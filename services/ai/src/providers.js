// 国产大模型提供商：管理员配置 API Key / Base URL，OpenAI 兼容协议调用
// 参考：通义 DashScope / DeepSeek / 智谱 / Moonshot / 豆包
import { snowflake } from '@nexus/shared';
import { db } from './repo.js';

export const PROVIDER_PRESETS = [
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    docs: 'https://www.dingtalk.com/ · 千问办公同系能力',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  {
    id: 'doubao',
    name: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-pro-32k',
  },
  {
    id: 'local',
    name: '内置 RAG（离线）',
    baseUrl: '',
    defaultModel: 'nexus-rag',
  },
];

try {
  db.run(`CREATE TABLE IF NOT EXISTS ai_providers (
    id TEXT PRIMARY KEY, name TEXT, base_url TEXT, api_key TEXT, model TEXT,
    enabled INTEGER DEFAULT 0, is_default INTEGER DEFAULT 0, updated_at INTEGER)`);
  // 种子预设（无 key，默认启用 local）
  for (const p of PROVIDER_PRESETS) {
    const exists = db.get('SELECT id FROM ai_providers WHERE id = ?', p.id);
    if (!exists) {
      db.run(
        `INSERT INTO ai_providers (id, name, base_url, api_key, model, enabled, is_default, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        p.id, p.name, p.baseUrl, '', p.defaultModel,
        p.id === 'local' ? 1 : 0,
        p.id === 'local' ? 1 : 0,
        Date.now()
      );
    }
  }
} catch { /* */ }

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export function listProviders() {
  return db.all('SELECT * FROM ai_providers ORDER BY is_default DESC, name').map((r) => ({
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    model: r.model,
    enabled: !!r.enabled,
    isDefault: !!r.is_default,
    hasKey: !!r.api_key,
    apiKeyMasked: maskKey(r.api_key),
  }));
}

export function getProvider(id) {
  return db.get('SELECT * FROM ai_providers WHERE id = ?', id);
}

export function getDefaultProvider() {
  return db.get('SELECT * FROM ai_providers WHERE is_default = 1 AND enabled = 1')
    || db.get('SELECT * FROM ai_providers WHERE id = ?', 'local');
}

export function upsertProvider(id, body, { isAdmin }) {
  if (!isAdmin) throw Object.assign(new Error('仅管理员可配置模型'), { status: 403 });
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  const existing = getProvider(id);
  if (!existing && !preset) throw Object.assign(new Error('未知提供商'), { status: 404 });
  const now = Date.now();
  const name = body.name || existing?.name || preset?.name || id;
  const baseUrl = body.baseUrl ?? existing?.base_url ?? preset?.baseUrl ?? '';
  const model = body.model || existing?.model || preset?.defaultModel || '';
  let apiKey = existing?.api_key || '';
  if (body.apiKey !== undefined && body.apiKey !== '' && !String(body.apiKey).includes('****')) {
    apiKey = body.apiKey;
  }
  const enabled = body.enabled === undefined ? (existing?.enabled ?? 0) : (body.enabled ? 1 : 0);
  if (existing) {
    db.run(
      `UPDATE ai_providers SET name=?, base_url=?, api_key=?, model=?, enabled=?, updated_at=? WHERE id=?`,
      name, baseUrl, apiKey, model, enabled, now, id
    );
  } else {
    db.run(
      `INSERT INTO ai_providers (id, name, base_url, api_key, model, enabled, is_default, updated_at)
       VALUES (?,?,?,?,?,?,0,?)`,
      id, name, baseUrl, apiKey, model, enabled, now
    );
  }
  if (body.isDefault) {
    db.run('UPDATE ai_providers SET is_default = 0');
    db.run('UPDATE ai_providers SET is_default = 1, enabled = 1 WHERE id = ?', id);
  }
  return listProviders().find((p) => p.id === id);
}

export function setDefaultProvider(id, { isAdmin }) {
  if (!isAdmin) throw Object.assign(new Error('仅管理员可切换默认模型'), { status: 403 });
  const p = getProvider(id);
  if (!p) throw Object.assign(new Error('提供商不存在'), { status: 404 });
  if (id !== 'local' && !p.api_key) throw Object.assign(new Error('请先填写 API Key'), { status: 400 });
  db.run('UPDATE ai_providers SET is_default = 0');
  db.run('UPDATE ai_providers SET is_default = 1, enabled = 1 WHERE id = ?', id);
  return listProviders().find((x) => x.id === id);
}

/** 调用 OpenAI 兼容 Chat Completions；失败时抛出可读错误 */
export async function chatCompletion(provider, messages, { temperature = 0.7 } = {}) {
  if (!provider || provider.id === 'local' || !provider.base_url || !provider.api_key) {
    return null; // 交给本地 RAG
  }
  const base = provider.base_url.replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.api_key}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature,
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || data.message || `HTTP ${res.status}`;
      throw new Error(`${provider.name} 调用失败: ${msg}`);
    }
    const content = data.choices?.[0]?.message?.content || '';
    return {
      reply: content,
      provider: provider.id,
      model: provider.model,
      usage: data.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export { snowflake };
