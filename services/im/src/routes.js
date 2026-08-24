// nexus-im：HTTP REST 路由
import { asyncRoute, requireFields, badRequest, forbidden, notFound, publishEvent } from '@nexus/shared';
import { randomUUID } from 'node:crypto';
import { db, createMessage, deliverMessage, findSingleConversation, getConversationMembers } from './repo.js';
import {
  sendFriendRequest, respondFriendRequest, listFriends, listFriendRequests, areFriends,
} from './friends.js';

export function setupRoutes(app, hub) {
  // ---- WhatsApp 式加好友 ----
  app.post('/friends/request', asyncRoute(async (req, res) => {
    requireFields(req.body, ['toUserId']);
    try {
      const r = sendFriendRequest(String(req.user.sub), String(req.body.toUserId), req.body.message);
      hub.sendTo(req.body.toUserId, { type: 'im:friend_request', request: r });
      res.status(201).json(r);
    } catch (e) {
      throw badRequest(e.message);
    }
  }));
  app.post('/friends/respond', asyncRoute(async (req, res) => {
    requireFields(req.body, ['requestId']);
    try {
      const r = respondFriendRequest(req.body.requestId, String(req.user.sub), !!req.body.accept);
      if (r.status === 'accepted') {
        hub.sendTo(r.from_id, { type: 'im:friend_accepted', request: r });
      }
      res.json(r);
    } catch (e) {
      throw badRequest(e.message);
    }
  }));
  app.get('/friends', (req, res) => res.json(listFriends(String(req.user.sub))));
  app.get('/friends/requests', (req, res) => {
    res.json(listFriendRequests(String(req.user.sub), req.query.box === 'sent' ? 'sent' : 'inbox'));
  });
  app.get('/friends/check/:userId', (req, res) => {
    res.json({ friends: areFriends(String(req.user.sub), req.params.userId) });
  });

  // ---- 会话管理 ----
  app.post('/conversations', asyncRoute(async (req, res) => {
    requireFields(req.body, ['type']);
    const { type, name, memberIds = [] } = req.body;
    if (type === 'single' && memberIds.length === 1) {
      const existing = findSingleConversation(req.user.sub, memberIds[0]);
      if (existing) return res.json(existing);
    }
    const id = randomUUID().replace(/-/g, '').slice(0, 16) + Date.now().toString(36);
    const now = Date.now();
    db.tx(() => {
      db.run('INSERT INTO conversations (id, type, name, owner_id, created_at, updated_at) VALUES (?,?,?,?,?,?)',
        id, type, name || '', req.user.sub, now, now);
      db.run('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
        id, req.user.sub, 'owner', now);
      for (const uid of memberIds) {
        db.run('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
          id, uid, 'member', now);
      }
    });
    publishEvent('im.conversation_created', { conversationId: id, type, memberIds: [req.user.sub, ...memberIds] }, 'im');
    res.status(201).json({ id, type, name, members: [req.user.sub, ...memberIds] });
  }));

  app.get('/conversations', (req, res) => {
    const convs = db.all(
      `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.status = 'sent' AND
       m.id > COALESCE((SELECT last_read_msg_id FROM conversation_members WHERE conversation_id = c.id AND user_id = ?), '0')) as unread
       FROM conversations c
       WHERE c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
       ORDER BY c.updated_at DESC`,
      String(req.user.sub), String(req.user.sub)
    );
    for (const c of convs) {
      c.members = db.all('SELECT user_id, role, nickname FROM conversation_members WHERE conversation_id = ?', c.id);
      c.lastMessage = db.get("SELECT * FROM messages WHERE conversation_id = ? AND status = 'sent' ORDER BY created_at DESC LIMIT 1", c.id);
    }
    res.json(convs);
  });

  app.get('/conversations/:id', (req, res) => {
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
    if (!conv) throw notFound('会话不存在');
    conv.members = db.all('SELECT user_id, role, nickname FROM conversation_members WHERE conversation_id = ?', conv.id);
    res.json(conv);
  });

  app.post('/conversations/:id/members', asyncRoute(async (req, res) => {
    const { userIds = [] } = req.body;
    const now = Date.now();
    db.tx(() => {
      for (const uid of userIds) {
        db.run('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?,?,?,?)',
          req.params.id, uid, 'member', now);
      }
    });
    hub.sendTo(userIds, { type: 'im:event', event: 'added_to_conversation', conversationId: req.params.id });
    res.json({ ok: true });
  }));

  app.delete('/conversations/:id/members/:userId', (req, res) => {
    db.run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', req.params.id, req.params.userId);
    res.json({ ok: true });
  });

  app.put('/conversations/:id/announcement', (req, res) => {
    db.run('UPDATE conversations SET announcement = ? WHERE id = ?', req.body.announcement || '', req.params.id);
    const members = getConversationMembers(req.params.id);
    hub.sendTo(members, { type: 'im:event', event: 'announcement', conversationId: req.params.id, announcement: req.body.announcement });
    res.json({ ok: true });
  });

  app.put('/conversations/:id', (req, res) => {
    const { name, avatar } = req.body;
    db.run('UPDATE conversations SET name = COALESCE(?, name), avatar = COALESCE(?, avatar), updated_at = ? WHERE id = ?',
      name, avatar, Date.now(), req.params.id);
    res.json({ ok: true });
  });

  app.delete('/conversations/:id', (req, res) => {
    db.tx(() => {
      db.run('DELETE FROM messages WHERE conversation_id = ?', req.params.id);
      db.run('DELETE FROM conversation_members WHERE conversation_id = ?', req.params.id);
      db.run('DELETE FROM conversations WHERE id = ?', req.params.id);
    });
    res.json({ ok: true });
  });

  // ---- 消息 ----
  app.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
    requireFields(req.body, ['type', 'body']);
    const msg = createMessage(req.params.id, String(req.user.sub), req.body.type, req.body.body);
    deliverMessage(hub, msg);
    res.status(201).json(msg);
  }));

  app.get('/conversations/:id/messages', (req, res) => {
    const before = req.query.before;
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    let sql = "SELECT * FROM messages WHERE conversation_id = ? AND status != 'deleted'";
    const params = [req.params.id];
    if (before) { sql += ' AND id < ?'; params.push(before); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    res.json(db.all(sql, ...params).reverse());
  });

  // ---- 已读回执 ----
  app.post('/conversations/:id/read', (req, res) => {
    const { lastReadMsgId } = req.body;
    db.run('UPDATE conversation_members SET last_read_msg_id = ? WHERE conversation_id = ? AND user_id = ?',
      lastReadMsgId, req.params.id, String(req.user.sub));
    const conv = db.get('SELECT * FROM conversations WHERE id = ?', req.params.id);
    if (conv?.type === 'single') {
      const other = db.get('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?',
        req.params.id, String(req.user.sub));
      if (other) hub.sendTo(other.user_id, { type: 'im:read', conversationId: req.params.id, userId: req.user.sub, lastReadMsgId });
    }
    res.json({ ok: true });
  });

  // ---- 撤回 ----
  app.post('/messages/:id/recall', (req, res) => {
    const msg = db.get('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!msg) throw notFound('消息不存在');
    if (msg.sender_id !== String(req.user.sub)) throw forbidden('只能撤回自己的消息');
    if (Date.now() - msg.created_at > 120000) throw badRequest('超过 2 分钟不可撤回');
    db.run('UPDATE messages SET status = ?, updated_at = ? WHERE id = ?', 'recalled', Date.now(), msg.id);
    const members = getConversationMembers(msg.conversation_id);
    hub.sendTo(members, { type: 'im:recall', messageId: msg.id, conversationId: msg.conversation_id, senderId: msg.sender_id });
    res.json({ ok: true });
  });

  app.delete('/messages/:id', (req, res) => {
    db.run('UPDATE messages SET status = ? WHERE id = ? AND sender_id = ?', 'deleted', req.params.id, String(req.user.sub));
    res.json({ ok: true });
  });

  // ---- 转发 ----
  app.post('/messages/:id/forward', asyncRoute(async (req, res) => {
    requireFields(req.body, ['targetConversationIds']);
    const msg = db.get('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!msg) throw notFound('消息不存在');
    const forwarded = [];
    for (const tid of req.body.targetConversationIds) {
      const body = JSON.parse(msg.body);
      body.forwardedFrom = msg.id;
      body.forwardedFromSender = msg.sender_id;
      const m = createMessage(tid, String(req.user.sub), msg.type, body);
      deliverMessage(hub, m);
      forwarded.push(m);
    }
    res.json({ forwarded });
  }));

  // ---- 收藏 ----
  app.post('/messages/:id/favorite', (req, res) => {
    db.run('INSERT OR IGNORE INTO message_favorites (user_id, message_id, category, created_at) VALUES (?,?,?,?)',
      String(req.user.sub), req.params.id, req.body.category || 'default', Date.now());
    res.json({ ok: true });
  });

  app.get('/favorites', (req, res) => {
    res.json(db.all('SELECT f.*, m.* FROM message_favorites f JOIN messages m ON m.id = f.message_id WHERE f.user_id = ? ORDER BY f.created_at DESC',
      String(req.user.sub)));
  });

  // ---- 草稿 ----
  app.put('/conversations/:id/draft', (req, res) => {
    db.run('INSERT OR REPLACE INTO drafts (user_id, conversation_id, content, updated_at) VALUES (?,?,?,?)',
      String(req.user.sub), req.params.id, req.body.content || '', Date.now());
    res.json({ ok: true });
  });

  app.get('/conversations/:id/draft', (req, res) => {
    const d = db.get('SELECT content FROM drafts WHERE user_id = ? AND conversation_id = ?', String(req.user.sub), req.params.id);
    res.json({ content: d?.content || '' });
  });

  // ---- 搜索 ----
  app.get('/search', (req, res) => {
    const q = String(req.query.q || '');
    if (!q) return res.json([]);
    const results = db.all("SELECT * FROM messages WHERE status = 'sent' AND body LIKE ? ORDER BY created_at DESC LIMIT 50", `%${q}%`)
      .filter((m) => db.get('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?', m.conversation_id, String(req.user.sub)));
    res.json(results);
  });

  // ---- 在线状态 ----
  app.get('/online/:userId', (req, res) => {
    res.json({ userId: req.params.userId, online: hub.isOnline(req.params.userId) });
  });

  // ---- 群组角色 ----
  app.put('/conversations/:id/members/:userId/role', (req, res) => {
    db.run('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?',
      req.body.role, req.params.id, req.params.userId);
    res.json({ ok: true });
  });
}
