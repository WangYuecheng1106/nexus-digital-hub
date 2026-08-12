import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

// 员工端通讯录：组织树 + WhatsApp 式加好友 / 发消息
export default function Contacts({ user, navigate }) {
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [friendMap, setFriendMap] = useState({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api('/contacts/departments').then((d) => {
      const list = Array.isArray(d) ? d : (d.tree || d.items || []);
      setDepartments(flattenDepts(list));
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    let url = '/contacts/employees?';
    if (selectedDept) url += 'dept=' + selectedDept + '&';
    if (search) url += 'q=' + encodeURIComponent(search);
    api(url).then((d) => setEmployees(Array.isArray(d) ? d : (d.items || []))).catch(() => setEmployees([]));
  }, [selectedDept, search]);

  const checkFriend = async (uid) => {
    if (!uid || friendMap[uid] !== undefined) return;
    try {
      const r = await api(`/im/friends/check/${uid}`);
      setFriendMap((m) => ({ ...m, [uid]: !!r.friends }));
    } catch {
      setFriendMap((m) => ({ ...m, [uid]: false }));
    }
  };

  useEffect(() => {
    if (selected) checkFriend(selected.user_id || selected.id);
  }, [selected]);

  const addFriend = async (emp) => {
    const toUserId = emp.user_id || emp.id;
    try {
      await api('/im/friends/request', {
        method: 'POST',
        body: JSON.stringify({ toUserId, message: `你好，我是${user.display_name || user.username}` }),
      });
      setMsg('好友申请已发送');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setError(e.message || '申请失败');
    }
  };

  const startChat = async (emp) => {
    const memberId = emp.user_id || emp.id;
    try {
      await api('/im/conversations', {
        method: 'POST',
        body: JSON.stringify({
          type: 'single',
          name: emp.name || emp.display_name || '会话',
          memberIds: [memberId],
        }),
      });
      navigate?.('im');
    } catch (e) {
      setError(e.message);
    }
  };

  const renderTree = (parentId = null, level = 0) =>
    departments.filter((d) => (d.parent_id ?? null) === parentId).map((d) => (
      <div key={d.id}>
        <button
          type="button"
          onClick={() => setSelectedDept(d.id)}
          className={`list-row${selectedDept === d.id ? ' active' : ''}`}
          style={{ width: 'calc(100% - 12px)', paddingLeft: 10 + level * 14, border: 'none', background: selectedDept === d.id ? 'var(--accent-soft)' : 'transparent' }}
        >
          <Icons.folder size={14} />
          <span style={{ fontSize: 13 }}>{d.name}</span>
          <span className="text-xs">({d.employee_count || 0})</span>
        </button>
        {renderTree(d.id, level + 1)}
      </div>
    ));

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside className="nx-side" style={{ width: 240 }}>
        <div className="nx-side-head">组织架构</div>
        <div style={{ padding: 10 }}>
          <input placeholder="搜索人员…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <button type="button" className={`list-row${!selectedDept ? ' active' : ''}`} style={{ width: '100%', border: 'none' }} onClick={() => setSelectedDept(null)}>全部</button>
          {renderTree(null)}
          {renderTree(undefined)}
        </div>
      </aside>
      <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
        {error && <div className="text-error" style={{ marginBottom: 8, fontSize: 12 }}>{error}</div>}
        {msg && <div className="text-xs" style={{ marginBottom: 8, color: 'var(--success)' }}>{msg}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {employees.map((e) => (
            <button key={e.id} type="button" className="card" style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => setSelected(e)}>
              <div className="avatar accent" style={{ margin: '0 auto 8px' }}>{(e.name || '?').charAt(0)}</div>
              <div className="font-semi">{e.name}</div>
              <div className="text-xs">{e.position}</div>
            </button>
          ))}
        </div>
        {employees.length === 0 && <div className="empty"><Icons.user size={28} /><div>暂无人员</div></div>}
      </div>
      {selected && (
        <aside style={{ width: 280, borderLeft: '1px solid var(--border)', background: 'var(--bg-elevated)', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="font-semi">人员详情</span>
            <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>关闭</button>
          </div>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div className="avatar accent" style={{ width: 56, height: 56, fontSize: 20, margin: '0 auto 8px' }}>{selected.name?.charAt(0)}</div>
            <div style={{ fontSize: 16, fontWeight: 650 }}>{selected.name}</div>
            <div className="text-xs">{selected.position}</div>
          </div>
          <div style={{ display: 'grid', gap: 8, fontSize: 13, marginBottom: 16 }}>
            <div>{selected.email || '—'}</div>
            <div>{maskPhone(selected.phone)}</div>
            <div>部门 {selected.dept_name || selected.dept_id || '—'}</div>
            <div>入职 {selected.hire_date || '—'}</div>
            <div className="text-xs text-muted">ID {(selected.user_id || selected.id)}</div>
          </div>
          {(selected.user_id || selected.id) !== user.id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn-primary" onClick={() => startChat(selected)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icons.chat size={14} /> 发消息
              </button>
              {!friendMap[selected.user_id || selected.id] && (
                <button type="button" className="btn-default" onClick={() => addFriend(selected)}>加好友</button>
              )}
              {friendMap[selected.user_id || selected.id] && (
                <div className="text-xs" style={{ color: 'var(--success)', textAlign: 'center' }}>已是好友</div>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function flattenDepts(list, acc = []) {
  for (const d of list) {
    acc.push(d);
    if (d.children) flattenDepts(d.children, acc);
  }
  return acc;
}

function maskPhone(phone) {
  if (!phone) return '—';
  return String(phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}
