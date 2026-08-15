import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Icons } from '../icons.jsx';
import CommandPalette from '../components/CommandPalette.jsx';

import Workbench from './Workbench.jsx';

const Mail = lazy(() => import('./Mail.jsx'));
const IM = lazy(() => import('./IM.jsx'));
const Meeting = lazy(() => import('./Meeting.jsx'));
const KnowledgeGraph = lazy(() => import('./KnowledgeGraph.jsx'));
const Document = lazy(() => import('./Document.jsx'));
const Workflow = lazy(() => import('./Workflow.jsx'));
const Calendar = lazy(() => import('./Calendar.jsx'));
const Drive = lazy(() => import('./Drive.jsx'));
const Project = lazy(() => import('./Project.jsx'));
const Attendance = lazy(() => import('./Attendance.jsx'));
const Contacts = lazy(() => import('./Contacts.jsx'));
const Forum = lazy(() => import('./Forum.jsx'));
const Analytics = lazy(() => import('./Analytics.jsx'));
const AI = lazy(() => import('./AI.jsx'));
const Settings = lazy(() => import('./Settings.jsx'));

/** 统一员工工作台：只有这一套壳，没有管理员/员工切换 */
const NAV = [
  { key: 'workbench', label: '工作台', Icon: Icons.home },
  { key: 'im', label: '消息', Icon: Icons.chat, badge: true },
  { key: 'mail', label: '邮箱', Icon: Icons.mail },
  { key: 'meeting', label: '会议', Icon: Icons.video },
  { key: 'contacts', label: '通讯录', Icon: Icons.user },
  { key: 'document', label: '文档', Icon: Icons.doc },
  { key: 'drive', label: '云盘', Icon: Icons.folder },
  { key: 'calendar', label: '日程', Icon: Icons.calendar },
  { key: 'workflow', label: '审批', Icon: Icons.check, badge: true },
  { key: 'project', label: '项目', Icon: Icons.board },
  { key: 'attendance', label: '考勤', Icon: Icons.clock },
  { key: 'forum', label: '论坛', Icon: Icons.globe },
  { key: 'knowledge', label: '关系图谱', Icon: Icons.graph },
  { key: 'analytics', label: '分析', Icon: Icons.chart },
  { key: 'ai', label: 'AI', Icon: Icons.spark },
];

const MODULE_KEYS = new Set([...NAV.map((n) => n.key), 'settings']);

