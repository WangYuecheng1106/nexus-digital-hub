// nexus-notification：消息中心服务 — 数据层
// 通知分类：todo(待办) / at_me(@我) / system(系统) / business(业务)
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('notification');

export const CATEGORIES = ['todo', 'at_me', 'system', 'business'];

migrate(db, [
  ['notifications', `CREATE TABLE notifications (
    id TEXT PRIMARY KEY, user_id TEXT, category TEXT, type TEXT, title TEXT, content TEXT,
    source_module TEXT, source_id TEXT, read INTEGER DEFAULT 0, action_url TEXT, created_at INTEGER)`],
  ['idx_notif_user', `CREATE INDEX idx_notif_user ON notifications(user_id, created_at DESC)`],
  ['preferences', `CREATE TABLE preferences (
    user_id TEXT, category TEXT, channel TEXT DEFAULT 'push', enabled INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, category))`],
]);

// 创建通知：返回创建结果；channel=none 的偏好会被静默丢弃（仍入库但标记不推送）
export function createNotification({ userId, category = 'system', type = 'generic', title, content, sourceModule, sourceId, actionUrl }) {
  const id = snowflake();
  const now = Date.now();
  db.run(`INSERT INTO notifications (id, user_id, category, type, title, content, source_module, source_id, read, action_url, created_at)
          VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
    id, userId, category, type, title, content || '', sourceModule || null, sourceId || null, actionUrl || null, now);
  return db.get('SELECT * FROM notifications WHERE id = ?', id);
}

export function listNotifications(userId, { category, read } = {}) {
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (read !== undefined && read !== '') { sql += ' AND read = ?'; params.push(Number(read)); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  return db.all(sql, ...params);
}

export function unreadCount(userId) {
  const rows = db.all('SELECT category, COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0 GROUP BY category', userId);
  const total = rows.reduce((n, r) => n + r.c, 0);
  const byCat = Object.fromEntries(rows.map((r) => [r.category, r.c]));
  return { total, byCat };
}

export function markRead(id, userId) {
  db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', id, userId);
}
export function markAllRead(userId) {
  db.run('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', userId);
}
export function deleteNotification(id, userId) {
  db.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', id, userId);
}

// 偏好：默认 push 通道、启用
export function getPreferences(userId) {
  const rows = db.all('SELECT category, channel, enabled FROM preferences WHERE user_id = ?', userId);
  const map = Object.fromEntries(rows.map((r) => [r.category, { channel: r.channel, enabled: !!r.enabled }]));
  const out = {};
  for (const c of CATEGORIES) out[c] = map[c] || { channel: 'push', enabled: true };
  return out;
}

export function setPreference(userId, category, { channel, enabled }) {
  db.run(`INSERT OR REPLACE INTO preferences (user_id, category, channel, enabled) VALUES (?,?,?,?)`,
    userId, category, channel || 'push', enabled === undefined ? 1 : (enabled ? 1 : 0));
}

// 频控：合并同源同类型通知为一条摘要（5 分钟内的同源通知合并标题）
export function mergeDigest(userId, sourceModule, type, title) {
  const recent = db.get(
    `SELECT * FROM notifications WHERE user_id = ? AND source_module IS ? AND type IS ? AND created_at > ? AND read = 0`,
    userId, sourceModule || null, type || null, Date.now() - 5 * 60 * 1000);
  if (recent) {
    db.run('UPDATE notifications SET content = content || ? , created_at = ? WHERE id = ?',
      `\n${title}`, Date.now(), recent.id);
    return recent.id;
  }
  return null;
}
