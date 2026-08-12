import React, { useState, useEffect } from 'react';
import { api, clearTokens } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Settings({ user, onLogout, theme, setTheme, brandColor, setBrandColor }) {
  const [tab, setTab] = useState('profile');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [passwords, setPasswords] = useState({ old: '', new: '', confirm: '' });
  const [mailCfg, setMailCfg] = useState({});
  const [mailForm, setMailForm] = useState({});

  useEffect(() => {
    if (tab === 'mail') {
      api('/integration/mail/config').then((c) => { setMailCfg(c); setMailForm(c); }).catch(() => {});
    }
  }, [tab]);

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
              <div><div className="text-muted text-xs">职位</div>{user.position || '—'}</div>
              <div><div className="text-muted text-xs">部门</div>{user.dept_id || '—'}</div>
              <div><div className="text-muted text-xs">用户 ID</div><span className="text-xs">{user.id}</span></div>
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="font-semi" style={{ marginBottom: 14 }}>安全设置</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
              <input type="password" placeholder="原密码" value={passwords.old} onChange={(e) => setPasswords({ ...passwords, old: e.target.value })} style={{ width: '100%' }} />
              <input type="password" placeholder="新密码" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} style={{ width: '100%' }} />
              <input type="password" placeholder="确认新密码" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} style={{ width: '100%' }} />
              <button type="button" className="btn-primary" onClick={changePassword} style={{ alignSelf: 'flex-start' }}>修改密码</button>
              <button type="button" className="btn-danger" onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <Icons.logout size={14} /> 退出登录
              </button>
            </div>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="font-semi" style={{ marginBottom: 14 }}>外观</div>
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
            <div className="text-xs" style={{ marginBottom: 8 }}>主题色</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {['#4d8cff', '#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1'].map((c) => (
                <button key={c} type="button" onClick={() => setBrandColor(c)} style={{ width: 28, height: 28, borderRadius: 14, background: c, border: brandColor === c ? '2px solid #fff' : '2px solid transparent', boxShadow: brandColor === c ? '0 0 0 2px ' + c : 'none' }} />
              ))}
            </div>
          </div>
        )}

        {tab === 'mail' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="font-semi" style={{ marginBottom: 8 }}>邮箱配置</div>
            <div className="text-xs" style={{ marginBottom: 12 }}>填写个人/企业邮箱 IMAP/SMTP（演示环境可用本地收件箱）</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400 }}>
              {['email', 'imapHost', 'smtpHost', 'username', 'password'].map((k) => (
                <input key={k} type={k === 'password' ? 'password' : 'text'} placeholder={k} value={mailForm[k] || ''} onChange={(e) => setMailForm({ ...mailForm, [k]: e.target.value })} style={{ width: '100%' }} />
              ))}
              <div className="text-xs">状态：{mailCfg.status === 'connected' ? '已连接' : (mailCfg.status || '未配置')}</div>
              <button type="button" className="btn-primary" onClick={saveMail} style={{ alignSelf: 'flex-start' }}>保存</button>
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ color: 'var(--accent)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}><Icons.nexus size={32} /></div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em' }}>Nexus</div>
            <div className="text-xs" style={{ marginTop: 6 }}>数字中枢 · 员工端 v0.2.0</div>
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
