import React, { useState, useEffect } from 'react';
import { api, clearTokens } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Settings({ user, onLogout, theme, setTheme, brandColor, setBrandColor, navigate }) {
  const [tab, setTab] = useState('profile');
  const [providers, setProviders] = useState([]);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [passwords, setPasswords] = useState({ old: '', new: '', confirm: '' });
  const [mailCfg, setMailCfg] = useState({});
  const [mailForm, setMailForm] = useState({});

  useEffect(() => {
    const admin = (user.perms || []).includes('*') || (user.roles || []).includes('admin') || (user.roles || []).includes('系统管理员');
    setIsAdmin(admin);
  }, [user]);

  useEffect(() => {
    if (tab === 'ai') {
      api('/ai/providers').then((d) => setProviders(d.providers || [])).catch((e) => setErr(e.message));
    }
    if (tab === 'mail') {
      api('/integration/mail/config').then((c) => { setMailCfg(c); setMailForm(c); }).catch(() => {});
    }
  }, [tab, isAdmin]);

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* */ }
    clearTokens();
    onLogout?.();
  };

  const changePassword = async () => {
    if (!passwords.old || !passwords.new) return setErr('请填写原密码和新密码');
    if (passwords.new !== passwords.confirm) return setErr('两次输入的新密码不一致');
    try {
      await api(`/auth/users/${user.id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ oldPassword: passwords.old, newPassword: passwords.new }),
      });
      setMsg('密码已修改');
      setPasswords({ old: '', new: '', confirm: '' });
    } catch (e) {
      setErr(e.message || '修改失败');
    }
  };

  const openEdit = (p) => {
    setEditId(p.id);
    setForm({ apiKey: '', baseUrl: p.baseUrl || '', model: p.model || '', enabled: p.enabled });
    setMsg(''); setErr('');
  };

  const saveProvider = async () => {
    try {
      await api(`/ai/providers/${editId}`, {
        method: 'PUT',
        body: JSON.stringify({
          apiKey: form.apiKey || undefined,
          baseUrl: form.baseUrl,
          model: form.model,
          enabled: form.enabled,
        }),
      });
      setMsg('已保存');
      setEditId(null);
      const d = await api('/ai/providers');
      setProviders(d.providers || []);
    } catch (e) { setErr(e.message || '保存失败'); }
  };

  const setDefault = async (id) => {
    try {
      await api(`/ai/providers/${id}/default`, { method: 'POST', body: '{}' });
      const d = await api('/ai/providers');
      setProviders(d.providers || []);
      setMsg(`已设为默认：${id}`);
    } catch (e) { setErr(e.message); }
  };

  const saveMail = async () => {
    try {
      const c = await api('/integration/mail/config', { method: 'PUT', body: JSON.stringify(mailForm) });
      setMailCfg(c); setMailForm(c);
      setMsg('邮箱配置已保存');
    } catch (e) { setErr(e.message || '保存失败'); }
  };

  const tabs = [
    ['profile', '个人资料', Icons.user],
    ['security', '安全', Icons.logout],
    ['appearance', '外观', Icons.settings],
    ['mail', '邮箱', Icons.mail],
    ['ai', 'AI 模型', Icons.spark],
    ['about', '关于', Icons.nexus],
  ];

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div className="nx-side" style={{ width: 220 }}>
        <div className="nx-side-head">设置</div>
        <div style={{ padding: 8 }}>
          {tabs.map(([k, l, Icon]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setMsg(''); setErr(''); }} className={`list-row${tab === k ? ' active' : ''}`} style={{ width: '100%', border: 'none', background: tab === k ? 'var(--accent-soft)' : 'transparent', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={14} /> {l}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-y" style={{ flex: 1, padding: 24 }}>
        {msg && <div className="text-xs" style={{ color: 'var(--success)', marginBottom: 10 }}>{msg}</div>}
        {err && <div className="text-error" style={{ fontSize: 12, marginBottom: 10 }}>{err}</div>}

        {tab === 'profile' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="font-semi" style={{ marginBottom: 16 }}>个人资料</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div className="avatar accent" style={{ width: 64, height: 64, fontSize: 24 }}>{(user.display_name || '?').charAt(0)}</div>
              <div>
                <div className="font-semi" style={{ fontSize: 16 }}>{user.display_name}</div>
                <div className="text-xs">{user.username} · {user.email || '—'}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div><div className="text-muted text-xs">姓名</div><b>{user.display_name}</b></div>
              <div><div className="text-muted text-xs">用户名</div><b>{user.username}</b></div>
              <div><div className="text-muted text-xs">邮箱</div>{user.email || '—'}</div>
              <div><div className="text-muted text-xs">部门</div>{user.dept_id || '—'}</div>
              <div><div className="text-muted text-xs">角色</div>{(user.roles || []).join(', ')}</div>
              <div><div className="text-muted text-xs">用户 ID</div><span className="text-xs">{user.id}</span></div>
            </div>
            {typeof navigate === 'function' && (
              <button type="button" className="btn-default" style={{ marginTop: 14 }} onClick={() => navigate('analytics')}>
                查看个人数据分析
              </button>
            )}
          </div>
        )}

        {tab === 'security' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="font-semi" style={{ marginBottom: 14 }}>安全设置</div>
            <div className="text-xs" style={{ marginBottom: 12 }}>修改密码、启用 MFA、退出登录</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
              <input type="password" placeholder="原密码" value={passwords.old} onChange={(e) => setPasswords({ ...passwords, old: e.target.value })} style={{ width: '100%' }} />
              <input type="password" placeholder="新密码" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} style={{ width: '100%' }} />
              <input type="password" placeholder="确认新密码" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} style={{ width: '100%' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn-primary" onClick={changePassword}>修改密码</button>
                <button type="button" className="btn-default" onClick={() => setMsg('MFA 暂未接入 TOTP 服务')}>启用 MFA (TOTP)</button>
              </div>
              <button type="button" className="btn-danger" onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <Icons.logout size={14} /> 退出登录
              </button>
            </div>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="font-semi" style={{ marginBottom: 14 }}>外观</div>
            <div className="text-xs" style={{ marginBottom: 12 }}>主题与品牌色（只影响本机显示）</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              {[['dark', '深色'], ['light', '浅色']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTheme(k)} className="card" style={{
                  cursor: 'pointer', width: 120, textAlign: 'center',
                  border: theme === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: k === 'dark' ? '#0c0c0c' : '#f7f7f7', color: k === 'dark' ? '#e8e8e8' : '#171717',
                }}>
                  <div style={{ height: 36, marginBottom: 8, borderRadius: 4, background: k === 'dark' ? '#141414' : '#fff', border: '1px solid ' + (k === 'dark' ? '#2a2a2a' : '#e2e2e2') }} />
                  {l}
                </button>
              ))}
            </div>
            <div className="text-xs" style={{ marginBottom: 8 }}>品牌色</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {['#5b5fc7', '#141413', '#3d8b6e'].map((c) => (
                <button key={c} type="button" onClick={() => setBrandColor(c)} style={{ width: 28, height: 28, borderRadius: 2, background: c, border: brandColor === c ? '2px solid #fff' : '2px solid transparent', boxShadow: brandColor === c ? '0 0 0 2px ' + c : 'none' }} />
              ))}
              <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} style={{ width: 40, height: 28, padding: 0, border: 'none', background: 'none' }} />
              <span className="text-xs">{brandColor}</span>
            </div>
            <div className="text-xs" style={{ margin: '16px 0 8px' }}>界面棱角</div>
            <input
              type="range"
              min="0"
              max="14"
              step="1"
              defaultValue={6}
              onChange={(e) => {
                const v = Number(e.target.value);
                document.documentElement.style.setProperty('--radius', `${v}px`);
                document.documentElement.style.setProperty('--radius-sm', `${Math.max(0, Math.floor(v / 2))}px`);
              }}
            />
            <div className="text-xs text-muted" style={{ marginTop: 6 }}>向左更利，向右更圆</div>
          </div>
        )}

        {tab === 'mail' && (
          <div className="card" style={{ maxWidth: 560 }}>
            <div className="font-semi" style={{ marginBottom: 8 }}>我的邮箱 MCP</div>
            <div className="text-xs" style={{ marginBottom: 12, lineHeight: 1.6 }}>
              填写你自己的邮箱账号，或 MCP 地址 / Token。QQ / 163 请用授权码。保存后邮箱页与 AI「写信」共用。
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
              {['email', 'imapHost', 'smtpHost', 'username', 'password', 'mcpUrl', 'mcpToken', 'mcpCommand'].map((k) => (
                <input
                  key={k}
                  type={k === 'password' || k === 'mcpToken' ? 'password' : 'text'}
                  placeholder={
                    k === 'mcpUrl' ? 'MCP 地址 http://127.0.0.1:3333/mcp'
                      : k === 'mcpToken' ? 'MCP Token'
                        : k === 'mcpCommand' ? 'MCP 启动命令（可选）'
                          : k
                  }
                  value={mailForm[k] || ''}
                  onChange={(e) => setMailForm({ ...mailForm, [k]: e.target.value })}
                  style={{ width: '100%' }}
                />
              ))}
              <div className="text-xs" style={{ color: mailCfg.status === 'connected' ? 'var(--success)' : 'var(--text-muted)' }}>
                状态：{mailCfg.status === 'connected' ? '已连接' : (mailCfg.status || '未配置')}
                {mailCfg.hasMcpToken ? ' · 已保存 MCP Token' : ''}
              </div>
              <button type="button" className="btn-primary" onClick={saveMail} style={{ alignSelf: 'flex-start' }}>保存</button>
            </div>
          </div>
        )}

        {tab === 'ai' && (
          <div style={{ maxWidth: 720 }}>
            <div className="font-semi" style={{ marginBottom: 8 }}>国产大模型 API</div>
            <div className="text-xs" style={{ marginBottom: 14 }}>
              填写对应厂商的 API Key 即可启用千问办公同级能力：对话、AI 文档（摘要/润色）、图谱节点整理、会议听记。
              未填写时仍可用关键词规则（提醒、发消息）。参考
              <a href="https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope" target="_blank" rel="noreferrer">千问兼容接口</a>
              、<a href="https://api-docs.deepseek.com/" target="_blank" rel="noreferrer">DeepSeek</a>。
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {providers.map((p) => (
                <div key={p.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div className="font-semi">{p.name} {p.isDefault ? '· 默认' : ''}</div>
                    <div className="text-xs" style={{ marginTop: 2 }}>模型：{p.model || '—'} · {p.hasKey ? '已配置' : '未配置 Key'} · {p.enabled ? '已启用' : '未启用'}</div>
                    <div className="text-xs text-muted" style={{ marginTop: 2 }}>{p.baseUrl}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn-default" style={{ fontSize: 12 }} onClick={() => openEdit(p)}>配置</button>
                    {!p.isDefault && p.enabled && (
                      <button type="button" className="btn-primary" style={{ fontSize: 12 }} onClick={() => setDefault(p.id)}>设为默认</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {editId && (
              <div className="card" style={{ marginTop: 16 }}>
                <div className="font-semi" style={{ marginBottom: 10 }}>编辑 · {editId}</div>
                <input placeholder="API Key（留空保持原值）" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
                <input placeholder="Base URL" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
                <input placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
                  <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> 启用
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-primary" onClick={saveProvider}>保存</button>
                  <button type="button" className="btn-default" onClick={() => setEditId(null)}>取消</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'about' && (
          <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ color: 'var(--accent)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}><Icons.nexus size={32} /></div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em' }}>Nexus</div>
            <div className="text-xs" style={{ marginTop: 6 }}>数字中枢 · v0.1.0</div>
            <div className="text-xs" style={{ marginTop: 12 }}>
              对标 <a href="https://www.dingtalk.com/" target="_blank" rel="noreferrer">钉钉</a>
              {' / '}WhatsApp{' / '}
              <a href="https://www.huaweicloud.com/product/welink.html" target="_blank" rel="noreferrer">华为 WeLink</a>
              {' / '}<a href="https://enablement.microsoft.com/zh-cn/viva/engage/" target="_blank" rel="noreferrer">Viva Engage</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
