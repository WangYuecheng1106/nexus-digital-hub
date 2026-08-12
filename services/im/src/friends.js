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

/** 从通讯录服务按姓名/用户名/手机/邮箱模糊搜索可加好友的人 */
export async function searchPeople(query, selfId, authHeader = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 1) return [];
  let employees = [];
  try {
    const r = await fetch('http://127.0.0.1:8092/employees?limit=200', {
      headers: { Authorization: authHeader },
    });
    if (r.ok) {
      const data = await r.json();
      employees = Array.isArray(data) ? data : (data.items || []);
    }
  } catch { /* */ }
  // 回退：auth 用户列表（若有权限）
  if (!employees.length) {
    try {
      const r = await fetch('http://127.0.0.1:8081/users', {
        headers: { Authorization: authHeader },
      });
      if (r.ok) {
        const data = await r.json();
        employees = (Array.isArray(data) ? data : []).map((u) => ({
          id: u.id,
          user_id: u.id,
          name: u.display_name,
          username: u.username,
          email: u.email,
          phone: u.phone,
          dept_name: u.dept_id,
          position: u.position,
        }));
      }
    } catch { /* */ }
  }

  return employees
    .map((e) => {
      const id = e.user_id || e.id;
      return {
        id,
        name: e.name || e.display_name || e.username || id,
        username: e.username || '',
        email: e.email || '',
        phone: e.phone || '',
        dept: e.dept_name || e.dept_id || '',
        position: e.position || '',
        isFriend: areFriends(selfId, id),
        isSelf: id === selfId,
      };
    })
    .filter((e) => !e.isSelf)
    .filter((e) => {
      const hay = `${e.name} ${e.username} ${e.email} ${e.phone} ${e.id}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 30);
}

/** 批量补全好友展示信息 */
export async function enrichFriendProfiles(friendRows, authHeader = '') {
  if (!friendRows?.length) return [];
  const ids = friendRows.map((f) => f.friend_id);
  let map = {};
  try {
    const r = await fetch(`http://127.0.0.1:8081/users/batch?ids=${ids.join(',')}`, {
      headers: { Authorization: authHeader },
    });
    if (r.ok) {
      const users = await r.json();
      for (const u of users) {
        map[u.id] = {
          name: u.display_name || u.username,
          username: u.username,
          email: u.email,
          position: u.position,
          dept: u.dept_id,
        };
      }
    }
  } catch { /* */ }
  return friendRows.map((f) => ({
    ...f,
    name: map[f.friend_id]?.name || f.friend_id,
    username: map[f.friend_id]?.username || '',
    email: map[f.friend_id]?.email || '',
    position: map[f.friend_id]?.position || '',
    dept: map[f.friend_id]?.dept || '',
  }));
}
