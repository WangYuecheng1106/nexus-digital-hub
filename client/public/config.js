/* 生产配置：同域（轻量云 / 自有域名反代）时留空；EdgeOne 预览域名则回源到服务器 */
(function () {
  var host = location.hostname || '';
  // 本地开发：走 Vite 代理到本机网关（localhost:8080）
  var onLocal = host === 'localhost' || host === '127.0.0.1';
  var onOwn =
    host === '82.156.154.115' ||
    host === 'nexus.ycwang.com' ||
    host.endsWith('.ycwang.com');
  if (onLocal || onOwn) {
    // 本地开发：apiOrigin 留空走 Vite 代理；wsHost/wsProto 不设，回退 location.host（含端口）
    window.__NEXUS_CONFIG__ = { apiOrigin: '' };
    return;
  }
  // EdgeOne 临时预览域名：API/WS 走轻量云（建议生产用域名 A 记录直连服务器）
  window.__NEXUS_CONFIG__ = {
    apiOrigin: 'http://82.156.154.115',
    wsHost: '82.156.154.115',
    wsProto: 'ws:',
  };
})();
