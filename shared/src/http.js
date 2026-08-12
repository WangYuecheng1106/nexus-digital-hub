// 微服务工厂：统一的 HTTP 服务骨架 —— 请求日志、JWT 鉴权中间件、健康检查、
// 调试端点、统一错误格式。每个微服务通过 createService 获得一致的可观测性与安全基线。
import express from 'express';
import http from 'node:http';
import { verifyToken } from './jwt.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = '未认证或凭证已失效') => new HttpError(401, msg);
export const forbidden = (msg = '没有执行该操作的权限') => new HttpError(403, msg);
export const notFound = (msg = '资源不存在') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

const INTERNAL_TOKEN = process.env.NEXUS_INTERNAL_TOKEN || 'nexus-internal-dev-token';

export function createService({ name, port, setup, publicPaths = [] }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  const startedAt = Date.now();
  let requestCount = 0;
  const debugProviders = [];

  // 鉴权中间件：优先校验 Authorization Bearer；网关注入的 x-user-* 头仅在带内部令牌时可信
  app.use((req, res, next) => {
    requestCount++;
    req.serviceName = name;
    const p = req.path;
    const isPublic = publicPaths.some((pp) => (pp.endsWith('*') ? p.startsWith(pp.slice(0, -1)) : p === pp));
    try {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        req.user = verifyToken(auth.slice(7));
      } else if (req.headers['x-internal-token'] === INTERNAL_TOKEN && req.headers['x-user-id']) {
        req.user = { sub: req.headers['x-user-id'], username: req.headers['x-user-name'], internal: true };
      }
    } catch {
      return res.status(401).json({ error: 'token_invalid', message: '凭证校验失败' });
    }
    if (!isPublic && !req.user && !p.startsWith('/health') && !p.startsWith('/debug') && !p.startsWith('/internal')) {
      return res.status(401).json({ error: 'unauthorized', message: '缺少访问令牌' });
    }
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: name, uptime: Math.round((Date.now() - startedAt) / 1000), requests: requestCount });
  });

  app.get('/debug/state', (req, res) => {
    const extra = {};
    for (const fn of debugProviders) Object.assign(extra, fn() || {});
    res.json({ service: name, uptime: Math.round((Date.now() - startedAt) / 1000), requests: requestCount, ...extra });
  });

  // 内部事件接收端点（跨服务事件总线的投递目标）
  const eventHandlers = new Map();
  app.post('/internal/events', (req, res) => {
    if (req.headers['x-internal-token'] !== INTERNAL_TOKEN) return res.status(403).json({ error: 'forbidden' });
    const { type, payload, source } = req.body || {};
    const handlers = [...(eventHandlers.get(type) || []), ...(eventHandlers.get('*') || [])];
    Promise.allSettled(handlers.map((h) => h(payload, { type, source }))).then(() => res.json({ delivered: handlers.length }));
  });

  const ctx = {
    name,
    port,
    app,
    onEvent(type, handler) {
      if (!eventHandlers.has(type)) eventHandlers.set(type, []);
      eventHandlers.get(type).push(handler);
    },
    addDebug(fn) {
      debugProviders.push(fn);
    },
    internalToken: INTERNAL_TOKEN,
  };

  const server = http.createServer(app);
  ctx.server = server;

  setup(app, ctx);

  // 统一错误格式：{ error, message, details? }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(`[${name}]`, err);
    res.status(status).json({ error: err.name || 'error', message: err.message || '服务器内部错误', details: err.details });
  });

  server.listen(port, () => console.log(`[${name}] listening on :${port}`));
  return { app, server, ctx };
}

export function requirePerm(...perms) {
  return (req, res, next) => {
    const owned = new Set(req.user?.perms || []);
    if (owned.has('*') || perms.every((p) => owned.has(p))) return next();
    return next(forbidden(`需要权限: ${perms.join(', ')}`));
  };
}

// 数据范围（ABAC 之数据范围层）：self / dept / dept_and_sub / all
export function scopeFilter(user, { ownerColumn = 'owner_id', deptColumn = 'dept_id' } = {}) {
  const scope = user?.scope || 'self';
  if (scope === 'all' || (user?.perms || []).includes('*')) return { sql: '1=1', params: [] };
  if (scope === 'dept' || scope === 'dept_and_sub') {
    return { sql: `(${deptColumn} = ? OR ${ownerColumn} = ?)`, params: [user.dept, user.sub] };
  }
  return { sql: `${ownerColumn} = ?`, params: [user.sub] };
}

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function pageParams(req, maxSize = 100) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(maxSize, Math.max(1, parseInt(req.query.size) || 20));
  return { page, size, offset: (page - 1) * size };
}

export function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') throw badRequest(`缺少必填字段: ${f}`);
  }
}
