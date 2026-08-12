// 审计日志：追加写入 + 哈希链（每条记录包含前一条的哈希），保证日志不可篡改。
import { createHash } from 'node:crypto';
import { openDb } from './db.js';
import { snowflake } from './snowflake.js';

export function auditLog(db, { userId, username, action, resource, resourceId, detail, ip }) {
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, user_id TEXT, username TEXT, action TEXT, resource TEXT,
    resource_id TEXT, detail TEXT, ip TEXT, prev_hash TEXT, hash TEXT, created_at INTEGER
  )`);
  const prev = db.get('SELECT hash FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 1');
  const prevHash = prev?.hash || 'GENESIS';
  const createdAt = Date.now();
  const payload = JSON.stringify({ userId, action, resource, resourceId: resourceId ?? null, detail, createdAt, prevHash });
  const hash = createHash('sha256').update(payload).digest('hex');
  db.run(
    `INSERT INTO audit_log (id, user_id, username, action, resource, resource_id, detail, ip, prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    snowflake(),
    userId ?? null,
    username ?? null,
    action,
    resource ?? null,
    resourceId ?? null,
    JSON.stringify(detail || {}),
    ip || '',
    prevHash,
    hash,
    createdAt
  );
}

export function auditDb() {
  return openDb('audit');
}
