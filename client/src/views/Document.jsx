import React, { useState, useEffect, useRef } from 'react';
import { api, wsConnect } from '../api.js';
import * as Y from 'yjs';
import { Icons } from '../icons.jsx';

export default function Document() {
  const [docs, setDocs] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [content, setContent] = useState('');
  const [collaborators, setCollaborators] = useState([]);
  const [error, setError] = useState('');
  const editorRef = useRef(null);
  const wsRef = useRef(null);
  const ydocRef = useRef(null);

  useEffect(() => {
    api('/document/documents').then((d) => setDocs(Array.isArray(d) ? d : [])).catch((e) => setError(e.message));
  }, []);

  const openDoc = async (doc) => {
    setActiveDoc(doc);
    setError('');
    let text = '';
    try {
      if (doc.content) {
        const parsed = typeof doc.content === 'string' ? JSON.parse(doc.content) : doc.content;
        text = parsed.text || '';
      }
    } catch { text = ''; }
    setContent(text);

    wsRef.current?.close();
    ydocRef.current = new Y.Doc();
    const ytext = ydocRef.current.getText('content');
    if (text) ytext.insert(0, text);
    ytext.observe(() => setContent(ytext.toString()));

    wsRef.current = wsConnect('/ws/document', (msg) => {
      if (msg.type === 'doc:update' && msg.docId === doc.id) {
        const update = Uint8Array.from(atob(msg.update), (c) => c.charCodeAt(0));
        Y.applyUpdate(ydocRef.current, update);
      } else if (msg.type === 'doc:awareness' && msg.docId === doc.id) {
        setCollaborators(msg.awareness || []);
      }
    });
    setTimeout(() => {
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'doc:open', docId: doc.id }));
      }
    }, 300);
  };

  const onEdit = (e) => {
    const newText = e.target.value;
    setContent(newText);
    const ytext = ydocRef.current?.getText('content');
    if (ytext && ytext.toString() !== newText) {
      ydocRef.current.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, newText);
      });
      const update = Y.encodeStateAsUpdate(ydocRef.current);
      const base64 = btoa(String.fromCharCode(...update));
      wsRef.current?.send(JSON.stringify({ type: 'doc:update', docId: activeDoc.id, update: base64 }));
    }
    clearTimeout(editorRef.current?._saveTimer);
    editorRef.current._saveTimer = setTimeout(() => {
      api('/document/documents/' + activeDoc.id, {
        method: 'PUT',
        body: JSON.stringify({ content: JSON.stringify({ text: newText }) }),
      }).catch(() => {});
    }, 1500);
  };

  const createDoc = async () => {
    try {
      const doc = await api('/document/documents', {
        method: 'POST',
        body: JSON.stringify({ title: '新建文档', type: 'rich_text' }),
      });
      setDocs([doc, ...docs]);
      openDoc(doc);
    } catch (e) { setError(e.message || '创建失败'); }
  };

  if (activeDoc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <input
            value={activeDoc.title}
            onChange={(e) => setActiveDoc({ ...activeDoc, title: e.target.value })}
            style={{ fontSize: 14, fontWeight: 600, border: 'none', background: 'transparent', padding: 0 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {collaborators.map((c, i) => (
              <div key={i} className="avatar sm accent">{(c.name || '?').charAt(0)}</div>
            ))}
            <span className="text-xs">{collaborators.length} 在线</span>
            <button type="button" className="btn-default" onClick={() => { wsRef.current?.close(); setActiveDoc(null); }}>返回</button>
          </div>
        </div>
        <textarea
          ref={editorRef}
          value={content}
          onChange={onEdit}
          style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', padding: 24, fontSize: 14.5, lineHeight: 1.75, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text)' }}
          placeholder="开始编辑…"
        />
      </div>
    );
  }

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <span className="font-semi" style={{ fontSize: 15 }}>文档协作</span>
        <button type="button" className="btn-primary" onClick={createDoc}><Icons.plus size={14} /> 新建文档</button>
      </div>
      {error && <div className="text-error" style={{ marginBottom: 8, fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {docs.map((d) => (
          <button key={d.id} type="button" className="card" onClick={() => openDoc(d)} style={{ cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ color: 'var(--accent)', marginBottom: 8 }}><Icons.doc size={22} /></div>
            <div className="font-semi" style={{ marginBottom: 4 }}>{d.title}</div>
            <div className="text-xs">{d.updated_at ? new Date(d.updated_at).toLocaleString('zh-CN') : ''}</div>
          </button>
        ))}
      </div>
      {docs.length === 0 && <div className="empty"><Icons.doc size={28} /><div>暂无文档</div></div>}
    </div>
  );
}
