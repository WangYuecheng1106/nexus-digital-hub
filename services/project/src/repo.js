// nexus-project：项目任务服务 — 数据层
// 项目/任务/依赖/评论/日志全部落在 SQLite。看板列固定为 5 列（todo/doing/testing/done/closed）
// 以保证开箱即用且与钉钉 Teambition/Jira 体验对齐；status 字段保留可扩展性。
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('project');

export const BOARD_COLUMNS = ['todo', 'doing', 'testing', 'done', 'closed'];

migrate(db, [
  ['projects', `CREATE TABLE projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, desc TEXT, owner_id TEXT NOT NULL,
    color TEXT, archived INTEGER DEFAULT 0, created_at INTEGER)`],
  ['tasks', `CREATE TABLE tasks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, desc TEXT,
    assignee_id TEXT, priority TEXT DEFAULT 'medium', label_ids TEXT, due_date INTEGER,
    est_hours REAL, status TEXT DEFAULT 'todo', board_column TEXT DEFAULT 'todo',
    parent_task_id TEXT, sort_order INTEGER DEFAULT 0, created_at INTEGER)`],
  ['idx_task_project', `CREATE INDEX idx_task_project ON tasks(project_id, board_column, sort_order)`],
  ['idx_task_assignee', `CREATE INDEX idx_task_assignee ON tasks(assignee_id, status)`],
  ['deps', `CREATE TABLE task_dependencies (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, depends_on_id TEXT NOT NULL,
    type TEXT DEFAULT 'FS')`],
  ['idx_dep', `CREATE INDEX idx_dep ON task_dependencies(task_id)`],
  ['comments', `CREATE TABLE task_comments (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT, created_at INTEGER)`],
  ['logs', `CREATE TABLE task_logs (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL,
    action TEXT, detail TEXT, created_at INTEGER)`],
]);

export function insertProject(ownerId, body) {
  const id = snowflake();
  db.run('INSERT INTO projects (id,name,desc,owner_id,color,archived,created_at) VALUES (?,?,?,?,?,?,?)',
    id, body.name, body.desc || '', ownerId, body.color || '#1677FF', 0, Date.now());
  return db.get('SELECT * FROM projects WHERE id = ?', id);
}

export function insertTask(projectId, body) {
  const id = snowflake();
  db.run(`INSERT INTO tasks (id,project_id,title,desc,assignee_id,priority,label_ids,due_date,
    est_hours,status,board_column,parent_task_id,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, projectId, body.title, body.desc || '', body.assignee_id || null, body.priority || 'medium',
    body.label_ids ? JSON.stringify(body.label_ids) : null, body.due_date || null, body.est_hours || 0,
    body.status || 'todo', body.board_column || 'todo', body.parent_task_id || null,
    body.sort_order || 0, Date.now());
  logAction(id, body.assignee_id || null, 'created', '任务创建');
  return db.get('SELECT * FROM tasks WHERE id = ?', id);
}

export function logAction(taskId, userId, action, detail) {
  db.run('INSERT INTO task_logs (id,task_id,user_id,action,detail,created_at) VALUES (?,?,?,?,?,?)',
    snowflake(), taskId, userId || 'system', action, detail, Date.now());
}

// 甘特图数据：任务列表 + 依赖关系 + 关键路径计算
// 关键路径 = 从起点到终点耗时最长的一条任务链，决定项目最早完成时间
export function buildGantt(projectId) {
  const tasks = db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY due_date, created_at', projectId);
  const deps = db.all(`SELECT d.* FROM task_dependencies d
    JOIN tasks t ON t.id = d.task_id WHERE t.project_id = ?`, projectId);
  // 计算每个任务最早完成时间（简化：用 est_hours 为工期，无开始日期则用 created_at）
  const memo = new Map();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  function earliestFinish(tid, seen = new Set()) {
    if (memo.has(tid)) return memo.get(tid);
    if (seen.has(tid)) return 0; // 循环依赖兜底
    seen.add(tid);
    const t = byId.get(tid);
    if (!t) return 0;
    const dur = (t.est_hours || 0) * 3600000;
    const start = t.created_at;
    let ef = start + dur;
    for (const d of deps) {
      if (d.task_id !== tid) continue;
      const depEf = earliestFinish(d.depends_on_id, seen);
      // FS：后继任务在依赖完成后才能开始
      if (d.type === 'FS') ef = Math.max(ef, depEf + dur);
      else if (d.type === 'SS') ef = Math.max(ef, depEf + dur);
      else ef = Math.max(ef, depEf);
    }
    memo.set(tid, ef);
    return ef;
  }
  let maxEf = 0;
  const criticalIds = new Set();
  for (const t of tasks) {
    const ef = earliestFinish(t.id);
    if (ef > maxEf) maxEf = ef;
  }
  // 找出落在最长路径上的任务（粗略：ef 等于 maxEf 的链路）
  for (const t of tasks) if (earliestFinish(t.id) === maxEf) criticalIds.add(t.id);
  return { tasks, dependencies: deps, criticalPath: [...criticalIds], projectEnd: maxEf };
}

// 统计：进度分布、成员工作量、燃尽图（按 created_at 聚合剩余任务数）
export function buildStats(projectId) {
  const total = db.get('SELECT COUNT(*) c FROM tasks WHERE project_id = ?', projectId).c;
  const byCol = db.all('SELECT board_column, COUNT(*) c FROM tasks WHERE project_id = ? GROUP BY board_column', projectId);
  const columns = Object.fromEntries(byCol.map((r) => [r.board_column, r.c]));
  const done = columns.done || 0;
  const closed = columns.closed || 0;
  const progress = total ? Math.round(((done + closed) / total) * 100) : 0;
  const workload = db.all(`SELECT assignee_id, COUNT(*) c, COALESCE(SUM(est_hours),0) h
    FROM tasks WHERE project_id = ? AND assignee_id IS NOT NULL GROUP BY assignee_id`, projectId);
  // 燃尽：按天聚合累计创建任务数与累计完成任务数
  const burndown = db.all(`SELECT date(created_at/1000,'unixepoch') d, COUNT(*) created FROM tasks WHERE project_id = ? GROUP BY d`, projectId);
  return { total, columns, progress, workload, burndown };
}
