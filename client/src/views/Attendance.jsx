import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Attendance({ user }) {
  const [records, setRecords] = useState([]);
  const [punched, setPunched] = useState(false);
  const [now, setNow] = useState(new Date());
  const [month] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = () => {
    api('/attendance/records?month=' + month)
      .then((d) => setRecords(Array.isArray(d) ? d : (d.items || [])))
      .catch((e) => { setRecords([]); setError(e.message || ''); });
  };

  useEffect(() => { load(); }, [month]);

  const punch = async () => {
    try {
      await api('/attendance/punch', { method: 'POST', body: JSON.stringify({ method: 'gps', location: '北京市朝阳区' }) });
      setPunched(true);
      load();
    } catch (e) { setError(e.message || '打卡失败'); }
  };

  const late = records.filter((r) => r.late).length;
  const early = records.filter((r) => r.early_leave || r.early).length;

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
      {error && <div className="text-error" style={{ marginBottom: 10, fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-xs" style={{ marginBottom: 6 }}>{now.toLocaleDateString('zh-CN', { weekday: 'long' })}</div>
          <div style={{ fontSize: 36, fontWeight: 650, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', marginBottom: 14 }}>
            {now.toLocaleTimeString('zh-CN')}
          </div>
          <button type="button" className="btn-primary" onClick={punch} disabled={punched} style={{ padding: '10px 28px' }}>
            {punched ? '已打卡' : '一键打卡'}
          </button>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 12 }}>本月统计 · {month}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><div style={{ fontSize: 22, fontWeight: 650 }}>{records.length}</div><div className="text-xs">打卡记录</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 650, color: 'var(--warning)' }}>{late}</div><div className="text-xs">迟到</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 650, color: 'var(--error)' }}>{early}</div><div className="text-xs">早退</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 650 }}>{user.display_name?.charAt(0)}</div><div className="text-xs">当前用户</div></div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="font-semi" style={{ marginBottom: 12 }}>打卡记录</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['时间', '类型', '方式', '状态'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={r.id || i}>
                <td style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>{new Date(r.punch_time || r.created_at).toLocaleString('zh-CN')}</td>
                <td style={{ padding: 8 }}>{({ check_in: '上班', check_out: '下班' })[r.type || r.punch_type] || r.type || '打卡'}</td>
                <td style={{ padding: 8 }}>{({ gps: '定位', wifi: 'Wi-Fi', face: '人脸', manual: '补卡' })[r.method] || r.method || '定位'}</td>
                <td style={{ padding: 8 }}>{r.late ? <span className="tag" style={{ background: 'rgba(230,184,77,.15)', color: 'var(--warning)' }}>迟到</span> : <span className="tag" style={{ background: 'rgba(62,207,142,.12)', color: 'var(--success)' }}>正常</span>}</td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={4} style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>暂无打卡记录</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
