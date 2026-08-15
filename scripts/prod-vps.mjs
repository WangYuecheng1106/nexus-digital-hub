/**
 * VPS 生产启动：只起微服务（含网关 0.0.0.0:8080），不启 Vite。
 * 用法（在服务器项目根目录）：
 *   node scripts/prod-vps.mjs
 * 环境变量：
 *   GATEWAY_HOST=0.0.0.0   （默认）
 *   CORS_ORIGIN=https://nexus.ycwang.com
 *   NEXUS_INTERNAL_TOKEN=请改成随机长串
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVICES_DIR = path.join(ROOT, 'services');

process.env.GATEWAY_HOST = process.env.GATEWAY_HOST || '127.0.0.1';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://nexus.ycwang.com,http://nexus.ycwang.com,http://82.156.154.115';
if (!process.env.NEXUS_INTERNAL_TOKEN || process.env.NEXUS_INTERNAL_TOKEN === 'nexus-internal-dev-token') {
  console.warn('[prod-vps] 警告: 请设置环境变量 NEXUS_INTERNAL_TOKEN 为随机密钥');
}

const services = fs
  .readdirSync(SERVICES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(SERVICES_DIR, d.name, 'src', 'index.js')))
  .map((d) => d.name);

const ordered = ['auth', 'gateway', ...services.filter((s) => s !== 'auth' && s !== 'gateway').sort()];
const children = [];

function launch(name) {
  const entry = path.join(ROOT, 'services', name, 'src', 'index.js');
  const child = spawn(process.execPath, [entry], {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    if (!shuttingDown) console.error(`[${name}] exited ${code}`);
  });
  children.push(child);
}

let shuttingDown = false;
function shutdown() {
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* */ }
  }
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const name of ordered) launch(name);
console.log(`[prod-vps] started: ${ordered.join(', ')}`);
console.log('[prod-vps] gateway http://0.0.0.0:8080  CORS=', process.env.CORS_ORIGIN);
