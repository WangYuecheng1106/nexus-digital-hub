const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let runtimeChild = null;
const DESKTOP_PORT = Number(process.env.NEXUS_DESKTOP_PORT || 39217);

function runtimePaths() {
  const isDev = !app.isPackaged;
  if (isDev) {
    const root = path.resolve(__dirname, '..');
    return {
      root,
      runtimeScript: path.join(root, 'scripts', 'desktop-runtime.cjs'),
      uiDist: path.join(__dirname, 'dist'),
    };
  }
  return {
    root: path.join(process.resourcesPath, 'runtime'),
    runtimeScript: path.join(process.resourcesPath, 'runtime', 'desktop-runtime.cjs'),
    uiDist: path.join(process.resourcesPath, 'ui'),
  };
}

function startRuntime() {
  const { root, runtimeScript, uiDist } = runtimePaths();
  if (!fs.existsSync(runtimeScript)) {
    console.error('[electron] desktop-runtime missing:', runtimeScript);
    return null;
  }
  const bundledNode = path.join(root, 'node.exe');
  const nodeBin = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
  const env = {
    ...process.env,
    NEXUS_ROOT: root,
    NEXUS_UI_DIST: uiDist,
    NEXUS_DESKTOP_PORT: String(DESKTOP_PORT),
    NEXUS_GATEWAY: 'http://127.0.0.1:8080',
  };
  if (nodeBin === process.execPath) env.ELECTRON_RUN_AS_NODE = '1';

  const child = spawn(nodeBin, [runtimeScript], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  child.stdout?.on('data', (d) => process.stdout.write(d));
  child.stderr?.on('data', (d) => process.stderr.write(d));
  child.on('exit', (code) => {
    console.error('[electron] desktop-runtime exited', code);
  });
  runtimeChild = child;
  return child;
}

function stopRuntime() {
  if (!runtimeChild || runtimeChild.killed) return;
  try {
    if (process.platform === 'win32' && runtimeChild.pid) {
      spawn('taskkill', ['/pid', String(runtimeChild.pid), '/f', '/t'], { windowsHide: true, stdio: 'ignore' });
    } else {
      runtimeChild.kill('SIGTERM');
    }
  } catch { /* */ }
  runtimeChild = null;
}

function waitForUi(timeoutMs = 45000) {
  const http = require('http');
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${DESKTOP_PORT}/`, (res) => {
        res.resume();
        resolve(DESKTOP_PORT);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('desktop UI timeout'));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

async function createWindow() {
  const isDev = !app.isPackaged;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f1ea',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    title: 'Nexus 数字中枢',
  });

  if (isDev) {
    // 开发：沿用 Vite；后端由 npm run dev 拉起
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    startRuntime();
    try {
      await waitForUi();
      await mainWindow.loadURL(`http://127.0.0.1:${DESKTOP_PORT}/#/home`);
    } catch (err) {
      const msg = String(err?.message || err);
      await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
        `<h2>Nexus 启动失败</h2><p>${msg}</p><p>请重新安装或检查端口 ${DESKTOP_PORT} / 8080 是否被占用。</p>`
      )}`);
    }
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopRuntime();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => stopRuntime());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  return sources.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id }));
});
