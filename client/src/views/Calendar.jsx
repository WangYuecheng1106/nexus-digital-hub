import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function Calendar({ user }) {
  const [view, setView] = useState('month');
  const [events, setEvents] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', start_time: '', end_time: '', description: '' });

  const load = async () => {
    const y = currentDate.getFullYear(), m = currentDate.getMonth();
    const start = new Date(y, m, 1).toISOString().slice(0, 10);
    const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    try {
      // calendar 服务要求 from/to 参数
      const d = await api('/calendar/events?from=' + start + 'T00:00:00.000Z&to=' + end + 'T23:59:59.999Z');
      setEvents(Array.isArray(d) ? d : (d.items || d.events || []));
    } catch { setEvents([]); }
  };

  useEffect(() => { load(); }, [currentDate]);

  const createEvent = async () => {
    await api('/calendar/events', { method: 'POST', body: JSON.stringify(form) });
    setShowCreate(false); setForm({ title: '', start_time: '', end_time: '', description: '' }); load();
  };

  const days = [];
  const y = currentDate.getFullYear(), m = currentDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-default" onClick={() => setCurrentDate(new Date(y, m - 1, 1))}>‹</button>
          <span style={{ fontSize: 18, fontWeight: 600, minWidth: 120, textAlign: 'center' }}>{y}年{m + 1}月</span>
          <button className="btn-default" onClick={() => setCurrentDate(new Date(y, m + 1, 1))}>›</button>
          <button className="btn-default" onClick={() => setCurrentDate(new Date())}>今天</button>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ 新建日程</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border-light)' }}>
          {['日','一','二','三','四','五','六'].map((d) => <div key={d} style={{ padding: 8, textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {days.map((d, i) => (
            <div key={i} style={{ minHeight: 80, borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)', padding: 4 }}>
              {d && (
                <>
                  <div style={{ fontSize: 13, fontWeight: d === new Date().getDate() && m === new Date().getMonth() ? 700 : 400, color: d === new Date().getDate() && m === new Date().getMonth() ? 'var(--primary)' : 'var(--text)' }}>{d}</div>
                  {events.filter((e) => new Date(e.start_time).getDate() === d).map((e, j) => (
                    <div key={j} style={{ fontSize: 11, background: e.color || 'var(--primary)', color: '#fff', padding: '2px 4px', borderRadius: 3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">新建日程</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <input type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              <input type="datetime-local" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              <textarea placeholder="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <button className="btn-primary" onClick={createEvent}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
