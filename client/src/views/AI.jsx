import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

export default function AI({ user, navigate }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '你好，我是 Nexus AI（对标钉钉千问办公 / WeLink 小微）。可查询、总结、翻译或推荐会议时间。回答仅作辅助，请自行审阅。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerId, setProviderId] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    api('/ai/providers').then((d) => {
      const list = d.providers || [];
      setProviders(list);
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
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: r.reply || r.message || '（无回复）',
        sources: r.sources,
        model: r.model,
        provider: r.provider,
      }]);
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
  ];

  const current = providers.find((p) => p.id === providerId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div className="font-semi" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icons.spark size={16} stroke="var(--accent)" /> AI 助手
          </div>
          <div className="text-xs">辅助决策，不替代决策 · AI 生成请审阅</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} style={{ fontSize: 12, maxWidth: 180 }}>
            {providers.filter((p) => p.enabled || p.id === 'local').map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' · 默认' : ''}</option>
            ))}
          </select>
          <button type="button" className="btn-default" style={{ fontSize: 12 }} onClick={() => navigate?.('settings')}>个人设置</button>
        </div>
      </div>
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
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="输入问题…" style={{ flex: 1 }} />
        <button type="button" className="btn-primary" onClick={send} disabled={loading}>发送</button>
      </div>
    </div>
  );
}
