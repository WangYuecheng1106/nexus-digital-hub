import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Workflow({ setPendingApprovals }) {
  const [tab, setTab] = useState('pending');
  const [tasks, setTasks] = useState([]);
  const [flows, setFlows] = useState([]);
  const [forms, setForms] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      if (tab === 'pending') {
        const t = await api('/workflow/tasks/pending');
        const list = Array.isArray(t) ? t : (t.items || []);
        setTasks(list);
        setPendingApprovals?.(list.length);
      } else if (tab === 'templates') {
        const t = await api('/workflow/templates');
        setTasks(Array.isArray(t) ? t : []);
      } else if (tab === 'flows') {
        setFlows(await api('/workflow/flows'));
      } else if (tab === 'forms') {
        setForms(await api('/workflow/forms'));
      }
    } catch (e) {
      setError(e.message || '加载失败');
      setTasks([]);
    }
  };

  useEffect(() => { load(); }, [tab]);

  const approve = async (taskId, action, comment) => {
    try {
      await api('/workflow/tasks/' + taskId + '/action', { method: 'POST', body: JSON.stringify({ action, comment }) });
      load();
    } catch (e) { setError(e.message || '操作失败'); }
  };

  const submitTemplate = async (tpl) => {
    try {
      await api('/workflow/submit', {
        method: 'POST',
        body: JSON.stringify({ flowDefId: tpl.flow_id || tpl.flowId || tpl.id, formData: { reason: '演示提交' } }),
      });
      setTab('pending');
    } catch (e) { setError(e.message || '提交失败'); }
  };

  const tabs = [
    ['pending', '待我审批'],
    ['templates', '发起审批'],
    ['flows', '流程定义'],
    ['forms', '表单定义'],
  ];

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(([k, l]) => (
          <button key={k} type="button" className={tab === k ? 'btn-primary' : 'btn-ghost'} style={{ borderRadius: 0, borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent' }} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {error && <div className="text-error" style={{ marginBottom: 10, fontSize: 12 }}>{error}</div>}

      {tab === 'pending' && (
        <div>
          {tasks.map((t) => (
            <div key={t.id} className="card" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="font-semi">{t.flow_name || t.title || '审批任务'}</div>
                <div className="text-xs">发起人 {t.initiator_id} · {t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn-primary" onClick={() => approve(t.id, 'approved', '同意')}>同意</button>
                <button type="button" className="btn-danger" onClick={() => approve(t.id, 'rejected', '拒绝')}>拒绝</button>
              </div>
            </div>
          ))}
          {tasks.length === 0 && <div className="empty"><Icons.check size={28} /><div>暂无待办审批</div></div>}
        </div>
      )}

      {tab === 'templates' && (
        <div>
          {tasks.map((t) => (
            <div key={t.id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="font-semi">{t.name}</div>
                <div className="text-xs">{t.code || t.description || '内置模板'}</div>
              </div>
              <button type="button" className="btn-primary" onClick={() => submitTemplate(t)}>发起</button>
            </div>
          ))}
          {tasks.length === 0 && <div className="empty"><Icons.doc size={28} /><div>暂无模板</div></div>}
        </div>
      )}

      {tab === 'flows' && (
        <div>
          {flows.map((f) => (
            <div key={f.id} className="card" style={{ marginBottom: 8 }}>
              <div className="font-semi">{f.name}</div>
              <div className="text-xs">{f.code} · 节点 {(() => { try { return JSON.parse(f.nodes || '[]').length; } catch { return 0; } })()}</div>
            </div>
          ))}
          {flows.length === 0 && <div className="empty"><Icons.board size={28} /><div>暂无流程定义</div></div>}
        </div>
      )}

      {tab === 'forms' && (
        <div>
          {forms.map((f) => (
            <div key={f.id} className="card" style={{ marginBottom: 8 }}>
              <div className="font-semi">{f.name}</div>
              <div className="text-xs">{f.code}</div>
            </div>
          ))}
          {forms.length === 0 && <div className="empty"><Icons.doc size={28} /><div>暂无表单</div></div>}
        </div>
      )}
    </div>
  );
}
