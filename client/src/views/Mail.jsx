import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Mail({ user }) {
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

  const load = () => {
    const path = folder === 'sent' ? '/integration/mail/sent' : '/integration/mail/inbox';
    api(path).then((d) => setList(Array.isArray(d) ? d : [])).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    api('/integration/mail/config').then(setConfig).catch(() => {});
    api('/integration/mail/mcp/tools').then((d) => setTools(d.tools || [])).catch(() => {});
  }, [folder]);

  const openMail = async (m) => {
    setSelected(m);
    setCompose(false);
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

  const saveConfig = async () => {
    try {
      const c = await api('/integration/mail/config', { method: 'PUT', body: JSON.stringify(cfgForm) });
      setConfig(c);
      setShowConfig(false);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside className="nx-side" style={{ width: 200 }}>
        <div className="nx-side-head">
          <span>邮箱</span>
          <button type="button" className="btn-icon" title="写邮件" onClick={() => { setCompose(true); setSelected(null); }}>
            <Icons.plus size={16} />
          </button>
        </div>
        <div style={{ padding: 8 }}>
          <button type="button" className={`list-row${folder === 'inbox' && !compose ? ' active' : ''}`} style={{ width: '100%', border: 'none' }} onClick={() => { setFolder('inbox'); setCompose(false); }}>收件箱</button>
          <button type="button" className={`list-row${folder === 'sent' && !compose ? ' active' : ''}`} style={{ width: '100%', border: 'none' }} onClick={() => { setFolder('sent'); setCompose(false); }}>已发送</button>
          <button type="button" className="list-row" style={{ width: '100%', border: 'none' }} onClick={() => { setShowConfig(true); setCfgForm({ email: config?.email, imapHost: config?.imapHost, smtpHost: config?.smtpHost, username: config?.username }); }}>连接配置</button>
        </div>
        {config && (
          <div className="text-xs" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
            <div>{config.email}</div>
            <div style={{ marginTop: 4 }}>{config.status === 'connected' ? '已连接' : config.status}</div>
            {tools.length > 0 && <div style={{ marginTop: 8 }}>MCP 工具 {tools.length} 个</div>}
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
        ) : selected ? (
          <div>
            <div style={{ fontSize: 18, fontWeight: 650, marginBottom: 8 }}>{selected.subject}</div>
            <div className="text-xs" style={{ marginBottom: 16 }}>
              {selected.from} → {selected.to}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{selected.body}</div>
          </div>
        ) : showConfig ? (
          <div className="card" style={{ maxWidth: 480 }}>
            <div className="font-semi" style={{ marginBottom: 8 }}>IMAP / SMTP 配置</div>
            <div className="text-xs" style={{ marginBottom: 12 }}>填写企业邮箱服务器后即可通过 MCP 工具 list/send（演示环境默认本地收件箱）</div>
            {['email', 'imapHost', 'smtpHost', 'username', 'password'].map((k) => (
              <input
                key={k}
                type={k === 'password' ? 'password' : 'text'}
                placeholder={k}
                value={cfgForm[k] || ''}
                onChange={(e) => setCfgForm({ ...cfgForm, [k]: e.target.value })}
                style={{ width: '100%', marginBottom: 8 }}
              />
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-primary" onClick={saveConfig}>保存</button>
              <button type="button" className="btn-default" onClick={() => setShowConfig(false)}>取消</button>
            </div>
          </div>
        ) : (
          <div className="empty"><Icons.doc size={28} /><div>选择一封邮件</div></div>
        )}
      </div>
    </div>
  );
}
