// Dev orchestrator: start all microservices (+ optional Vite / Electron).
// Each service is an independent process; Ctrl+C kills children.
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

function resolveBin(candidates) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function launch(name, command, cmdArgs, cwd) {
  const color = COLORS[children.length % COLORS.length];
  // Windows Node 24: shell:false + .cmd/.bat => EINVAL.
  // Always run JS entrypoints via process.execPath.
  const child = spawn(command, cmdArgs, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: false,
    windowsHide: true,
  });
  child.on('error', (err) => {
    console.error(`[${name}] spawn failed: ${err.message}`);
  });
  child.stdout?.on('data', (d) =>
    process.stdout.write(
      d
        .toString()
        .split('\n')
        .filter(Boolean)
        .map((l) => `\x1b[${color}m[${name}]\x1b[0m ${l}`)
        .join('\n') + '\n'
    )
  );
  child.stderr?.on('data', (d) => process.stderr.write(`\x1b[${color}m[${name}]\x1b[0m ${d}`));
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
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(c.pid), '/f', '/t'], { shell: false, windowsHide: true });
      } else {
        c.kill('SIGTERM');
      }
    } catch {
      /* noop */
    }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!clientOnly) {
  // gateway first, then the rest (alphabetical)
  const ordered = ['gateway', ...services.filter((s) => s !== 'gateway').sort()];
  for (const name of ordered) {
    launch(name, process.execPath, [path.join('services', name, 'src', 'index.js')], ROOT);
  }
}

if (!servicesOnly) {
  const viteJs = resolveBin([
    path.join(ROOT, 'client', 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  ]);
  if (!viteJs) {
    console.error('[dev] vite not found. Run: npm install');
    process.exit(1);
  }
  launch('web', process.execPath, [viteJs, '--port', '5173'], path.join(ROOT, 'client'));

  if (withElectron) {
    const electronCli = resolveBin([
      path.join(ROOT, 'client', 'node_modules', 'electron', 'cli.js'),
      path.join(ROOT, 'node_modules', 'electron', 'cli.js'),
    ]);
    setTimeout(() => {
      if (!electronCli) {
        console.error('[electron] not installed. Run: npm install electron');
        return;
      }
      launch('electron', process.execPath, [electronCli, '.'], path.join(ROOT, 'client'));
    }, 4000);
  }
}

console.log(`[dev] started services: ${clientOnly ? '(none)' : services.join(', ')}${servicesOnly ? '' : ' + web'}`);
