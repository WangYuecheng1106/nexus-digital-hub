// 好友关系（WhatsApp 式加好友）+ 迁移
import { snowflake } from '@nexus/shared';
import { db } from './repo.js';

// 幂等迁移：好友申请与好友列表
try {
  db.run(`CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, message TEXT,
    status TEXT DEFAULT 'pending', created_at INTEGER, updated_at INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS friendships (
    user_a TEXT, user_b TEXT, created_at INTEGER,
    PRIMARY KEY (user_a, user_b))`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_friend_req_to ON friend_requests(to_id, status)`);
} catch { /* already exists */ }

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function sendFriendRequest(fromId, toId, message = '') {
  if (fromId === toId) throw new Error('不能添加自己');
  const [a, b] = pair(fromId, toId);
  const exists = db.get('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?', a, b);
  if (exists) throw new Error('已是好友');
  const pending = db.get(
    `SELECT * FROM friend_requests WHERE status = 'pending'
     AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))`,
    fromId, toId, toId, fromId
  );
  if (pending) throw new Error('已有待处理申请');
  const id = snowflake();
  const now = Date.now();
  db.run('INSERT INTO friend_requests (id, from_id, to_id, message, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    id, fromId, toId, message || '你好，我想加你为好友', 'pending', now, now);
  return db.get('SELECT * FROM friend_requests WHERE id = ?', id);
}

export function respondFriendRequest(requestId, userId, accept) {
  const req = db.get('SELECT * FROM friend_requests WHERE id = ?', requestId);
  if (!req) throw new Error('申请不存在');
  if (req.to_id !== userId) throw new Error('无权处理');
  if (req.status !== 'pending') throw new Error('申请已处理');
  const now = Date.now();
  const status = accept ? 'accepted' : 'rejected';
  db.run('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?', status, now, requestId);
  if (accept) {
    const [a, b] = pair(req.from_id, req.to_id);
    db.run('INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?,?,?)', a, b, now);
  }
  return { ...req, status };
}

export function listFriends(userId) {
  return db.all(
    `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS friend_id, created_at
     FROM friendships WHERE user_a = ? OR user_b = ? ORDER BY created_at DESC`,
    userId, userId, userId
  );
}

export function listFriendRequests(userId, box = 'inbox') {
  if (box === 'sent') {
    return db.all('SELECT * FROM friend_requests WHERE from_id = ? ORDER BY created_at DESC', userId);
  }
  return db.all('SELECT * FROM friend_requests WHERE to_id = ? ORDER BY created_at DESC', userId);
}

export function areFriends(userA, userB) {
  const [a, b] = pair(userA, userB);
  return !!db.get('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?', a, b);
}
