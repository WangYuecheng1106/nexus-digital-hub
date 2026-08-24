// nexus-document：文档协作服务入口。
// 路由 + Yjs WebSocket 同步 hub。Yjs 增量通过 WS 广播给同房间连接，
// 服务端不解析 update 语义——Yjs CRDT 自带合并收敛，无需中心化冲突仲裁。
import { createService, createWsHub, asyncRoute, requireFields, badRequest, forbidden, notFound, publishEvent } from '@nexus/shared';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import {
  db, getYDoc, persistYDoc, getRoom, getDocument, listDocuments, createDocument,
  updateDocumentMeta, deleteDocument, listVersions, createVersion, getVersion,
  restoreVersion, getUserPerm, setPermission, listPermissions, createComment,
  listComments, resolveComment, createShare, listTemplates, createTemplate,
  seedBuiltinTemplates, activeRoomCount,
} from './repo.js';

const PERM_RANK = { view: 1, comment: 2, edit: 3, manage: 4 };
const hasPerm = (docId, userId, need) => {
  const p = getUserPerm(docId, userId);
  return p && (PERM_RANK[p] || 0) >= (PERM_RANK[need] || 99);
};

// 自动保存：每 5 秒把内存中变更过的 Y.Doc 落库为最新 content 快照。
// 选用周期快照而非每次 update 落库：高频写库会拖垮协同吞吐，
// 5 秒粒度兼顾"崩溃最多丢 5 秒编辑"与写库压力。
const dirtyDocs = new Set();
setInterval(() => {
  for (const docId of [...dirtyDocs]) {
    persistYDoc(docId, 'system');
    dirtyDocs.delete(docId);
  }
}, 5000);

function handleWsMessage(hub) {
  return async (socket, msg) => {
    switch (msg.type) {
      case 'doc:open': {
        // 加入房间：注册 socket，回放当前 Y.Doc 全量状态给新加入者
        const { docId } = msg;
        if (!hasPerm(docId, socket.userId, 'view')) return socket.close(4003, 'forbidden');
        const room = getRoom(docId);
        room.set(socket.userId, socket);
        socket.docId = docId;
        const ydoc = getYDoc(docId);
        const update = encodeStateAsUpdate(ydoc);
        socket.send(JSON.stringify({ type: 'doc:sync', docId, update: Buffer.from(update).toString('base64') }));
        // 广播 awareness：有人加入
        broadcastRoom(room, { type: 'doc:awareness', docId, userId: socket.userId, state: 'join' }, socket.userId);
        break;
      }
      case 'doc:update': {
        // 应用增量 update 到 Y.Doc 并广播给房间内其他成员
        const { docId, update } = msg;
        if (!hasPerm(docId, socket.userId, 'edit')) return;
        const ydoc = getYDoc(docId);
        try {
          const bin = Buffer.from(update, 'base64');
          applyUpdate(ydoc, bin, socket.userId);
        } catch (e) {
          return socket.send(JSON.stringify({ type: 'error', message: 'invalid_update' }));
        }
        dirtyDocs.add(docId);
        const room = getRoom(docId);
        broadcastRoom(room, { type: 'doc:update', docId, update }, socket.userId);
        break;
      }
      case 'doc:awareness': {
        // 光标/选区等 awareness 状态：仅广播不落库
        const room = getRoom(msg.docId);
        if (room) broadcastRoom(room, { type: 'doc:awareness', docId: msg.docId, userId: socket.userId, state: msg.state }, socket.userId);
        break;
      }
      case 'doc:close': {
        leaveRoom(socket);
        break;
      }
    }
  };
}

function broadcastRoom(room, message, exceptUserId) {
  const data = JSON.stringify(message);
  for (const [uid, sock] of room) {
    if (uid === exceptUserId) continue;
    if (sock.readyState === 1) sock.send(data);
  }
}

function leaveRoom(socket) {
  if (!socket.docId) return;
  const room = getRoom(socket.docId);
  room.delete(socket.userId);
  broadcastRoom(room, { type: 'doc:awareness', docId: socket.docId, userId: socket.userId, state: 'leave' });
}

