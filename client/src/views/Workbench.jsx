import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

const APPS = [
  { key: 'im', label: '消息', Icon: Icons.chat },
  { key: 'mail', label: '邮箱', Icon: Icons.mail },
  { key: 'meeting', label: '会议', Icon: Icons.video },
  { key: 'document', label: '文档', Icon: Icons.doc },
  { key: 'workflow', label: '审批', Icon: Icons.check },
  { key: 'calendar', label: '日程', Icon: Icons.calendar },
  { key: 'drive', label: '云盘', Icon: Icons.folder },
  { key: 'attendance', label: '考勤', Icon: Icons.clock },
  { key: 'contacts', label: '通讯录', Icon: Icons.user },
  { key: 'forum', label: '论坛', Icon: Icons.globe },
  { key: 'ai', label: 'AI', Icon: Icons.spark },
];

function greet() {
  const h = new Date().getHours();
  if (h < 12) return '上午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export default function Workbench({ user, navigate }) {
  const [services, setServices] = useState([]);
  const [todos, setTodos] = useState([]);
  const [events, setEvents] = useState([]);
  const [punched, setPunched] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api('/services/health').then(setServices).catch(() => {});
    api('/portal/todos').then((d) => setTodos(Array.isArray(d) ? d : (d.items || []))).catch(() => setTodos([]));
    const day = new Date().toISOString().slice(0, 10);
    api(`/calendar/events?from=${day}T00:00:00.000Z&to=${day}T23:59:59.999Z`).then((d) => setEvents(Array.isArray(d) ? d : (d.items || d.events || []))).catch(() => setEvents([]));
  }, []);

  const punch = async () => {
    try {
      await api('/attendance/punch', { method: 'POST', body: JSON.stringify({ method: 'gps', location: '办公区' }) });
      setPunched(true);
    } catch (e) {
      alert(e.message || '打卡失败');
    }
  };

  const up = services.filter((s) => s.status === 'ok').length;

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
      <div className="card" style={{
        marginBottom: 14,
        background: 'linear-gradient(135deg, var(--accent-soft), transparent), var(--bg-elevated)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.03em', marginBottom: 4 }}>
            {greet()}，{user.display_name}
          </div>
          <div className="text-xs">
            {user.position || '员工'} · {now.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div className="tag">{up}/{services.length || '—'} 服务在线</div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="label">待办事项</div>
          <div className="value" style={{ color: todos.length ? 'var(--warning)' : 'var(--text)' }}>{todos.length}</div>
          <div className="text-xs" style={{ marginTop: 6 }}>
            {todos.length === 0 ? '暂无待办' : todos.slice(0, 2).map((t) => t.title || t.flow_name || '审批').join(' · ')}
          </div>
          <button type="button" className="btn-ghost" style={{ marginTop: 8, padding: 0 }} onClick={() => navigate('workflow')}>去处理</button>
        </div>
        <div className="stat-card">
          <div className="label">今日日程</div>
          <div className="value">{events.length}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}> 场</span></div>
          <div className="text-xs" style={{ marginTop: 6 }}>
            {events.length === 0 ? '今日暂无日程' : events.slice(0, 2).map((e) => e.title).join(' · ')}
          </div>
          <button type="button" className="btn-ghost" style={{ marginTop: 8, padding: 0 }} onClick={() => navigate('calendar')}>查看日程</button>
        </div>
        <div className="stat-card">
          <div className="label">考勤打卡</div>
          <div className="value" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <button type="button" className="btn-primary" style={{ marginTop: 10 }} onClick={punch} disabled={punched}>
            {punched ? '已打卡' : '一键打卡'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">应用中心</div>
        <div className="grid-apps">
          {APPS.map(({ key, label, Icon }) => (
            <button key={key} type="button" className="app-tile" onClick={() => navigate(key)}>
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
