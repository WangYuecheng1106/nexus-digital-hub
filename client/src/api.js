// API 客户端：封装 fetch，自动注入 JWT、处理错误、刷新令牌
// 生产同域反代时 apiOrigin 留空；若 API 在独立子域，在 public/config.js 填写
const CFG = (typeof window !== 'undefined' && window.__NEXUS_CONFIG__) || {};
const API_ORIGIN = String(CFG.apiOrigin || '').replace(/\/$/, '');
const BASE = `${API_ORIGIN}/api`;
let token = localStorage.getItem('nexus_token');
let refreshToken = localStorage.getItem('nexus_refresh');
let wsReconnectDelay = 1000;
const MAX_WS_RECONNECT_DELAY = 30000;
const requestQueue = [];
let isOnline = navigator.onLine;

// 网络状态监听
window.addEventListener('online', () => {
  isOnline = true;
  wsReconnectDelay = 1000;
  flushQueue();
});
window.addEventListener('offline', () => { isOnline = false; });

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

// 请求队列（离线时缓存写操作）
function enqueueRequest(path, opts) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ path, opts, resolve, reject });
  });
}

async function flushQueue() {
  while (requestQueue.length > 0 && isOnline) {
    const { path, opts, resolve, reject } = requestQueue.shift();
    try {
      const result = await api(path, opts);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }
}

export async function api(path, opts = {}) {
  // 离线时排队写请求，直接拒绝读请求
  if (!isOnline && opts.method && opts.method !== 'GET') {
    return enqueueRequest(path, opts);
  }
  if (!isOnline) {
    throw { status: 0, error: 'offline', message: '当前离线，操作将在网络恢复后同步' };
  }

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
    window.dispatchEvent(new Event('nexus:logout'));
    window.location.hash = '#/login';
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) {
    if (r.status === 404 || r.status === 502 || r.status === 503) {
      throw { status: r.status, error: 'backend_unavailable', message: '后端服务未就绪，请在本机运行 npm run dev 后再登录' };
    }
    throw { status: r.status, ...data, message: data.message || data.error || (r.status === 401 ? '用户名或密码错误' : `请求失败 (${r.status})`) };
  }
  return data;
}

// WebSocket 连接工厂（自动重连 + 心跳）
export function wsConnect(path, onMessage, opts = {}) {
  const proto = CFG.wsProto || (location.protocol === 'https:' ? 'wss:' : 'ws:');
  const host = CFG.wsHost || location.host;
  const wsUrl = `${proto}//${host}${path}?token=${token || ''}`;
  let ws;
  let pingInterval;
  let reconnectTimer;
  let manualClose = false;
  let retries = 0;

  const connect = () => {
    if (manualClose) return;
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      retries = 0;
      wsReconnectDelay = 1000;
      pingInterval = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'im:ping' }));
      }, 25000);
      opts.onOpen?.();
    };
    
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    
    ws.onclose = () => {
      clearInterval(pingInterval);
      opts.onClose?.();
      if (!manualClose && isOnline) {
        retries++;
        const delay = Math.min(wsReconnectDelay * Math.pow(2, retries - 1), MAX_WS_RECONNECT_DELAY);
        reconnectTimer = setTimeout(connect, delay);
      }
    };
    
    ws.onerror = (err) => {
      opts.onError?.(err);
    };
  };

  connect();

  return {
    get readyState() { return ws?.readyState || 0; },
    send(data) {
      if (ws?.readyState === 1) ws.send(data);
      else console.warn('WebSocket not ready, message dropped:', data);
    },
    close() {
      manualClose = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingInterval);
      ws?.close();
    },
  };
}
