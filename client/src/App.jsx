import React, { useState, useEffect, useCallback } from 'react';
import { api, clearTokens, getToken } from './api.js';
import Login from './views/Login.jsx';
import Landing from './views/Landing.jsx';
import MainLayout from './views/MainLayout.jsx';

/** 解析公开路由：官网首页 / 登录 / 应用内模块 */
function publicRoute(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '').split(/[?#]/)[0].trim().replace(/\/+$/, '');
  if (raw === 'login') return 'login';
  if (raw === 'home' || raw === 'landing') return 'home';
  if (!raw) return 'root';
  return 'app';
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(() => publicRoute() === 'login');
  const [, setHashTick] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('nexus_theme') || 'light');
  }, []);

  useEffect(() => {
    const onHash = () => {
      const r = publicRoute();
      if (r === 'login') setShowLogin(true);
      if (r === 'home' || r === 'root') setShowLogin(false);
      setHashTick((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadUser = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try {
      const u = await api('/auth/me');
      setUser(u);
    } catch {
      clearTokens();
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  // 未登录访问根路径时落到官网首页 hash，便于分享与刷新
  useEffect(() => {
    if (loading) return;
    if (!user && publicRoute() === 'root') {
      window.location.hash = '#/home';
    }
  }, [loading, user]);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setShowLogin(true);
      if (!/^#\/?login/.test(window.location.hash)) window.location.hash = '#/login';
    };
    window.addEventListener('nexus:logout', onLogout);
    return () => window.removeEventListener('nexus:logout', onLogout);
  }, []);

  const handleLogin = (userInfo) => {
    setUser(userInfo);
    setShowLogin(false);
    window.location.hash = '#/workbench';
  };

  const handleLogout = () => {
    clearTokens();
    setUser(null);
    setShowLogin(false);
    window.location.hash = '#/home';
  };

  const route = publicRoute();
  const showMarketingHome = route === 'home' || (route === 'root' && !user);

  if (loading) {
    return (
      <div className="scroll-y" style={{ height: '100vh', padding: 20 }}>
        <div className="skeleton" style={{ height: 48, marginBottom: 14, borderRadius: 10 }} />
        <div className="skeleton-grid" style={{ marginBottom: 14 }}>
          <div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" />
        </div>
        <div className="skeleton" style={{ height: 180, borderRadius: 10 }} />
      </div>
    );
  }

  // 官网首页：未登录默认；已登录也可通过 #/home 或侧栏 Logo 打开
  if (showMarketingHome && !(showLogin && !user)) {
    return (
      <Landing
        signedIn={!!user}
        onEnter={() => {
          if (user) {
            window.location.hash = '#/workbench';
            return;
          }
          setShowLogin(true);
          window.location.hash = '#/login';
        }}
      />
    );
  }

  if (!user) {
    if (showLogin || route === 'login') {
      return (
        <Login
          onLogin={handleLogin}
          onBack={() => {
            setShowLogin(false);
            window.location.hash = '#/home';
          }}
        />
      );
    }
    return (
      <Landing
        onEnter={() => {
          setShowLogin(true);
          window.location.hash = '#/login';
        }}
      />
    );
  }

  return <MainLayout user={user} onLogout={handleLogout} onUserUpdate={setUser} />;
}
