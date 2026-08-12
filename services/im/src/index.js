// nexus-im：服务入口
import { createService, createWsHub, subscribeEvents } from '@nexus/shared';
import { db } from './repo.js';
import { handleWsMessage } from './ws.js';
import { setupRoutes } from './routes.js';

let hub;

const { ctx } = createService({
  name: 'im',
  port: 8083,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    hub = createWsHub({ server: ctx.server, path: '/ws', onMessage: handleWsMessage(() => hub) });
    setupRoutes(app, hub);
    ctx.addDebug(() => ({
      conversations: db.get('SELECT COUNT(*) c FROM conversations').c,
      messages: db.get('SELECT COUNT(*) c FROM messages').c,
      onlineUsers: hub?.onlineCount() || 0,
    }));
  },
});

subscribeEvents('im', 8083, ['auth.login', 'auth.user_status']);
