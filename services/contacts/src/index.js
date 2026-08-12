// nexus-contacts：通讯录与组织架构服务 HTTP 路由。
// 端口 8092。功能：部门树 CRUD/合并/排序、员工检索/详情/调岗、虚拟团队。
import { createService, asyncRoute, requireFields, badRequest, notFound, conflict, requirePerm, publishEvent } from '@nexus/shared';
import {
  db, seed, buildDeptTree, searchEmployees, getEmployee, getOrgRelations,
  transferEmployee, mergeDepartments, createVirtualTeam, getVirtualTeams,
} from './repo.js';

const INTERNAL_TOKEN = process.env.NEXUS_INTERNAL_TOKEN || 'nexus-internal-dev-token';

// 通过 im 服务查在线状态；im 不可达时回退 offline
async function fetchOnline(userId) {
  try {
    const r = await fetch(`http://localhost:8083/online/${userId}`, {
      headers: { 'x-internal-token': INTERNAL_TOKEN, 'x-user-id': 'internal' },
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.online;
  } catch { return false; }
}

const { ctx } = createService({
  name: 'contacts',
  port: 8092,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    // ---- 部门树 ----
    app.get('/departments', (req, res) => {
      const list = db.all('SELECT * FROM departments ORDER BY sort_order');
      res.json(buildDeptTree(list));
    });

    app.post('/departments', requirePerm('org:manage'), asyncRoute(async (req, res) => {
      requireFields(req.body, ['name']);
      const { name, code, parentId, managerId, sortOrder = 0, description } = req.body;
      if (code && db.get('SELECT id FROM departments WHERE code = ?', code)) throw conflict('部门编码已存在');
      const id = `dept-${Date.now().toString(36)}`;
      db.run('INSERT INTO departments (id,name,code,parent_id,manager_id,sort_order,description,created_at) VALUES (?,?,?,?,?,?,?,?)',
        id, name, code || null, parentId || null, managerId || null, sortOrder, description || '', Date.now());
      publishEvent('org.dept_created', { id, name, parentId }, 'contacts');
      res.status(201).json({ id });
    }));

    app.put('/departments/:id', requirePerm('org:manage'), (req, res) => {
      const d = db.get('SELECT * FROM departments WHERE id = ?', req.params.id);
      if (!d) throw notFound('部门不存在');
      const { name, code, parentId, managerId, sortOrder, description } = req.body;
      if (parentId === req.params.id) throw badRequest('部门不能以自身为上级');
      db.run(`UPDATE departments SET name=COALESCE(?,name), code=COALESCE(?,code), parent_id=COALESCE(?,parent_id),
        manager_id=COALESCE(?,manager_id), sort_order=COALESCE(?,sort_order), description=COALESCE(?,description) WHERE id=?`,
        name, code, parentId, managerId, sortOrder, description, req.params.id);
      res.json({ ok: true });
    });

    app.delete('/departments/:id', requirePerm('org:manage'), (req, res) => {
      const d = db.get('SELECT * FROM departments WHERE id = ?', req.params.id);
      if (!d) throw notFound('部门不存在');
      if (db.get('SELECT 1 FROM departments WHERE parent_id = ?', req.params.id)) throw badRequest('请先处理子部门');
      if (db.get('SELECT 1 FROM employees WHERE dept_id = ?', req.params.id)) throw badRequest('请先转移部门员工');
      db.run('DELETE FROM departments WHERE id = ?', req.params.id);
      res.json({ ok: true });
    });

    // 部门合并
    app.post('/departments/:id/merge', requirePerm('org:manage'), (req, res) => {
      requireFields(req.body, ['targetId']);
      if (!mergeDepartments(req.params.id, req.body.targetId)) throw badRequest('部门合并失败');
      publishEvent('org.dept_merged', { sourceId: req.params.id, targetId: req.body.targetId }, 'contacts');
      res.json({ ok: true });
    });

    // 部门排序
    app.put('/departments/:id/sort', requirePerm('org:manage'), (req, res) => {
      requireFields(req.body, ['sortOrder']);
      db.run('UPDATE departments SET sort_order = ? WHERE id = ?', req.body.sortOrder, req.params.id);
      res.json({ ok: true });
    });

    // ---- 员工检索 ----
    app.get('/employees', asyncRoute(async (req, res) => {
      const { dept, q } = req.query;
      const list = searchEmployees({ dept: dept || null, q: q || null });
      // 批量补在线状态（仅返回前 50 条以控制 im 调用量）
      const withStatus = await Promise.all(list.slice(0, 50).map(async (e) => ({ ...e, online: await fetchOnline(e.id) })));
      for (let i = 0; i < withStatus.length; i++) list[i] = withStatus[i];
      res.json(list);
    }));

    app.get('/employees/:id', asyncRoute(async (req, res) => {
      const emp = getEmployee(req.params.id);
      if (!emp) throw notFound('员工不存在');
      const rel = getOrgRelations(emp);
      // 工龄（年）：按毫秒差值折算
      const tenure = emp.hire_date ? Math.floor((Date.now() - new Date(emp.hire_date).getTime()) / (365.25 * 86400 * 1000)) : 0;
      res.json({ ...emp, tenure, online: await fetchOnline(emp.id), ...rel });
    }));

    app.post('/employees', requirePerm('org:manage'), asyncRoute(async (req, res) => {
      requireFields(req.body, ['name', 'empNo']);
      const { name, empNo, avatar, position, deptId, supervisorId, email, phone, internalPhone, hireDate, pinyin, pinyinInitials } = req.body;
      if (db.get('SELECT id FROM employees WHERE emp_no = ?', empNo)) throw conflict('工号已存在');
      const id = `user-${snowflake()}`;
      db.run(`INSERT INTO employees (id,name,emp_no,avatar,position,dept_id,supervisor_id,email,phone,internal_phone,hire_date,status,pinyin,pinyin_initials,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, name, empNo, avatar || '', position || '', deptId || null, supervisorId || null,
        email || '', phone || '', internalPhone || '', hireDate || '', 'active', pinyin || '', pinyinInitials || '', Date.now());
      publishEvent('org.employee_joined', { id, name, deptId }, 'contacts');
      res.status(201).json({ id });
    }));

    // 调岗
    app.put('/employees/:id/transfer', requirePerm('org:manage'), (req, res) => {
      requireFields(req.body, ['deptId']);
      const emp = transferEmployee(req.params.id, req.body);
      if (!emp) throw notFound('员工不存在');
      publishEvent('org.employee_transferred', { userId: req.params.id, deptId: req.body.deptId, position: req.body.position }, 'contacts');
      res.json(emp);
    });

    // 离职：冻结账号
    app.put('/employees/:id/status', requirePerm('org:manage'), (req, res) => {
      const { status } = req.body;
      if (!['active', 'frozen'].includes(status)) throw badRequest('非法状态');
      db.run('UPDATE employees SET status = ? WHERE id = ?', status, req.params.id);
      publishEvent('org.employee_status', { userId: req.params.id, status }, 'contacts');
      res.json({ ok: true });
    });

    // ---- 虚拟团队 ----
    app.get('/virtual-teams', (req, res) => res.json(getVirtualTeams()));

    app.post('/virtual-teams', requirePerm('org:manage'), asyncRoute(async (req, res) => {
      requireFields(req.body, ['name']);
      const { name, description, memberIds } = req.body;
      res.status(201).json(createVirtualTeam({ name, description, memberIds }));
    }));

    ctx.addDebug(() => ({
      departments: db.get('SELECT COUNT(*) c FROM departments').c,
      employees: db.get('SELECT COUNT(*) c FROM employees').c,
      virtualTeams: db.get('SELECT COUNT(*) c FROM virtual_teams').c,
    }));
  },
});

seed();
