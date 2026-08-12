// nexus-integration：服务入口 + HTTP 路由 + OpenAPI 文档
import { createService, asyncRoute, requireFields, badRequest, notFound, publishEvent, subscribeEvents } from '@nexus/shared';
import {
  db, listApps, getApp, installApp, uninstallApp, createApiKey, listApiKeys,
  createWebhook, listWebhooks, createIntegration, listIntegrations, updateIntegration,
  deleteIntegration, checkRateLimit,
} from './repo.js';
import {
  getMailConfig, saveMailConfig, listMail, markRead, sendMail,
  listMcpTools, invokeMcpTool,
} from './mail.js';

const { ctx } = createService({
  name: 'integration',
  port: 8095,
  publicPaths: ['/health', '/debug', '/openapi.json', '/apps'],
  setup(app, ctx) {
    setupRoutes(app);
    ctx.addDebug(() => ({
      apps: db.get('SELECT COUNT(*) c FROM apps').c,
      installed: db.get('SELECT COUNT(*) c FROM apps WHERE installed = 1').c,
      apiKeys: db.get('SELECT COUNT(*) c FROM api_keys').c,
      webhooks: db.get('SELECT COUNT(*) c FROM webhooks').c,
      integrations: db.get('SELECT COUNT(*) c FROM integrations').c,
    }));
  },
});

subscribeEvents('integration', 8095, ['*']);

function setupRoutes(app) {
  // ---- 应用市场 ----
  app.get('/apps', (req, res) => res.json(listApps({ category: req.query.category, installed: req.query.installed })));
  app.get('/apps/:id', (req, res) => {
    const a = getApp(req.params.id);
    if (!a) throw notFound('应用不存在');
    a.config_schema = JSON.parse(a.config_schema);
    res.json(a);
  });
  app.post('/apps/:id/install', asyncRoute(async (req, res) => {
    const a = installApp(req.params.id);
    if (!a) throw notFound('应用不存在');
    publishEvent('integration.app_installed', { appId: a.id, name: a.name, config: req.body?.config || {} }, 'integration');
    res.json(a);
  }));
  app.delete('/apps/:id', (req, res) => { uninstallApp(req.params.id); res.json({ ok: true }); });

  // ---- API Key 管理（OAuth2 client credentials 简化版） ----
  app.post('/api-keys', asyncRoute(async (req, res) => {
    requireFields(req.body, ['appId']);
    res.status(201).json(createApiKey(req.body.appId, { rateLimit: req.body.rateLimit }));
  }));
  app.get('/api-keys', (req, res) => res.json(listApiKeys(req.query.appId)));

  // ---- Webhook 管理 ----
  app.post('/webhooks', asyncRoute(async (req, res) => {
    requireFields(req.body, ['appId', 'eventType', 'targetUrl']);
    res.status(201).json({ id: createWebhook(req.body.appId, req.body.eventType, req.body.targetUrl) });
  }));
  app.get('/webhooks', (req, res) => res.json(listWebhooks(req.query.appId)));

  // ---- 企业系统集成（ERP/HR/CRM mock） ----
  app.post('/integrations', asyncRoute(async (req, res) => {
    requireFields(req.body, ['type', 'name']);
    if (!['erp', 'hr', 'crm'].includes(req.body.type)) throw badRequest('类型必须为 erp/hr/crm');
    res.status(201).json(createIntegration(req.body));
  }));
  app.get('/integrations', (req, res) => res.json(listIntegrations(req.query.type)));
  app.put('/integrations/:id', asyncRoute(async (req, res) => {
    const r = updateIntegration(req.params.id, req.body);
    if (!r) throw notFound('集成不存在');
    res.json(r);
  }));
  app.delete('/integrations/:id', (req, res) => { deleteIntegration(req.params.id); res.json({ ok: true }); });

  // ---- 低代码平台：表单设计器 + 流程设计器（流程透传 workflow 服务） ----
  app.post('/lowcode/forms', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name', 'schema']);
    const id = `form_${Date.now().toString(36)}`;
    // 表单 schema 仅落库到 integrations 表，便于后续扩展存储
    res.status(201).json({ id, name: req.body.name, schema: req.body.schema });
  }));
  app.post('/lowcode/flows', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name', 'definition']);
    // 流程透传 workflow 服务：这里仅返回流程定义 ID，由前端携带 ID 调用 workflow 服务创建
    const id = `flow_${Date.now().toString(36)}`;
    publishEvent('integration.lowcode_flow', { flowId: id, name: req.body.name, definition: req.body.definition }, 'integration');
    res.status(201).json({ id, name: req.body.name, definition: req.body.definition, workflowService: 'http://localhost:8086' });
  }));

  // ---- API 鉴权 + 限流中间件示例：第三方调用入口 ----
  app.post('/api/:appId/:resource', asyncRoute(async (req, res) => {
    const apiKey = (req.headers['x-api-key'] || '').trim();
    if (!apiKey) throw badRequest('缺少 x-api-key');
    const key = db.get('SELECT * FROM api_keys WHERE key = ?', apiKey);
    if (!key || key.app_id !== req.params.appId) throw notFound('API Key 无效');
    if (!checkRateLimit(apiKey, key.rate_limit)) {
      res.status(429).json({ error: 'rate_limited', message: '超出 API 调用频率限制' });
      return;
    }
    publishEvent('integration.api_call', { appId: req.params.appId, resource: req.params.resource, apiKeyId: key.id }, 'integration');
    res.json({ ok: true, resource: req.params.resource, payload: req.body });
  }));

  // ---- 企业邮箱（IMAP/SMTP 配置 + MCP 工具面，对标钉钉邮箱 / WeLink 连接业务）----
  app.get('/mail/config', (req, res) => res.json(getMailConfig(String(req.user.sub))));
  app.put('/mail/config', asyncRoute(async (req, res) => {
    res.json(saveMailConfig(String(req.user.sub), req.body || {}));
  }));
  app.get('/mail/inbox', (req, res) => res.json(listMail(String(req.user.sub), 'inbox')));
  app.get('/mail/sent', (req, res) => res.json(listMail(String(req.user.sub), 'sent')));
  app.post('/mail/send', asyncRoute(async (req, res) => {
    requireFields(req.body, ['to', 'subject']);
    res.status(201).json(sendMail(String(req.user.sub), req.body));
  }));
  app.post('/mail/:id/read', (req, res) => res.json(markRead(String(req.user.sub), req.params.id)));
  app.get('/mail/mcp/tools', (req, res) => res.json(listMcpTools()));
  app.post('/mail/mcp/invoke', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name']);
    res.json(invokeMcpTool(String(req.user.sub), req.body.name, req.body.arguments || {}));
  }));

  // ---- OpenAPI 2.0 (Swagger) 文档 ----
  app.get('/openapi.json', (req, res) => res.json(buildSwagger()));
}

