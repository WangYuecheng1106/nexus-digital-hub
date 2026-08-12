// nexus-drive：服务入口
// 云盘服务：个人/共享空间、文件 CRUD、上传下载、分享、版本、搜索、回收站、配额。
// 大对象走文件系统、元数据走 SQLite，秒传通过 content_hash 复用存储实现。
import { createService, subscribeEvents } from '@nexus/shared';
import { db } from './repo.js';
import { setupRoutes } from './routes.js';

const { ctx } = createService({
  name: 'drive',
  port: 8089,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    setupRoutes(app);
    ctx.addDebug(() => ({
      files: db.get('SELECT COUNT(*) c FROM files WHERE deleted = 0').c,
      recycle: db.get('SELECT COUNT(*) c FROM file_recycle').c,
      shares: db.get('SELECT COUNT(*) c FROM file_shares').c,
      versions: db.get('SELECT COUNT(*) c FROM file_versions').c,
    }));
  },
});

// 用户离职：将其所有文件标记为已删除（保留 30 天供交接，到期由 cron 清理）
ctx.onEvent('auth.user_deleted', (payload) => {
  if (!payload?.userId) return;
  db.run('UPDATE files SET deleted = 1, deleted_at = ? WHERE owner_id = ? AND deleted = 0', Date.now(), payload.userId);
});

subscribeEvents('drive', 8089, ['auth.user_deleted']);
