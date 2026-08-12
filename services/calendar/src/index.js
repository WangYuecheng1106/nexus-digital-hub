// nexus-calendar：服务入口
// 日程服务负责日程 CRUD、重复规则展开、参会人邀请与回复、冲突检测、节假日查询。
// 通过事件总线向 notification 服务投递提醒事件，由其负责实际推送（应用内/系统通知/邮件）。
import { createService, subscribeEvents } from '@nexus/shared';
import { db } from './repo.js';
import { setupRoutes } from './routes.js';

const { ctx } = createService({
  name: 'calendar',
  port: 8088,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    setupRoutes(app);
    ctx.addDebug(() => ({
      events: db.get('SELECT COUNT(*) c FROM events').c,
      attendees: db.get('SELECT COUNT(*) c FROM event_attendees').c,
      pendingReminders: db.get('SELECT COUNT(*) c FROM reminders WHERE sent = 0').c,
    }));
  },
});

// 订阅用户删除事件，清理该用户参与的待办邀请，避免脏数据残留
ctx.onEvent('auth.user_deleted', (payload) => {
  if (!payload?.userId) return;
  db.run('DELETE FROM event_attendees WHERE user_id = ?', payload.userId);
  db.run('DELETE FROM reminders WHERE user_id = ?', payload.userId);
});

subscribeEvents('calendar', 8088, ['auth.user_deleted']);
