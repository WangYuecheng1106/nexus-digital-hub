import React, { useState, useEffect, useCallback } from 'react';
import { api, clearTokens, getToken } from './api.js';
import Login from './views/Login.jsx';
import MainLayout from './views/MainLayout.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('nexus_theme') || 'dark');
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

  const handleLogin = (userInfo) => {
    setUser(userInfo);
    window.location.hash = '#/workbench';
  };

  const handleLogout = () => {
    clearTokens();
    setUser(null);
    window.location.hash = '#/login';
  };

  if (loading) return <div className="empty" style={{ height: '100vh' }}>加载中…</div>;
  if (!user) return <Login onLogin={handleLogin} />;
  return <MainLayout user={user} onLogout={handleLogout} onUserUpdate={setUser} />;
}
