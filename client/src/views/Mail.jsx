import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Mail({ user, navigate }) {
  const [folder, setFolder] = useState('inbox');
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [compose, setCompose] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [config, setConfig] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [cfgForm, setCfgForm] = useState({});
  const [error, setError] = useState('');
  const [tools, setTools] = useState([]);
  const [mcpSource, setMcpSource] = useState('');

  const load = () => {
    const path = folder === 'sent' ? '/integration/mail/sent' : '/integration/mail/inbox';
    api(path).then((d) => {
      const items = Array.isArray(d) ? d : [];
      setList(items);
      setSelected((cur) => cur && items.some((m) => m.id === cur.id) ? cur : (items[0] || null));
    }).catch((e) => setError(e.message));
  };

  const loadTools = () => {
    api('/integration/mail/mcp/tools').then((d) => {
      setTools(d.tools || []);
      setMcpSource(d.source || '');
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    api('/integration/mail/config').then((c) => {
      setConfig(c);
      if (!c.email && !c.mcpUrl) setShowConfig(true);
    }).catch(() => {});
    loadTools();
  }, [folder]);

  const openMail = async (m) => {
    setSelected(m);
    setCompose(false);
    setShowConfig(false);
    if (!m.read && folder === 'inbox') {
      await api(`/integration/mail/${m.id}/read`, { method: 'POST' }).catch(() => {});
      load();
    }
  };

  const send = async () => {
    try {
      await api('/integration/mail/send', {
        method: 'POST',
        body: JSON.stringify({ to, subject, body }),
      });
      setCompose(false);
      setTo(''); setSubject(''); setBody('');
      setFolder('sent');
    } catch (e) {
      setError(e.message || '发送失败');
    }
  };

  const applyPreset = (id) => {
    const p = (config?.presets || []).find((x) => x.id === id);
    setCfgForm((f) => ({
      ...f,
      provider: id,
      imapHost: p?.imapHost || f.imapHost || '',
      smtpHost: p?.smtpHost || f.smtpHost || '',
    }));
  };

  const saveConfig = async () => {
    try {
      const c = await api('/integration/mail/config', { method: 'PUT', body: JSON.stringify(cfgForm) });
      setConfig(c);
      setShowConfig(false);
      setError('');
      loadTools();
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const testMcp = async () => {
    try {
      const r = await api('/integration/mail/mcp/invoke', { method: 'POST', body: JSON.stringify({ name: 'mail_get_config', arguments: {} }) });
      setError('');
      alert(r.via === 'mcp' ? '已连上你的邮箱 MCP' : `本地 MCP 可用，状态：${r.status || r.email || 'ok'}`);
    } catch (e) {
      setError(e.message || 'MCP 调用失败');
    }
  };

  const hint = (config?.presets || []).find((p) => p.id === (cfgForm.provider || config?.provider))?.hint;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside className="nx-side" style={{ width: 200 }}>
        <div className="nx-side-head">
          <span>邮箱</span>
          <button type="button" className="btn-icon" title="写邮件" onClick={() => { setCompose(true); setSelected(null); setShowConfig(false); }}>
            <Icons.plus size={16} />
          </button>
        </div>
        <div style={{ padding: 8 }}>
          <button type="button" className={`list-row${folder === 'inbox' && !compose && !showConfig ? ' active' : ''}`} style={{ width: '100%', border: 'none' }} onClick={() => { setFolder('inbox'); setCompose(false); setShowConfig(false); }}>收件箱</button>
          <button type="button" className={`list-row${folder === 'sent' && !compose && !showConfig ? ' active' : ''}`} style={{ width: '100%', border: 'none' }} onClick={() => { setFolder('sent'); setCompose(false); setShowConfig(false); }}>已发送</button>
          <button type="button" className={`list-row${showConfig ? ' active' : ''}`} style={{ width: '100%', border: 'none' }} onClick={() => { setShowConfig(true); setCompose(false); setCfgForm({ ...config }); }}>我的邮箱 MCP</button>
        </div>
        {config && (
          <div className="text-xs" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
            <div>{config.email || '未绑定邮箱'}</div>
            <div style={{ marginTop: 4 }}>{config.status === 'connected' ? '已连接' : '未连接'}</div>
            {tools.length > 0 && <div style={{ marginTop: 8 }}>MCP 工具 {tools.length} 个 · {mcpSource || 'local'}</div>}
          </div>
        )}
      </aside>

      <div style={{ width: 300, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div className="nx-side-head">{folder === 'sent' ? '已发送' : '收件箱'}</div>
        <div className="scroll-y" style={{ flex: 1 }}>
          {list.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`list-row${selected?.id === m.id ? ' active' : ''}`}
              style={{ width: '100%', border: 'none', textAlign: 'left', opacity: m.read ? 0.75 : 1 }}
              onClick={() => openMail(m)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="font-med" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</div>
                <div className="text-xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder === 'sent' ? m.to : m.from}</div>
              </div>
            </button>
          ))}
          {list.length === 0 && <div className="empty" style={{ padding: 24 }}><div>暂无邮件</div></div>}
        </div>
      </div>

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        {error && <div className="text-error" style={{ fontSize: 12, marginBottom: 8 }}>{error}</div>}
        {compose ? (
          <div className="card" style={{ maxWidth: 560 }}>
            <div className="font-semi" style={{ marginBottom: 12 }}>写邮件</div>
            <input placeholder="收件人" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
            <input placeholder="主题" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
            <textarea rows={10} placeholder="正文" value={body} onChange={(e) => setBody(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
            <button type="button" className="btn-primary" onClick={send} disabled={!to.trim() || !subject.trim()}>发送</button>
          </div>
        ) : showConfig ? (
          <div className="card" style={{ maxWidth: 560 }}>
            <div className="font-semi" style={{ marginBottom: 8 }}>填写你自己的邮箱 MCP</div>
            <div className="text-xs" style={{ marginBottom: 12, lineHeight: 1.6 }}>
              选择邮箱服务商并填写账号 / 授权码；若你已有邮箱 MCP（HTTP JSON-RPC），填入地址与 Token。保存后 AI 与本页共用同一套工具。
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {(config?.presets || []).map((p) => (
                <button key={p.id} type="button" className={cfgForm.provider === p.id ? 'btn-primary' : 'btn-default'} style={{ fontSize: 12 }} onClick={() => applyPreset(p.id)}>{p.name}</button>
              ))}
            </div>
            {hint && <div className="text-xs text-muted" style={{ marginBottom: 10 }}>{hint}</div>}
            {[
              ['email', '邮箱地址', 'text'],
              ['username', '用户名（可同邮箱）', 'text'],
              ['password', '授权码 / 密码', 'password'],
              ['imapHost', 'IMAP 主机', 'text'],
              ['smtpHost', 'SMTP 主机', 'text'],
              ['mcpUrl', 'MCP 地址（如 http://127.0.0.1:3333/mcp）', 'text'],
              ['mcpToken', 'MCP Token', 'password'],
              ['mcpCommand', 'MCP 启动命令（可选，如 npx -y @modelcontextprotocol/server-gmail）', 'text'],
            ].map(([k, ph, type]) => (
              <input
                key={k}
                type={type}
                placeholder={ph}
                value={cfgForm[k] || ''}
                onChange={(e) => setCfgForm({ ...cfgForm, [k]: e.target.value })}
                style={{ width: '100%', marginBottom: 8 }}
              />
            ))}
            <div className="text-xs" style={{ marginBottom: 10 }}>
              当前工具：{tools.map((t) => t.name).join('、') || '尚未加载'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={saveConfig}>保存并连接</button>
              <button type="button" className="btn-default" onClick={testMcp}>测试 MCP</button>
              <button type="button" className="btn-ghost" onClick={() => setShowConfig(false)}>取消</button>
            </div>
          </div>
        ) : selected ? (
          <div>
            <div style={{ fontSize: 18, fontWeight: 650, marginBottom: 8 }}>{selected.subject}</div>
            <div className="text-xs" style={{ marginBottom: 16 }}>
              {selected.from} → {selected.to}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{selected.body}</div>
          </div>
        ) : (
          <div className="empty"><Icons.doc size={28} /><div>选择一封邮件</div></div>
        )}
      </div>
    </div>
  );
}
