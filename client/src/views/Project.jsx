import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

const COLUMNS = ['todo', 'doing', 'testing', 'done', 'closed'];
const COL_LABELS = { todo: '待办', doing: '进行中', testing: '待测试', done: '已完成', closed: '已关闭' };
const PRI = { urgent: '#ef5f5f', high: '#e6b84d', medium: '#3b82f6', low: '#6b6b6b' };

export default function Project({ user }) {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState('board');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', priority: 'medium', due_date: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    api('/project/projects').then((d) => setProjects(Array.isArray(d) ? d : (d.items || []))).catch((e) => setError(e.message));
  }, []);

  const openProject = async (p) => {
    setActive(p);
    try {
      const t = await api('/project/projects/' + p.id + '/tasks');
      setTasks(Array.isArray(t) ? t : []);
    } catch (e) { setError(e.message); setTasks([]); }
  };

  const createProject = async () => {
    try {
      const p = await api('/project/projects', {
        method: 'POST',
        body: JSON.stringify({ name: '演示项目', description: 'Nexus 示例', color: '#3b82f6' }),
      });
      setProjects((prev) => [p, ...prev]);
      openProject(p);
    } catch (e) { setError(e.message || '创建失败'); }
  };

  const createTask = async () => {
    try {
      await api('/project/projects/' + active.id + '/tasks', {
        method: 'POST',
        body: JSON.stringify({ ...form, assignee_id: user.id, board_column: 'todo' }),
      });
      setShowCreate(false);
      setForm({ title: '', priority: 'medium', due_date: '' });
      openProject(active);
    } catch (e) { setError(e.message || '创建任务失败'); }
  };

  const moveTask = async (taskId, column) => {
    try {
      await api('/project/tasks/' + taskId + '/move', { method: 'PUT', body: JSON.stringify({ column }) });
      openProject(active);
    } catch (e) { setError(e.message); }
  };

  if (!active) {
    return (
      <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <span className="font-semi" style={{ fontSize: 15 }}>项目管理</span>
          <button type="button" className="btn-primary" onClick={createProject}><Icons.plus size={14} /> 新建项目</button>
        </div>
        {error && <div className="text-error" style={{ marginBottom: 8, fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {projects.map((p) => (
            <button key={p.id} type="button" className="card" style={{ textAlign: 'left', cursor: 'pointer', borderLeft: `3px solid ${p.color || 'var(--accent)'}` }} onClick={() => openProject(p)}>
              <div className="font-semi">{p.name}</div>
              <div className="text-xs">{p.description}</div>
            </button>
          ))}
        </div>
        {projects.length === 0 && <div className="empty"><Icons.board size={28} /><div>暂无项目</div><button type="button" className="btn-default" onClick={createProject}>创建第一个项目</button></div>}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn-ghost" onClick={() => setActive(null)}><Icons.chevronL size={14} /> 返回</button>
          <span className="font-semi">{active.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['board', '看板'], ['list', '列表'], ['gantt', '甘特']].map(([k, l]) => (
            <button key={k} type="button" className={view === k ? 'btn-primary' : 'btn-default'} onClick={() => setView(k)}>{l}</button>
          ))}
          <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>+ 任务</button>
        </div>
      </div>
      {error && <div className="text-error" style={{ padding: '6px 16px', fontSize: 12 }}>{error}</div>}
      {view === 'board' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'auto', padding: 12, gap: 10 }}>
          {COLUMNS.map((col) => (
            <div key={col} style={{ flex: 1, minWidth: 200, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
              <div className="font-semi" style={{ marginBottom: 8, fontSize: 12 }}>{COL_LABELS[col]} ({tasks.filter((t) => (t.board_column || t.column) === col).length})</div>
              {tasks.filter((t) => (t.board_column || t.column) === col).map((t) => (
                <div key={t.id} className="card" style={{ marginBottom: 8, padding: 10 }}>
                  <div className="font-med" style={{ marginBottom: 6 }}>{t.title}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {COLUMNS.filter((c) => c !== col).slice(0, 2).map((c) => (
                      <button key={c} type="button" className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => moveTask(t.id, c)}>→{COL_LABELS[c]}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {view === 'list' && (
        <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['任务', '优先级', '截止', '状态'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>{t.title}</td>
                  <td style={{ padding: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: PRI[t.priority], display: 'inline-block', marginRight: 6 }} />{t.priority}</td>
                  <td style={{ padding: 8 }}>{t.due_date || '—'}</td>
                  <td style={{ padding: 8 }}><span className="tag">{COL_LABELS[t.board_column || t.column]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'gantt' && (
        <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
          {tasks.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 120, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              <div style={{ flex: 1, height: 16, background: 'var(--bg-panel)', borderRadius: 3, border: '1px solid var(--border)' }}>
                <div style={{ height: '100%', width: '55%', background: PRI[t.priority] || 'var(--accent)', borderRadius: 3, opacity: .85 }} />
              </div>
            </div>
          ))}
          {tasks.length === 0 && <div className="empty"><Icons.chart size={28} /><div>暂无任务</div></div>}
        </div>
      )}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">新建任务</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input placeholder="任务标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="urgent">紧急</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option>
              </select>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              <button type="button" className="btn-primary" onClick={createTask}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
