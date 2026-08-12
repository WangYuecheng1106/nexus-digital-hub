// nexus-auth：统一身份认证与权限管理。
// OAuth2.0/OIDC 风格令牌端点 + RBAC/ABAC 混合权限 + MFA(TOTP) + 扫码登录 +
// 登录锁定策略 + 权限审计。JWT 使用 RS256，私钥仅存本服务。
import { createService, asyncRoute, requireFields, badRequest, unauthorized, forbidden, conflict,
  hashPassword, comparePassword, signAccessToken, signRefreshToken, verifyToken,
  totpSecret, totpVerify, randomToken, snowflake, auditLog, publishEvent, requirePerm } from '@nexus/shared';
import QRCode from 'qrcode';
import { db, getUserWithRoles } from './repo.js';
import { seed } from './seed.js';

const REFRESH_TTL = 7 * 24 * 3600 * 1000;
const LOCK_MINUTES = 15;
const MAX_FAILS = 5;

function issueTokens(user) {
  const full = getUserWithRoles(user.id);
  const accessToken = signAccessToken(full);
  const jti = snowflake();
  db.run('INSERT INTO refresh_tokens (jti, user_id, expires_at, revoked, created_at) VALUES (?,?,?,0,?)',
    jti, String(full.id), Date.now() + REFRESH_TTL, Date.now());
  const refreshToken = signRefreshToken(full.id, jti);
  return { accessToken, refreshToken, expiresIn: 1800, tokenType: 'Bearer' };
}

function publicUser(u) {
  const { password_hash, mfa_secret, failed_attempts, ...rest } = u;
  return rest;
}

