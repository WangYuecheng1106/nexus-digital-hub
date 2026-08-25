// Nexus 关系图谱 · 精简网关
// 只路由两个服务：knowledge(图谱数据) + dingtalk(免登/通讯录同步)
import http from 'node:http';
import { createService } from '@nexus/shared';

const SERVICE_PORTS = {
  knowledge: 8087,
  dingtalk: 8099,
};

// 内置反向代理：把 /api/<service>/* 转发到对应微服务
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
    const upstream = http.request({
      hostname: '127.0.0.1',
      port,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${port}` },
    }, onUp);
    upstream.on('error', fail);

    if (isMultipart) {
      req.pipe(upstream);
      return;
    }
    const canHaveBody = !['GET', 'HEAD'].includes(req.method);
    const hasBody = canHaveBody && req.body !== undefined && req.body !== null
      && !(typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length === 0);
    const body = hasBody ? (Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body)) : null;
    if (body !== null) {
      upstream.setHeader('content-type', upstream.getHeader('content-type') || 'application/json');
      upstream.setHeader('content-length', Buffer.byteLength(body));
      upstream.write(body);
    }
    upstream.end();
  };
}

const { app } = createService({
  name: 'gateway',
  port: 8080,
  publicPaths: ['/api/*', '/health', '/'],
  setup(app) {
    // CORS：钉钉端内 H5 微应用需要放行
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

    for (const [name, port] of Object.entries(SERVICE_PORTS)) {
      const prefix = `/api/${name}`;
      const handler = proxyTo(port, prefix);
      app.all(`/api/${name}/*`, handler);
      app.all(`/api/${name}`, handler);
    }

    app.get('/', (req, res) => res.json({ name: 'nexus-gateway', services: Object.keys(SERVICE_PORTS) }));
  },
});