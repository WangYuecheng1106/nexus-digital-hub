// 可复用空状态：图标 + 标题 + 描述 + 可选操作
import React from 'react';

export default function EmptyState({ icon, title, description, action, compact = false }) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`} role="status">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-desc">{description}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