/** 只认模块路由；落地页锚点 / #login 等返回 null，绝不误判成工作台 */
function parseModuleHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '').split(/[?#]/)[0].trim().replace(/\/+$/, '');
  if (!raw) return 'workbench';
  if (!MODULE_KEYS.has(raw)) return null;
  return raw;
}

function displayName(user) {
  const name = user?.display_name || user?.username || '用户';
  // 演示账号后端仍叫「系统管理员」，界面按统一员工端展示
  if (name === '系统管理员' || user?.username === 'admin') return '演示用户';
  return name;
}

export default function MainLayout({ user, onLogout, onUserUpdate }) {
  const [active, setActive] = useState(() => parseModuleHash(window.location.hash) || 'workbench');
  const [theme, setTheme] = useState(localStorage.getItem('nexus_theme') || 'light');
  const [brandColor, setBrandColor] = useState(localStorage.getItem('nexus_brand') || '#5b5fc7');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nexus_theme', theme);
    document.documentElement.style.setProperty('--accent', brandColor);
    localStorage.setItem('nexus_brand', brandColor);
  }, [theme, brandColor]);

  useEffect(() => {
    const handler = () => {
      const key = parseModuleHash(window.location.hash);
      // 未知 hash（#features / #login）不要把当前模块踢回工作台
      if (key) {
        setActive(key);
        setLoadError('');
      } else if (!window.location.hash || window.location.hash === '#') {
        setActive('workbench');
      }
    };
    handler();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = (key) => {
    if (!MODULE_KEYS.has(key)) return;
    const next = `#/${key}`;
    if (window.location.hash !== next) window.location.hash = next;
    else setActive(key);
    setActive(key);
    setLoadError('');
  };

  useEffect(() => {
    window.__nexus = {
      user,
      activeModule: active,
      getUnreadCount: () => unreadCount,
      getPendingApprovals: () => pendingApprovals,
      navigate,
    };
  }, [user, active, unreadCount, pendingApprovals]);

  const current = NAV.find((n) => n.key === active) || (active === 'settings' ? { key: 'settings', label: '设置' } : NAV[0]);
  const name = displayName(user);

  const renderView = () => {
    const props = { user, onUserUpdate, navigate };
    switch (active) {
      case 'workbench': return <Workbench {...props} />;
      case 'im': return <IM {...props} setUnreadCount={setUnreadCount} />;
      case 'mail': return <Mail {...props} />;
      case 'meeting': return <Meeting {...props} />;
      case 'contacts': return <Contacts {...props} />;
      case 'document': return <Document {...props} />;
      case 'drive': return <Drive {...props} />;
      case 'calendar': return <Calendar {...props} />;
      case 'workflow': return <Workflow {...props} setPendingApprovals={setPendingApprovals} />;
      case 'project': return <Project {...props} />;
      case 'attendance': return <Attendance {...props} />;
      case 'forum': return <Forum {...props} />;
      case 'knowledge': return <KnowledgeGraph {...props} />;
      case 'analytics': return <Analytics {...props} />;
      case 'ai': return <AI {...props} />;
      case 'settings': return <Settings {...props} onLogout={onLogout} theme={theme} setTheme={setTheme} brandColor={brandColor} setBrandColor={setBrandColor} />;
      default: return <Workbench {...props} />;
    }
  };

  return (
    <div className="nx-shell">
      <nav className="nx-rail" aria-label="主导航">
        <button
          type="button"
          className="nx-rail-brand"
          title="官网首页"
          onClick={() => { window.location.hash = '#/home'; }}
          style={{ cursor: 'pointer', border: 0, background: 'transparent', color: 'inherit' }}
        >
          <Icons.nexus size={20} />
        </button>
        <div className="nx-rail-scroll">
          {NAV.map(({ key, label, Icon, badge }) => (
            <button
              key={key}
              type="button"
              className={`nx-rail-item${active === key ? ' active' : ''}`}
              title={label}
              aria-current={active === key ? 'page' : undefined}
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {badge && key === 'im' && unreadCount > 0 && <span className="badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              {badge && key === 'workflow' && pendingApprovals > 0 && <span className="badge">{pendingApprovals}</span>}
            </button>
          ))}
        </div>
        <div className="nx-rail-foot">
          <button type="button" className={`nx-rail-item${active === 'settings' ? ' active' : ''}`} title="设置" onClick={() => navigate('settings')}>
            <Icons.settings size={18} />
            <span>设置</span>
          </button>
        </div>
      </nav>

      <div className="nx-main">
        <header className="nx-topbar">
          <div className="font-semi" style={{ fontSize: 13 }}>{current.label}</div>
          <button
            type="button"
            className="cmdk-trigger"
            onClick={() => window.dispatchEvent(new Event('nexus:cmdk'))}
            aria-label="打开命令面板 (Ctrl+K)"
          >
            <Icons.search size={14} />
            <span>搜索或快捷操作</span>
            <kbd className="cmdk-kbd">Ctrl K</kbd>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="text-xs">{name}</span>
            <div className="avatar sm accent">{name.charAt(0)}</div>
          </div>
        </header>
        <div className="nx-content" key={active}>
          <Suspense fallback={<div className="empty" style={{ height: '100%' }}><div className="skeleton-grid" style={{ width: '80%', maxWidth: 720 }}><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></div></div>}>
            {loadError ? (
              <div className="empty" style={{ height: '100%' }}>
                <div className="font-semi">模块加载失败</div>
                <div className="text-xs">{loadError}</div>
                <button type="button" className="btn-default" onClick={() => { setLoadError(''); navigate('workbench'); }}>回工作台</button>
              </div>
            ) : renderView()}
          </Suspense>
        </div>
      </div>
      <CommandPalette navigate={navigate} />
    </div>
  );
}