const { ctx } = createService({
  name: 'auth',
  port: 8081,
  publicPaths: ['/login', '/refresh', '/register', '/qr/*', '/.well-known/*', '/logout'],
  setup(app, ctx) {
    // ---- 注册（企业内网场景下默认开放，可由环境变量关闭）----
    app.post('/register', asyncRoute(async (req, res) => {
      requireFields(req.body, ['username', 'password', 'displayName']);
      const { username, password, displayName, email, phone } = req.body;
      if (db.get('SELECT id FROM users WHERE username = ?', username)) throw conflict('用户名已存在');
      if (String(password).length < 8) throw badRequest('密码长度至少 8 位');
      const id = snowflake();
      db.run(`INSERT INTO users (id, username, password_hash, display_name, email, phone, dept_id, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, username, hashPassword(password), displayName, email || '', phone || '', 'root', 'active', Date.now(), Date.now());
      const employee = db.get(`SELECT id FROM roles WHERE code = 'employee'`);
      if (employee) db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)', id, employee.id);
      auditLog(db, { userId: id, username, action: 'register', resource: 'user', resourceId: id });
      res.status(201).json({ id, username });
    }));

    // ---- 登录：口令校验 → 锁定策略 → (可选)MFA → 签发令牌 ----
    app.post('/login', asyncRoute(async (req, res) => {
      requireFields(req.body, ['username', 'password']);
      const { username, password, mfaCode } = req.body;
      const user = db.get('SELECT * FROM users WHERE username = ?', username);
      if (!user || user.status !== 'active') throw unauthorized('用户名或密码错误');
      if (user.locked_until > Date.now()) {
        throw unauthorized(`账号已锁定，请于 ${new Date(user.locked_until).toLocaleTimeString('zh-CN')} 后重试`);
      }
      if (!comparePassword(password, user.password_hash)) {
        const fails = user.failed_attempts + 1;
        const lockUntil = fails >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0;
        db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', fails, lockUntil, user.id);
        auditLog(db, { userId: user.id, username, action: 'login_failed', resource: 'auth', ip: req.ip });
        throw unauthorized(fails >= MAX_FAILS ? `连续失败 ${MAX_FAILS} 次，账号锁定 ${LOCK_MINUTES} 分钟` : '用户名或密码错误');
      }
      if (user.mfa_enabled) {
        if (!mfaCode) return res.status(200).json({ mfaRequired: true });
        if (!totpVerify(user.mfa_secret, mfaCode)) throw unauthorized('动态验证码错误');
      }
      db.run('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?', user.id);
      auditLog(db, { userId: user.id, username, action: 'login', resource: 'auth', ip: req.ip });
      publishEvent('auth.login', { userId: user.id, username }, 'auth');
      res.json({ ...issueTokens(user), user: publicUser(getUserWithRoles(user.id)) });
    }));

    // ---- 刷新令牌（旋转：旧令牌即刻作废）----
    app.post('/refresh', asyncRoute(async (req, res) => {
      requireFields(req.body, ['refreshToken']);
      let payload;
      try { payload = verifyToken(req.body.refreshToken); } catch { throw unauthorized('refresh token 无效或已过期'); }
      if (payload.typ !== 'refresh') throw unauthorized('令牌类型错误');
      const stored = db.get('SELECT * FROM refresh_tokens WHERE jti = ?', payload.jti);
      if (!stored || stored.revoked || stored.expires_at < Date.now()) throw unauthorized('refresh token 已失效');
      db.run('UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?', payload.jti);
      const user = db.get('SELECT * FROM users WHERE id = ?', payload.sub);
      if (!user || user.status !== 'active') throw unauthorized('账号不可用');
      res.json(issueTokens(user));
    }));

    app.post('/logout', (req, res) => {
      if (req.user) {
        db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', String(req.user.sub));
        auditLog(db, { userId: req.user.sub, username: req.user.username, action: 'logout', resource: 'auth', ip: req.ip });
      }
      res.json({ ok: true });
    });

    // ---- 当前用户 ----
    app.get('/me', (req, res) => res.json(publicUser(getUserWithRoles(req.user.sub))));

    // ---- 批量查询用户公开资料（其他服务解析展示名/头像用）----
    app.get('/users/batch', (req, res) => {
      const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
      if (!ids.length) return res.json([]);
      const marks = ids.map(() => '?').join(',');
      const users = db.all(`SELECT * FROM users WHERE id IN (${marks})`, ...ids);
      res.json(users.map((u) => publicUser({ ...u, roles: undefined, perms: undefined, scope: undefined })));
    });

    // ---- 用户管理（管理员）----
    app.get('/users', requirePerm('auth:user:manage'), (req, res) => {
      const users = db.all('SELECT * FROM users ORDER BY created_at LIMIT 500');
      res.json(users.map((u) => publicUser(getUserWithRoles(u.id))));
    });

    app.put('/users/:id/status', requirePerm('auth:user:manage'), (req, res) => {
      const { status } = req.body; // active / frozen
      if (!['active', 'frozen'].includes(status)) throw badRequest('非法状态');
      db.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), req.params.id);
      auditLog(db, { userId: req.user.sub, username: req.user.username, action: 'user_status', resource: 'user', resourceId: req.params.id, detail: { status } });
      publishEvent('auth.user_status', { userId: req.params.id, status }, 'auth');
      res.json({ ok: true });
    });

    app.put('/users/:id/password', (req, res) => {
      requireFields(req.body, ['oldPassword', 'newPassword']);
      const user = db.get('SELECT * FROM users WHERE id = ?', String(req.user.sub));
      if (String(req.user.sub) !== req.params.id && !(req.user.perms || []).includes('*')) throw forbidden();
      const target = db.get('SELECT * FROM users WHERE id = ?', req.params.id);
      if (String(req.user.sub) === req.params.id && !comparePassword(req.body.oldPassword, user.password_hash)) throw unauthorized('原密码错误');
      if (String(req.body.newPassword).length < 8) throw badRequest('密码长度至少 8 位');
      db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(req.body.newPassword), Date.now(), target.id);
      db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', target.id);
      auditLog(db, { userId: req.user.sub, username: req.user.username, action: 'password_change', resource: 'user', resourceId: target.id });
      res.json({ ok: true });
    });

    // ---- MFA：TOTP 设置/启用/关闭 ----
    app.post('/mfa/setup', asyncRoute(async (req, res) => {
      const user = db.get('SELECT * FROM users WHERE id = ?', String(req.user.sub));
      const secret = totpSecret();
      db.run('UPDATE users SET mfa_secret = ? WHERE id = ?', secret, user.id);
      const otpauth = `otpauth://totp/Nexus:${encodeURIComponent(user.username)}?secret=${secret}&issuer=Nexus`;
      res.json({ secret, otpauth, qr: await QRCode.toDataURL(otpauth) });
    }));

    app.post('/mfa/enable', (req, res) => {
      requireFields(req.body, ['code']);
      const user = db.get('SELECT * FROM users WHERE id = ?', String(req.user.sub));
      if (!totpVerify(user.mfa_secret, req.body.code)) throw badRequest('验证码错误');
      db.run('UPDATE users SET mfa_enabled = 1 WHERE id = ?', user.id);
      auditLog(db, { userId: user.id, username: user.username, action: 'mfa_enable', resource: 'auth' });
      res.json({ ok: true });
    });

    app.post('/mfa/disable', (req, res) => {
      requireFields(req.body, ['code']);
      const user = db.get('SELECT * FROM users WHERE id = ?', String(req.user.sub));
      if (!totpVerify(user.mfa_secret, req.body.code)) throw badRequest('验证码错误');
      db.run('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?', user.id);
      res.json({ ok: true });
    });

    // ---- 扫码登录：桌面端生成二维码 → 已登录移动端确认 → 轮询签发 ----
    app.post('/qr/create', asyncRoute(async (req, res) => {
      const id = snowflake();
      db.run('INSERT INTO qr_sessions (id, status, created_at, expires_at) VALUES (?,?,?,?)',
        id, 'pending', Date.now(), Date.now() + 3 * 60000);
      res.json({ sessionId: id, qr: await QRCode.toDataURL(JSON.stringify({ nexusQr: id })), expiresIn: 180 });
    }));

    app.get('/qr/:id/status', (req, res) => {
      const s = db.get('SELECT * FROM qr_sessions WHERE id = ?', req.params.id);
      if (!s || s.expires_at < Date.now()) return res.json({ status: 'expired' });
      if (s.status === 'confirmed') {
        const user = db.get('SELECT * FROM users WHERE id = ?', s.user_id);
        db.run('DELETE FROM qr_sessions WHERE id = ?', s.id);
        return res.json({ status: 'confirmed', ...issueTokens(user), user: publicUser(getUserWithRoles(user.id)) });
      }
      res.json({ status: s.status });
    });

    app.post('/qr/:id/confirm', (req, res) => {
      const s = db.get('SELECT * FROM qr_sessions WHERE id = ?', req.params.id);
      if (!s || s.expires_at < Date.now()) throw badRequest('二维码已过期');
      db.run(`UPDATE qr_sessions SET status = 'confirmed', user_id = ? WHERE id = ?`, String(req.user.sub), s.id);
      res.json({ ok: true });
    });

    // ---- JWKS：公钥以 JWK 形式发布（OIDC 约定）----
    app.get('/.well-known/jwks.json', asyncRoute(async (req, res) => {
      const { ensureKeys } = await import('@nexus/shared');
      const { createPublicKey } = await import('node:crypto');
      const { publicKey } = ensureKeys();
      const jwk = createPublicKey(publicKey).export({ format: 'jwk' });
      res.json({ keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid: 'nexus-main' }] });
    }));

    // ---- RBAC 管理 ----
    app.get('/roles', requirePerm('auth:role:view'), (req, res) => {
      const roles = db.all('SELECT * FROM roles ORDER BY created_at');
      for (const r of roles) r.perms = db.all('SELECT perm_code FROM role_permissions WHERE role_id = ?', r.id).map((p) => p.perm_code);
      res.json(roles);
    });

    app.post('/roles', requirePerm('auth:role:manage'), (req, res) => {
      requireFields(req.body, ['code', 'name']);
      const { code, name, description = '', dataScope = 'self', perms = [] } = req.body;
      if (db.get('SELECT id FROM roles WHERE code = ?', code)) throw conflict('角色编码已存在');
      const id = snowflake();
      db.tx(() => {
        db.run('INSERT INTO roles (id, code, name, description, data_scope, builtin, created_at) VALUES (?,?,?,?,?,0,?)',
          id, code, name, description, dataScope, Date.now());
        for (const p of perms) db.run('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?,?)', id, p);
      });
      auditLog(db, { userId: req.user.sub, username: req.user.username, action: 'role_create', resource: 'role', resourceId: id, detail: { code } });
      res.status(201).json({ id });
    });

    app.put('/roles/:id', requirePerm('auth:role:manage'), (req, res) => {
      const role = db.get('SELECT * FROM roles WHERE id = ?', req.params.id);
      if (!role) throw badRequest('角色不存在');
      const { name = role.name, description = role.description, dataScope = role.data_scope, perms } = req.body;
      db.tx(() => {
        db.run('UPDATE roles SET name = ?, description = ?, data_scope = ? WHERE id = ?', name, description, dataScope, role.id);
        if (Array.isArray(perms)) {
          db.run('DELETE FROM role_permissions WHERE role_id = ?', role.id);
          for (const p of perms) db.run('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?,?)', role.id, p);
        }
      });
      auditLog(db, { userId: req.user.sub, username: req.user.username, action: 'role_update', resource: 'role', resourceId: role.id });
      res.json({ ok: true });
    });

    app.delete('/roles/:id', requirePerm('auth:role:manage'), (req, res) => {
      const role = db.get('SELECT * FROM roles WHERE id = ?', req.params.id);
      if (!role || role.builtin) throw badRequest('内置角色不可删除');
      db.tx(() => {
        db.run('DELETE FROM role_permissions WHERE role_id = ?', role.id);
        db.run('DELETE FROM user_roles WHERE role_id = ?', role.id);
        db.run('DELETE FROM roles WHERE id = ?', role.id);
      });
      res.json({ ok: true });
    });

    app.get('/permissions', requirePerm('auth:role:view'), (req, res) => {
      res.json(db.all('SELECT * FROM permissions ORDER BY module, code'));
    });

    app.post('/users/:id/roles', requirePerm('auth:user:manage'), (req, res) => {
      const { roleIds = [] } = req.body;
      db.tx(() => {
        db.run('DELETE FROM user_roles WHERE user_id = ?', req.params.id);
        for (const rid of roleIds) db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)', req.params.id, rid);
      });
      auditLog(db, { userId: req.user.sub, username: req.user.username, action: 'user_roles_assign', resource: 'user', resourceId: req.params.id, detail: { roleIds } });
      publishEvent('auth.roles_changed', { userId: req.params.id }, 'auth');
      res.json({ ok: true });
    });

    // ---- 权限审计查询 ----
    app.get('/audit', requirePerm('auth:audit:view'), (req, res) => {
      const { action, userId } = req.query;
      let sql = 'SELECT * FROM audit_log WHERE 1=1';
      const params = [];
      if (action) { sql += ' AND action = ?'; params.push(action); }
      if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
      sql += ' ORDER BY created_at DESC LIMIT 200';
      res.json(db.all(sql, ...params));
    });

    // 供 Playwright 断言内部状态
    ctx.addDebug(() => ({
      users: db.get('SELECT COUNT(*) c FROM users').c,
      roles: db.get('SELECT COUNT(*) c FROM roles').c,
      activeRefreshTokens: db.get('SELECT COUNT(*) c FROM refresh_tokens WHERE revoked = 0 AND expires_at > ?', Date.now()).c,
    }));
  },
});

seed();