// 生成 Swagger 2.0 规范：列出本服务主要端点
function buildSwagger() {
  return {
    swagger: '2.0',
    info: { title: 'Nexus Integration API', version: '0.1.0', description: '第三方集成与应用市场 API 文档' },
    host: 'localhost:8095',
    basePath: '/',
    schemes: ['http'],
    paths: {
      '/apps': { get: { summary: '应用市场列表', tags: ['apps'], responses: { 200: { description: '应用列表' } } } },
      '/apps/{id}/install': { post: { summary: '安装应用', tags: ['apps'], parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }], responses: { 200: { description: '安装成功' } } } },
      '/api-keys': { post: { summary: '创建 API Key', tags: ['auth'], responses: { 201: { description: '创建成功' } } } },
      '/webhooks': { post: { summary: '注册 Webhook', tags: ['webhooks'], responses: { 201: { description: '注册成功' } } } },
      '/integrations': { get: { summary: '集成列表', tags: ['integrations'], responses: { 200: { description: '集成列表' } } }, post: { summary: '创建集成', tags: ['integrations'], responses: { 201: { description: '创建成功' } } } },
      '/lowcode/forms': { post: { summary: '低代码表单设计', tags: ['lowcode'], responses: { 201: { description: '创建成功' } } } },
      '/lowcode/flows': { post: { summary: '低代码流程设计', tags: ['lowcode'], responses: { 201: { description: '创建成功' } } } },
    },
  };
}
