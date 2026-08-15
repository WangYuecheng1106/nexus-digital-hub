import React, { useState, useEffect, useRef } from 'react';
import { api, wsConnect } from '../api.js';
import * as Y from 'yjs';
import { Icons } from '../icons.jsx';
import EmptyState from '../components/EmptyState.jsx';

function fmtDocTime(ts) {
  if (!ts) return '';
  const n = Number(ts);
  const d = new Date(Number.isFinite(n) && n > 1e11 ? n : ts);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2024 || d.getFullYear() > 2027) return '最近更新';
  return d.toLocaleString('zh-CN');
}

function isImage(mime, name) {
  return /^image\//.test(mime || '') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name || '');
}
function isText(mime, name) {
  return /^(text\/|application\/(json|xml|javascript|csv))/.test(mime || '')
    || /\.(txt|md|json|csv|xml|js|css|html|log)$/i.test(name || '');
}
function isPdf(mime, name) {
  return mime === 'application/pdf' || /\.pdf$/i.test(name || '');
}

async function fetchDriveFile(id) {
  const token = localStorage.getItem('nexus_token');
  const r = await fetch(`/api/drive/files/${id}/download`, { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('无法打开云盘文件');
  return r;
}

export default function Document({ navigate }) {
  const [docs, setDocs] = useState([]);
  const [driveFiles, setDriveFiles] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [driveView, setDriveView] = useState(null);
  const [content, setContent] = useState('');
  const [collaborators, setCollaborators] = useState([]);
  const [comments, setComments] = useState([]);
  const [versions, setVersions] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState('');
  const [aiNote, setAiNote] = useState('');
  const [hasRemote, setHasRemote] = useState(false);
  const editorRef = useRef(null);
  const wsRef = useRef(null);
  const ydocRef = useRef(null);

  const loadLists = () => {
    api('/document/documents').then((d) => setDocs(Array.isArray(d) ? d : [])).catch((e) => setError(e.message));
    api('/drive/files-all').then((d) => setDriveFiles(Array.isArray(d) ? d : [])).catch(() => setDriveFiles([]));
  };

  useEffect(() => {
    loadLists();
    api('/ai/status').then((s) => setHasRemote(!!s.hasRemote)).catch(() => {});
  }, []);

  const openDriveFile = async (f) => {
    setActiveDoc(null);
    setError('');
    setAiNote('');
    try {
      const r = await fetchDriveFile(f.id);
      const mime = f.mime_type || r.headers.get('content-type') || '';
      if (isImage(mime, f.name)) {
        const blob = await r.blob();
        setDriveView({ file: f, kind: 'image', url: URL.createObjectURL(blob) });
      } else if (isPdf(mime, f.name)) {
        const blob = await r.blob();
        setDriveView({ file: f, kind: 'pdf', url: URL.createObjectURL(blob) });
      } else if (isText(mime, f.name)) {
        const text = await r.text();
        setDriveView({ file: f, kind: 'text', text });
      } else {
        const blob = await r.blob();
        setDriveView({ file: f, kind: 'binary', url: URL.createObjectURL(blob), mime });
      }
    } catch (e) {
      setError(e.message || '打开失败');
    }
  };

  useEffect(() => {
    let id;
    try { id = sessionStorage.getItem('nexus_open_drive'); sessionStorage.removeItem('nexus_open_drive'); } catch { id = null; }
    if (!id) return;
    api('/drive/files/' + id).then((f) => openDriveFile(f)).catch(() => {});
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
    api('/document/documents/' + doc.id + '/comments').then((d) => setComments(Array.isArray(d) ? d : [])).catch(() => setComments([]));
    api('/document/documents/' + doc.id + '/versions').then((d) => setVersions(Array.isArray(d) ? d : [])).catch(() => setVersions([]));
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
        body: JSON.stringify({ title: '新建文档', type: 'rich_text', watermark: 0 }),
      });
      setDocs([doc, ...docs]);
      openDoc(doc);
    } catch (e) { setError(e.message || '创建失败'); }
  };

  const addComment = async () => {
    if (!commentText.trim() || !activeDoc) return;
    try {
      await api('/document/documents/' + activeDoc.id + '/comments', {
        method: 'POST',
        body: JSON.stringify({ content: commentText.trim() }),
      });
      setCommentText('');
      const d = await api('/document/documents/' + activeDoc.id + '/comments');
      setComments(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
  };

  const snapshot = async () => {
    if (!activeDoc) return;
    try {
      await api('/document/documents/' + activeDoc.id + '/versions', { method: 'POST', body: JSON.stringify({}) });
      const d = await api('/document/documents/' + activeDoc.id + '/versions');
      setVersions(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
  };

  const applyText = (newText) => {
    setContent(newText);
    const ytext = ydocRef.current?.getText('content');
    if (ytext && ytext.toString() !== newText) {
      ydocRef.current.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, newText);
      });
    }
    if (activeDoc) {
      api('/document/documents/' + activeDoc.id, {
        method: 'PUT',
        body: JSON.stringify({ content: JSON.stringify({ text: newText }) }),
      }).catch(() => {});
    }
  };

  const runAi = async (task) => {
    if (!hasRemote) {
      setError('请先在设置 → AI 模型填写 API Key');
      navigate?.('settings');
      return;
    }
    if (!content.trim()) { setError('请先写一些正文'); return; }
    setAiBusy(task);
    setError('');
    try {
      const r = await api('/ai/complete', { method: 'POST', body: JSON.stringify({ task, text: content }) });
      if (task === 'polish') applyText(r.text);
      else if (task === 'continue') applyText(`${content}\n\n${r.text}`);
      else setAiNote(r.text);
    } catch (e) {
      setError(e.message || '模型调用失败');
    }
    setAiBusy('');
  };

  if (driveView) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="font-semi">{driveView.file.name}</div>
            <div className="text-xs">来自云盘 · {driveView.file.mime_type || driveView.kind}</div>
          </div>
          <button type="button" className="btn-default" onClick={() => {
            if (driveView.url) URL.revokeObjectURL(driveView.url);
            setDriveView(null);
          }}>返回</button>
        </div>
        {error && <div className="text-error" style={{ padding: 12, fontSize: 12 }}>{error}</div>}
        <div className="scroll-y" style={{ flex: 1, padding: 20, background: 'var(--bg)' }}>
          {driveView.kind === 'image' && <img src={driveView.url} alt={driveView.file.name} style={{ maxWidth: '100%', border: '1px solid var(--border)' }} />}
          {driveView.kind === 'pdf' && <iframe title={driveView.file.name} src={driveView.url} style={{ width: '100%', height: '100%', minHeight: 480, border: '1px solid var(--border)' }} />}
          {driveView.kind === 'text' && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>{driveView.text}</pre>
          )}
          {driveView.kind === 'binary' && (
            <div className="card" style={{ maxWidth: 420 }}>
              <div className="font-semi" style={{ marginBottom: 8 }}>{driveView.file.name}</div>
              <div className="text-xs" style={{ marginBottom: 12 }}>此类型在文档区提供下载预览。</div>
              <a className="btn-primary" href={driveView.url} download={driveView.file.name} style={{ display: 'inline-flex', textDecoration: 'none' }}>下载文件</a>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeDoc) {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
              <button type="button" className="btn-default" disabled={!!aiBusy} onClick={() => runAi('summarize')}>{aiBusy === 'summarize' ? '摘要中…' : 'AI 摘要'}</button>
              <button type="button" className="btn-default" disabled={!!aiBusy} onClick={() => runAi('polish')}>{aiBusy === 'polish' ? '润色中…' : 'AI 润色'}</button>
              <button type="button" className="btn-default" disabled={!!aiBusy} onClick={() => runAi('continue')}>{aiBusy === 'continue' ? '续写中…' : 'AI 续写'}</button>
              <button type="button" className="btn-default" onClick={snapshot}>保存版本</button>
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
        <aside style={{ width: 280, borderLeft: '1px solid var(--border)', background: 'var(--bg-elevated)', padding: 14, overflowY: 'auto' }}>
          {error && <div className="text-error" style={{ fontSize: 12, marginBottom: 8 }}>{error}</div>}
          {!hasRemote && (
            <div className="text-xs" style={{ marginBottom: 12, padding: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              填写模型 API Key 后可使用 AI 文档。
              <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: 0, marginLeft: 6 }} onClick={() => navigate?.('settings')}>去配置</button>
            </div>
          )}
          {aiNote && (
            <>
              <div className="font-semi" style={{ marginBottom: 8 }}>AI 摘要</div>
              <div className="text-xs" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 14 }}>{aiNote}</div>
            </>
          )}
          <div className="font-semi" style={{ marginBottom: 8 }}>评论</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="写下评论…" style={{ flex: 1 }} />
            <button type="button" className="btn-primary" onClick={addComment}>发送</button>
          </div>
          {comments.length === 0 && <div className="text-xs" style={{ marginBottom: 16 }}>暂无评论</div>}
          {comments.map((c) => (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <div className="text-xs">{c.user_id} · {fmtDocTime(c.created_at)}</div>
              <div style={{ fontSize: 13 }}>{c.content}</div>
            </div>
          ))}
          <div className="font-semi" style={{ margin: '16px 0 8px' }}>版本</div>
          {versions.length === 0 && <div className="text-xs">还没有快照</div>}
          {versions.map((v) => (
            <div key={v.id} className="text-xs" style={{ marginBottom: 6 }}>v{v.version_no} · {fmtDocTime(v.created_at)}</div>
          ))}
        </aside>
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
            <div className="text-xs">{fmtDocTime(d.updated_at)}</div>
          </button>
        ))}
      </div>
      {driveFiles.length > 0 && (
        <>
          <div className="font-semi" style={{ fontSize: 15, margin: '22px 0 12px' }}>来自云盘</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {driveFiles.map((f) => (
              <button key={f.id} type="button" className="card" onClick={() => openDriveFile(f)} style={{ cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ color: 'var(--accent)', marginBottom: 8 }}>{isImage(f.mime_type, f.name) ? <Icons.image size={22} /> : <Icons.file size={22} />}</div>
                <div className="font-semi" style={{ marginBottom: 4 }}>{f.name}</div>
                <div className="text-xs">{fmtDocTime(f.updated_at)} · 云盘</div>
              </button>
            ))}
          </div>
        </>
      )}
      {docs.length === 0 && driveFiles.length === 0 && (
        <EmptyState
          icon={<Icons.doc size={28} />}
          title="还没有文档"
          description="新建一份，右侧可以评论和保存版本。没有水印。"
          action={<button type="button" className="btn-primary" onClick={createDoc}>新建文档</button>}
        />
      )}
    </div>
  );
}
