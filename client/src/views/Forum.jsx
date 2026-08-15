import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Icons } from '../icons.jsx';
import Modal from '../components/Modal.jsx';
import EmptyState from '../components/EmptyState.jsx';

const SECTIONS = [['all', '全部'], ['news', '公司动态'], ['tech', '技术分享'], ['recruit', '招聘内推'], ['trade', '二手交易'], ['life', '生活杂谈']];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function MediaBlock({ media }) {
  const list = Array.isArray(media) ? media : [];
  if (!list.length) return null;
  return (
    <div className="forum-media-grid" style={{ padding: '10px 0 0' }}>
      {list.map((m, i) => (
        <div key={i} className="forum-media-item">
          {m.kind === 'video' ? (
            <video src={m.url} controls preload="metadata" />
          ) : (
            <img src={m.url} alt={m.name || '图片'} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function Forum({ user }) {
  const [posts, setPosts] = useState([]);
  const [section, setSection] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', section: 'tech', media: [] });
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');
  const [stats, setStats] = useState({});
  const imgRef = useRef(null);
  const vidRef = useRef(null);

  const load = async () => {
    try {
      const d = await api('/forum/posts' + (section !== 'all' ? '?section=' + section : ''));
      setPosts(Array.isArray(d) ? d : (d.items || []));
      const s = await api('/forum/sections').catch(() => []);
      setStats(Array.isArray(s) ? s.reduce((m, x) => ({ ...m, [x.key]: x.count }), {}) : {});
    } catch (e) { setPosts([]); setError(e.message || ''); }
  };

  useEffect(() => { load(); }, [section]);

  const addMedia = async (files, kind) => {
    const picked = [...(files || [])].slice(0, 9 - form.media.length);
    if (!picked.length) return;
    const next = [];
    for (const f of picked) {
      if (f.size > 8 * 1024 * 1024) {
        setError('单个附件不超过 8MB');
        continue;
      }
      const url = await readAsDataUrl(f);
      next.push({ kind, url, name: f.name, mime: f.type });
    }
    setForm((prev) => ({ ...prev, media: [...prev.media, ...next].slice(0, 9) }));
  };

  const createPost = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setError('请填写标题和正文');
      return;
    }
    try {
      await api('/forum/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          content: form.content,
          section: form.section,
          media: form.media,
          author_id: user.id,
        }),
      });
      setShowCreate(false);
      setForm({ title: '', content: '', section: 'tech', media: [] });
      setError('');
      load();
    } catch (e) { setError(e.message || '发布失败'); }
  };

  const like = async (id) => {
    try { await api('/forum/posts/' + id + '/like', { method: 'POST' }); load(); if (detail) loadDetail(id); } catch { /* */ }
  };

  const loadDetail = async (id) => {
    try {
      const p = await api('/forum/posts/' + id);
      setDetail(p);
    } catch (e) { setError(e.message); }
  };

  const submitComment = async () => {
    if (!comment.trim() || !detail) return;
    try {
      await api(`/forum/posts/${detail.id}/comments`, { method: 'POST', body: JSON.stringify({ content: comment }) });
      setComment('');
      loadDetail(detail.id);
    } catch (e) { setError(e.message); }
  };

  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts : ts);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside className="nx-side" style={{ width: 220 }}>
        <div className="nx-side-head">论坛板块</div>
        <div style={{ padding: 8 }}>
          {SECTIONS.map(([k, l]) => (
            <button key={k} type="button" className={`list-row${section === k ? ' active' : ''}`} style={{ width: '100%', border: 'none', display: 'flex', justifyContent: 'space-between' }} onClick={() => { setSection(k); setDetail(null); }}>
              <span>{l}</span>
              <span className="text-xs">{stats[k] || 0}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        {detail ? (
          <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <button type="button" className="btn-ghost" onClick={() => setDetail(null)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Icons.chevronL size={14} /> 返回</button>
              <span className="tag">{SECTIONS.find((s) => s[0] === detail.section)?.[1] || detail.section}</span>
            </div>
            <div className="font-semi" style={{ fontSize: 18, marginBottom: 12 }}>{detail.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div className="avatar sm">{(detail.author_name || detail.author_id || '?').charAt(0)}</div>
              <div>
                <div className="font-med" style={{ fontSize: 13 }}>{detail.author_name || detail.author_id}</div>
                <div className="text-xs text-muted">{fmtTime(detail.created_at)}</div>
              </div>
            </div>
            <div style={{ lineHeight: 1.7, fontSize: 14, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{detail.content}</div>
            <MediaBlock media={detail.media} />
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 12 }}>
              <span>浏览 {detail.views || 0}</span>
              <button type="button" className="btn-ghost" style={{ padding: 0, fontSize: 12 }} onClick={() => like(detail.id)}>赞 {detail.likes || 0}</button>
              <span>评论 {detail.comment_count || detail.comments?.length || 0}</span>
            </div>

            <div style={{ marginTop: 20 }}>
              <div className="font-semi" style={{ marginBottom: 10, fontSize: 13 }}>评论</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input placeholder="写下你的评论…" value={comment} onChange={(e) => setComment(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn-primary" onClick={submitComment}>发送</button>
              </div>
              {(detail.comments || []).length === 0 && <div className="text-xs text-muted">暂无评论</div>}
              {(detail.comments || []).map((c) => (
                <div key={c.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div className="avatar sm">{(c.author_name || c.author_id || '?').charAt(0)}</div>
                    <span className="font-med" style={{ fontSize: 12 }}>{c.author_name || c.author_id}</span>
                    <span className="text-xs text-muted">{fmtTime(c.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, paddingLeft: 30 }}>{c.content}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
              <div className="font-semi" style={{ fontSize: 15 }}>{SECTIONS.find((s) => s[0] === section)?.[1]}帖子</div>
              <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>+ 发帖</button>
            </div>
            {error && <div className="text-error" style={{ marginBottom: 8, fontSize: 12 }}>{error}</div>}
            {posts.map((p) => (
              <div key={p.id} className="card" style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => loadDetail(p.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div className="font-semi" style={{ fontSize: 14 }}>{p.title}</div>
                  <span className="tag">{SECTIONS.find((s) => s[0] === p.section)?.[1] || p.section}</span>
                </div>
                <div className="text-xs" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>{(p.content || '').slice(0, 120)}{(p.content || '').length > 120 ? '…' : ''}</div>
                {Array.isArray(p.media) && p.media.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {p.media.slice(0, 4).map((m, i) => (
                      <div key={i} style={{ width: 56, height: 56, borderRadius: 2, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)' }}>
                        {m.kind === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </div>
                    ))}
                    {p.media.length > 4 && <span className="text-xs text-muted">+{p.media.length - 4}</span>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="avatar sm">{(p.author_name || p.author_id || '?').charAt(0)}</div>
                    <span>{p.author_name || p.author_id}</span>
                  </div>
                  <span>{fmtTime(p.created_at)}</span>
                  <span>浏览 {p.views || 0}</span>
                  <button type="button" className="btn-ghost" style={{ padding: 0, fontSize: 12 }} onClick={(e) => { e.stopPropagation(); like(p.id); }}>赞 {p.likes || 0}</button>
                  <span>评论 {p.comment_count || 0}</span>
                </div>
              </div>
            ))}
            {posts.length === 0 && (
              <EmptyState
                icon={<Icons.globe size={28} />}
                title="这个板块还没有帖子"
                description="发一条公司动态或技术分享，让同事看见。"
                action={<button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>+ 发帖</button>}
              />
            )}
          </>
        )}
      </div>
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="发布帖子" width={560}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ flex: 1 }} />
            <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} style={{ width: 140 }}>
              {SECTIONS.slice(1).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="forum-composer">
            <textarea
              className="forum-composer-body"
              placeholder="说点什么… 支持 #话题# ，可附图片/视频"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
            {form.media.length > 0 && (
              <div className="forum-media-grid">
                {form.media.map((m, i) => (
                  <div key={i} className="forum-media-item">
                    {m.kind === 'video' ? <video src={m.url} muted /> : <img src={m.url} alt="" />}
                    <button
                      type="button"
                      className="rm"
                      title="移除"
                      onClick={() => setForm({ ...form, media: form.media.filter((_, j) => j !== i) })}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="forum-composer-toolbar">
              <input ref={imgRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addMedia(e.target.files, 'image'); e.target.value = ''; }} />
              <input ref={vidRef} type="file" accept="video/*" multiple hidden onChange={(e) => { addMedia(e.target.files, 'video'); e.target.value = ''; }} />
              <button type="button" className="btn-icon" title="图片" onClick={() => imgRef.current?.click()}><Icons.image size={16} /></button>
              <button type="button" className="btn-icon" title="视频" onClick={() => vidRef.current?.click()}><Icons.video size={16} /></button>
              <button type="button" className="btn-icon" title="附件" onClick={() => imgRef.current?.click()}><Icons.attach size={16} /></button>
              <span className="text-xs text-muted" style={{ marginLeft: 4 }}>{form.media.length}/9</span>
              <div style={{ flex: 1 }} />
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
              <button type="button" className="btn-primary" onClick={createPost} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icons.send size={14} /> 发布
              </button>
            </div>
          </div>
          {error && <div className="text-error" style={{ fontSize: 12 }}>{error}</div>}
        </div>
      </Modal>
    </div>
  );
}
