// nexus-im：服务入口
import { createService, createWsHub, subscribeEvents } from '@nexus/shared';
import { db, postWorkNotice } from './repo.js';
import { handleWsMessage } from './ws.js';
import { setupRoutes } from './routes.js';

const ACTORS = {
  'user-admin': '系统管理员',
  'user-zhangwei': '张伟',
  'user-lina': '李娜',
  'user-wangfang': '王芳',
  'user-chenjie': '陈杰',
  'user-liuyang': '刘洋',
};
function actorName(payload) {
  return payload?.actorName || ACTORS[payload?.actorId] || '审批人';
}

let hub;

const { ctx } = createService({
  name: 'im',
  port: 8083,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    hub = createWsHub({ server: ctx.server, path: '/ws', onMessage: handleWsMessage(() => hub) });
    setupRoutes(app, hub);
    ctx.onEvent('workflow.completed', (payload) => {
      const name = actorName(payload);
      if (payload?.initiatorId) postWorkNotice(hub, payload.initiatorId, `${name}已同意你的审批`);
    });
    ctx.onEvent('workflow.rejected', (payload) => {
      const name = actorName(payload);
      if (payload?.initiatorId) postWorkNotice(hub, payload.initiatorId, `${name}已拒绝你的审批`);
    });
    ctx.onEvent('workflow.task_acted', (payload) => {
      const name = actorName(payload);
      if (payload?.initiatorId) postWorkNotice(hub, payload.initiatorId, `${name}已同意`);
    });
    ctx.onEvent('meeting.created', (payload) => {
      if (payload?.hostId) postWorkNotice(hub, payload.hostId, `会议已创建，会议号 ${payload.meetingNo || ''}`);
    });
    ctx.addDebug(() => ({
      conversations: db.get('SELECT COUNT(*) c FROM conversations').c,
      messages: db.get('SELECT COUNT(*) c FROM messages').c,
      onlineUsers: hub?.onlineCount() || 0,
    }));
  },
});

subscribeEvents('im', 8083, ['auth.login', 'auth.user_status', 'workflow.completed', 'workflow.rejected', 'workflow.task_acted', 'meeting.created']);
