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
  { key: 'project', label: '项目', Icon: Icons.board },
  { key: 'attendance', label: '考勤', Icon: Icons.clock },
  { key: 'contacts', label: '通讯录', Icon: Icons.user },
  { key: 'forum', label: '论坛', Icon: Icons.globe },
  { key: 'knowledge', label: '图谱', Icon: Icons.graph },
  { key: 'analytics', label: '分析', Icon: Icons.chart },
  { key: 'ai', label: 'AI', Icon: Icons.spark },
];

function greet() {
  const h = new Date().getHours();
  if (h < 12) return '上午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function friendlyName(user) {
  const name = user?.display_name || user?.username || '同事';
  if (name === '系统管理员' || user?.username === 'admin') return '演示用户';
  return name;
}

function humanTitle(t) {
  const raw = String(t.title || t.flow_name || '').trim();
  if (!raw) return '待处理事项';
  if (/^待办消息[-_]?\d+$/.test(raw)) return '一条消息待跟进';
  return raw;
}

function goSource(t, navigate) {
  const src = String(t.source || t.label || '');
  if (/im|消息/.test(src)) navigate('im');
  else if (/calendar|日程|ai/.test(src) && /日程/.test(t.title || '')) navigate('calendar');
  else if (/calendar|日程/.test(src)) navigate('calendar');
  else if (/project|项目/.test(src)) navigate('project');
  else if (/ai/.test(src)) navigate('ai');
  else navigate('workflow');
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
    api(`/calendar/events?from=${day}T00:00:00.000Z&to=${day}T23:59:59.999Z`)
      .then((d) => setEvents(Array.isArray(d) ? d : (d.items || d.events || [])))
      .catch(() => setEvents([]));
  }, []);

  const punch = async () => {
    try {
      await api('/attendance/punch', { method: 'POST', body: JSON.stringify({ method: 'gps', location: '办公区' }) });
      setPunched(true);
    } catch (e) {
      alert(e.message || '打卡失败');
    }
  };

  const live = (services || []).filter((s) => s.name !== 'user' && s.name !== 'auth');
  const up = live.filter((s) => s.status === 'ok').length;

  return (
    <div className="scroll-y workbench-page" style={{ height: '100%', padding: 20 }}>
      <div className="card" style={{
        marginBottom: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em', marginBottom: 4 }}>
            {greet()}，{friendlyName(user)}
          </div>
          <div className="text-xs">
            {now.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
        {live.length > 0 && <div className="tag">{up}/{live.length} 服务在线</div>}
      </div>

      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="label">待办事项</div>
          <div className="value" style={{ color: todos.length ? 'var(--warning)' : 'var(--text)' }}>{todos.length}</div>
          <div className="text-xs" style={{ marginTop: 6 }}>
            {todos.length === 0 ? '暂无待办' : todos.slice(0, 2).map(humanTitle).join(' · ')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, marginTop: 8 }}>
            {todos.slice(0, 3).map((t) => (
              <button key={t.id} type="button" className="btn-ghost" style={{ padding: 0, textAlign: 'left' }} onClick={() => goSource(t, navigate)}>
                {humanTitle(t)}
              </button>
            ))}
            {todos.length === 0 && <button type="button" className="btn-ghost" style={{ padding: 0 }} onClick={() => navigate('workflow')}>去处理审批</button>}
          </div>
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
