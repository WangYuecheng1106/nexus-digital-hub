// nexus-project：HTTP REST 路由
// 项目 CRUD + 任务 CRUD + 看板移动 + 评论 + 甘特图 + 统计。
// 看板移动记录日志便于追溯；甘特图与统计在服务端聚合，前端直接渲染。
import { asyncRoute, requireFields, badRequest, forbidden, notFound, pageParams, publishEvent, snowflake } from '@nexus/shared';
import { db, insertProject, insertTask, logAction, buildGantt, buildStats, BOARD_COLUMNS } from './repo.js';

export function setupRoutes(app) {
  // ---- 项目 CRUD ----
  app.post('/projects', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name']);
    const p = insertProject(String(req.user.sub), req.body);
    publishEvent('project.created', { projectId: p.id, ownerId: req.user.sub }, 'project');
    res.status(201).json(p);
  }));

  app.get('/projects', (req, res) => {
    const { page, size, offset } = pageParams(req);
    const archived = req.query.archived === 'true' ? 1 : 0;
    const total = db.get('SELECT COUNT(*) c FROM projects WHERE archived = ?', archived).c;
    const rows = db.all('SELECT * FROM projects WHERE archived = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', archived, size, offset);
    res.json({ page, size, total, items: rows });
  });

  app.get('/projects/:id', (req, res) => {
    const p = db.get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!p) throw notFound('项目不存在');
    const taskCount = db.get('SELECT COUNT(*) c FROM tasks WHERE project_id = ?', p.id).c;
    const doneCount = db.get("SELECT COUNT(*) c FROM tasks WHERE project_id = ? AND board_column IN ('done','closed')", p.id).c;
    res.json({ ...p, taskCount, doneCount, progress: taskCount ? Math.round((doneCount / taskCount) * 100) : 0 });
  });

  app.put('/projects/:id', (req, res) => {
    const p = db.get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!p) throw notFound('项目不存在');
    if (p.owner_id !== String(req.user.sub)) throw forbidden('仅所有者可编辑');
    db.run('UPDATE projects SET name=COALESCE(?,name), desc=COALESCE(?,desc), color=COALESCE(?,color) WHERE id=?',
      req.body.name, req.body.desc, req.body.color, req.params.id);
    res.json({ ok: true });
  });

  app.post('/projects/:id/archive', (req, res) => {
    db.run('UPDATE projects SET archived=1 WHERE id=?', req.params.id);
    res.json({ ok: true });
  });

  app.post('/projects/:id/unarchive', (req, res) => {
    db.run('UPDATE projects SET archived=0 WHERE id=?', req.params.id);
    res.json({ ok: true });
  });

  app.delete('/projects/:id', (req, res) => {
    const p = db.get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!p) throw notFound('项目不存在');
    if (p.owner_id !== String(req.user.sub)) throw forbidden('仅所有者可删除');
    db.tx(() => {
      db.run('DELETE FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', req.params.id);
      db.run('DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', req.params.id);
      db.run('DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', req.params.id);
      db.run('DELETE FROM tasks WHERE project_id = ?', req.params.id);
      db.run('DELETE FROM projects WHERE id = ?', req.params.id);
    });
    res.json({ ok: true });
  });

  // ---- 任务 CRUD ----
  app.post('/projects/:id/tasks', asyncRoute(async (req, res) => {
    requireFields(req.body, ['title']);
    const p = db.get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!p) throw notFound('项目不存在');
    if (p.archived) throw badRequest('已归档项目不可添加任务');
    const t = insertTask(req.params.id, req.body);
    publishEvent('project.task_created', { projectId: req.params.id, taskId: t.id }, 'project');
    res.status(201).json(t);
  }));

  app.get('/projects/:id/tasks', (req, res) => {
    const view = req.query.view || 'board';
    const rows = db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, created_at', req.params.id);
    if (view === 'list') return res.json(rows);
    // 看板视图按列分组
    const board = {};
    for (const col of BOARD_COLUMNS) board[col] = rows.filter((t) => t.board_column === col);
    res.json({ view: 'board', columns: BOARD_COLUMNS, board });
  });

  app.get('/tasks/:id', (req, res) => {
    const t = db.get('SELECT * FROM tasks WHERE id = ?', req.params.id);
    if (!t) throw notFound('任务不存在');
    t.labels = t.label_ids ? JSON.parse(t.label_ids) : [];
    t.subtasks = db.all('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY sort_order', t.id);
    t.dependencies = db.all('SELECT * FROM task_dependencies WHERE task_id = ?', t.id);
    t.comments = db.all('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at', t.id);
    res.json(t);
  });

  app.put('/tasks/:id', (req, res) => {
    const t = db.get('SELECT * FROM tasks WHERE id = ?', req.params.id);
    if (!t) throw notFound('任务不存在');
    const { title, desc, assignee_id, priority, label_ids, due_date, est_hours, status, sort_order } = req.body;
    db.run(`UPDATE tasks SET title=COALESCE(?,title), desc=COALESCE(?,desc), assignee_id=COALESCE(?,assignee_id),
      priority=COALESCE(?,priority), label_ids=COALESCE(?,label_ids), due_date=COALESCE(?,due_date),
      est_hours=COALESCE(?,est_hours), status=COALESCE(?,status), sort_order=COALESCE(?,sort_order) WHERE id=?`,
      title, desc, assignee_id, priority, label_ids ? JSON.stringify(label_ids) : null,
      due_date, est_hours, status, sort_order, req.params.id);
    if (assignee_id && assignee_id !== t.assignee_id) logAction(t.id, req.user.sub, 'assigned', `指派给 ${assignee_id}`);
    res.json({ ok: true });
  });

  // ---- 看板移动 ----
  app.put('/tasks/:id/move', (req, res) => {
    requireFields(req.body, ['column']);
    if (!BOARD_COLUMNS.includes(req.body.column)) throw badRequest(`列必须为 ${BOARD_COLUMNS.join('/')}`);
    const t = db.get('SELECT * FROM tasks WHERE id = ?', req.params.id);
    if (!t) throw notFound('任务不存在');
    const from = t.board_column;
    db.run('UPDATE tasks SET board_column=?, status=?, sort_order=? WHERE id=?',
      req.body.column, req.body.column, req.body.sort_order || 0, req.params.id);
    logAction(t.id, req.user.sub, 'moved', `${from} → ${req.body.column}`);
    publishEvent('project.task_moved', { taskId: t.id, from, to: req.body.column }, 'project');
    res.json({ ok: true, from, to: req.body.column });
  });

  app.delete('/tasks/:id', (req, res) => {
    db.tx(() => {
      db.run('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_id = ?', req.params.id, req.params.id);
      db.run('DELETE FROM task_comments WHERE task_id = ?', req.params.id);
      db.run('DELETE FROM task_logs WHERE task_id = ?', req.params.id);
      db.run('DELETE FROM tasks WHERE id = ? OR parent_task_id = ?', req.params.id, req.params.id);
    });
    res.json({ ok: true });
  });

  // ---- 任务依赖 ----
  app.post('/tasks/:id/dependencies', (req, res) => {
    requireFields(req.body, ['depends_on_id', 'type']);
    if (!['FS', 'FF', 'SS', 'SF'].includes(req.body.type)) throw badRequest('依赖类型必须为 FS/FF/SS/SF');
    if (req.body.depends_on_id === req.params.id) throw badRequest('不能依赖自身');
    const id = snowflake();
    db.run('INSERT INTO task_dependencies (id,task_id,depends_on_id,type) VALUES (?,?,?,?)',
      id, req.params.id, req.body.depends_on_id, req.body.type);
    res.status(201).json({ id });
  });

  // ---- 评论 ----
  app.post('/tasks/:id/comments', (req, res) => {
    requireFields(req.body, ['content']);
    const id = snowflake();
    db.run('INSERT INTO task_comments (id,task_id,user_id,content,created_at) VALUES (?,?,?,?,?)',
      id, req.params.id, String(req.user.sub), req.body.content, Date.now());
    logAction(req.params.id, req.user.sub, 'commented', '新增评论');
    res.status(201).json({ id, task_id: req.params.id, user_id: req.user.sub, content: req.body.content, created_at: Date.now() });
  });

  app.get('/tasks/:id/comments', (req, res) => {
    res.json(db.all('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at', req.params.id));
  });

  // ---- 甘特图 + 统计 ----
  app.get('/projects/:id/gantt', (req, res) => res.json(buildGantt(req.params.id)));
  app.get('/projects/:id/stats', (req, res) => res.json(buildStats(req.params.id)));

  // ---- 任务动态日志 ----
  app.get('/tasks/:id/logs', (req, res) => {
    res.json(db.all('SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at DESC', req.params.id));
  });
}