let hub;
const { ctx } = createService({
  name: 'document',
  port: 8085,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    hub = createWsHub({ server: ctx.server, path: '/ws', onMessage: handleWsMessage(() => hub), onDisconnect: leaveRoom });
    seedBuiltinTemplates();

    // ---- 文档 CRUD ----
    app.post('/documents', asyncRoute(async (req, res) => {
      requireFields(req.body, ['title', 'type']);
      const { title, type, content, parentId, templateId } = req.body;
      let initContent = content;
      if (templateId) {
        const t = db.get('SELECT content FROM doc_templates WHERE id = ?', templateId);
        if (t) initContent = t.content;
      }
      const doc = createDocument({ title, type, content: initContent, ownerId: String(req.user.sub), parentId, watermark: 0 });
      publishEvent('document.created', { docId: doc.id, title }, 'document');
      res.status(201).json(doc);
    }));

    app.get('/documents', (req, res) => {
      res.json(listDocuments(String(req.user.sub), req.query.parentId));
    });

    app.get('/documents/:id', (req, res) => {
      const doc = getDocument(req.params.id);
      if (!doc) throw notFound('文档不存在');
      if (!hasPerm(req.params.id, req.user.sub, 'view')) throw forbidden();
      res.json(doc);
    });

    app.put('/documents/:id', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'edit')) throw forbidden();
      const doc = updateDocumentMeta(req.params.id, req.body);
      res.json(doc);
    });

    app.delete('/documents/:id', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'manage')) throw forbidden();
      deleteDocument(req.params.id);
      res.json({ ok: true });
    });

    // ---- 版本历史 ----
    app.get('/documents/:id/versions', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'view')) throw forbidden();
      res.json(listVersions(req.params.id));
    });

    app.post('/documents/:id/versions', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'edit')) throw forbidden();
      persistYDoc(req.params.id, String(req.user.sub));
      res.status(201).json(createVersion(req.params.id, String(req.user.sub)));
    });

    app.get('/documents/:id/versions/:versionNo', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'view')) throw forbidden();
      const v = getVersion(req.params.id, parseInt(req.params.versionNo));
      if (!v) throw notFound('版本不存在');
      res.json(v);
    });

    app.post('/documents/:id/versions/:versionNo/restore', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'manage')) throw forbidden();
      const doc = restoreVersion(req.params.id, parseInt(req.params.versionNo));
      if (!doc) throw notFound('版本不存在');
      // 通知在线编辑者：文档已回滚，需重新拉取全量状态
      const room = getRoom(req.params.id);
      broadcastRoom(room, { type: 'doc:sync', docId: req.params.id, update: Buffer.from(encodeStateAsUpdate(getYDoc(req.params.id))).toString('base64') });
      res.json(doc);
    });

    // ---- 评论 ----
    app.post('/documents/:id/comments', asyncRoute(async (req, res) => {
      requireFields(req.body, ['content']);
      if (!hasPerm(req.params.id, req.user.sub, 'comment')) throw forbidden();
      const c = createComment(req.params.id, String(req.user.sub), req.body.content, req.body.parentCommentId);
      const room = getRoom(req.params.id);
      broadcastRoom(room, { type: 'doc:comment', docId: req.params.id, comment: c });
      res.status(201).json(c);
    }));

    app.get('/documents/:id/comments', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'view')) throw forbidden();
      res.json(listComments(req.params.id));
    });

    app.post('/documents/:id/comments/:commentId/resolve', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'comment')) throw forbidden();
      res.json(resolveComment(req.params.commentId, req.body.resolved !== false));
    });

    // ---- 权限 ----
    app.get('/documents/:id/permissions', (req, res) => {
      if (!hasPerm(req.params.id, req.user.sub, 'manage')) throw forbidden();
      res.json(listPermissions(req.params.id));
    });

    app.post('/documents/:id/permissions', (req, res) => {
      requireFields(req.body, ['userId', 'perm']);
      if (!hasPerm(req.params.id, req.user.sub, 'manage')) throw forbidden();
      if (!PERM_RANK[req.body.perm]) throw badRequest('非法权限');
      setPermission(req.params.id, req.body.userId, req.body.perm);
      res.json({ ok: true });
    });

    // ---- 分享 ----
    app.post('/documents/:id/share', (req, res) => {
      requireFields(req.body, ['shareType', 'perm']);
      if (!hasPerm(req.params.id, req.user.sub, 'manage')) throw forbidden();
      res.status(201).json(createShare(req.params.id, req.body));
    });

    // ---- 模板 ----
    app.get('/templates', (req, res) => {
      res.json(listTemplates(req.query.builtin === '1'));
    });

    app.post('/templates', (req, res) => {
      requireFields(req.body, ['name', 'type']);
      res.status(201).json(createTemplate({ ...req.body, builtin: 0 }));
    });

    ctx.addDebug(() => ({
      documents: db.get('SELECT COUNT(*) c FROM documents').c,
      versions: db.get('SELECT COUNT(*) c FROM doc_versions').c,
      comments: db.get('SELECT COUNT(*) c FROM doc_comments').c,
      templates: db.get('SELECT COUNT(*) c FROM doc_templates').c,
      onlineUsers: hub?.onlineCount() || 0,
      onlineDocs: activeRoomCount(),
    }));
  },
});
