// nexus-document：数据层 + Yjs 协同状态。
// 选用 Yjs CRDT 而非 OT：CRDT 天然支持离线编辑与无冲突合并，
// 离线后重连只需回放 update 增量，无需中心化变换服务器，更适合分布式协作。
import { openDb, migrate, snowflake } from '@nexus/shared';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';

export const db = openDb('document');

migrate(db, [
  ['documents', `CREATE TABLE documents (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL,
    content TEXT DEFAULT '{}', owner_id TEXT NOT NULL, parent_id TEXT,
    watermark INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER)`],
  ['doc_versions', `CREATE TABLE doc_versions (
    id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, content TEXT NOT NULL,
    version_no INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER)`],
  ['doc_permissions', `CREATE TABLE doc_permissions (
    doc_id TEXT, user_id TEXT, perm TEXT NOT NULL, created_at INTEGER,
    PRIMARY KEY (doc_id, user_id))`],
  ['doc_comments', `CREATE TABLE doc_comments (
    id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, user_id TEXT NOT NULL,
    content TEXT NOT NULL, parent_comment_id TEXT, resolved INTEGER DEFAULT 0,
    created_at INTEGER)`],
  ['doc_templates', `CREATE TABLE doc_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
    category TEXT, builtin INTEGER DEFAULT 0, created_at INTEGER)`],
  ['doc_shares', `CREATE TABLE doc_shares (
    id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, share_type TEXT NOT NULL,
    password TEXT, expires_at INTEGER, perm TEXT NOT NULL, created_at INTEGER)`],
  ['idx_doc_owner', `CREATE INDEX idx_doc_owner ON documents(owner_id)`],
  ['idx_ver_doc', `CREATE INDEX idx_ver_doc ON doc_versions(doc_id, version_no)`],
]);

// 内存中的 Yjs 文档池：每个文档一个 Y.Doc，承载实时协同状态。
// 不持久化 Y.Doc 本身——增量 update 落库为 content 快照即可，
// 重启时按最新 content 重建 Y.Doc，避免长期累积未压缩的 update 增量。
const ydocs = new Map();
// 每个文档当前在线的 userId -> WebSocket socket 集合，用于广播 awareness 与 update
const rooms = new Map();

export function getYDoc(docId) {
  if (!ydocs.has(docId)) {
    const ydoc = new Doc();
    const doc = getDocument(docId);
    if (doc?.content) {
      try {
        const snapshot = Buffer.from(doc.content, 'base64');
        applyUpdate(ydoc, snapshot);
      } catch { /* 旧版内容是 JSON 文本，忽略，由前端首次同步时回写 */ }
    }
    ydocs.set(docId, ydoc);
  }
  return ydocs.get(docId);
}

export function persistYDoc(docId, userId) {
  const ydoc = getYDoc(docId);
  const update = encodeStateAsUpdate(ydoc);
  const content = Buffer.from(update).toString('base64');
  const now = Date.now();
  db.run('UPDATE documents SET content = ?, updated_at = ? WHERE id = ?', content, now, docId);
  return content;
}

export function getRoom(docId) {
  if (!rooms.has(docId)) rooms.set(docId, new Map());
  return rooms.get(docId);
}

export function activeRoomCount() {
  let n = 0;
  for (const room of rooms.values()) if (room.size > 0) n++;
  return n;
}

export function getDocument(id) {
  return db.get('SELECT * FROM documents WHERE id = ?', id);
}

export function listDocuments(ownerId, parentId) {
  return db.all('SELECT id, title, type, parent_id, watermark, created_at, updated_at FROM documents WHERE owner_id = ? AND COALESCE(parent_id, ?) = ? ORDER BY updated_at DESC',
    ownerId, parentId || '', parentId || '');
}

