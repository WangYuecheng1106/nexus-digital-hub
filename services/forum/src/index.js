// nexus-forum：服务入口 + HTTP 路由
// 板块：公司动态/技术分享/招聘内推/二手交易/生活杂谈
import { createService, asyncRoute, requireFields, badRequest, forbidden, notFound, pageParams, publishEvent, subscribeEvents, requirePerm } from '@nexus/shared';
import {
  db, createPost, getPost, listPosts, hotPosts, feedFor, addComment, listComments,
  setLike, toggleFavorite, toggleFollow, reportPost, banPost, extractHashtags,
} from './repo.js';

export const SECTIONS = ['news', 'tech', 'recruit', 'trade', 'life'];
export const SECTION_LABELS = { news: '公司动态', tech: '技术分享', recruit: '招聘内推', trade: '二手交易', life: '生活杂谈' };

const { ctx } = createService({
  name: 'forum',
  port: 8093,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    setupRoutes(app);
    if (!db.get("SELECT id FROM posts WHERE section = 'news' AND banned = 0")) {
      createPost('user-admin', { section: 'news', title: '统一员工端已上线', content: '所有人使用同一工作台，没有管理员皮肤。' });
    }
    if (db.get('SELECT COUNT(*) c FROM posts').c < 3) {
      createPost('user-zhangwei', { section: 'tech', title: '图谱适应画布', content: '万级节点请点「适应画布」，节点会出现在视野里。' });
      createPost('user-lina', { section: 'recruit', title: '前端工程师内推', content: '研发部扩招，欢迎内推。' });
    }
    ctx.addDebug(() => ({
      posts: db.get('SELECT COUNT(*) c FROM posts').c,
      comments: db.get('SELECT COUNT(*) c FROM comments').c,
      reports: db.get("SELECT COUNT(*) c FROM reports WHERE status = 'open'").c,
    }));
  },
});

subscribeEvents('forum', 8093, ['auth.user_registered']);

