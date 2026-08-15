import React, { useState } from 'react';
import { api, setTokens } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Login({ onLogin, onBack }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin@1234');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setTokens(data.accessToken, data.refreshToken);
      onLogin(data.user);
    } catch (err) {
      const msg = err?.message || '';
      if (err?.status === 0 || err?.error === 'network_error' || err?.error === 'backend_unavailable') {
        setError(msg || '后端未启动：请在项目根目录执行 npm run dev，然后打开 http://localhost:5173');
      } else if (msg.includes('锁定')) {
        setError(msg);
      } else {
        setError(msg || '用户名或密码错误');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <form onSubmit={submit} className="card" style={{ width: 380, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Icons.nexus size={22} stroke="var(--accent)" />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em' }}>Nexus</span>
        </div>
        <p className="text-xs" style={{ marginBottom: 22 }}>企业协作中枢 · 登录后进入统一工作台</p>

        <label className="text-xs" style={{ display: 'block', marginBottom: 6 }}>用户名</label>
        <input
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ width: '100%', marginBottom: 14 }}
          autoFocus
        />
        <label className="text-xs" style={{ display: 'block', marginBottom: 6 }}>密码</label>
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', marginBottom: 18 }}
        />

        {error && <div className="text-error" style={{ fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', padding: 10 }}>
          {loading ? '登录中…' : '登录'}
        </button>
        {onBack && (
          <button type="button" className="btn-ghost" style={{ width: '100%', marginTop: 10, fontSize: 12 }} onClick={onBack}>
            ← 返回介绍页
          </button>
        )}

        <div className="text-muted" style={{ marginTop: 16, fontSize: 11, lineHeight: 1.6 }}>
          演示账号 admin / Admin@1234 · liuyang / Nexus@1234
        </div>
      </form>
    </div>
  );
}
