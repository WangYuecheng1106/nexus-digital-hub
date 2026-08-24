// nexus-im：即时通讯服务 — 数据层与会话管理
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('im');

migrate(db, [
  ['conversations', `CREATE TABLE conversations (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT, avatar TEXT,
    owner_id TEXT, announcement TEXT, pinned_by TEXT DEFAULT '', muted_by TEXT DEFAULT '',
    created_at INTEGER, updated_at INTEGER)`],
  ['members', `CREATE TABLE conversation_members (
    conversation_id TEXT, user_id TEXT, role TEXT DEFAULT 'member',
    nickname TEXT, joined_at INTEGER, last_read_msg_id TEXT,
    PRIMARY KEY (conversation_id, user_id))`],
  ['messages', `CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, sender_id TEXT, type TEXT NOT NULL,
    body TEXT NOT NULL, status TEXT DEFAULT 'sent',
    created_at INTEGER, updated_at INTEGER)`],
  ['idx_msg_conv', `CREATE INDEX idx_msg_conv ON messages(conversation_id, created_at)`],
  ['msg_reads', `CREATE TABLE message_reads (
    message_id TEXT, user_id TEXT, read_at INTEGER, PRIMARY KEY (message_id, user_id))`],
  ['favorites', `CREATE TABLE message_favorites (
    user_id TEXT, message_id TEXT, category TEXT DEFAULT 'default', created_at INTEGER,
    PRIMARY KEY (user_id, message_id))`],
  ['drafts', `CREATE TABLE drafts (
    user_id TEXT, conversation_id TEXT, content TEXT, updated_at INTEGER,
    PRIMARY KEY (user_id, conversation_id))`],
]);

export function createMessage(conversationId, senderId, type, body) {
  const id = snowflake();
  const now = Date.now();
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  db.run('INSERT INTO messages (id, conversation_id, sender_id, type, body, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    id, conversationId, senderId, type, bodyStr, 'sent', now, now);
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', now, conversationId);
  return { id, conversation_id: conversationId, sender_id: senderId, type, body: bodyStr, status: 'sent', created_at: now };
}

export function deliverMessage(hub, msg) {
  const members = db.all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', msg.conversation_id).map((m) => m.user_id);
  let body = msg.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = { text: body }; }
  }
  // 事件 type 固定为 im:message；消息种类放在 messageType，避免被覆盖
  hub.sendTo(members, {
    type: 'im:message',
    id: msg.id,
    conversationId: msg.conversation_id,
    conversation_id: msg.conversation_id,
    sender_id: msg.sender_id,
    senderId: msg.sender_id,
    messageType: msg.type,
    body,
    status: msg.status,
    created_at: msg.created_at,
  });
  return members.length;
}

export function findSingleConversation(userA, userB) {
  const rows = db.all(
    `SELECT c.id FROM conversations c
     WHERE c.type = 'single'
     AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
     AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
     AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2`,
    userA, userB
  );
  return rows[0] || null;
}

export function getConversationMembers(convId) {
  return db.all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', convId).map((m) => m.user_id);
}

export function ensureNoticeConv(userId) {
  const uid = String(userId);
  const existing = db.get(
    `SELECT c.* FROM conversations c
     JOIN conversation_members m ON m.conversation_id = c.id
     WHERE c.type = 'notice' AND m.user_id = ?`,
    uid
  );
  if (existing) return existing;
  const id = snowflake();
  const now = Date.now();
  db.run('INSERT INTO conversations (id, type, name, owner_id, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    id, 'notice', '工作通知', uid, now, now);
  db.run('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
    id, uid, 'member', now);
  return db.get('SELECT * FROM conversations WHERE id = ?', id);
}

export function postWorkNotice(hub, userId, text) {
  if (!userId || !hub) return null;
  const conv = ensureNoticeConv(userId);
  const msg = createMessage(conv.id, 'system', 'text', { text, workNotice: true });
  deliverMessage(hub, msg);
  return msg;
}
