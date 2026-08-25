/**
 * 打包 Windows 桌面端：Vite 构建 → 准备 runtime → electron-builder → 拷贝到官网下载目录
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT = path.join(ROOT, 'client');
const DOWNLOADS = path.join(CLIENT, 'public', 'downloads');
const RELEASE = path.join(ROOT, 'build', 'desktop-release');
const STAGE = path.join(ROOT, 'build', 'desktop-runtime');

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} => ${code}`))));
    child.on('error', reject);
  });
}

function runNpm(args, cwd) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolve, reject) => {
    const child = spawn(npmCmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} => ${code}`))));
    child.on('error', reject);
  });
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest, { filter } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(ent, path.join(src, ent.name))) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to, { filter });
    else fs.copyFileSync(from, to);
  }
}

function shouldCopyRuntime(ent, full) {
  const name = ent.name;
  if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'release' || name === 'build') return false;
  if (name === 'data' && full.replace(/\\/g, '/').endsWith('/data')) return true;
  if (name.endsWith('.db-shm') || name.endsWith('.db-wal')) return false;
  if (name === 'drive-storage') return false;
  return true;
}

async function main() {
  console.log('[pack-windows] build client…');
  const viteJs = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  await run(process.execPath, [viteJs, 'build'], CLIENT);

  console.log('[pack-windows] stage runtime…');
  rimraf(STAGE);
  fs.mkdirSync(STAGE, { recursive: true });

  // 精简 runtime：服务源码 + shared + 根依赖 + desktop-runtime
  copyDir(path.join(ROOT, 'services'), path.join(STAGE, 'services'), {
    filter: (ent) => ent.name !== 'node_modules' && ent.name !== 'data',
  });
  copyDir(path.join(ROOT, 'shared'), path.join(STAGE, 'shared'), {
    filter: (ent) => ent.name !== 'node_modules',
  });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'desktop-runtime.cjs'), path.join(STAGE, 'desktop-runtime.cjs'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(STAGE, 'package.json'));
  if (fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
    fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(STAGE, 'package-lock.json'));
  }

  // data：拷贝空库结构（若有）供首次启动
  const dataSrc = path.join(ROOT, 'data');
  const dataDest = path.join(STAGE, 'data');
  fs.mkdirSync(dataDest, { recursive: true });
  if (fs.existsSync(dataSrc)) {
    for (const f of fs.readdirSync(dataSrc)) {
      if (f.endsWith('.db')) {
        fs.copyFileSync(path.join(dataSrc, f), path.join(dataDest, f));
      }
    }
  }

  // 自带 Node 运行时（避免 ELECTRON_RUN_AS_NODE 与原生模块 ABI 不兼容）
  const nodeSrc = process.execPath;
  const nodeDest = path.join(STAGE, 'node.exe');
  console.log('[pack-windows] copy node runtime from', nodeSrc);
  fs.copyFileSync(nodeSrc, nodeDest);

  // 复用仓库已安装的 node_modules（比在 stage 里重装快且兼容 workspaces）
  console.log('[pack-windows] copy node_modules…');
  const nm = path.join(ROOT, 'node_modules');
  const stageNm = path.join(STAGE, 'node_modules');
  if (fs.existsSync(stageNm)) rimraf(stageNm);
  await run('powershell.exe', [
    '-NoProfile', '-Command',
    `Copy-Item -Path '${nm.replace(/'/g, "''")}' -Destination '${stageNm.replace(/'/g, "''")}' -Recurse -Force`,
  ], ROOT);

  // workspaces 包也放到 stage 可解析位置
  // shared / services 已在上面；确保 @nexus/shared 指向 stage/shared
  const nexusShared = path.join(STAGE, 'node_modules', '@nexus');
  fs.mkdirSync(nexusShared, { recursive: true });
  const sharedLink = path.join(nexusShared, 'shared');
  rimraf(sharedLink);
  // 用真实拷贝替代 junction，保证安装包可移植
  copyDir(path.join(STAGE, 'shared'), sharedLink);

  console.log('[pack-windows] electron-builder…');
  rimraf(RELEASE);
  await runNpm(['exec', '--', 'electron-builder', '--win', 'portable', 'nsis'], CLIENT);

  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const artifacts = fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE) : [];
  const prefer = artifacts.find((f) => /Setup.*\.exe$/i.test(f))
    || artifacts.find((f) => /\.exe$/i.test(f) && !/blockmap/i.test(f));
  if (!prefer) {
    throw new Error(`No exe in ${RELEASE}: ${artifacts.join(', ') || '(empty)'}`);
  }
  const destName = 'Nexus-Setup.exe';
  fs.copyFileSync(path.join(RELEASE, prefer), path.join(DOWNLOADS, destName));
  // 便携版额外保留（若有）
  const portable = artifacts.find((f) => /portable/i.test(f) && /\.exe$/i.test(f));
  if (portable && portable !== prefer) {
    fs.copyFileSync(path.join(RELEASE, portable), path.join(DOWNLOADS, 'Nexus-Portable.exe'));
  }

  // 写入版本说明
  fs.writeFileSync(
    path.join(DOWNLOADS, 'README.txt'),
    [
      'Nexus Windows 桌面端',
      '==================',
      `文件: ${destName}`,
      '双击安装/运行后即可使用官网、登录与全部模块。',
      '演示账号: admin / Admin@1234',
      '',
      '重新打包: npm run pack:win',
      '',
    ].join('\n'),
    'utf8'
  );

  console.log('[pack-windows] done →', path.join(DOWNLOADS, destName));
}

main().catch((err) => {
  console.error('[pack-windows] failed:', err);
  process.exit(1);
});
