import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Drive({ user, navigate }) {
  const { showToast } = useToast();
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const load = async (parentId) => {
    try {
      const d = await api('/drive/files' + (parentId ? '?parent_id=' + parentId : ''));
      setFiles(Array.isArray(d) ? d : (d.items || []));
    } catch (e) { setFiles([]); setError(e.message || ''); }
  };

  useEffect(() => { load(currentPath); }, [currentPath]);

  const uploadOne = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    if (currentPath) formData.append('parent_id', currentPath);
    formData.append('space', 'personal');
    const token = localStorage.getItem('nexus_token');
    const r = await fetch('/api/drive/upload', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: formData,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || '上传失败');
    return data;
  };

  const uploadList = async (list) => {
    if (!list.length || uploading) return;
    setUploading(true);
    setError('');
    let ok = 0;
    try {
      for (const file of list) {
        await uploadOne(file);
        ok += 1;
      }
      showToast(ok > 1 ? `已上传 ${ok} 个文件，可在文档中查看` : `已上传 ${list[0].name}，可在文档中查看`, 'success');
      load(currentPath);
    } catch (err) {
      const msg = err.message || '上传失败';
      setError(msg);
      showToast(msg, 'error');
      if (ok) load(currentPath);
    } finally {
      setUploading(false);
    }
  };

  const onPickFiles = (e) => {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    uploadList(list);
  };

  const del = async (f) => {
    try {
      await api('/drive/files/' + f.id, { method: 'DELETE' });
      load(currentPath);
    } catch (e) { setError(e.message); }
  };

  const openFile = (f) => {
    if (f.type === 'folder') {
      setCurrentPath(f.id);
      return;
    }
    try { sessionStorage.setItem('nexus_open_drive', f.id); } catch { /* */ }
    navigate?.('document');
  };

  return (
    <div
      className="scroll-y"
      style={{ height: '100%', padding: 20, outline: dragOver ? '2px dashed var(--accent)' : 'none', outlineOffset: -8 }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        uploadList([...(e.dataTransfer.files || [])]);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onPickFiles}
        style={{ display: 'none' }}
        aria-hidden
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn-ghost" onClick={() => setCurrentPath(null)}>我的云盘</button>
          {currentPath && <span className="text-xs">/</span>}
        </div>
        <span className="text-xs text-muted">{uploading ? '上传中…' : '拖入文件即可上传 · 在文档中查看'}</span>
      </div>
      {error && <div className="text-error" style={{ marginBottom: 8, fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {files.map((f) => (
          <div key={f.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, cursor: 'pointer' }}
            onClick={() => openFile(f)}>
            {f.type === 'folder' ? <Icons.folder size={18} /> : <Icons.file size={18} />}
            <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{f.name}</div>
            <button type="button" className="btn-icon" onClick={(e) => { e.stopPropagation(); del(f); }} title="删除"><Icons.trash size={12} /></button>
          </div>
        ))}
      </div>
      {files.length === 0 && (
        <button
          type="button"
          className="empty"
          style={{ width: '100%', border: '1px dashed var(--border)', background: 'transparent' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Icons.upload size={28} />
          <div>{uploading ? '上传中…' : '把文件拖到这里，或点此选择'}</div>
          <div className="text-xs">上传后可在「文档」里打开查看</div>
        </button>
      )}
    </div>
  );
}
