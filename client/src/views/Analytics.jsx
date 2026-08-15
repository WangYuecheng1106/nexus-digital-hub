import React, { useState, useEffect } from 'react';
import { Icons } from '../icons.jsx';
import { api } from '../api.js';

const CHART = ['#5b5fc7', '#3d8b6e', '#b45309', '#57534e', '#1677ff', '#be185d'];
const LABEL = {
  im: '消息', meeting: '会议', workflow: '审批', document: '文档',
  attendance: '考勤', project: '项目', forum: '论坛', calendar: '日程',
  message_sent: '发消息', conversation_created: '建会话',
  meeting_created: '发起', meeting_joined: '入会', meeting_ended: '结束',
  task_assigned: '待办', task_approved: '通过', task_rejected: '拒绝',
  check_in: '上班', check_out: '下班', late: '迟到',
  doc_created: '新建文档', doc_edited: '编辑',
};

function zh(s) { return LABEL[s] || s; }

function Bars({ values = [], labels = [], color = CHART[0], height = 120, onPick }) {
  const max = Math.max(1, ...values.map(Number));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height, overflow: 'hidden' }}>
      {values.map((v, i) => (
        <button
          key={i}
          type="button"
          title={`${zh(labels[i]) || i}: ${v}`}
          onClick={() => onPick?.({ index: i, label: labels[i], value: v })}
          style={{
            flex: 1, height: `${Math.max(6, (Number(v) / max) * 100)}%`,
            background: color, borderRadius: '2px 2px 0 0', opacity: 0.88, minWidth: 0, padding: 0, border: 'none', cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}

export default function Analytics({ user = {}, navigate }) {
  const [range, setRange] = useState('7d');
  const [data, setData] = useState(null);
  const [drill, setDrill] = useState(null);
  const [err, setErr] = useState('');
  const days = range === '90d' ? 90 : range === '30d' ? 30 : 7;
  const name = user.display_name || user.username || '同事';

  useEffect(() => {
    api(`/analytics/overview?days=${days}`)
      .then(setData)
      .catch((e) => setErr(e.message || '报表加载失败'));
  }, [days]);

  const activity = data?.activity || { series: [{ data: [] }, { data: [] }], labels: [] };
  const meetings = data?.meetings || { series: [], labels: [] };
  const approvals = data?.approvals || { series: [], labels: [] };
  const attendance = data?.attendance || { series: [{ data: [] }, { data: [] }], labels: [] };
  const collab = data?.collaboration || { series: [], labels: [] };
  const eventSeries = activity.series?.[0]?.data || [];
  const userSeries = activity.series?.[1]?.data || [];
  const punchSeries = attendance.series?.[0]?.data || [];
  const lateSeries = attendance.series?.[1]?.data || [];
  const pieTotal = (approvals.series || []).reduce((s, n) => s + Number(n), 0) || 1;
  let pieAcc = 0;
  const pieStops = (approvals.series || []).map((n, i) => {
    const from = pieAcc;
    pieAcc += (Number(n) / pieTotal) * 100;
    return `${CHART[i % CHART.length]} ${from}% ${pieAcc}%`;
  });

  const personal = [
    ['本周事件', eventSeries.reduce((s, n) => s + Number(n), 0) || '—'],
    ['活跃用户', Math.max(0, ...userSeries.map(Number)) || '—'],
    ['协作量', (collab.series || []).reduce((s, n) => s + Number(n), 0) || '—'],
    ['迟到', lateSeries.reduce((s, n) => s + Number(n), 0) || 0],
  ];

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="font-semi" style={{ fontSize: 15 }}>个人 · 数据分析</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['7d', '近 7 天'], ['30d', '近 30 天'], ['90d', '近 90 天']].map(([k, l]) => (
            <button key={k} type="button" className={range === k ? 'btn-primary' : 'btn-default'} onClick={() => { setRange(k); setDrill(null); }}>{l}</button>
          ))}
          <button type="button" className="btn-default" style={{ fontSize: 12 }} onClick={async () => {
            try {
              const token = localStorage.getItem('nexus_token');
              const r = await fetch(`/api/analytics/export?days=${days}&format=csv`, { headers: { authorization: 'Bearer ' + token } });
              const blob = await r.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'analytics.csv'; a.click();
              URL.revokeObjectURL(url);
            } catch { setErr('导出失败'); }
          }}>导出 CSV</button>
        </div>
      </div>
      {err && <div className="text-error" style={{ fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="avatar accent" style={{ width: 64, height: 64, fontSize: 24 }}>{String(name).charAt(0)}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="font-semi" style={{ fontSize: 18, fontFamily: 'var(--font-display)' }}>{name}</div>
          <div className="text-xs" style={{ marginTop: 4 }}>
            {user.username || '—'} · {user.email || '未绑定邮箱'} · {(user.roles || []).join(', ') || '员工'}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>部门 {user.dept_id || '未分配'} · 点击柱状图可下钻</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(72px, 1fr))', gap: 10, flex: 1, minWidth: 280 }}>
          {personal.map(([label, value]) => (
            <div key={label} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 20, fontWeight: 650, color: 'var(--accent)', letterSpacing: '-0.03em' }}>{value}</div>
              <div className="text-xs">{label}</div>
            </div>
          ))}
        </div>
        {navigate && <button type="button" className="btn-default" onClick={() => navigate('settings')}>编辑资料</button>}
      </div>

      {drill && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div>
            <div className="font-semi">下钻 · {drill.chart}</div>
            <div className="text-xs" style={{ marginTop: 4 }}>{zh(drill.label)} = {drill.value}</div>
          </div>
          <button type="button" className="btn-ghost" onClick={() => setDrill(null)}>清除</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 10 }}>活跃趋势</div>
          <Bars values={eventSeries} labels={activity.labels} color={CHART[0]} onPick={(p) => setDrill({ chart: '活跃', ...p })} />
          <div className="text-xs text-muted" style={{ marginTop: 8 }}>事件数 · 共 {activity.labels?.length || 0} 天</div>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 10 }}>活跃用户</div>
          <Bars values={userSeries} labels={activity.labels} color={CHART[4]} onPick={(p) => setDrill({ chart: '用户', ...p })} />
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 12 }}>审批构成</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 84, height: 84, borderRadius: '50%', background: pieStops.length ? `conic-gradient(${pieStops.join(', ')})` : 'var(--border)' }} />
            <div className="text-xs" style={{ lineHeight: 1.8 }}>
              {(approvals.labels || []).map((l, i) => (
                <button key={l} type="button" className="btn-ghost" style={{ display: 'block', padding: 0, fontSize: 12 }} onClick={() => setDrill({ chart: '审批', label: l, value: approvals.series[i] })}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: CHART[i % CHART.length], marginRight: 6 }} />
                  {zh(l)} {approvals.series[i]}
                </button>
              ))}
              {!approvals.labels?.length && <div>暂无审批事件</div>}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 10 }}>会议动作</div>
          <Bars values={meetings.series || []} labels={meetings.labels} color={CHART[1]} onPick={(p) => setDrill({ chart: '会议', ...p })} />
          <div className="text-xs" style={{ marginTop: 8 }}>{(meetings.labels || []).map(zh).join(' / ') || '暂无'}</div>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 10 }}>考勤</div>
          <Bars values={punchSeries} labels={attendance.labels} color={CHART[1]} onPick={(p) => setDrill({ chart: '打卡', ...p })} />
          <div className="text-xs text-muted" style={{ marginTop: 8 }}>迟到合计 {lateSeries.reduce((s, n) => s + Number(n), 0)}</div>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 8 }}>协作漏斗</div>
          {(collab.labels || []).map((l, i) => {
            const max = Math.max(1, ...collab.series.map(Number));
            const w = Math.round((Number(collab.series[i]) / max) * 100);
            return (
              <button key={l} type="button" onClick={() => setDrill({ chart: '协作', label: l, value: collab.series[i] })} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 8, background: 'none', padding: 0 }}>
                <div className="text-xs" style={{ marginBottom: 3 }}>{zh(l)} · {collab.series[i]}</div>
                <div style={{ height: 8, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                  <div style={{ width: `${w}%`, height: '100%', background: CHART[i % CHART.length] }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="section-title">模块热度</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {(collab.labels?.length ? collab.labels.map((l, i) => [zh(l), collab.series[i], Icons.chart]) : [
            ['消息', '—', Icons.chat], ['会议', '—', Icons.video], ['文档', '—', Icons.doc], ['审批', '—', Icons.check],
          ]).map(([label, value, Icon]) => (
            <div key={label} style={{ textAlign: 'center', padding: 14, background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 6, display: 'flex', justifyContent: 'center' }}><Icon size={18} /></div>
              <div style={{ fontSize: 22, fontWeight: 650, color: 'var(--accent)', letterSpacing: '-0.03em' }}>{value}</div>
              <div className="text-xs">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
