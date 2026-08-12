// 数据模型与迁移：用户、角色、权限、刷新令牌、二维码登录会话。
import { openDb, migrate } from '@nexus/shared';

export const db = openDb('auth');

migrate(db, [
  ['users', `CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL, email TEXT, phone TEXT, avatar TEXT, dept_id TEXT,
    position TEXT, status TEXT DEFAULT 'active', mfa_secret TEXT, mfa_enabled INTEGER DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER)`],
  ['roles', `CREATE TABLE roles (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    description TEXT, data_scope TEXT DEFAULT 'self', builtin INTEGER DEFAULT 0, created_at INTEGER)`],
  ['permissions', `CREATE TABLE permissions (
    code TEXT PRIMARY KEY, name TEXT, module TEXT, description TEXT)`],
  ['role_permissions', `CREATE TABLE role_permissions (
    role_id TEXT, perm_code TEXT, PRIMARY KEY (role_id, perm_code))`],
  ['user_roles', `CREATE TABLE user_roles (
    user_id TEXT, role_id TEXT, PRIMARY KEY (user_id, role_id))`],
  ['refresh_tokens', `CREATE TABLE refresh_tokens (
    jti TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER, revoked INTEGER DEFAULT 0, created_at INTEGER)`],
  ['qr_sessions', `CREATE TABLE qr_sessions (
    id TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', user_id TEXT, created_at INTEGER, expires_at INTEGER)`],
  ['idx_users_dept', `CREATE INDEX idx_users_dept ON users(dept_id)`],
  ['idx_refresh_user', `CREATE INDEX idx_refresh_user ON refresh_tokens(user_id)`],
]);

export function getUserWithRoles(userId) {
  const user = db.get('SELECT * FROM users WHERE id = ?', String(userId));
  if (!user) return null;
  const roles = db.all(
    `SELECT r.* FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`, String(userId));
  const perms = db.all(
    `SELECT DISTINCT perm_code FROM role_permissions WHERE role_id IN
     (SELECT role_id FROM user_roles WHERE user_id = ?)`, String(userId)).map((r) => r.perm_code);
  // 数据范围取所有角色中最宽的范围
  const order = { self: 0, dept: 1, dept_and_sub: 2, all: 3 };
  const scope = roles.reduce((acc, r) => (order[r.data_scope] > order[acc] ? r.data_scope : acc), 'self');
  return { ...user, roles: roles.map((r) => r.code), roleNames: roles.map((r) => r.name), perms, scope };
}
