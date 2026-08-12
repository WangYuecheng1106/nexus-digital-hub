// nexus-portal：服务入口 + HTTP 路由
// 工作台、应用中心、全局搜索（跨服务 fetch 聚合）、待办中心（跨服务聚合）
import { createService, asyncRoute, requireFields, subscribeEvents } from '@nexus/shared';
import {
  db, APP_CATALOG, getWorkbench, setWorkbench, listApps, recordAppUse, recentApps,
} from './repo.js';

const { ctx } = createService({
  name: 'portal',
  port: 8098,
  publicPaths: ['/health', '/debug', '/apps'],
  setup(app, ctx) {
    setupRoutes(app);
    ctx.addDebug(() => ({
      dashboards: db.get('SELECT COUNT(*) c FROM user_dashboards').c,
      appUsage: db.get('SELECT COUNT(*) c FROM app_usage').c,
    }));
  },
});

subscribeEvents('portal', 8098, ['auth.login']);

// 跨服务 fetch 封装：透传用户 JWT，超时 3s，失败返回 null 不影响聚合
async function fetchService(port, path, authHeader, method = 'GET', body) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`http://localhost:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: authHeader || '' },
      body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// 全局搜索：跨多个服务并发搜索并聚合结果
const SEARCH_TARGETS = [
  { id: 'im', port: 8083, path: '/search', label: '消息' },
  { id: 'document', port: 8085, path: '/search', label: '文档' },
  { id: 'forum', port: 8093, path: '/posts', label: '帖子', queryTransform: (q) => `?author_id=&section=&size=20` },
  { id: 'knowledge', port: 8087, path: '/search', label: '知识' },
  { id: 'contacts', port: 8092, path: '/search', label: '通讯录' },
  { id: 'drive', port: 8089, path: '/search', label: '文件' },
  { id: 'project', port: 8090, path: '/search', label: '任务' },
];

// 待办聚合：从 workflow + project + calendar 拉取待办
const TODO_TARGETS = [
  { id: 'workflow', port: 8086, path: '/tasks/pending', label: '审批待办' },
  { id: 'project', port: 8090, path: '/tasks/pending', label: '项目任务' },
  { id: 'calendar', port: 8088, path: '/events/upcoming', label: '日程待办' },
];

function setupRoutes(app) {
  // ---- 工作台 ----
  app.get('/workbench', asyncRoute(async (req, res) => {
    const { layout } = getWorkbench(String(req.user.sub));
    const auth = req.headers.authorization;
    // 为每种卡片填充实时数据
    const cards = await Promise.all(layout.map(async (c) => {
      const card = { ...c };
      if (c.type === 'todo') card.data = await aggregateTodos(auth);
      else if (c.type === 'messages') card.data = await fetchService(8094, '/notifications/unread-count', auth);
      else if (c.type === 'approvals') card.data = (await fetchService(8086, '/tasks/pending', auth)) || [];
      else if (c.type === 'attendance') card.data = await fetchService(8091, '/status', auth);
      else if (c.type === 'calendar') card.data = (await fetchService(8088, '/events?from=today', auth)) || [];
      else if (c.type === 'quick_actions') card.data = APP_CATALOG.slice(0, 8);
      return card;
    }));
    res.json({ cards });
  }));

  app.put('/workbench', asyncRoute(async (req, res) => {
    requireFields(req.body, ['layout']);
    setWorkbench(String(req.user.sub), req.body.layout);
    res.json({ ok: true });
  }));

  // ---- 应用中心 ----
  app.get('/apps', (req, res) => {
    const apps = listApps(String(req.user.sub));
    if (req.query.category) return res.json(apps.filter((a) => a.category === req.query.category));
    // 按类别分组返回
    const groups = {};
    for (const a of apps) (groups[a.category] = groups[a.category] || []).push(a);
    res.json({ apps, groups, recent: recentApps(String(req.user.sub)) });
  });

  app.post('/apps/:id/use', (req, res) => {
    recordAppUse(String(req.user.sub), req.params.id);
    res.json({ ok: true });
  });

  app.get('/apps/search', (req, res) => {
    const q = String(req.query.q || '').toLowerCase();
    if (!q) return res.json([]);
    res.json(APP_CATALOG.filter((a) => a.name.toLowerCase().includes(q) || a.id.includes(q)));
  });

  // ---- 全局搜索：跨服务聚合 ----
  app.get('/search', asyncRoute(async (req, res) => {
    const q = String(req.query.q || '');
    if (!q) return res.json({ query: q, results: [] });
    const auth = req.headers.authorization;
    const results = await Promise.all(SEARCH_TARGETS.map(async (t) => {
      const path = t.queryTransform ? `${t.path}${t.queryTransform(q)}` : `${t.path}?q=${encodeURIComponent(q)}`;
      const data = await fetchService(t.port, path, auth);
      const items = Array.isArray(data) ? data : (data?.items || data?.results || data?.posts || (data ? [data] : []));
      return { module: t.id, label: t.label, items: items.slice(0, 10) };
    }));
    res.json({ query: q, results: results.filter((r) => r.items.length > 0) });
  }));

  // ---- 待办中心：聚合 workflow + project + calendar ----
  app.get('/todos', asyncRoute(async (req, res) => {
    const auth = req.headers.authorization;
    const todos = await aggregateTodos(auth);
    res.json({ total: todos.length, items: todos });
  }));
}

// 待办聚合实现：并发拉取三个服务，统一格式化
async function aggregateTodos(auth) {
  const results = await Promise.all(TODO_TARGETS.map(async (t) => {
    const data = await fetchService(t.port, t.path, auth);
    const items = Array.isArray(data) ? data : (data?.items || (data ? [data] : []));
    return items.map((it) => ({
      id: it.id || it._id,
      source: t.id,
      label: t.label,
      title: it.title || it.name || it.summary || '待办事项',
      dueTime: it.dueTime || it.start_time || it.startTime || it.dueDate,
      status: it.status || 'pending',
      actionUrl: it.actionUrl || it.action_url,
    }));
  }));
  return results.flat();
}
