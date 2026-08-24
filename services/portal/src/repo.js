// nexus-portal：统一门户服务 — 数据层
// 工作台卡片布局、应用中心、最近使用、待办聚合
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('portal');

migrate(db, [
  ['user_dashboards', `CREATE TABLE user_dashboards (
    user_id TEXT PRIMARY KEY, layout TEXT, updated_at INTEGER)`],
  ['app_usage', `CREATE TABLE app_usage (
    user_id TEXT, app_id TEXT, last_used INTEGER, use_count INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, app_id))`],
  ['personal_todos', `CREATE TABLE personal_todos (
    id TEXT PRIMARY KEY, user_id TEXT, title TEXT,
    source TEXT, source_id TEXT, status TEXT DEFAULT 'pending', created_at INTEGER)`],
]);

// 全部 19 个服务作为应用中心条目，按类别分组
export const APP_CATALOG = [
  { id: 'auth', name: '身份认证', port: 8081, category: '基础', icon: 'auth' },
  { id: 'im', name: '即时通讯', port: 8083, category: '通讯', icon: 'chat' },
  { id: 'meeting', name: '视频会议', port: 8084, category: '通讯', icon: 'meeting' },
  { id: 'document', name: '文档协作', port: 8085, category: '协作', icon: 'doc' },
  { id: 'workflow', name: '流程审批', port: 8086, category: '协作', icon: 'flow' },
  { id: 'knowledge', name: '知识图谱', port: 8087, category: '协作', icon: 'graph' },
  { id: 'calendar', name: '日程日历', port: 8088, category: '协作', icon: 'calendar' },
  { id: 'drive', name: '云盘文件', port: 8089, category: '协作', icon: 'drive' },
  { id: 'project', name: '项目管理', port: 8090, category: '协作', icon: 'project' },
  { id: 'attendance', name: '考勤打卡', port: 8091, category: '人事', icon: 'clock' },
  { id: 'contacts', name: '通讯录', port: 8092, category: '人事', icon: 'contacts' },
  { id: 'forum', name: '企业论坛', port: 8093, category: '社区', icon: 'forum' },
  { id: 'notification', name: '消息中心', port: 8094, category: '基础', icon: 'bell' },
  { id: 'integration', name: '应用集成', port: 8095, category: '平台', icon: 'plug' },
  { id: 'ai', name: 'AI 助手', port: 8096, category: '平台', icon: 'ai' },
  { id: 'analytics', name: '数据分析', port: 8097, category: '平台', icon: 'chart' },
  { id: 'portal', name: '统一门户', port: 8098, category: '基础', icon: 'home' },
];

// 卡片类型：todo / calendar / messages / approvals / attendance / quick_actions
export const DEFAULT_LAYOUT = [
  { type: 'todo', title: '我的待办', w: 6, h: 4, x: 0, y: 0 },
  { type: 'calendar', title: '今日日程', w: 6, h: 4, x: 6, y: 0 },
  { type: 'messages', title: '未读消息', w: 4, h: 4, x: 0, y: 4 },
  { type: 'approvals', title: '待我审批', w: 4, h: 4, x: 4, y: 4 },
  { type: 'attendance', title: '考勤打卡', w: 4, h: 4, x: 8, y: 4 },
  { type: 'quick_actions', title: '快捷入口', w: 12, h: 2, x: 0, y: 8 },
];

export function getWorkbench(userId) {
  const row = db.get('SELECT * FROM user_dashboards WHERE user_id = ?', userId);
  if (!row) return { layout: DEFAULT_LAYOUT };
  return { layout: JSON.parse(row.layout) };
}

export function setWorkbench(userId, layout) {
  db.run(`INSERT OR REPLACE INTO user_dashboards (user_id, layout, updated_at) VALUES (?,?,?)`,
    userId, JSON.stringify(layout || DEFAULT_LAYOUT), Date.now());
}

export function listApps(userId) {
  const usage = db.all('SELECT app_id, last_used, use_count FROM app_usage WHERE user_id = ?', userId);
  const usageMap = Object.fromEntries(usage.map((u) => [u.app_id, u]));
  return APP_CATALOG.map((a) => ({ ...a, url: `/api/${a.id}`, lastUsed: usageMap[a.id]?.last_used || null, useCount: usageMap[a.id]?.use_count || 0 }));
}

export function recordAppUse(userId, appId) {
  const now = Date.now();
  db.run(`INSERT OR REPLACE INTO app_usage (user_id, app_id, last_used, use_count) VALUES (?,?,?,COALESCE((SELECT use_count FROM app_usage WHERE user_id=? AND app_id=?),0)+1)`,
    userId, appId, now, userId, appId);
}

export function recentApps(userId, limit = 8) {
  const rows = db.all('SELECT app_id, last_used FROM app_usage WHERE user_id = ? ORDER BY last_used DESC LIMIT ?', userId, limit);
  const map = Object.fromEntries(APP_CATALOG.map((a) => [a.id, a]));
  return rows.map((r) => ({ ...map[r.app_id], lastUsed: r.last_used })).filter(Boolean);
}

// ---- 个人待办（如 IM 消息转待办）----
export function createPersonalTodo(userId, { title, source, source_id }) {
  const id = snowflake();
  db.run(
    'INSERT INTO personal_todos (id, user_id, title, source, source_id, status, created_at) VALUES (?,?,?,?,?,?,?)',
    id, userId, String(title || '待办事项').slice(0, 120), source || 'manual', source_id || null, 'pending', Date.now(),
  );
  return db.get('SELECT * FROM personal_todos WHERE id = ?', id);
}

export function listPersonalTodos(userId) {
  return db.all("SELECT * FROM personal_todos WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 50", userId);
}
