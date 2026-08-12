// nexus-drive：云盘服务 — 数据层
// 元数据存 SQLite，文件实体落本地磁盘（data/drive-storage/<id>）。这样元数据查询走索引、
// 大对象走文件系统，兼顾性能与可备份性；content_hash 用于秒传（同内容直接引用已有文件）。
import { openDb, migrate, snowflake, dataDir } from '@nexus/shared';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const db = openDb('drive');
export const STORAGE_DIR = path.join(dataDir(), 'drive-storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

migrate(db, [
  ['files', `CREATE TABLE files (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, type TEXT NOT NULL,
    size INTEGER DEFAULT 0, mime_type TEXT, owner_id TEXT NOT NULL, space TEXT DEFAULT 'personal',
    content_hash TEXT, deleted INTEGER DEFAULT 0, deleted_at INTEGER,
    created_at INTEGER, updated_at INTEGER)`],
  ['idx_file_parent', `CREATE INDEX idx_file_parent ON files(parent_id, deleted)`],
  ['idx_file_owner', `CREATE INDEX idx_file_owner ON files(owner_id, space)`],
  ['idx_file_hash', `CREATE INDEX idx_file_hash ON files(content_hash)`],
  ['versions', `CREATE TABLE file_versions (
    id TEXT PRIMARY KEY, file_id TEXT, version_no INTEGER, size INTEGER, hash TEXT,
    created_by TEXT, created_at INTEGER)`],
  ['shares', `CREATE TABLE file_shares (
    id TEXT PRIMARY KEY, file_id TEXT, share_type TEXT, password TEXT, expires_at INTEGER,
    perm TEXT DEFAULT 'view', access_count INTEGER DEFAULT 0, created_at INTEGER)`],
  ['recycle', `CREATE TABLE file_recycle (
    id TEXT PRIMARY KEY, file_id TEXT, original_parent_id TEXT, deleted_by TEXT, deleted_at INTEGER)`],
]);

export const DEFAULT_QUOTA = 10 * 1024 * 1024 * 1024; // 10GB 个人空间默认配额

export function contentPath(id) { return path.join(STORAGE_DIR, id); }

// 写入文件实体并计算哈希；若哈希已存在则复用旧文件，实现秒传
export function storeContent(buf) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const existing = db.get('SELECT id FROM files WHERE content_hash = ? AND deleted = 0 LIMIT 1', hash);
  if (existing) return { hash, reused: true };
  const id = snowflake();
  fs.writeFileSync(contentPath(id), buf);
  return { hash, reused: false, storageId: id };
}

export function insertFile(ownerId, body, storageId = null) {
  const id = snowflake();
  const now = Date.now();
  db.run(`INSERT INTO files (id,name,parent_id,type,size,mime_type,owner_id,space,content_hash,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, body.name, body.parent_id || null, body.type, body.size || 0, body.mime_type || '',
    ownerId, body.space || 'personal', body.content_hash || null, now, now);
  return db.get('SELECT * FROM files WHERE id = ?', id);
}

// 递归统计目录下文件总大小，用于配额校验
export function calcUsedSize(ownerId, space) {
  const row = db.get("SELECT COALESCE(SUM(size),0) s FROM files WHERE owner_id = ? AND space = ? AND deleted = 0 AND type = 'file'",
    ownerId, space);
  return row.s;
}

// 递归查询子树所有文件 id（用于删除/移动整棵子树）
export function collectSubtree(rootId) {
  const out = [rootId];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    const children = db.all('SELECT id FROM files WHERE parent_id = ? AND deleted = 0', cur);
    for (const c of children) { out.push(c.id); stack.push(c.id); }
  }
  return out;
}

// 新版本快照：将当前文件内容复制一份作为历史版本，便于回滚
export function snapshotVersion(file, byUserId) {
  const vno = (db.get('SELECT MAX(version_no) m FROM file_versions WHERE file_id = ?', file.id)?.m || 0) + 1;
  const vid = snowflake();
  // 复制磁盘内容到版本快照文件
  if (file.content_hash && fs.existsSync(contentPath(file.id))) {
    fs.copyFileSync(contentPath(file.id), contentPath(vid));
  }
  db.run('INSERT INTO file_versions (id,file_id,version_no,size,hash,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
    vid, file.id, vno, file.size, file.content_hash, byUserId, Date.now());
  return vid;
}

export function restoreVersion(file, version) {
  // 当前内容先快照，再用历史版本内容覆盖当前
  snapshotVersion(file, version.created_by);
  const src = contentPath(version.id);
  if (fs.existsSync(src)) fs.copyFileSync(src, contentPath(file.id));
  db.run('UPDATE files SET size = ?, content_hash = ?, updated_at = ? WHERE id = ?',
    version.size, version.hash, Date.now(), file.id);
}
