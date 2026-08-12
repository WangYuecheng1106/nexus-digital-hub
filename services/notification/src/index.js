// nexus-notification：服务入口 + HTTP 路由 + WebSocket 实时推送
// 在线用户通过 /ws 实时推送，离线用户入库后下次进入消息中心查看
import { createService, createWsHub, asyncRoute, requireFields, notFound, publishEvent, subscribeEvents } from '@nexus/shared';
import {
  db, CATEGORIES, createNotification, listNotifications, unreadCount,
  markRead, markAllRead, deleteNotification, getPreferences, setPreference, mergeDigest,
} from './repo.js';

let hub;

const { ctx } = createService({
  name: 'notification',
  port: 8094,
  publicPaths: ['/health', '/debug', '/internal/events'],
  setup(app, ctx) {
    hub = createWsHub({ server: ctx.server, path: '/ws' });
    setupRoutes(app);
    // 订阅跨服务事件：把事件转化为通知入库并实时推送
    ctx.onEvent('*', (payload, meta) => {
      const mapping = EVENT_MAP[meta.type];
      if (!mapping) return;
      const notif = createNotification({ userId: mapping.userId(payload), ...mapping.fields(payload) });
      if (notif && hub?.isOnline(notif.user_id)) {
        hub.sendTo(notif.user_id, { type: 'notification:new', notification: notif });
      }
    });
    ctx.addDebug(() => ({
      notifications: db.get('SELECT COUNT(*) c FROM notifications').c,
      unread: db.get('SELECT COUNT(*) c FROM notifications WHERE read = 0').c,
      online: hub?.onlineCount() || 0,
    }));
  },
});

subscribeEvents('notification', 8094, ['*']);

// 事件 → 通知字段映射表：约定 payload 必含 userId
const EVENT_MAP = {
  'workflow.task_assigned': { userId: (p) => p.userId, fields: (p) => ({ category: 'todo', type: 'workflow', title: '新待办任务', content: p.title || '您有新的审批任务待处理', sourceModule: 'workflow', sourceId: p.taskId, actionUrl: p.actionUrl }) },
  'workflow.task_approved': { userId: (p) => p.userId, fields: (p) => ({ category: 'business', type: 'workflow', title: '审批通过', content: p.title || '您的申请已通过', sourceModule: 'workflow', sourceId: p.taskId }) },
  'im.mentioned': { userId: (p) => p.userId, fields: (p) => ({ category: 'at_me', type: 'im', title: `${p.senderName || '有人'} @ 了你`, content: p.preview || '', sourceModule: 'im', sourceId: p.messageId, actionUrl: p.actionUrl }) },
  'meeting.invited': { userId: (p) => p.userId, fields: (p) => ({ category: 'business', type: 'meeting', title: '会议邀请', content: p.title || '您被邀请参加会议', sourceModule: 'meeting', sourceId: p.meetingId, actionUrl: p.actionUrl }) },
  'meeting.starting_soon': { userId: (p) => p.userId, fields: (p) => ({ category: 'todo', type: 'meeting', title: '会议即将开始', content: p.title || '会议 5 分钟后开始', sourceModule: 'meeting', sourceId: p.meetingId }) },
  'forum.post_at_me': { userId: (p) => p.userId, fields: (p) => ({ category: 'at_me', type: 'forum', title: `${p.authorName || '有人'} 在帖子里 @ 了你`, content: p.preview || '', sourceModule: 'forum', sourceId: p.postId }) },
  'calendar.reminder': { userId: (p) => p.userId, fields: (p) => ({ category: 'todo', type: 'calendar', title: '日程提醒', content: p.title || '日程即将开始', sourceModule: 'calendar', sourceId: p.eventId, actionUrl: p.actionUrl }) },
  'system.announcement': { userId: (p) => p.userId, fields: (p) => ({ category: 'system', type: 'system', title: p.title || '系统公告', content: p.content || '', sourceModule: 'system' }) },
};

function setupRoutes(app) {
  // ---- 通知面板 ----
  app.get('/notifications', (req, res) => {
    res.json(listNotifications(String(req.user.sub), { category: req.query.category, read: req.query.read }));
  });
  app.get('/notifications/unread-count', (req, res) => res.json(unreadCount(String(req.user.sub))));

  // ---- 单条/全部已读 ----
  app.post('/notifications/:id/read', (req, res) => { markRead(req.params.id, String(req.user.sub)); res.json({ ok: true }); });
  app.post('/notifications/read-all', (req, res) => { markAllRead(String(req.user.sub)); res.json({ ok: true }); });

  // ---- 删除 ----
  app.delete('/notifications/:id', (req, res) => { deleteNotification(req.params.id, String(req.user.sub)); res.json({ ok: true }); });

  // ---- 快捷操作：通过通知直接执行关联动作（仅做状态记录） ----
  app.post('/notifications/:id/action', asyncRoute(async (req, res) => {
    const n = db.get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', req.params.id, String(req.user.sub));
    if (!n) throw notFound('通知不存在');
    markRead(n.id, String(req.user.sub));
    publishEvent('notification.action', { notificationId: n.id, action: req.body.action, userId: req.user.sub }, 'notification');
    res.json({ ok: true, actionUrl: n.action_url });
  }));

  // ---- 偏好设置（免打扰 / 通道 / 分类开关） ----
  app.get('/preferences', (req, res) => res.json(getPreferences(String(req.user.sub))));
  app.put('/preferences', asyncRoute(async (req, res) => {
    requireFields(req.body, ['category']);
    if (!CATEGORIES.includes(req.body.category)) throw notFound('分类不存在');
    setPreference(String(req.user.sub), req.body.category, { channel: req.body.channel, enabled: req.body.enabled });
    res.json({ ok: true });
  }));

  // ---- 内部推送接口：其他服务直接调用本服务发通知 ----
  app.post('/internal/send', asyncRoute(async (req, res) => {
    requireFields(req.body, ['userId', 'title']);
    const prefs = getPreferences(String(req.body.userId));
    const pref = prefs[req.body.category || 'system'];
    if (!pref.enabled || pref.channel === 'none') return res.json({ ok: false, reason: 'muted' });
    // 频控：同源同类型 5 分钟内合并为摘要
    const merged = mergeDigest(String(req.body.userId), req.body.sourceModule, req.body.type, req.body.title);
    let notif;
    if (merged) {
      notif = db.get('SELECT * FROM notifications WHERE id = ?', merged);
    } else {
      notif = createNotification({ ...req.body, userId: String(req.body.userId) });
    }
    if (notif && hub?.isOnline(notif.user_id)) {
      hub.sendTo(notif.user_id, { type: 'notification:new', notification: notif });
    }
    res.status(201).json(notif);
  }));
}
