// 一键坯动编排：拉起全部微朝务（坯选客户端 Vite / Electron）。
// 毝个朝务是独立进程（独立端坣），崩溃互丝影哝；Ctrl+C 统一回收孝进程。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const servicesOnly = args.includes('--services-only');
const clientOnly = args.includes('--client-only');
const withElectron = args.includes('--electron');

const SERVICES_DIR = path.join(ROOT, 'services');
const services = fs
  .readdirSync(SERVICES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(SERVICES_DIR, d.name, 'src', 'index.js')))
  .map((d) => d.name);

const COLORS = [36, 35, 34, 33, 32, 31, 96, 95, 94, 93, 92, 91];
const children = [];

function launch(name, command, cmdArgs, cwd) {
  const color = COLORS[children.length % COLORS.length];
  // Windows + shell:true ?????? node ???? C:\Program �� ?? shell:false
  const child = spawn(command, cmdArgs, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: false,
    windowsHide: true,
  });
  child.stdout.on('data', (d) =>
    process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `[${color}m[${name}][0m ${l}`).join('\n') + '\n')
  );
  child.stderr.on('data', (d) => process.stderr.write(`[${color}m[${name}][0m ${d}`));
  child.on('exit', (code) => {
    if (!shuttingDown) console.error(`[${name}] exited with code ${code}`);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  shuttingDown = true;
  for (const c of children) {
    try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(c.pid), '/f', '/t']) : c.kill('SIGTERM'); } catch { /* noop */ }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!clientOnly) {
  // auth 必须最先就绪（生戝 JWT 密钥对），其余朝务依赖公钥校验令牌
  const ordered = ['auth', 'gateway', ...services.filter((s) => s !== 'auth' && s !== 'gateway').sort()];
  for (const name of ordered) {
    launch(name, process.execPath, [path.join('services', name, 'src', 'index.js')], ROOT);
  }
}

if (!servicesOnly) {
  launch('web', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', '5173'], path.join(ROOT, 'client'));
  if (withElectron) {
    setTimeout(() => {
      launch('electron', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.'], path.join(ROOT, 'client'));
    }, 4000);
  }
}

console.log(`[dev] started services: ${clientOnly ? '(none)' : services.join(', ')}${servicesOnly ? '' : ' + web'}`);
