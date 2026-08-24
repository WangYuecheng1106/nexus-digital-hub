// nexus-ai：服务入口 + HTTP 路由
// 对外能力：/chat(RAG问答) /summarize /translate /search(语义搜索) /conversations /schedule /nl2sql /reminder
import { createService, asyncRoute, requireFields, notFound, publishEvent, subscribeEvents } from '@nexus/shared';
import {
  db, ragAnswer, nl2sql, summarize, translate, suggestMeetingSlots,
  semanticSearch, createConversation, listConversations, addMessage, listMessages,
} from './repo.js';
import {
  listProviders, upsertProvider, setDefaultProvider, getDefaultProvider,
  getProvider, chatCompletion, PROVIDER_PRESETS, aiStatus, completeTask, hasRemoteKey,
} from './providers.js';

function isAdmin(user) {
  const roles = user?.roles || [];
  const perms = user?.perms || [];
  return perms.includes('*') || roles.includes('admin') || roles.includes('系统管理员');
}

function sourceLabel(s) {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.title || s.doc_id || s.id || s.name || '';
}

function parseWorkIntent(message, userId) {
  void userId;
  const m = String(message || '').trim();
  const remind = m.match(/^(?:提醒我|创建待办|加个待办)[，,：:\s]*(.+)$/);
  if (remind) return { tool: 'create_todo', params: { title: remind[1] }, text: `已创建待办：${remind[1]}` };
  const send = m.match(/^(?:发消息给|发给)(.+?)(?:说|[:：]\s*)(.+)$/);
  if (send) return { tool: 'send_im_message', params: { to: send[1].trim(), text: send[2].trim() }, text: `已发给 ${send[1].trim()}：${send[2].trim()}` };
  const cal = m.match(/^(?:安排|新建日程|约个?|创建日程)[：:\s]*(.+)$/);
  if (cal) return { tool: 'create_calendar_event', params: { title: cal[1] }, text: `已创建日程：${cal[1]}` };
  const appr = m.match(/^(?:帮我)?(?:请假|发起审批|提交审批)[：:\s]*(.*)$/);
  if (appr) return { tool: 'create_approval', params: { title: appr[1] || '请假申请' }, text: '已发起审批' };
  const kg = m.match(/^(?:搜(?:索)?(?:一下)?图谱|图谱里找|搜索知识)[：:\s]*(.+)$/);
  if (kg) return { tool: 'search_knowledge', params: { q: kg[1] }, text: `已搜索图谱：${kg[1]}` };
  const mail = m.match(/^(?:写信给|发邮件给)(.+?)(?:说|[:：]\s*)(.+)$/);
  if (mail) return { tool: 'send_email', params: { to: mail[1].trim(), text: mail[2].trim(), subject: '来自 Nexus AI' }, text: `已写信给 ${mail[1].trim()}` };
  return null;
}

