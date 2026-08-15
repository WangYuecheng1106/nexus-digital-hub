// Toast 通知系统：Context + Provider，无外部依赖
// 用法：const { showToast } = useToast(); showToast('已发送', 'success');
import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import { Icons } from '../icons.jsx';

const ToastCtx = createContext(null);
const MAX_TOASTS = 3;
const DEFAULT_DURATION = 3000;

const TYPE_ICON = {
  success: Icons.check,
  error: Icons.x,
  info: Icons.info,
  warning: Icons.warning,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const hideToast = useCallback((id) => {
    const timers = timersRef.current;
    if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, out: true } : t)));
    setTimeout(() => removeToast(id), 180);
  }, [removeToast]);

  const showToast = useCallback((message, type = 'info', duration = DEFAULT_DURATION) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, type }]);
    if (duration > 0) {
      const timer = setTimeout(() => hideToast(id), duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [hideToast]);

  return (
    <ToastCtx.Provider value={{ showToast, hideToast }}>
      {children}
      <div className="toast-container" role="region" aria-label="通知">
        {toasts.map((t) => {
          const Icon = TYPE_ICON[t.type] || Icons.info;
          return (
            <div key={t.id} className={`toast toast-${t.type}${t.out ? ' out' : ''}`} role="alert">
              <span className="toast-icon"><Icon size={15} /></span>
              <span className="toast-msg">{t.message}</span>
              <button type="button" className="toast-close" aria-label="关闭通知" onClick={() => hideToast(t.id)}>
                <Icons.x size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Provider 缺失时降级为 console，避免渲染崩溃
    return { showToast: (m) => console.warn('[toast]', m), hideToast: () => {} };
  }
  return ctx;
}
