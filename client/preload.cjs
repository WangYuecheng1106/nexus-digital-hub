const { contextBridge, ipcRenderer } = require('electron');

// 安全暴露 Electron API 给渲染进程
contextBridge.exposeInMainWorld('nexusElectron', {
  getScreenSources: () => ipcRenderer.invoke('get-sources'),
  platform: process.platform,
  isElectron: true,
});
