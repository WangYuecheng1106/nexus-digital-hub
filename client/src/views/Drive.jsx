import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';

export default function Drive({ user }) {
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState(null);
  const [error, setError] = useState('');

  const load = async (parentId) => {
    try {
      const d = await api('/drive/files' + (parentId ? '?parent=' + parentId : ''));
      setFiles(Array.isArray(d) ? d : (d.items || []));
    } catch (e) { setFiles([]); setError(e.message || ''); }
  };

  useEffect(() => { load(currentPath); }, [currentPath]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    if (currentPath) formData.append('parent_id', currentPath);
    formData.append('owner_id', user.id);
    formData.append('space', 'personal');
    try {
      const token = localStorage.getItem('nexus_token');
      const r = await fetch('/api/drive/upload', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: formData });
      if (!r.ok) throw new Error('上传失败');
      load(currentPath);
    } catch (err) { setError(err.message); }
  };

  const del = async (f) => {
    try {
      await api('/drive/files/' + f.id, { method: 'DELETE' });
      load(currentPath);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn-ghost" onClick={() => setCurrentPath(null)}>我的云盘</button>
          {currentPath && <span className="text-xs">/</span>}
        </div>
        <label className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <Icons.plus size={14} /> 上传
          <input type="file" onChange={upload} style={{ display: 'none' }} />
        </label>
      </div>
      {error && <div className="text-error" style={{ marginBottom: 8, fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {files.map((f) => (
          <div key={f.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, cursor: 'pointer' }}
            onClick={() => (f.type === 'folder' ? setCurrentPath(f.id) : window.open('/api/drive/files/' + f.id + '/download?token=' + localStorage.getItem('nexus_token')))}>
            {f.type === 'folder' ? <Icons.folder size={18} /> : <Icons.file size={18} />}
            <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{f.name}</div>
            <button type="button" className="btn-icon" onClick={(e) => { e.stopPropagation(); del(f); }} title="删除"><Icons.logout size={12} /></button>
          </div>
        ))}
      </div>
      {files.length === 0 && <div className="empty"><Icons.folder size={28} /><div>暂无文件</div></div>}
    </div>
  );
}
