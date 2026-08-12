// nexus-integration：第三方集成与应用市场 — 数据层
// 涵盖：应用市场、OAuth2/API Key 鉴权、Webhook、ERP/HR/CRM 集成、低代码平台对接
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('integration');

// 应用市场种子：常见企业第三方应用
const SEED_APPS = [
  { name: '钉钉同步', description: '与企业钉钉通讯录/消息互通', icon: 'dingtalk', category: '协同', config_schema: { corpId: 'string', agentId: 'string', secret: 'string' } },
  { name: '企业微信', description: '企业微信通讯录与消息推送', icon: 'wecom', category: '协同', config_schema: { corpId: 'string', secret: 'string' } },
  { name: '飞书开放平台', description: '飞书多维表格与审批同步', icon: 'feishu', category: '协同', config_schema: { appId: 'string', appSecret: 'string' } },
  { name: 'SAP ERP', description: 'SAP 财务/物料数据集成', icon: 'sap', category: 'ERP', config_schema: { host: 'string', client: 'string', user: 'string', password: 'string' } },
  { name: '用友 U8', description: '用友财务系统对接', icon: 'yonyou', category: 'ERP', config_schema: { host: 'string', apiKey: 'string' } },
  { name: '北森 HR', description: '北森人才管理系统集成', icon: 'beisen', category: 'HR', config_schema: { tenant: 'string', apiKey: 'string' } },
  { name: '销售易 CRM', description: '销售易客户关系管理同步', icon: 'xiaoshouyi', category: 'CRM', config_schema: { host: 'string', token: 'string' } },
  { name: 'Salesforce', description: 'Salesforce CRM 数据集成', icon: 'salesforce', category: 'CRM', config_schema: { instance: 'string', clientId: 'string', clientSecret: 'string' } },
  { name: 'Jira', description: 'Jira 项目与工单同步', icon: 'jira', category: '研发', config_schema: { host: 'string', user: 'string', token: 'string' } },
  { name: 'GitHub', description: 'GitHub 仓库与 PR 通知', icon: 'github', category: '研发', config_schema: { token: 'string' } },
  { name: '低代码表单', description: '低代码平台表单设计器入口', icon: 'lowcode', category: '低代码', config_schema: {} },
  { name: '低代码流程', description: '低代码平台流程设计器（透传 workflow 服务）', icon: 'lowcode', category: '低代码', config_schema: { workflowService: 'string' } },
];

migrate(db, [
  ['apps', `CREATE TABLE apps (
    id TEXT PRIMARY KEY, name TEXT, description TEXT, icon TEXT, category TEXT,
    config_schema TEXT, installed INTEGER DEFAULT 0, installed_at INTEGER)`],
  ['api_keys', `CREATE TABLE api_keys (
    id TEXT PRIMARY KEY, app_id TEXT, key TEXT, secret TEXT, rate_limit INTEGER DEFAULT 1000, created_at INTEGER)`],
  ['webhooks', `CREATE TABLE webhooks (
    id TEXT PRIMARY KEY, app_id TEXT, event_type TEXT, target_url TEXT, created_at INTEGER)`],
  ['integrations', `CREATE TABLE integrations (
    id TEXT PRIMARY KEY, type TEXT, name TEXT, config TEXT, status TEXT DEFAULT 'active', created_at INTEGER)`],
]);

// 种子应用：仅当 apps 表为空时插入
if (db.get('SELECT COUNT(*) c FROM apps').c === 0) {
  for (const a of SEED_APPS) {
    db.run('INSERT INTO apps (id, name, description, icon, category, config_schema) VALUES (?,?,?,?,?,?)',
      snowflake(), a.name, a.description, a.icon, a.category, JSON.stringify(a.config_schema));
  }
}

export function listApps({ category, installed } = {}) {
  let sql = 'SELECT id, name, description, icon, category, installed, installed_at FROM apps WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (installed !== undefined) { sql += ' AND installed = ?'; params.push(Number(installed)); }
  return db.all(sql, ...params);
}

export function getApp(id) { return db.get('SELECT * FROM apps WHERE id = ?', id); }

export function installApp(id) {
  const app = getApp(id);
  if (!app) return null;
  db.run('UPDATE apps SET installed = 1, installed_at = ? WHERE id = ?', Date.now(), id);
  return { ...app, installed: 1, installed_at: Date.now() };
}
export function uninstallApp(id) {
  db.run('UPDATE apps SET installed = 0, installed_at = NULL WHERE id = ?', id);
}

export function createApiKey(appId, { rateLimit = 1000 } = {}) {
  const id = snowflake();
  const key = `nk_${Math.random().toString(36).slice(2, 18)}`;
  const secret = Math.random().toString(36).slice(2, 34);
  db.run('INSERT INTO api_keys (id, app_id, key, secret, rate_limit, created_at) VALUES (?,?,?,?,?,?)',
    id, appId, key, secret, rateLimit, Date.now());
  return { id, appId, key, secret, rateLimit };
}

export function listApiKeys(appId) {
  return db.all('SELECT id, app_id, key, rate_limit, created_at FROM api_keys WHERE app_id = ?', appId);
}

export function createWebhook(appId, eventType, targetUrl) {
  const id = snowflake();
  db.run('INSERT INTO webhooks (id, app_id, event_type, target_url, created_at) VALUES (?,?,?,?,?)',
    id, appId, eventType, targetUrl, Date.now());
  return id;
}
export function listWebhooks(appId) { return db.all('SELECT * FROM webhooks WHERE app_id = ?', appId); }

export function createIntegration({ type, name, config }) {
  const id = snowflake();
  db.run('INSERT INTO integrations (id, type, name, config, status, created_at) VALUES (?,?,?,?,?,?)',
    id, type, name, JSON.stringify(config || {}), 'active', Date.now());
  return db.get('SELECT * FROM integrations WHERE id = ?', id);
}
export function listIntegrations(type) {
  let sql = 'SELECT * FROM integrations';
  const params = [];
  if (type) { sql += ' WHERE type = ?'; params.push(type); }
  return db.all(sql + ' ORDER BY created_at DESC', ...params).map((i) => ({ ...i, config: JSON.parse(i.config) }));
}
export function updateIntegration(id, { name, config, status }) {
  db.run('UPDATE integrations SET name = COALESCE(?, name), config = COALESCE(?, config), status = COALESCE(?, status) WHERE id = ?',
    name, config ? JSON.stringify(config) : null, status, id);
  return db.get('SELECT * FROM integrations WHERE id = ?', id);
}
export function deleteIntegration(id) { db.run('DELETE FROM integrations WHERE id = ?', id); }

// 速率限制：内存桶，按 API key 维度计数（每分钟）
const buckets = new Map();
export function checkRateLimit(apiKey, limit) {
  const now = Date.now();
  let b = buckets.get(apiKey);
  if (!b || now - b.start > 60000) { b = { start: now, count: 0 }; buckets.set(apiKey, b); }
  b.count++;
  return b.count <= limit;
}