export function createDocument({ title, type, content = '{}', ownerId, parentId, watermark = 0 }) {
  const id = snowflake();
  const now = Date.now();
  db.run('INSERT INTO documents (id, title, type, content, owner_id, parent_id, watermark, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, title, type, JSON.stringify(content), ownerId, parentId || null, watermark ? 1 : 0, now, now);
  db.run('INSERT INTO doc_permissions (doc_id, user_id, perm, created_at) VALUES (?,?,?,?)', id, ownerId, 'manage', now);
  return getDocument(id);
}

export function updateDocumentMeta(id, { title, watermark, parentId }) {
  db.run('UPDATE documents SET title = COALESCE(?, title), watermark = COALESCE(?, watermark), parent_id = COALESCE(?, parent_id), updated_at = ? WHERE id = ?',
    title, watermark === undefined ? null : watermark ? 1 : 0, parentId, Date.now(), id);
  return getDocument(id);
}

export function deleteDocument(id) {
  db.tx(() => {
    db.run('DELETE FROM doc_versions WHERE doc_id = ?', id);
    db.run('DELETE FROM doc_permissions WHERE doc_id = ?', id);
    db.run('DELETE FROM doc_comments WHERE doc_id = ?', id);
    db.run('DELETE FROM doc_shares WHERE doc_id = ?', id);
    db.run('DELETE FROM documents WHERE id = ?', id);
  });
  ydocs.delete(id);
  rooms.delete(id);
}

export function listVersions(docId) {
  return db.all('SELECT id, doc_id, version_no, created_by, created_at FROM doc_versions WHERE doc_id = ? ORDER BY version_no DESC', docId);
}

export function createVersion(docId, userId) {
  const doc = getDocument(docId);
  if (!doc) return null;
  const last = db.get('SELECT MAX(version_no) v FROM doc_versions WHERE doc_id = ?', docId);
  const versionNo = (last?.v || 0) + 1;
  const id = snowflake();
  db.run('INSERT INTO doc_versions (id, doc_id, content, version_no, created_by, created_at) VALUES (?,?,?,?,?,?)',
    id, docId, doc.content, versionNo, userId, Date.now());
  return { id, doc_id: docId, version_no: versionNo, created_by: userId, created_at: Date.now() };
}

export function getVersion(docId, versionNo) {
  return db.get('SELECT * FROM doc_versions WHERE doc_id = ? AND version_no = ?', docId, versionNo);
}

export function restoreVersion(docId, versionNo) {
  const v = getVersion(docId, versionNo);
  if (!v) return null;
  db.run('UPDATE documents SET content = ?, updated_at = ? WHERE id = ?', v.content, Date.now(), docId);
  ydocs.delete(docId); // 让 getYDoc 重新按最新 content 构建
  return getDocument(docId);
}

export function getUserPerm(docId, userId) {
  if (!userId) return null;
  const doc = getDocument(docId);
  if (doc?.owner_id === String(userId)) return 'manage';
  return db.get('SELECT perm FROM doc_permissions WHERE doc_id = ? AND user_id = ?', docId, String(userId))?.perm || null;
}

export function setPermission(docId, userId, perm) {
  db.run('INSERT OR REPLACE INTO doc_permissions (doc_id, user_id, perm, created_at) VALUES (?,?,?,?)',
    docId, userId, perm, Date.now());
}

export function listPermissions(docId) {
  return db.all('SELECT user_id, perm, created_at FROM doc_permissions WHERE doc_id = ?', docId);
}

export function createComment(docId, userId, content, parentCommentId) {
  const id = snowflake();
  db.run('INSERT INTO doc_comments (id, doc_id, user_id, content, parent_comment_id, resolved, created_at) VALUES (?,?,?,?,?,0,?)',
    id, docId, userId, content, parentCommentId || null, Date.now());
  return db.get('SELECT * FROM doc_comments WHERE id = ?', id);
}

export function listComments(docId) {
  return db.all('SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at ASC', docId);
}

export function resolveComment(commentId, resolved) {
  db.run('UPDATE doc_comments SET resolved = ? WHERE id = ?', resolved ? 1 : 0, commentId);
  return db.get('SELECT * FROM doc_comments WHERE id = ?', commentId);
}

export function createShare(docId, { shareType, password, expiresAt, perm }) {
  const id = snowflake();
  db.run('INSERT INTO doc_shares (id, doc_id, share_type, password, expires_at, perm, created_at) VALUES (?,?,?,?,?,?,?)',
    id, docId, shareType, password || null, expiresAt || null, perm, Date.now());
  return { id, doc_id: docId, share_type: shareType, perm, expires_at: expiresAt };
}

export function listTemplates(builtinOnly = false) {
  const sql = builtinOnly ? 'SELECT * FROM doc_templates WHERE builtin = 1 ORDER BY category' : 'SELECT * FROM doc_templates ORDER BY builtin DESC, category';
  return db.all(sql);
}

export function createTemplate({ name, type, content, category, builtin = 0 }) {
  const id = snowflake();
  db.run('INSERT INTO doc_templates (id, name, type, content, category, builtin, created_at) VALUES (?,?,?,?,?,?,?)',
    id, name, type, JSON.stringify(content), category || 'custom', builtin ? 1 : 0, Date.now());
  return { id, name, type, category };
}

// 内置模板：覆盖会议纪要/周报/需求文档/项目计划四类高频场景，
// 让新企业开箱即用而无需先设计模板。
export function seedBuiltinTemplates() {
  const builtins = [
    { name: '会议纪要', type: 'rich_text', category: 'meeting', content: { blocks: [{ type: 'h1', text: '会议纪要' }, { type: 'p', text: '时间：' }, { type: 'p', text: '参会人：' }, { type: 'h2', text: '议题' }, { type: 'h2', text: '决议' }, { type: 'h2', text: '待办' }] } },
    { name: '周报', type: 'rich_text', category: 'report', content: { blocks: [{ type: 'h1', text: '本周工作' }, { type: 'h1', text: '下周计划' }, { type: 'h1', text: '风险与求助' }] } },
    { name: '需求文档', type: 'rich_text', category: 'product', content: { blocks: [{ type: 'h1', text: '背景' }, { type: 'h1', text: '目标' }, { type: 'h1', text: '功能需求' }, { type: 'h1', text: '非功能需求' }, { type: 'h1', text: '里程碑' }] } },
    { name: '项目计划', type: 'rich_text', category: 'project', content: { blocks: [{ type: 'h1', text: '项目概述' }, { type: 'h2', text: '范围' }, { type: 'h2', text: '时间线' }, { type: 'h2', text: '资源' }, { type: 'h2', text: '风险' }] } },
  ];
  const has = db.get('SELECT COUNT(*) c FROM doc_templates WHERE builtin = 1').c;
  if (has > 0) return;
  for (const t of builtins) createTemplate({ ...t, builtin: true });
}
