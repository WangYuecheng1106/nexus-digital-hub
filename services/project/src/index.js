// nexus-project：服务入口
// 项目任务服务：项目/任务 CRUD、看板列流转、子任务、依赖关系、甘特图、评论、统计。
// 关键路径与燃尽图在服务端聚合计算，前端只负责渲染。
import { createService, subscribeEvents } from '@nexus/shared';
import { db } from './repo.js';
import { setupRoutes } from './routes.js';

const { ctx } = createService({
  name: 'project',
  port: 8090,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    setupRoutes(app);
    ctx.addDebug(() => ({
      projects: db.get('SELECT COUNT(*) c FROM projects').c,
      tasks: db.get('SELECT COUNT(*) c FROM tasks').c,
      archivedProjects: db.get('SELECT COUNT(*) c FROM projects WHERE archived = 1').c,
      comments: db.get('SELECT COUNT(*) c FROM task_comments').c,
    }));
  },
});

// 用户离职：将其负责的任务指派人清空，避免任务被永久锁定
ctx.onEvent('auth.user_deleted', (payload) => {
  if (!payload?.userId) return;
  db.run('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?', payload.userId);
});

subscribeEvents('project', 8090, ['auth.user_deleted']);
