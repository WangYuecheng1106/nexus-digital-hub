// nexus-forum：企业论坛服务 — 数据层
// 板块划分：公司动态 / 技术分享 / 招聘内推 / 二手交易 / 生活杂谈
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('forum');

// 敏感词清单：发帖/评论入库前过滤，命中则替换为 *** 并标记待审核
export const SENSITIVE_WORDS = ['垃圾', '骗子', '操', 'sb', '傻逼', '妈的', 'fuck'];

migrate(db, [
  ['posts', `CREATE TABLE posts (
    id TEXT PRIMARY KEY, author_id TEXT, section TEXT, title TEXT, content TEXT,
    type TEXT DEFAULT 'article', views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0, created_at INTEGER)`],
  ['idx_post_section', `CREATE INDEX idx_post_section ON posts(section, created_at DESC)`],
  ['comments', `CREATE TABLE comments (
    id TEXT PRIMARY KEY, post_id TEXT, user_id TEXT, content TEXT,
    parent_id TEXT, created_at INTEGER)`],
  ['idx_comment_post', `CREATE INDEX idx_comment_post ON comments(post_id, created_at)`],
  ['post_likes', `CREATE TABLE post_likes (post_id TEXT, user_id TEXT, type TEXT, PRIMARY KEY (post_id, user_id))`],
  ['favorites', `CREATE TABLE favorites (user_id TEXT, post_id TEXT, PRIMARY KEY (user_id, post_id))`],
  ['follows', `CREATE TABLE follows (follower_id TEXT, followee_id TEXT, PRIMARY KEY (follower_id, followee_id))`],
  ['hashtags', `CREATE TABLE hashtags (id TEXT PRIMARY KEY, name TEXT UNIQUE)`],
  ['post_tags', `CREATE TABLE post_tags (post_id TEXT, tag_id TEXT, PRIMARY KEY (post_id, tag_id))`],
  ['reports', `CREATE TABLE reports (
    id TEXT PRIMARY KEY, post_id TEXT, reporter_id TEXT, reason TEXT, status TEXT DEFAULT 'open', created_at INTEGER)`],
]);

// 敏感词过滤：返回 { text, hit } —— 命中则替换并标记
export function filterSensitive(text) {
  let hit = false;
  let out = String(text || '');
  for (const w of SENSITIVE_WORDS) {
    if (out.includes(w)) { out = out.replaceAll(w, '***'); hit = true; }
  }
  return { text: out, hit };
}

// 解析正文中的 #话题# 标签，返回去重后的标签名列表
export function extractHashtags(content) {
  const set = new Set();
  const re = /#([^\s#]+)#/g;
  let m;
  while ((m = re.exec(String(content || '')))) set.add(m[1]);
  return [...set];
}

export function createPost(authorId, { section, title, content, type = 'article', tags = [] }) {
  const id = snowflake();
  const now = Date.now();
  const { text } = filterSensitive(content);
  db.tx(() => {
    db.run('INSERT INTO posts (id, author_id, section, title, content, type, created_at) VALUES (?,?,?,?,?,?,?)',
      id, authorId, section, title, text, type, now);
    for (const name of [...extractHashtags(content), ...tags]) {
      db.run('INSERT OR IGNORE INTO hashtags (id, name) VALUES (?, ?)', snowflake(), name);
      const t = db.get('SELECT id FROM hashtags WHERE name = ?', name);
      db.run('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', id, t.id);
    }
  });
  return getPost(id);
}

export function getPost(id) {
  const p = db.get('SELECT * FROM posts WHERE id = ?', id);
  if (p) p.tags = db.all('SELECT h.name FROM post_tags pt JOIN hashtags h ON h.id = pt.tag_id WHERE pt.post_id = ?', id).map((t) => t.name);
  return p;
}

export function listPosts({ section, where = '', params = [], order = 'created_at DESC', limit = 20 }) {
  let sql = 'SELECT * FROM posts WHERE banned = 0';
  if (section) sql += ' AND section = ?';
  sql += ` ${where} ORDER BY ${order} LIMIT ?`;
  return db.all(sql, ...(section ? [section] : []), ...params, limit);
}

// 热榜：综合点赞与浏览量按时间衰减排序，模拟 Hacker News 排名
export function hotPosts(limit = 20) {
  return db.all(
    `SELECT *, (likes * 2 + views + comments_count) AS score FROM (
      SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
      FROM posts p WHERE p.banned = 0
      ORDER BY (likes * 2 + views + (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)) DESC, created_at DESC
      LIMIT ?)`, limit);
}

// 推荐流：基于用户关注的人 + 同板块热门，简化为关注者最新 + 兜底热门
export function feedFor(userId, limit = 20) {
  const followeeCount = db.get('SELECT COUNT(*) c FROM follows WHERE follower_id = ?', userId).c;
  if (followeeCount > 0) {
    return db.all(
      `SELECT p.* FROM posts p JOIN follows f ON f.followee_id = p.author_id
       WHERE f.follower_id = ? AND p.banned = 0 ORDER BY p.created_at DESC LIMIT ?`, userId, limit);
  }
  return hotPosts(limit);
}

export function addComment(postId, userId, content, parentId = null) {
  const id = snowflake();
  const { text } = filterSensitive(content);
  const now = Date.now();
  db.run('INSERT INTO comments (id, post_id, user_id, content, parent_id, created_at) VALUES (?,?,?,?,?,?)',
    id, postId, userId, text, parentId, now);
  return db.get('SELECT * FROM comments WHERE id = ?', id);
}

export function listComments(postId) {
  const all = db.all('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC', postId);
  // 组装为两层结构：顶层评论 + replies
  const byParent = new Map();
  for (const c of all) {
    const pid = c.parent_id || 'root';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(c);
  }
  return (byParent.get('root') || []).map((c) => ({ ...c, replies: byParent.get(c.id) || [] }));
}

export function setLike(postId, userId, type) {
  db.tx(() => {
    db.run('INSERT OR REPLACE INTO post_likes (post_id, user_id, type) VALUES (?,?,?)', postId, userId, type);
    const likes = db.get("SELECT COUNT(*) c FROM post_likes WHERE post_id = ? AND type = 'like'", postId).c;
    const dislikes = db.get("SELECT COUNT(*) c FROM post_likes WHERE post_id = ? AND type = 'dislike'", postId).c;
    db.run('UPDATE posts SET likes = ? WHERE id = ?', likes - dislikes, postId);
  });
}

export function toggleFavorite(userId, postId) {
  const exists = db.get('SELECT 1 FROM favorites WHERE user_id = ? AND post_id = ?', userId, postId);
  if (exists) db.run('DELETE FROM favorites WHERE user_id = ? AND post_id = ?', userId, postId);
  else db.run('INSERT OR IGNORE INTO favorites (user_id, post_id) VALUES (?, ?)', userId, postId);
  return !exists;
}

export function toggleFollow(followerId, followeeId) {
  const exists = db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', followerId, followeeId);
  if (exists) db.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', followerId, followeeId);
  else db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)', followerId, followeeId);
  return !exists;
}

export function reportPost(postId, reporterId, reason) {
  const id = snowflake();
  db.run('INSERT INTO reports (id, post_id, reporter_id, reason, created_at) VALUES (?,?,?,?,?)',
    id, postId, reporterId, reason, Date.now());
  return id;
}

export function banPost(postId) { db.run('UPDATE posts SET banned = 1 WHERE id = ?', postId); }