async function jsonFetch(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function runTool(tool, params, authorization) {
  const headers = { 'content-type': 'application/json', authorization: authorization || '' };
  try {
    if (tool === 'create_todo') {
      return await jsonFetch('http://localhost:8098/todos', {
        method: 'POST', headers, body: JSON.stringify({ title: params.title, source: 'ai' }),
      });
    }
    if (tool === 'create_calendar_event') {
      const start = Date.now() + 60 * 60 * 1000;
      return await jsonFetch('http://localhost:8088/events', {
        method: 'POST', headers,
        body: JSON.stringify({ title: params.title, start_time: start, end_time: start + 3600000, desc: '由 AI 创建' }),
      });
    }
    if (tool === 'send_im_message') {
      const aliases = { 张三: '张伟', 李四: '李娜', 王五: '王芳' };
      const want = aliases[params.to] || params.to;
      const listRes = await jsonFetch('http://localhost:8092/employees?q=' + encodeURIComponent(want), { headers });
      const people = Array.isArray(listRes.data) ? listRes.data : (listRes.data.items || []);
      const hit = people.find((e) => e.name === want || e.name?.includes(want) || e.name?.includes(params.to)) || people[0];
      if (!hit) return { ok: false, error: `找不到联系人「${params.to}」` };
      const conv = await jsonFetch('http://localhost:8083/conversations', {
        method: 'POST', headers,
        body: JSON.stringify({ type: 'single', name: hit.name, memberIds: [hit.id] }),
      });
      const convId = conv.data?.id;
      if (!convId) return { ok: false, error: '无法创建会话' };
      const sent = await jsonFetch(`http://localhost:8083/conversations/${convId}/messages`, {
        method: 'POST', headers,
        body: JSON.stringify({ type: 'text', body: { text: params.text } }),
      });
      return { ok: sent.ok, data: { to: hit.name, convId, ...sent.data } };
    }
    if (tool === 'create_approval') {
      const tpls = await jsonFetch('http://localhost:8086/templates', { headers });
      const list = Array.isArray(tpls.data) ? tpls.data : [];
      const tpl = list.find((t) => /请假/.test(t.name)) || list[0];
      if (!tpl) return { ok: false, error: '没有可用审批模板' };
      return await jsonFetch('http://localhost:8086/submit', {
        method: 'POST', headers,
        body: JSON.stringify({ flowDefId: tpl.flow_def_id, formData: { reason: params.title || 'AI 发起' } }),
      });
    }
    if (tool === 'search_knowledge') {
      return await jsonFetch('http://localhost:8087/graph/search?q=' + encodeURIComponent(params.q || params.title || ''), { headers });
    }
    if (tool === 'send_email') {
      return await jsonFetch('http://localhost:8095/mail/send', {
        method: 'POST', headers,
        body: JSON.stringify({ to: params.to, subject: params.subject || '来自 Nexus AI', body: params.text || params.body || '' }),
      });
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, data: params };
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
    res.json({ providers: listProviders(), presets: PROVIDER_PRESETS, ...aiStatus() });
  });
  app.get('/status', (req, res) => res.json(aiStatus()));

  // 填写 API Key 后：文档摘要/润色、图谱整理说明、听记等走真实模型
  app.post('/complete', asyncRoute(async (req, res) => {
    requireFields(req.body, ['text']);
    const providerId = req.body.providerId;
    const provider = providerId ? getProvider(providerId) : getDefaultProvider();
    try {
      const out = await completeTask(provider, {
        task: req.body.task || 'chat',
        text: req.body.text,
        instruction: req.body.instruction || '',
      });
      res.json(out);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message, needKey: !!e.needKey });
    }
  }));
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

    const intent = parseWorkIntent(req.body.message, req.user?.sub);
    if (intent) {
      const result = await runTool(intent.tool, intent.params, req.headers.authorization);
      addMessage(convId, 'assistant', intent.text);
      return res.json({
        type: 'tool_call',
        tool: intent.tool,
        params: intent.params,
        result: { message: result.ok ? intent.text : (result.error || '未写入，已在对话中记下') },
        text: result.ok ? intent.text : (result.error || intent.text),
        conversationId: convId,
        provider: 'agentos',
        model: 'rules',
        aiGenerated: true,
        sources: [],
      });
    }

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
    const sourceNames = (sources || []).map(sourceLabel).filter(Boolean);
    res.json({ reply, sources: sourceNames, conversationId: convId, ...modelMeta, aiGenerated: true });
  }));

  // ---- 文本摘要（会议纪要 / 文档） ----
  app.post('/summarize', asyncRoute(async (req, res) => {
    requireFields(req.body, ['text']);
    const provider = req.body.providerId ? getProvider(req.body.providerId) : getDefaultProvider();
    if (hasRemoteKey(provider)) {
      try {
        const out = await completeTask(provider, { task: 'summarize', text: req.body.text });
        return res.json({ summary: out.text, provider: out.provider, model: out.model, aiGenerated: true });
      } catch { /* 回退本地摘要 */ }
    }
    res.json({ summary: summarize(req.body.text, req.body.ratio || 0.3), provider: 'local' });
  }));

  // ---- AI 翻译（mock 中英互译） ----
  app.post('/translate', asyncRoute(async (req, res) => {
    requireFields(req.body, ['text', 'from', 'to']);
    const provider = req.body.providerId ? getProvider(req.body.providerId) : getDefaultProvider();
    if (hasRemoteKey(provider)) {
      try {
        const out = await completeTask(provider, {
          task: 'chat',
          text: req.body.text,
          instruction: `请将以下文本从 ${req.body.from} 翻译为 ${req.body.to}，只输出译文。`,
        });
        return res.json({ translation: out.text, provider: out.provider, aiGenerated: true });
      } catch { /* 回退词典 */ }
    }
    res.json({ translation: translate(req.body.text, req.body.from, req.body.to), provider: 'local' });
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
