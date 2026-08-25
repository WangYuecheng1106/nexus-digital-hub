/* 生产配置：同域（自有域名反代）时留空；本地开发走 Vite 代理到本机网关 */
(function () {
  var host = location.hostname || '';
  var onLocal = host === 'localhost' || host === '127.0.0.1';
  var onOwn =
    host === '82.156.154.115' ||
    host === 'nexus.ycwang.com' ||
    host.endsWith('.ycwang.com');
  if (onLocal || onOwn) {
    window.__NEXUS_CONFIG__ = { apiOrigin: '' };
    return;
  }
  // 其它域名（如钉钉配置的 H5 首页地址）：默认同域，可在下方按需覆盖
  window.__NEXUS_CONFIG__ = { apiOrigin: '' };
})();

// 钉钉端内环境标记（H5 微应用配置了首页地址后，端内会用 dd.requestAuthCode 免登）
// 如部署在与 API 不同域名，可在此覆盖 __NEXUS_CONFIG__.apiOrigin
window.__NEXUS_DINGTALK__ = { enabled: true };