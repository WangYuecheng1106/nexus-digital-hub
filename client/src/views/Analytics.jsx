import React, { useEffect } from 'react';
import { Icons } from '../icons.jsx';

const CHART = ['#3b82f6', '#3ecf8e', '#e6b84d', '#ef5f5f'];

export default function Analytics() {
  useEffect(() => {
    // 预置报表接口可能不存在 default dashboard；看板用本地演示数据保证可演示
  }, []);

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
      <div className="font-semi" style={{ fontSize: 15, marginBottom: 14 }}>数据分析</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 12 }}>日活跃用户趋势</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100 }}>
            {[40, 65, 50, 80, 70, 90, 85, 95, 88, 92, 78, 96].map((h, i) => (
              <div key={i} style={{ flex: 1, height: h + '%', background: CHART[0], borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
            ))}
          </div>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 12 }}>会议分布</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 84, height: 84, borderRadius: '50%', background: `conic-gradient(${CHART[1]} 0 60%, ${CHART[2]} 60% 80%, ${CHART[3]} 80% 100%)` }} />
            <div className="text-xs" style={{ lineHeight: 1.8 }}>
              <div>一对一 60%</div>
              <div>多人会议 20%</div>
              <div>屏幕共享 20%</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 8 }}>审批效率</div>
          <div style={{ fontSize: 28, fontWeight: 650, color: 'var(--accent)', letterSpacing: '-0.03em' }}>2.3h</div>
          <div className="text-xs">平均审批时长 · 超时率 8%</div>
        </div>
        <div className="card">
          <div className="font-semi" style={{ marginBottom: 8 }}>考勤</div>
          <div style={{ fontSize: 28, fontWeight: 650, color: 'var(--success)', letterSpacing: '-0.03em' }}>96.2%</div>
          <div className="text-xs">出勤率 · 迟到 12 · 早退 3</div>
        </div>
      </div>
      <div className="card">
        <div className="section-title">数据大屏</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            ['总用户数', '1,234', Icons.user],
            ['今日消息', '45,678', Icons.chat],
            ['本周会议', '234', Icons.video],
            ['文档数', '1,567', Icons.doc],
          ].map(([label, value, Icon]) => (
            <div key={label} style={{ textAlign: 'center', padding: 14, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
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
