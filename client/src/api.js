// API 客户端（精简单页版）：只负责 fetch + JWT，供图谱/钉钉免登使用。
const CFG = (typeof window !== 'undefined' && window.__NEXUS_CONFIG__) || {};
const API_ORIGIN = String(CFG.apiOrigin || '').replace(/\/$/, '');
const BASE = `${API_ORIGIN}/api`;
let token = localStorage.getItem('nexus_token');

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('nexus_token', t);
  else localStorage.removeItem('nexus_token');
}

export function getToken() { return token; }

export function clearToken() {
  token = null;
  localStorage.removeItem('nexus_token');
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
  if (r.status === 401 && path !== '/auth/login' && path !== '/dingtalk/auth/code') {
    clearToken();
    window.dispatchEvent(new Event('nexus:logout'));
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) {
    if (r.status === 404 || r.status === 502 || r.status === 503) {
      throw { status: r.status, error: 'backend_unavailable', message: '后端服务未就绪' };
    }
    throw { status: r.status, ...data, message: data.message || data.error || (r.status === 401 ? '未认证' : `请求失败 (${r.status})`) };
  }
  return data;
}

// 钉钉免登：存在 dd JSAPI 且在企业端内时调用；否则返回 null（演示态）
export async function dingtalkLogin() {
  try {
    if (typeof window.dd !== 'undefined' && typeof window.dd.requestAuthCode === 'function') {
      return new Promise((resolve) => {
        window.dd.requestAuthCode({
          corpId: window.__NEXUS_DINGTALK__?.corpId,
          clientId: window.__NEXUS_DINGTALK__?.appKey,
          onSuccess: async (result) => {
            try {
              const r = await api('/dingtalk/auth/code', {
                method: 'POST',
                body: JSON.stringify({ code: result.code }),
              });
              setToken(r.accessToken);
              resolve(r.user || null);
            } catch {
              resolve(null);
            }
          },
          onFail: () => resolve(null),
        });
      });
    }
    return null;
  } catch {
    return null;
  }
}