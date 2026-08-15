// API 网关：路由分发、登录限流、鉴权前置、服务健康聚合、跨服务事件总线、WebSocket 代理。
// 所有外部流量经 8080 进入，内部服务只监听 localhost。
// 使用 Node 内置 http 模块做反向代理，避免 http-proxy-middleware 的 body 消费问题。
import http from 'node:http';
import { createService, openDb, migrate, verifyToken } from '@nexus/shared';

const SERVICE_PORTS = {
  auth: 8081, im: 8083, meeting: 8084, document: 8085, workflow: 8086,
  knowledge: 8087, calendar: 8088, drive: 8089, project: 8090, attendance: 8091,
  contacts: 8092, forum: 8093, notification: 8094, integration: 8095, ai: 8096,
  analytics: 8097, portal: 8098,
};

const INTERNAL_TOKEN = process.env.NEXUS_INTERNAL_TOKEN || 'nexus-internal-dev-token';
const db = openDb('gateway');
migrate(db, [
  ['subscribers', `CREATE TABLE subscribers (
     service TEXT, url TEXT, types TEXT, registered_at INTEGER, PRIMARY KEY (service, url))`],
]);

// 登录接口限流：每 IP 每分钟 20 次
const buckets = new Map();
function rateLimit(perMinute) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > 60000) { b = { start: now, count: 0 }; buckets.set(key, b); }
    if (++b.count > perMinute) {
      return res.status(429).json({ error: 'rate_limited', message: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

// ---- 内置反向代理 ----
// express.json() 会消费 JSON 请求体；multipart 必须原样 pipe，否则 multer 报 Unexpected end of form
function proxyTo(port, prefix) {
  return (req, res) => {
    const targetPath = req.url.replace(prefix, '') || '/';
    const ct = String(req.headers['content-type'] || '');
    const isMultipart = ct.includes('multipart/form-data');
    const onUp = (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    };
    const fail = () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'service_unavailable', message: '目标服务暂不可用' }));
    };

    if (isMultipart) {
      const headers = { ...req.headers, host: `localhost:${port}` };
      const upstream = http.request({
        hostname: '127.0.0.1',
        port,
        path: targetPath,
        method: req.method,
        headers,
      }, onUp);
      upstream.on('error', fail);
      req.pipe(upstream);
      return;
    }

    const canHaveBody = !['GET', 'HEAD'].includes(req.method);
    const hasBody = canHaveBody && req.body !== undefined && req.body !== null
      && !(typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length === 0);
    const body = hasBody ? (Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body)) : null;
    const headers = { ...req.headers, host: `localhost:${port}` };
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    if (body !== null) {
      headers['content-type'] = headers['content-type'] || 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    const upstream = http.request({
      hostname: '127.0.0.1',
      port,
      path: targetPath,
      method: req.method,
      headers,
    }, onUp);
    upstream.on('error', fail);
    if (body !== null) upstream.write(body);
    upstream.end();
  };
}

const { app, server, ctx } = createService({
  name: 'gateway',
  port: 8080,
  publicPaths: ['/api/auth/*', '/internal/*', '/debug/*', '/health', '/api/services/*', '/'],
  setup(app, ctx) {
    // 允许 EdgeOne 前端域名跨域访问（同域反代时不需要，双域名时需要）
    const allowOrigin = process.env.CORS_ORIGIN || '*';
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (allowOrigin === '*') res.setHeader('Access-Control-Allow-Origin', origin || '*');
      else if (origin && allowOrigin.split(',').map((s) => s.trim()).includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).end();
      next();
    });

    // ---- 跨服务事件总线 ----
    app.post('/internal/subscribe', (req, res) => {
      if (req.headers['x-internal-token'] !== INTERNAL_TOKEN) return res.status(403).json({ error: 'forbidden' });
      const { service, url, types } = req.body || {};
      db.run('INSERT OR REPLACE INTO subscribers (service, url, types, registered_at) VALUES (?,?,?,?)',
        service, url, JSON.stringify(types || ['*']), Date.now());
      res.json({ ok: true });
    });

    app.post('/internal/events', async (req, res) => {
      if (req.headers['x-internal-token'] !== INTERNAL_TOKEN) return res.status(403).json({ error: 'forbidden' });
      const { type, payload, source } = req.body || {};
      const subs = db.all('SELECT * FROM subscribers').filter((s) => {
        const types = JSON.parse(s.types);
        return (types.includes('*') || types.includes(type)) && s.service !== source;
      });
      const results = await Promise.allSettled(
        subs.map((s) =>
          fetch(s.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
            body: JSON.stringify({ type, payload, source }),
          }).then((r) => r.ok)
        )
      );
      res.json({ delivered: results.filter((r) => r.status === 'fulfilled' && r.value).length, total: subs.length });
    });

    // ---- 服务健康聚合 ----
    app.get('/api/services/health', async (req, res) => {
      const checks = await Promise.allSettled(
        Object.entries(SERVICE_PORTS).map(async ([name, port]) => {
          const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1500) });
          return { name, port, ...(await r.json()) };
        })
      );
      res.json(checks.map((c, i) => (c.status === 'fulfilled' ? c.value : { name: Object.keys(SERVICE_PORTS)[i], status: 'down' })));
    });

    // ---- 动态路由：/api/<service>/* → 对应微服务 ----
    for (const [name, port] of Object.entries(SERVICE_PORTS)) {
      const prefix = `/api/${name}`;
      const handler = proxyTo(port, prefix);
      if (name === 'auth') app.use(`/api/${name}`, rateLimit(20));
      app.all(`/api/${name}/*`, handler);
      app.all(`/api/${name}`, handler);
    }

    app.get('/', (req, res) => res.json({ name: 'nexus-gateway', services: Object.keys(SERVICE_PORTS).length }));
  },
});

// ---- WebSocket 代理 ----
const WS_PORTS = { '/ws/im': 8083, '/ws/document': 8085, '/ws/meeting': 8084, '/ws/notification': 8094 };
import net from 'node:net';
server.on('upgrade', (req, socket, head) => {
  const route = Object.keys(WS_PORTS).find((p) => req.url.startsWith(p));
  if (!route) return socket.destroy();
  const port = WS_PORTS[route];
  const upstream = net.connect(port, '127.0.0.1', () => {
    const targetPath = req.url.replace(route, '/ws');
    const lines = [
      `${req.method} ${targetPath} HTTP/1.1`,
      ...Object.entries(req.headers).filter(([k]) => k !== 'host').map(([k, v]) => `${k}: ${v}`),
      `host: localhost:${port}`,
      '',
      '',
    ];
    upstream.write(lines.join('\r\n'));
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

ctx.addDebug(() => ({
  subscribers: db.all('SELECT service, url, types FROM subscribers'),
  routes: SERVICE_PORTS,
}));
