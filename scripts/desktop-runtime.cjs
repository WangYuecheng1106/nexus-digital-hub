/**
 * Nexus Desktop Runtime — 在 Windows APP 内拉起微服务 + 静态前端 + API 反代
 * 由 Electron 主进程以 ELECTRON_RUN_AS_NODE=1 拉起。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.NEXUS_ROOT || path.resolve(__dirname, '..');
const UI_DIST = process.env.NEXUS_UI_DIST || path.join(ROOT, 'client', 'dist');
const PORT = Number(process.env.NEXUS_DESKTOP_PORT || 39217);
const GATEWAY = process.env.NEXUS_GATEWAY || 'http://127.0.0.1:8080';
const children = [];

function log(...args) {
  console.log('[desktop-runtime]', ...args);
}

function launchService(name, entry) {
  const bundledNode = path.join(ROOT, 'node.exe');
  const nodeBin = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
  const env = {
    ...process.env,
    FORCE_COLOR: '0',
  };
  if (nodeBin === process.execPath && /electron/i.test(nodeBin)) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  const child = spawn(nodeBin, [entry], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    if (!shuttingDown) log(`${name} exited`, code);
  });
  children.push(child);
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(c.pid), '/f', '/t'], { windowsHide: true, stdio: 'ignore' });
      } else {
        c.kill('SIGTERM');
      }
    } catch { /* */ }
  }
  setTimeout(() => process.exit(0), 400);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('disconnect', shutdown);

function startServices() {
  const servicesDir = path.join(ROOT, 'services');
  if (!fs.existsSync(servicesDir)) {
    log('services dir missing:', servicesDir);
    return;
  }
  const names = fs.readdirSync(servicesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(servicesDir, d.name, 'src', 'index.js')))
    .map((d) => d.name);
  const ordered = ['auth', 'gateway', ...names.filter((n) => n !== 'auth' && n !== 'gateway').sort()];
  for (const name of ordered) {
    launchService(name, path.join(servicesDir, name, 'src', 'index.js'));
  }
  log('started services:', ordered.join(', '));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.exe': 'application/octet-stream',
  })[ext] || 'application/octet-stream';
}

function proxy(req, res, targetBase) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const target = new URL(u.pathname + u.search, targetBase);
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'gateway_unavailable', message: '后端服务启动中，请稍后重试' }));
  });
  req.pipe(upstream);
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      return proxy(req, res, GATEWAY);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const filePath = path.normalize(path.join(UI_DIST, rel));
    if (!filePath.startsWith(path.normalize(UI_DIST))) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback
        const index = path.join(UI_DIST, 'index.html');
        return fs.readFile(index, (e2, html) => {
          if (e2) {
            res.writeHead(404);
            return res.end('UI not found. Rebuild client dist.');
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
        });
      }
      res.writeHead(200, { 'content-type': contentType(filePath) });
      res.end(data);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    // WS → gateway
    const target = new URL(req.url || '/', GATEWAY.replace(/^http/, 'ws'));
    const net = require('net');
    const gw = new URL(GATEWAY);
    const proxySock = net.connect(Number(gw.port || 80), gw.hostname, () => {
      const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      const hdrs = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      proxySock.write(`${reqLine}${hdrs}\r\n\r\n`);
      if (head?.length) proxySock.write(head);
      proxySock.pipe(socket);
      socket.pipe(proxySock);
    });
    proxySock.on('error', () => socket.destroy());
    socket.on('error', () => proxySock.destroy());
  });

  server.listen(PORT, '127.0.0.1', () => {
    log(`UI+proxy http://127.0.0.1:${PORT} → ${GATEWAY}`);
    // 通知父进程（Electron）已就绪
    if (process.send) process.send({ type: 'ready', port: PORT });
  });
}

log('ROOT=', ROOT);
log('UI_DIST=', UI_DIST);
startServices();
startStaticServer();
