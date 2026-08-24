// nexus-contacts：通讯录与组织架构数据层。
// 部门树、员工、虚拟团队、拼音检索字段。种子数据与 auth 服务的演示账号对齐。
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('contacts');

migrate(db, [
  ['departments', `CREATE TABLE departments (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE, parent_id TEXT,
    manager_id TEXT, sort_order INTEGER DEFAULT 0, description TEXT, created_at INTEGER)`],
  ['employees', `CREATE TABLE employees (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, emp_no TEXT UNIQUE, avatar TEXT,
    position TEXT, dept_id TEXT, supervisor_id TEXT, email TEXT, phone TEXT,
    internal_phone TEXT, hire_date TEXT, status TEXT DEFAULT 'active',
    pinyin TEXT DEFAULT '', pinyin_initials TEXT DEFAULT '', created_at INTEGER)`],
  ['idx_emp_dept', `CREATE INDEX idx_emp_dept ON employees(dept_id)`],
  ['virtual_teams', `CREATE TABLE virtual_teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at INTEGER)`],
  ['virtual_team_members', `CREATE TABLE virtual_team_members (
    team_id TEXT, user_id TEXT, PRIMARY KEY (team_id, user_id))`],
]);

// 种子部门与员工：与 auth 服务的演示账号一一对应
export function seed() {
  if (db.get('SELECT COUNT(*) c FROM departments').c > 0) return;
  const now = Date.now();
  const depts = [
    ['dept-root', 'Nexus 集团', 'root', null, 'user-admin', 0, '集团总部'],
    ['dept-rd', '研发部', 'rd', 'dept-root', 'user-zhangwei', 1, '产品研发'],
    ['dept-hr', '人力资源部', 'hr', 'dept-root', 'user-lina', 2, '人力资源管理'],
    ['dept-fin', '财务部', 'fin', 'dept-root', 'user-wangfang', 3, '财务管理'],
    ['dept-mkt', '市场部', 'mkt', 'dept-root', 'user-chenjie', 4, '市场与品牌'],
  ];
  for (const [id, name, code, pid, mgr, sort, desc] of depts) {
    db.run('INSERT OR IGNORE INTO departments (id,name,code,parent_id,manager_id,sort_order,description,created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, name, code, pid, mgr, sort, desc, now);
  }
  // 员工：id 与 auth users 表一致，便于跨服务关联
  const emps = [
    ['user-admin', '系统管理员', 'EMP001', 'dept-root', null, '平台管理员', 'admin@nexus.local', '13800000001', '1001', '2024-01-01', 'xtgly', 'xt'],
    ['user-zhangwei', '张伟', 'EMP002', 'dept-rd', 'user-admin', '研发总监', 'zhangwei@nexus.local', '13800000002', '1002', '2024-03-15', 'zhangwei', 'zw'],
    ['user-lina', '李娜', 'EMP003', 'dept-hr', 'user-admin', 'HR 经理', 'lina@nexus.local', '13800000003', '1003', '2024-05-20', 'lina', 'ln'],
    ['user-wangfang', '王芳', 'EMP004', 'dept-fin', 'user-admin', '财务专员', 'wangfang@nexus.local', '13800000004', '1004', '2024-07-01', 'wangfang', 'wf'],
    ['user-chenjie', '陈杰', 'EMP005', 'dept-mkt', 'user-admin', '市场专员', 'chenjie@nexus.local', '13800000005', '1005', '2024-08-10', 'chenjie', 'cj'],
    ['user-liuyang', '刘洋', 'EMP006', 'dept-rd', 'user-zhangwei', '前端工程师', 'liuyang@nexus.local', '13800000006', '1006', '2024-09-05', 'liuyang', 'ly'],
  ];
  for (const [id, name, empNo, dept, sup, pos, email, phone, ip, hire, py, ini] of emps) {
    db.run(`INSERT OR IGNORE INTO employees (id,name,emp_no,position,dept_id,supervisor_id,email,phone,internal_phone,hire_date,status,pinyin,pinyin_initials,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, name, empNo, pos, dept, sup, email, phone, ip, hire, 'active', py, ini, now);
  }
  // 演示虚拟团队
  const vt = 'vt-digital';
  db.run('INSERT OR IGNORE INTO virtual_teams (id,name,description,created_at) VALUES (?,?,?,?)', vt, '数字化转型项目组', '跨部门虚拟团队', now);
  for (const u of ['user-zhangwei', 'user-lina', 'user-liuyang']) {
    db.run('INSERT OR IGNORE INTO virtual_team_members (team_id,user_id) VALUES (?,?)', vt, u);
  }
  console.log('[contacts] seeded departments/employees');
}

// 由扁平部门列表构建多级树
export function buildDeptTree(list) {
  const map = new Map(list.map((d) => [d.id, { ...d, children: [], manager_name: null, headcount: 0 }]));
  const roots = [];
  for (const d of map.values()) {
    if (d.parent_id && map.has(d.parent_id)) map.get(d.parent_id).children.push(d);
    else roots.push(d);
  }
  // 填充负责人姓名与部门人数
  const allEmps = db.all('SELECT id, name, dept_id FROM employees WHERE status = ?', 'active');
  const empMap = new Map(allEmps.map((e) => [e.id, e]));
  for (const d of map.values()) {
    if (d.manager_id && empMap.has(d.manager_id)) d.manager_name = empMap.get(d.manager_id).name;
    d.headcount = allEmps.filter((e) => e.dept_id === d.id).length;
    d.employee_count = d.headcount;
  }
  const sortRec = (nodes) => { nodes.sort((a, b) => a.sort_order - b.sort_order); for (const n of nodes) sortRec(n.children); };
  sortRec(roots);
  return roots;
}

// 收集部门及其所有子部门 id（用于按部门查询时包含下属）
export function collectDeptIds(deptId) {
  const ids = [deptId];
  const children = db.all('SELECT id FROM departments WHERE parent_id = ?', deptId);
  for (const c of children) ids.push(...collectDeptIds(c.id));
  return ids;
}

// 员工搜索：支持姓名/工号/职位/手机号/拼音/拼音首字母
export function searchEmployees({ dept, q, includeSub = true }) {
  let sql = "SELECT * FROM employees WHERE status = 'active'";
  const params = [];
  if (dept) {
    const ids = includeSub ? collectDeptIds(dept) : [dept];
    sql += ` AND dept_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (q) {
    sql += ` AND (name LIKE ? OR emp_no LIKE ? OR position LIKE ? OR phone LIKE ? OR pinyin LIKE ? OR pinyin_initials LIKE ?)`;
    const term = `%${q}%`;
    params.push(term, term, term, term, term, term);
  }
  sql += ' ORDER BY emp_no LIMIT 200';
  return db.all(sql, ...params);
}

export function getEmployee(id) {
  return db.get('SELECT * FROM employees WHERE id = ?', String(id));
}

// 组织关系：上级 + 下属列表
export function getOrgRelations(emp) {
  const supervisor = emp.supervisor_id ? db.get('SELECT id,name,position,avatar FROM employees WHERE id = ?', emp.supervisor_id) : null;
  const subordinates = db.all('SELECT id,name,position,avatar FROM employees WHERE supervisor_id = ? AND status = ?', emp.id, 'active');
  const dept = emp.dept_id ? db.get('SELECT id,name,code FROM departments WHERE id = ?', emp.dept_id) : null;
  return { supervisor, subordinates, dept };
}

// 调岗：变更部门/职位/上级，记录事件
export function transferEmployee(id, { deptId, position, supervisorId }) {
  const emp = getEmployee(id);
  if (!emp) return null;
  db.run('UPDATE employees SET dept_id = COALESCE(?, dept_id), position = COALESCE(?, position), supervisor_id = COALESCE(?, supervisor_id) WHERE id = ?',
    deptId ?? null, position ?? null, supervisorId ?? null, String(id));
  return getEmployee(id);
}

// 部门合并：将源部门的子部门与员工迁移到目标部门，然后删除源部门
export function mergeDepartments(sourceId, targetId) {
  if (sourceId === targetId) return false;
  db.tx(() => {
    db.run('UPDATE departments SET parent_id = ? WHERE parent_id = ?', targetId, sourceId);
    db.run('UPDATE employees SET dept_id = ? WHERE dept_id = ?', targetId, sourceId);
    db.run('DELETE FROM departments WHERE id = ?', sourceId);
  });
  return true;
}

export function createVirtualTeam({ name, description, memberIds = [] }) {
  const id = `vt-${snowflake()}`;
  db.tx(() => {
    db.run('INSERT INTO virtual_teams (id,name,description,created_at) VALUES (?,?,?,?)', id, name, description || '', Date.now());
    for (const u of memberIds) db.run('INSERT OR IGNORE INTO virtual_team_members (team_id,user_id) VALUES (?,?)', id, String(u));
  });
  return { id };
}

export function getVirtualTeams() {
  const teams = db.all('SELECT * FROM virtual_teams ORDER BY created_at');
  for (const t of teams) {
    t.members = db.all('SELECT user_id FROM virtual_team_members WHERE team_id = ?', t.id).map((m) => m.user_id);
  }
  return teams;
}
