// nexus-ai：服务入口 + HTTP 路由
// 对外能力：/chat(RAG问答) /summarize /translate /search(语义搜索) /conversations /schedule /nl2sql /reminder
import { createService, asyncRoute, requireFields, notFound, publishEvent, subscribeEvents } from '@nexus/shared';
import {
  db, ragAnswer, nl2sql, summarize, translate, suggestMeetingSlots,
  semanticSearch, createConversation, listConversations, addMessage, listMessages,
} from './repo.js';
import {
  listProviders, upsertProvider, setDefaultProvider, getDefaultProvider,
  getProvider, chatCompletion, PROVIDER_PRESETS,
} from './providers.js';

function isAdmin(user) {
  const roles = user?.roles || [];
  const perms = user?.perms || [];
  return perms.includes('*') || roles.includes('admin') || roles.includes('系统管理员');
}

const { ctx } = createService({
  name: 'ai',
  port: 8096,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    setupRoutes(app);
    ctx.addDebug(() => ({
      conversations: db.get('SELECT COUNT(*) c FROM conversations').c,
      messages: db.get('SELECT COUNT(*) c FROM messages').c,
      embeddings: db.get('SELECT COUNT(*) c FROM embeddings').c,
      providers: listProviders().filter((p) => p.enabled).map((p) => p.id),
    }));
  },
});

subscribeEvents('ai', 8096, ['meeting.created', 'workflow.task_assigned', 'calendar.event_updated']);

function setupRoutes(app) {
  // ---- 国产多模型管理（管理员填 API Key）----
  app.get('/providers', (req, res) => {
    res.json({ providers: listProviders(), presets: PROVIDER_PRESETS });
  });
  app.put('/providers/:id', asyncRoute(async (req, res) => {
    try {
      res.json(upsertProvider(req.params.id, req.body || {}, { isAdmin: isAdmin(req.user) }));
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  }));
  app.post('/providers/:id/default', asyncRoute(async (req, res) => {
    try {
      res.json(setDefaultProvider(req.params.id, { isAdmin: isAdmin(req.user) }));
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
    }
  }));

  // ---- RAG / 远程模型问答 ----
  app.post('/chat', asyncRoute(async (req, res) => {
    requireFields(req.body, ['message']);
    let convId = req.body.conversationId;
    if (!convId) {
      const title = String(req.body.message).slice(0, 20);
      const conv = createConversation(String(req.user.sub), title);
      convId = conv.id;
    }
    addMessage(convId, 'user', req.body.message);

    const providerId = req.body.providerId;
    const provider = providerId ? getProvider(providerId) : getDefaultProvider();
    let reply; let sources = []; let modelMeta = { provider: 'local', model: 'nexus-rag' };

    try {
      const remote = await chatCompletion(provider, [
        { role: 'system', content: '你是 Nexus 企业协作助手（对标钉钉千问办公 / WeLink 小微）。回答简洁、可执行。注明「AI 生成，请审阅」。' },
        { role: 'user', content: req.body.message },
      ]);
      if (remote?.reply) {
        reply = remote.reply;
        modelMeta = { provider: remote.provider, model: remote.model, usage: remote.usage };
      }
    } catch (e) {
      // 远程失败回退本地 RAG，并附带错误说明
      const local = ragAnswer(req.body.message);
      reply = `${local.reply}\n\n（远程模型不可用：${e.message}，已回退内置 RAG）`;
      sources = local.sources;
    }

    if (!reply) {
      const local = ragAnswer(req.body.message);
      reply = local.reply;
      sources = local.sources;
    }

    addMessage(convId, 'assistant', reply);
    res.json({ reply, sources, conversationId: convId, ...modelMeta, aiGenerated: true });
  }));

  // ---- 文本摘要（会议纪要 / 文档） ----
  app.post('/summarize', asyncRoute(async (req, res) => {
    requireFields(req.body, ['text']);
    res.json({ summary: summarize(req.body.text, req.body.ratio || 0.3) });
  }));

  // ---- AI 翻译（mock 中英互译） ----
  app.post('/translate', asyncRoute(async (req, res) => {
    requireFields(req.body, ['text', 'from', 'to']);
    res.json({ translation: translate(req.body.text, req.body.from, req.body.to) });
  }));

  // ---- 语义搜索 ----
  app.post('/search', asyncRoute(async (req, res) => {
    requireFields(req.body, ['query']);
    res.json({ results: semanticSearch(req.body.query, req.body.topK || 5) });
  }));

  // ---- 自然语言转 SQL（mock） ----
  app.post('/nl2sql', asyncRoute(async (req, res) => {
    requireFields(req.body, ['question']);
    res.json(nl2sql(req.body.question));
  }));

  // ---- 智能排期：推荐可用会议时间 ----
  app.post('/schedule', asyncRoute(async (req, res) => {
    const duration = parseInt(req.body.durationMin) || 60;
    const count = parseInt(req.body.count) || 3;
    res.json({ slots: suggestMeetingSlots(duration, count) });
  }));

  // ---- 智能提醒：根据事件生成提醒文案 ----
  app.post('/reminder', asyncRoute(async (req, res) => {
    requireFields(req.body, ['event', 'time']);
    const text = `智能提醒：您在 ${req.body.time} 有「${req.body.event}」，请提前准备。`;
    publishEvent('ai.reminder_generated', { userId: req.user.sub, text, event: req.body.event, time: req.body.time }, 'ai');
    res.json({ reminder: text });
  }));

  // ---- 会话管理 ----
  app.post('/conversations', asyncRoute(async (req, res) => {
    const conv = createConversation(String(req.user.sub), req.body.title);
    res.status(201).json(conv);
  }));
  app.get('/conversations', (req, res) => res.json(listConversations(String(req.user.sub))));
  app.get('/conversations/:id/messages', (req, res) => {
    const conv = db.get('SELECT * FROM conversations WHERE id = ? AND user_id = ?', req.params.id, String(req.user.sub));
    if (!conv) throw notFound('会话不存在');
    res.json(listMessages(req.params.id));
  });
  app.delete('/conversations/:id', (req, res) => {
    db.tx(() => {
      db.run('DELETE FROM messages WHERE conversation_id = ?', req.params.id);
      db.run('DELETE FROM conversations WHERE id = ? AND user_id = ?', req.params.id, String(req.user.sub));
    });
    res.json({ ok: true });
  });
}
