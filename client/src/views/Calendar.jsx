import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';

function eventStart(e) {
  const t = e.instance_start || e.start_time || e.start;
  if (!t) return null;
  const d = new Date(typeof t === 'number' ? t : t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function Calendar({ user }) {
  const [view, setView] = useState('month');
  const [events, setEvents] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', start_time: '', end_time: '', description: '' });

  const load = async () => {
    const y = currentDate.getFullYear(), m = currentDate.getMonth();
    const start = new Date(y, m, 1).toISOString();
    const end = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
    try {
      const d = await api('/calendar/events?from=' + encodeURIComponent(start) + '&to=' + encodeURIComponent(end));
      setEvents(Array.isArray(d) ? d : (d.items || d.events || []));
    } catch { setEvents([]); }
  };

  useEffect(() => { load(); }, [currentDate]);

  const createEvent = async () => {
    const start = Date.parse(form.start_time);
    const end = Date.parse(form.end_time);
    await api('/calendar/events', {
      method: 'POST',
      body: JSON.stringify({
        title: form.title,
        desc: form.description,
        start_time: Number.isFinite(start) ? start : Date.now(),
        end_time: Number.isFinite(end) ? end : Date.now() + 3600000,
      }),
    });
    setShowCreate(false); setForm({ title: '', start_time: '', end_time: '', description: '' }); load();
  };

  const y = currentDate.getFullYear(), m = currentDate.getMonth();
  const days = [];
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - currentDate.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const eventsOn = (date) => events.filter((e) => {
    const s = eventStart(e);
    return s && s.getFullYear() === date.getFullYear() && s.getMonth() === date.getMonth() && s.getDate() === date.getDate();
  });

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn-default" onClick={() => setCurrentDate(new Date(y, m - 1, 1))}>‹</button>
          <span style={{ fontSize: 18, fontWeight: 600, minWidth: 120, textAlign: 'center' }}>{y}年{m + 1}月</span>
          <button type="button" className="btn-default" onClick={() => setCurrentDate(new Date(y, m + 1, 1))}>›</button>
          <button type="button" className="btn-default" onClick={() => setCurrentDate(new Date())}>今天</button>
          <button type="button" className={view === 'month' ? 'btn-primary' : 'btn-default'} onClick={() => setView('month')}>月</button>
          <button type="button" className={view === 'week' ? 'btn-primary' : 'btn-default'} onClick={() => setView('week')}>周</button>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>+ 新建日程</button>
      </div>
      {events.length === 0 && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="font-semi">这个月还没有日程</div>
            <div className="text-xs">点右上角新建，或让 AI 说「安排明天下午周会」。</div>
          </div>
          <button type="button" className="btn-default" onClick={() => setShowCreate(true)}>今天新建</button>
        </div>
      )}
      {view === 'month' && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
            {['日', '一', '二', '三', '四', '五', '六'].map((d) => <div key={d} style={{ padding: 8, textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)' }}>{d}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {days.map((d, i) => (
              <div key={i} style={{ minHeight: 80, borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', padding: 4 }}>
                {d && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: d === new Date().getDate() && m === new Date().getMonth() ? 700 : 400, color: d === new Date().getDate() && m === new Date().getMonth() ? 'var(--accent)' : 'var(--text)' }}>{d}</div>
                    {eventsOn(new Date(y, m, d)).map((e, j) => (
                      <div key={e.id || j} style={{ fontSize: 11, background: e.color || 'var(--accent)', color: '#fff', padding: '2px 4px', borderRadius: 3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {view === 'week' && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {weekDays.map((d) => (
              <div key={d.toISOString()} style={{ minHeight: 220, borderRight: '1px solid var(--border-subtle)', padding: 10 }}>
                <div className="font-semi" style={{ marginBottom: 8 }}>{['日', '一', '二', '三', '四', '五', '六'][d.getDay()]} {d.getDate()}</div>
                {eventsOn(d).map((e) => (
                  <div key={e.id} className="card" style={{ padding: 8, marginBottom: 6 }}>
                    <div className="font-med">{e.title}</div>
                    <div className="text-xs">{eventStart(e)?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建日程">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <input type="datetime-local" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          <textarea placeholder="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button type="button" className="btn-primary" onClick={createEvent}>创建</button>
        </div>
      </Modal>
    </div>
  );
}
