// API 客户端：封装 fetch，自动注入 JWT、处理错误、刷新令牌
const BASE = '/api';
let token = localStorage.getItem('nexus_token');
let refreshToken = localStorage.getItem('nexus_refresh');

export function setTokens(access, refresh) {
  token = access;
  refreshToken = refresh;
  localStorage.setItem('nexus_token', access);
  if (refresh) localStorage.setItem('nexus_refresh', refresh);
}

export function clearTokens() {
  token = null;
  refreshToken = null;
  localStorage.removeItem('nexus_token');
  localStorage.removeItem('nexus_refresh');
}

export function getToken() { return token; }

async function refreshIfNeeded() {
  if (!refreshToken) return false;
  try {
    const r = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch { return false; }
}

export async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...opts.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  let r;
  try {
    r = await fetch(`${BASE}${path}`, { ...opts, headers });
  } catch {
    throw { status: 0, error: 'network_error', message: '无法连接后端服务，请先在本机启动：npm run dev' };
  }
  // 令牌过期时尝试刷新
  if (r.status === 401 && refreshToken && !opts._retried) {
    const ok = await refreshIfNeeded();
    if (ok) {
      headers.authorization = `Bearer ${token}`;
      r = await fetch(`${BASE}${path}`, { ...opts, headers, _retried: true });
    }
  }
  if (r.status === 401 && path !== '/auth/login') {
    clearTokens();
    window.location.hash = '#/login';
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) {
    if (r.status === 404 || r.status === 502 || r.status === 503) {
      throw { status: r.status, error: 'backend_unavailable', message: '后端服务未就绪，请在本机运行 npm run dev 后再登录' };
    }
    throw { status: r.status, ...data, message: data.message || (r.status === 401 ? '用户名或密码错误' : `请求失败 (${r.status})`) };
  }
  return data;
}

// WebSocket 连接工厂
export function wsConnect(path, onMessage) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}${path}?token=${token || ''}`;
  const ws = new WebSocket(wsUrl);
  let pingInterval;
  ws.onopen = () => {
    pingInterval = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'im:ping' }));
    }, 25000);
  };
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  ws.onclose = () => clearInterval(pingInterval);
  return ws;
}
