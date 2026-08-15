import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

// AgentOS：对话即操作。支持工具调用面板，让 AI 直接操控平台功能
export default function AI({ user, navigate }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '你好，我是 Nexus AI（对标钉钉千问办公 / WeLink 小微）。可查询、总结、翻译或推荐会议时间。回答仅作辅助，请自行审阅。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerId, setProviderId] = useState('');
  const [hasRemote, setHasRemote] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    api('/ai/providers').then((d) => {
      const list = d.providers || [];
      setProviders(list);
      setHasRemote(!!d.hasRemote);
      const def = list.find((p) => p.isDefault) || list.find((p) => p.id === 'local');
      if (def) setProviderId(def.id);
    }).catch(() => {});
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const r = await api('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text, providerId: providerId || undefined }),
      });
      
      // 工具调用响应
      if (r.type === 'tool_call') {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: r.text,
          toolCall: { tool: r.tool, params: r.params, result: r.result },
          model: r.model,
          provider: r.provider,
        }]);
      } else {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: r.reply || r.message || '（无回复）',
          sources: (r.sources || []).map((s) => (typeof s === 'string' ? s : (s.title || s.doc_id || s.id || s.name || ''))).filter(Boolean),
          model: r.model,
          provider: r.provider,
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '暂时无法回答，请稍后重试。' }]);
    }
    setLoading(false);
  };

  const quick = [
    { label: '总结文档', prompt: '请总结最近的文档' },
    { label: '翻译', prompt: '请翻译：Hello World' },
    { label: '智能搜索', prompt: '搜索上周产品发布讨论' },
    { label: '会议时间', prompt: '帮我找一个明天下午的会议时间' },
    { label: '发消息', prompt: '发消息给张三说会议改到3点' },
    { label: '创建待办', prompt: '提醒我下午5点提交周报' },
    { label: '建日程', prompt: '安排明天下午周会' },
    { label: '发起审批', prompt: '请假：周五半天' },
    { label: '搜图谱', prompt: '搜索图谱 张伟' },
    { label: '写信', prompt: '写信给李娜说入职材料已齐' },
  ];

  const eco = [
    { label: '千问办公', hint: '对话即操作', go: null },
    { label: 'AI 文档', hint: '摘要 / 润色', go: 'document' },
    { label: 'AI 听记', hint: '会议笔记', go: 'meeting' },
    { label: 'AI 表格', hint: '个人分析', go: 'analytics' },
    { label: 'AI 搜问', hint: '图谱整理', go: 'knowledge' },
  ];
  const current = providers.find((p) => p.id === providerId);

  // 工具调用卡片渲染
  const renderToolCall = (toolCall) => {
    const { tool, params, result } = toolCall;
    const toolNames = {
      send_im_message: '发送消息',
      create_todo: '创建待办',
      create_approval: '发起审批',
      create_calendar_event: '创建日程',
      search_knowledge: '搜索知识库',
      send_email: '发送邮件',
    };
    return (
      <div style={{
        marginTop: 8,
        padding: 10,
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Icons.spark size={12} stroke="var(--accent)" />
          <span className="font-semi" style={{ color: 'var(--accent)' }}>{toolNames[tool] || tool}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
          参数: {JSON.stringify(params, null, 2)}
        </div>
        {result && (
          <div style={{ fontSize: 11, color: 'var(--success)' }}>
            ✓ {result.message || '执行成功'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div className="font-semi" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icons.spark size={16} stroke="var(--accent)" /> AI 助手
            <span className="tag" style={{ fontSize: 10, background: 'var(--accent-soft)', color: 'var(--accent)' }}>AgentOS</span>
          </div>
          <div className="text-xs">对标钉钉千问办公 · 填 Key 后文档/图谱/听记走真实模型 · AI 生成请审阅</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} style={{ fontSize: 12, maxWidth: 180 }}>
            {providers.filter((p) => p.enabled || p.id === 'local').map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' · 默认' : ''}</option>
            ))}
          </select>
          <button type="button" className="btn-default" style={{ fontSize: 12 }} onClick={() => navigate?.('settings')}>配置模型</button>
        </div>
      </div>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, overflowX: 'auto', background: 'var(--bg-panel)' }}>
        {eco.map((e) => (
          <button key={e.label} type="button" className="btn-default" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => e.go && navigate?.(e.go)}>
            {e.label}
            <span className="text-muted" style={{ marginLeft: 6 }}>{e.hint}</span>
          </button>
        ))}
      </div>
      {!hasRemote && (
        <div className="text-xs" style={{ padding: '8px 16px', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>填写通义 / DeepSeek / 智谱等 API Key 后，聊天、AI 文档与节点整理走真实模型。规则指令（提醒、发消息）无需 Key。</span>
          <button type="button" className="btn-primary" style={{ fontSize: 12 }} onClick={() => navigate?.('settings')}>去填写</button>
        </div>
      )}
      <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 14, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
            <div className={`avatar sm ${m.role === 'user' ? 'accent' : ''}`}>
              {m.role === 'user' ? (user.display_name || '?').charAt(0) : 'AI'}
            </div>
            <div style={{ maxWidth: '70%' }}>
              <div className={`msg-bubble ${m.role === 'user' ? 'mine' : 'theirs'}`}>
                {m.content}
                {m.sources?.length > 0 && <div style={{ marginTop: 6, fontSize: 11, opacity: .7 }}>来源: {m.sources.join(', ')}</div>}
              </div>
              {m.toolCall && renderToolCall(m.toolCall)}
              {m.role === 'assistant' && (
                <div className="text-muted" style={{ fontSize: 10, marginTop: 3 }}>
                  AI 生成，请审阅{m.provider ? ` · ${m.provider}/${m.model || ''}` : current ? ` · ${current.name}` : ''}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="text-muted" style={{ fontSize: 12 }}>思考中…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap', background: 'var(--bg-elevated)' }}>
        {quick.map((a) => (
          <button key={a.label} type="button" className="btn-default" style={{ fontSize: 12 }} onClick={() => setInput(a.prompt)}>{a.label}</button>
        ))}
      </div>
      <div className="composer">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="输入问题或指令（如：发消息给张三）…" style={{ flex: 1 }} />
        <button type="button" className="btn-primary" onClick={send} disabled={loading}>发送</button>
      </div>
    </div>
  );
}