function setupRoutes(app) {
  // ---- 板块 ----
  app.get('/sections', (req, res) => {
    db.run(`UPDATE posts SET section = 'life' WHERE section NOT IN ('news','tech','recruit','trade','life')`);
    const all = db.get('SELECT COUNT(*) c FROM posts WHERE banned = 0').c;
    res.json([
      { id: -1, key: 'all', name: '全部', count: all },
      ...SECTIONS.map((key, i) => ({ id: i, key, name: SECTION_LABELS[key], count: db.get('SELECT COUNT(*) c FROM posts WHERE section = ? AND banned = 0', key).c })),
    ]);
  });

  // ---- 帖子 CRUD ----
  app.post('/posts', asyncRoute(async (req, res) => {
    requireFields(req.body, ['section', 'title', 'content']);
    if (!SECTIONS.includes(req.body.section)) throw badRequest('板块不存在');
    const p = createPost(String(req.user.sub), req.body);
    publishEvent('forum.post_created', { postId: p.id, authorId: p.author_id, section: p.section }, 'forum');
    res.status(201).json(p);
  }));

  app.get('/posts', (req, res) => {
    const { size, offset } = pageParams(req);
    const { section, author_id } = req.query;
    res.json(listPosts({ section, where: author_id ? ' AND author_id = ?' : '', params: author_id ? [author_id] : [], limit: size, offset }));
  });

  app.get('/posts/:id', (req, res) => {
    const p = getPost(req.params.id);
    if (!p) throw notFound('帖子不存在');
    db.run('UPDATE posts SET views = views + 1 WHERE id = ?', p.id);
    p.views++;
    p.comments = listComments(p.id);
    res.json(p);
  });

  app.put('/posts/:id', asyncRoute(async (req, res) => {
    const p = getPost(req.params.id);
    if (!p) throw notFound('帖子不存在');
    if (p.author_id !== String(req.user.sub)) throw forbidden('只能编辑自己的帖子');
    db.run('UPDATE posts SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?',
      req.body.title, req.body.content, p.id);
    res.json(getPost(p.id));
  }));

  app.delete('/posts/:id', (req, res) => {
    const p = getPost(req.params.id);
    if (!p) throw notFound('帖子不存在');
    if (p.author_id !== String(req.user.sub) && !(req.user.perms || []).includes('forum.moderate')) throw forbidden('无权删除');
    db.run('DELETE FROM posts WHERE id = ?', p.id);
    res.json({ ok: true });
  });

  // ---- 点赞 / 点踩 ----
  app.post('/posts/:id/like', asyncRoute(async (req, res) => {
    const type = req.body.type === 'dislike' ? 'dislike' : 'like';
    setLike(req.params.id, String(req.user.sub), type);
    res.json(getPost(req.params.id));
  }));

  // ---- 收藏 ----
  app.post('/posts/:id/favorite', (req, res) => res.json({ favorited: toggleFavorite(String(req.user.sub), req.params.id) }));
  app.get('/favorites', (req, res) => res.json(db.all(
    'SELECT p.* FROM favorites f JOIN posts p ON p.id = f.post_id WHERE f.user_id = ? ORDER BY p.created_at DESC', String(req.user.sub))));

  // ---- 评论（支持二级嵌套） ----
  app.post('/posts/:id/comments', asyncRoute(async (req, res) => {
    requireFields(req.body, ['content']);
    const p = getPost(req.params.id);
    if (!p) throw notFound('帖子不存在');
    const c = addComment(p.id, String(req.user.sub), req.body.content, req.body.parentId || null);
    res.status(201).json(c);
  }));
  app.get('/posts/:id/comments', (req, res) => res.json(listComments(req.params.id)));

  // ---- 转发：复制为新帖并标记来源 ----
  app.post('/posts/:id/forward', asyncRoute(async (req, res) => {
    const p = getPost(req.params.id);
    if (!p) throw notFound('帖子不存在');
    const fwd = createPost(String(req.user.sub), {
      section: p.section, title: `[转发] ${p.title}`, content: p.content, type: p.type,
    });
    res.status(201).json(fwd);
  }));

  // ---- 关注 / 粉丝 ----
  app.post('/follow/:userId', (req, res) => res.json({ following: toggleFollow(String(req.user.sub), req.params.userId) }));
  app.get('/follows', (req, res) => {
    const uid = String(req.user.sub);
    res.json({
      following: db.all('SELECT followee_id FROM follows WHERE follower_id = ?', uid).map((r) => r.followee_id),
      followers: db.all('SELECT follower_id FROM follows WHERE followee_id = ?', uid).map((r) => r.follower_id),
    });
  });

  // ---- 话题广场 ----
  app.get('/hashtags', (req, res) => res.json(db.all(
    `SELECT h.name, COUNT(pt.post_id) count FROM hashtags h
     LEFT JOIN post_tags pt ON pt.tag_id = h.id
     GROUP BY h.id ORDER BY count DESC LIMIT 100`)));
  app.get('/hashtags/:name', (req, res) => {
    const t = db.get('SELECT * FROM hashtags WHERE name = ?', req.params.name);
    if (!t) return res.json({ name: req.params.name, posts: [] });
    const posts = db.all('SELECT p.* FROM post_tags pt JOIN posts p ON p.id = pt.post_id WHERE pt.tag_id = ? AND p.banned = 0 ORDER BY p.created_at DESC', t.id);
    res.json({ name: t.name, posts });
  });

  // ---- 热榜 / 推荐流 ----
  app.get('/hot', (req, res) => res.json(hotPosts(parseInt(req.query.limit) || 20)));
  app.get('/feed', (req, res) => res.json(feedFor(String(req.user.sub), parseInt(req.query.limit) || 20)));

  // ---- 举报 ----
  app.post('/report', asyncRoute(async (req, res) => {
    requireFields(req.body, ['postId', 'reason']);
    const id = reportPost(req.body.postId, String(req.user.sub), req.body.reason);
    res.status(201).json({ id });
  }));

  // ---- 管理员审核：封禁帖子 / 处理举报 ----
  app.post('/admin/ban/:postId', requirePerm('forum.moderate'), (req, res) => {
    banPost(req.params.postId);
    res.json({ ok: true });
  });
  app.get('/admin/reports', requirePerm('forum.moderate'), (req, res) =>
    res.json(db.all("SELECT r.*, p.title FROM reports r JOIN posts p ON p.id = r.post_id WHERE r.status = 'open' ORDER BY r.created_at DESC")));
  app.post('/admin/reports/:id/resolve', requirePerm('forum.moderate'), (req, res) => {
    db.run('UPDATE reports SET status = ? WHERE id = ?', req.body.action === 'ban' ? 'banned' : 'dismissed', req.params.id);
    if (req.body.action === 'ban') banPost(req.body.postId);
    res.json({ ok: true });
  });
}
