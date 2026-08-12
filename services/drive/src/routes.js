// nexus-drive：HTTP REST 路由
// 上传走 multer 解析 multipart；下载用流式响应避免大文件占内存；
// 软删除进回收站保留 30 天，到期由定时任务清理（此处仅提供接口，清理交给运维 cron）。
import multer from 'multer';
import { asyncRoute, requireFields, badRequest, forbidden, notFound, pageParams, snowflake } from '@nexus/shared';
import { db, storeContent, insertFile, calcUsedSize, collectSubtree, snapshotVersion, restoreVersion, contentPath, DEFAULT_QUOTA } from './repo.js';
import fs from 'node:fs';

// 内存存储：先入内存算哈希做秒传判断，再决定是否落盘
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

export function setupRoutes(app) {
  // ---- 文件夹/文件元数据 CRUD ----
  app.post('/files', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name', 'type']);
    if (req.body.type === 'folder') {
      const f = insertFile(String(req.user.sub), { ...req.body, size: 0 });
      return res.status(201).json(f);
    }
    throw badRequest('文件请走 /upload');
  }));

  app.get('/files', (req, res) => {
    const parentId = req.query.parent_id || null;
    const space = req.query.space || 'personal';
    const rows = db.all('SELECT * FROM files WHERE parent_id IS ? AND space = ? AND owner_id = ? AND deleted = 0 ORDER BY type DESC, name ASC',
      parentId, space, String(req.user.sub));
    res.json(rows);
  });

  app.get('/files/:id', (req, res) => {
    const f = db.get('SELECT * FROM files WHERE id = ? AND deleted = 0', req.params.id);
    if (!f) throw notFound('文件不存在');
    res.json(f);
  });

  app.put('/files/:id', (req, res) => {
    const f = db.get('SELECT * FROM files WHERE id = ? AND deleted = 0', req.params.id);
    if (!f) throw notFound('文件不存在');
    if (f.owner_id !== String(req.user.sub)) throw forbidden('仅所有者可修改');
    const { name, parent_id } = req.body;
    // 防止把目录移动到自身子树下造成环
    if (parent_id && collectSubtree(req.params.id).includes(parent_id)) throw badRequest('不能移动到自身子目录下');
    db.run('UPDATE files SET name=COALESCE(?,name), parent_id=COALESCE(?,parent_id), updated_at=? WHERE id=?',
      name, parent_id, Date.now(), req.params.id);
    res.json({ ok: true });
  });

  app.delete('/files/:id', (req, res) => {
    const f = db.get('SELECT * FROM files WHERE id = ? AND deleted = 0', req.params.id);
    if (!f) throw notFound('文件不存在');
    if (f.owner_id !== String(req.user.sub)) throw forbidden('仅所有者可删除');
    const ids = collectSubtree(req.params.id);
    db.tx(() => {
      for (const id of ids) {
        db.run('UPDATE files SET deleted=1, deleted_at=? WHERE id=?', Date.now(), id);
        db.run('INSERT INTO file_recycle (id,file_id,original_parent_id,deleted_by,deleted_at) VALUES (?,?,?,?,?)',
          snowflake(), id, f.parent_id, String(req.user.sub), Date.now());
      }
    });
    res.json({ ok: true, deleted: ids.length });
  });

  app.post('/files/:id/copy', asyncRoute(async (req, res) => {
    requireFields(req.body, ['target_parent_id']);
    const src = db.get('SELECT * FROM files WHERE id = ? AND deleted = 0', req.params.id);
    if (!src) throw notFound('源文件不存在');
    const copy = insertFile(String(req.user.sub), { ...src, name: src.name + ' 副本', parent_id: req.body.target_parent_id });
    if (src.type === 'file' && fs.existsSync(contentPath(src.id))) {
      fs.copyFileSync(contentPath(src.id), contentPath(copy.id));
    }
    res.status(201).json(copy);
  }));

  // ---- 上传 ----
  app.post('/upload', upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw badRequest('缺少上传文件');
    const used = calcUsedSize(String(req.user.sub), req.body.space || 'personal');
    if (used + req.file.size > DEFAULT_QUOTA) throw badRequest('超出存储配额');
    const { hash } = storeContent(req.file.buffer);
    const f = insertFile(String(req.user.sub), {
      name: req.file.originalname, parent_id: req.body.parent_id || null,
      type: 'file', size: req.file.size, mime_type: req.file.mimetype,
      space: req.body.space || 'personal', content_hash: hash,
    });
    // 若未复用已有存储，则把内容写入该文件 id 对应磁盘文件
    if (!fs.existsSync(contentPath(f.id))) fs.writeFileSync(contentPath(f.id), req.file.buffer);
    res.status(201).json(f);
  }));

  // ---- 下载 ----
  app.get('/files/:id/download', (req, res) => {
    const f = db.get('SELECT * FROM files WHERE id = ? AND deleted = 0', req.params.id);
    if (!f || f.type !== 'file') throw notFound('文件不存在');
    if (!fs.existsSync(contentPath(f.id))) throw notFound('文件内容缺失');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
    res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
    fs.createReadStream(contentPath(f.id)).pipe(res);
  });

  // ---- 分享 ----
  app.post('/files/:id/share', (req, res) => {
    const f = db.get('SELECT * FROM files WHERE id = ? AND deleted = 0', req.params.id);
    if (!f) throw notFound('文件不存在');
    requireFields(req.body, ['share_type']);
    const id = snowflake();
    db.run('INSERT INTO file_shares (id,file_id,share_type,password,expires_at,perm,created_at) VALUES (?,?,?,?,?,?,?)',
      id, req.params.id, req.body.share_type, req.body.password || null, req.body.expires_at || null,
      req.body.perm || 'view', Date.now());
    res.status(201).json({ id, link: `/share/${id}` });
  });

  app.get('/shares', (req, res) => {
    res.json(db.all(`SELECT s.*, f.name FROM file_shares s JOIN files f ON f.id = s.file_id
      WHERE f.owner_id = ? ORDER BY s.created_at DESC`, String(req.user.sub)));
  });

  // ---- 版本管理 ----
  app.get('/files/:id/versions', (req, res) => {
    res.json(db.all('SELECT * FROM file_versions WHERE file_id = ? ORDER BY version_no DESC', req.params.id));
  });

  app.post('/files/:id/restore/:version', (req, res) => {
    const f = db.get('SELECT * FROM files WHERE id = ? AND deleted = 0', req.params.id);
    if (!f) throw notFound('文件不存在');
    const v = db.get('SELECT * FROM file_versions WHERE id = ? AND file_id = ?', req.params.version, req.params.id);
    if (!v) throw notFound('版本不存在');
    restoreVersion(f, v);
    res.json({ ok: true, restored_to: v.version_no });
  });

  // ---- 搜索 ----
  app.get('/search', (req, res) => {
    const q = String(req.query.q || '');
    if (!q) return res.json([]);
    res.json(db.all("SELECT * FROM files WHERE owner_id = ? AND deleted = 0 AND name LIKE ? ORDER BY updated_at DESC LIMIT 50",
      String(req.user.sub), `%${q}%`));
  });

  // ---- 回收站 ----
  app.get('/recycle', (req, res) => {
    const rows = db.all(`SELECT r.id, r.file_id, r.original_parent_id, r.deleted_at, f.name, f.type
      FROM file_recycle r JOIN files f ON f.id = r.file_id
      WHERE r.deleted_by = ? ORDER BY r.deleted_at DESC`, String(req.user.sub));
    res.json(rows);
  });

  app.post('/recycle/:id/restore', (req, res) => {
    const r = db.get('SELECT * FROM file_recycle WHERE id = ? AND deleted_by = ?', req.params.id, String(req.user.sub));
    if (!r) throw notFound('回收站记录不存在');
    db.tx(() => {
      db.run('UPDATE files SET deleted=0, deleted_at=NULL WHERE id=?', r.file_id);
      db.run('DELETE FROM file_recycle WHERE id=?', r.id);
    });
    res.json({ ok: true });
  });

  app.delete('/recycle/:id', (req, res) => {
    const r = db.get('SELECT * FROM file_recycle WHERE id = ? AND deleted_by = ?', req.params.id, String(req.user.sub));
    if (!r) throw notFound('回收站记录不存在');
    db.tx(() => {
      try { fs.unlinkSync(contentPath(r.file_id)); } catch { /* 元数据已删即可 */ }
      db.run('DELETE FROM files WHERE id=?', r.file_id);
      db.run('DELETE FROM file_recycle WHERE id=?', r.id);
    });
    res.json({ ok: true });
  });

  // ---- 配额 ----
  app.get('/quota', (req, res) => {
    const used = calcUsedSize(String(req.user.sub), req.query.space || 'personal');
    res.json({ used, total: DEFAULT_QUOTA, percent: Math.round((used / DEFAULT_QUOTA) * 10000) / 100 });
  });
}
