// 初始化种子数据：权限目录、内置角色、演示账号与组织架构用户。
// 口令经 BCrypt(cost=12) 散列存储；演示账号仅用于本地开发环境。
import { hashPassword } from '@nexus/shared';
import { db } from './repo.js';

const PERMISSIONS = [
  ['*', '超级权限', 'admin', '拥有全部权限'],
  ['auth:role:view', '查看角色', 'auth', ''], ['auth:role:manage', '管理角色', 'auth', ''],
  ['auth:user:manage', '管理用户', 'auth', ''], ['auth:audit:view', '查看审计日志', 'auth', ''],
  ['im:send', '发送消息', 'im', ''], ['im:recall', '撤回消息', 'im', ''], ['im:group:manage', '群组管理', 'im', ''],
  ['meeting:create', '发起会议', 'meeting', ''], ['meeting:record', '会议录制', 'meeting', ''], ['meeting:manage', '会议管理', 'meeting', ''],
  ['doc:create', '创建文档', 'document', ''], ['doc:share', '分享文档', 'document', ''], ['doc:manage', '管理文档', 'document', ''],
  ['wf:design', '流程设计', 'workflow', ''], ['wf:approve', '审批处理', 'workflow', ''], ['wf:monitor', '流程监控', 'workflow', ''],
  ['kg:view', '查看关系图谱', 'knowledge', ''], ['kg:manage', '管理图谱数据', 'knowledge', ''],
  ['cal:manage', '日程管理', 'calendar', ''],
  ['drive:upload', '上传文件', 'drive', ''], ['drive:share', '分享文件', 'drive', ''], ['drive:manage', '云盘管理', 'drive', ''],
  ['proj:manage', '项目管理', 'project', ''],
  ['att:punch', '考勤打卡', 'attendance', ''], ['att:manage', '考勤管理', 'attendance', ''], ['att:report', '考勤报表', 'attendance', ''],
  ['org:view', '查看通讯录', 'contacts', ''], ['org:manage', '管理组织架构', 'contacts', ''],
  ['forum:post', '论坛发帖', 'forum', ''], ['forum:moderate', '论坛管理', 'forum', ''],
  ['notif:manage', '通知管理', 'notification', ''],
  ['integ:manage', '集成管理', 'integration', ''],
  ['ai:use', '使用 AI 助手', 'ai', ''],
  ['ana:view', '查看数据报表', 'analytics', ''], ['ana:manage', '管理报表', 'analytics', ''],
];

const ROLES = [
  { code: 'admin', name: '系统管理员', desc: '平台超级管理员', scope: 'all', perms: ['*'] },
  {
    code: 'manager', name: '部门经理', desc: '部门管理者，可审批与查看部门数据', scope: 'dept_and_sub',
    perms: ['im:send', 'im:recall', 'im:group:manage', 'meeting:create', 'meeting:record', 'doc:create', 'doc:share',
      'wf:approve', 'wf:monitor', 'kg:view', 'cal:manage', 'drive:upload', 'drive:share', 'proj:manage',
      'att:punch', 'att:manage', 'att:report', 'org:view', 'forum:post', 'forum:moderate', 'ai:use', 'ana:view'],
  },
  {
    code: 'employee', name: '普通员工', desc: '标准员工权限', scope: 'self',
    perms: ['im:send', 'im:recall', 'meeting:create', 'doc:create', 'doc:share', 'wf:approve', 'kg:view',
      'cal:manage', 'drive:upload', 'drive:share', 'att:punch', 'org:view', 'forum:post', 'ai:use'],
  },
  { code: 'auditor', name: '审计员', desc: '只读合规审查', scope: 'all', perms: ['auth:audit:view', 'ana:view', 'org:view', 'kg:view'] },
];

const USERS = [
  { username: 'admin', name: '系统管理员', password: 'Admin@1234', roles: ['admin'], dept: 'dept-root', position: '平台管理员', email: 'admin@nexus.local', phone: '13800000001' },
  { username: 'zhangwei', name: '张伟', password: 'Nexus@1234', roles: ['manager'], dept: 'dept-rd', position: '研发总监', email: 'zhangwei@nexus.local', phone: '13800000002' },
  { username: 'lina', name: '李娜', password: 'Nexus@1234', roles: ['manager'], dept: 'dept-hr', position: 'HR 经理', email: 'lina@nexus.local', phone: '13800000003' },
  { username: 'wangfang', name: '王芳', password: 'Nexus@1234', roles: ['employee'], dept: 'dept-fin', position: '财务专员', email: 'wangfang@nexus.local', phone: '13800000004' },
  { username: 'chenjie', name: '陈杰', password: 'Nexus@1234', roles: ['employee'], dept: 'dept-mkt', position: '市场专员', email: 'chenjie@nexus.local', phone: '13800000005' },
  { username: 'liuyang', name: '刘洋', password: 'Nexus@1234', roles: ['employee', 'auditor'], dept: 'dept-rd', position: '前端工程师', email: 'liuyang@nexus.local', phone: '13800000006' },
];

export function seed() {
  if (db.get('SELECT COUNT(*) c FROM permissions').c > 0) return;
  const now = Date.now();
  db.tx(() => {
    for (const [code, name, module, description] of PERMISSIONS) {
      db.run('INSERT OR IGNORE INTO permissions (code, name, module, description) VALUES (?,?,?,?)', code, name, module, description);
    }
    const roleIds = {};
    for (const r of ROLES) {
      const id = `role-${r.code}`;
      roleIds[r.code] = id;
      db.run('INSERT OR IGNORE INTO roles (id, code, name, description, data_scope, builtin, created_at) VALUES (?,?,?,?,?,1,?)',
        id, r.code, r.name, r.desc, r.scope, now);
      for (const p of r.perms) db.run('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?,?)', id, p);
    }
    for (const u of USERS) {
      if (db.get('SELECT id FROM users WHERE username = ?', u.username)) continue;
      const id = `user-${u.username}`;
      db.run(`INSERT INTO users (id, username, password_hash, display_name, email, phone, dept_id, position, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id, u.username, hashPassword(u.password), u.name, u.email, u.phone, u.dept, u.position, 'active', now, now);
      for (const rc of u.roles) db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)', id, roleIds[rc]);
    }
  });
  console.log('[auth] seeded permissions/roles/users');
}
