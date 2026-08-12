import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Icons } from '../icons.jsx';

const Mail = lazy(() => import('./Mail.jsx'));
const Workbench = lazy(() => import('./Workbench.jsx'));
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

// 统一端：All-in-One 入口，所有用户均使用完整工作台（钉钉 / WeLink / Viva Engage 模式）
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
  { key: 'knowledge', label: '图谱', Icon: Icons.graph },
  { key: 'analytics', label: '分析', Icon: Icons.chart },
  { key: 'ai', label: 'AI', Icon: Icons.spark },
];

export default function MainLayout({ user, onLogout, onUserUpdate }) {
  const [active, setActive] = useState('workbench');
  const [theme, setTheme] = useState(localStorage.getItem('nexus_theme') || 'dark');
  const [brandColor, setBrandColor] = useState(localStorage.getItem('nexus_brand') || '#4d8cff');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nexus_theme', theme);
    document.documentElement.style.setProperty('--accent', brandColor);
    localStorage.setItem('nexus_brand', brandColor);
  }, [theme, brandColor]);

  useEffect(() => {
    const handler = () => setActive(window.location.hash.slice(2) || 'workbench');
    handler();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const navigate = (key) => {
    window.location.hash = `#/${key}`;
    setActive(key);
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

  const current = NAV.find((n) => n.key === active) || NAV[0];

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
        <div className="nx-rail-brand" title="Nexus">
          <Icons.nexus size={20} />
        </div>
        {NAV.map(({ key, label, Icon, badge }) => (
          <button
            key={key}
            type="button"
            className={`nx-rail-item${active === key ? ' active' : ''}`}
            title={label}
            onClick={() => navigate(key)}
          >
            <Icon size={18} />
            {badge && key === 'im' && unreadCount > 0 && <span className="badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            {badge && key === 'workflow' && pendingApprovals > 0 && <span className="badge">{pendingApprovals}</span>}
          </button>
        ))}
        <div className="nx-rail-spacer" />
        <button type="button" className={`nx-rail-item${active === 'settings' ? ' active' : ''}`} title="设置" onClick={() => navigate('settings')}>
          <Icons.settings size={18} />
        </button>
      </nav>

      <div className="nx-main">
        <header className="nx-topbar">
          <div className="font-semi" style={{ fontSize: 13 }}>{current.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="text-xs">{user.display_name} · {(user.roleNames || user.roles || []).join(' · ')}</span>
            <div className="avatar sm accent">{(user.display_name || '?').charAt(0)}</div>
          </div>
        </header>
        <div className="nx-content">
          <Suspense fallback={<div className="empty">加载中…</div>}>
            {renderView()}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
