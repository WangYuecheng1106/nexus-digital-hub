// 数据库访问层：基于 Node 内置 node:sqlite（零原生依赖、零外部服务）。
// 选用嵌入式 SQLite 而非 MySQL/Neo4j 集群的理由：本地开发零基础设施、
// 单文件便于备份与重置；所有 SQL 集中在各服务仓库层，后续可平滑替换为
// PostgreSQL/Neo4j 而不影响业务代码。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const dbs = new Map();
const stmtCache = new Map();

export function dataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

export function openDb(name) {
  if (dbs.has(name)) return dbs.get(name);
  dataDir();
  const db = new DatabaseSync(path.join(DATA_DIR, `${name}.db`));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA cache_size = -20000;');
  const wrap = {
    raw: db,
    exec: (sql) => db.exec(sql),
    run(sql, ...params) {
      return prep(db, sql).run(...params);
    },
    get(sql, ...params) {
      return prep(db, sql).get(...params);
    },
    all(sql, ...params) {
      return prep(db, sql).all(...params);
    },
    // 事务包装：多步写入要么全部成功要么全部回滚，保证数据一致性
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = fn(wrap);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  dbs.set(name, wrap);
  return wrap;
}

function prep(db, sql) {
  let s = stmtCache.get(sql);
  if (!s || s.db !== db) {
    s = { stmt: db.prepare(sql), db };
    if (stmtCache.size > 2000) stmtCache.clear();
    stmtCache.set(sql, s);
  }
  return s.stmt;
}

export function migrate(db, statements) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at INTEGER)`);
  const applied = new Set(db.all('SELECT name FROM _migrations').map((r) => r.name));
  for (const [name, sql] of statements) {
    if (applied.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.run('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', name, Date.now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${name} failed: ${e.message}`);
    }
  }
}
