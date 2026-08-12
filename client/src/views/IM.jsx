import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, wsConnect } from '../api.js';
import { Icons } from '../icons.jsx';
import VoiceBubble from './VoiceBubble.jsx';

// WhatsApp 模式：左会话列表 + 右对话区；钉钉风格语音气泡
export default function IM({ user, setUnreadCount }) {
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(null);
  const [peers, setPeers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [sideTab, setSideTab] = useState('chats'); // chats | friends
  const [friends, setFriends] = useState([]);
  const [friendReqs, setFriendReqs] = useState([]);
  const [addFriendId, setAddFriendId] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const wsRef = useRef(null);
  const msgEndRef = useRef(null);
  const activeRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const recStartRef = useRef(0);

  useEffect(() => { activeRef.current = activeConv; }, [activeConv]);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await api('/im/conversations');
      setConversations(Array.isArray(convs) ? convs : []);
      const totalUnread = (convs || []).reduce((s, c) => s + (c.unread || 0), 0);
      setUnreadCount?.(totalUnread);
    } catch (e) {
      setError(e.message || '加载会话失败');
    }
  }, [setUnreadCount]);

  const loadFriends = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([
        api('/im/friends'),
        api('/im/friends/requests'),
      ]);
      setFriends(Array.isArray(f) ? f : []);
      setFriendReqs(Array.isArray(r) ? r : []);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    loadConversations();
    loadFriends();
    wsRef.current = wsConnect('/ws/im', (msg) => {
      switch (msg.type) {
        case 'im:message':
        case 'im:ack':
          loadConversations();
          if (msg.conversationId === activeRef.current?.id || msg.conversation_id === activeRef.current?.id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id || m.id === msg.messageId)) return prev;
              if (msg.type === 'im:ack') return prev;
              return [...prev, normalizeMsg(msg)];
            });
          }
          break;
        case 'im:read':
          loadConversations();
          break;
        case 'im:recall':
          setMessages((prev) => prev.map((m) => (m.id === msg.messageId ? { ...m, status: 'recalled' } : m)));
          break;
        case 'im:typing':
          if (msg.conversationId === activeRef.current?.id) {
            setTyping(msg.userId);
            setTimeout(() => setTyping(null), 2500);
          }
          break;
        case 'im:friend_request':
        case 'im:friend_accepted':
          loadFriends();
          break;
        default:
          break;
      }
    });
    return () => {
      wsRef.current?.close();
      stopRecTimer();
    };
  }, [loadConversations, loadFriends]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openConversation = async (conv) => {
    setActiveConv(conv);
    setError('');
    try {
      const msgs = await api(`/im/conversations/${conv.id}/messages?limit=50`);
      const list = Array.isArray(msgs) ? msgs : (msgs.items || []);
      setMessages(list.map(normalizeMsg));
      if (list.length > 0) {
        await api(`/im/conversations/${conv.id}/read`, {
          method: 'POST',
          body: JSON.stringify({ lastReadMsgId: list[list.length - 1].id }),
        }).catch(() => {});
        loadConversations();
      }
    } catch (e) {
      setError(e.message || '加载消息失败');
    }
  };

  const sendPayload = (type, body, optimisticExtra = {}) => {
    if (!activeConv) return;
    const optimistic = {
      id: 'tmp-' + Date.now(),
      sender_id: user.id,
      type,
      body,
      created_at: Date.now(),
      status: 'sending',
      ...optimisticExtra,
    };
    setMessages((prev) => [...prev, optimistic]);
    const payload = { type: 'im:send', conversationId: activeConv.id, messageType: type, body };
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(payload));
    } else {
      api(`/im/conversations/${activeConv.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ type, body }),
      }).then(() => loadConversations()).catch((e) => setError(e.message || '发送失败'));
    }
  };

  const sendMessage = () => {
    if (!activeConv || !input.trim()) return;
    const text = input.trim();
    setInput('');
    sendPayload('text', { text });
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'im:typing', conversationId: activeConv.id }));
    }
  };

  function stopRecTimer() {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    recTimerRef.current = null;
  }

  const startVoice = async () => {
    if (!activeConv || recording) return;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const duration = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: mime });
        const reader = new FileReader();
        reader.onloadend = () => {
          const audio = reader.result;
          sendPayload('voice', { duration, audio, mimeType: mime });
        };
        reader.readAsDataURL(blob);
      };
      mediaRef.current = mr;
      recStartRef.current = Date.now();
      setRecSec(0);
      setRecording(true);
      mr.start(200);
      recTimerRef.current = setInterval(() => {
        const s = Math.round((Date.now() - recStartRef.current) / 1000);
        setRecSec(s);
        if (s >= 60) stopVoice();
      }, 200);
    } catch (e) {
      setError('无法使用麦克风：' + (e.message || '请授权'));
    }
  };

  const stopVoice = () => {
    stopRecTimer();
    setRecording(false);
    setRecSec(0);
    const mr = mediaRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    mediaRef.current = null;
  };

  const startChat = async (memberOverride) => {
    setCreating(true);
    setError('');
    try {
      let memberId = memberOverride;
      let name = '会话';
      if (!memberId) {
        let list = peers;
        if (!list.length) {
          list = await api('/contacts/employees').catch(() => []);
          if (!Array.isArray(list)) list = list.items || [];
          setPeers(list);
        }
        const other = list.find((e) => e.user_id !== user.id && e.id !== user.id) || list[0];
        if (!other) throw new Error('通讯录暂无其他成员');
        memberId = other.user_id || other.id;
        name = other.name || other.display_name || '会话';
      }
      const conv = await api('/im/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'single', name, memberIds: [memberId] }),
      });
      await loadConversations();
      openConversation(conv);
      setSideTab('chats');
    } catch (e) {
      setError(e.message || '创建会话失败');
    } finally {
      setCreating(false);
    }
  };

  const sendFriendReq = async () => {
    if (!addFriendId.trim()) return;
    try {
      await api('/im/friends/request', {
        method: 'POST',
        body: JSON.stringify({ toUserId: addFriendId.trim(), message: '你好，我想加你为好友' }),
      });
      setAddFriendId('');
      loadFriends();
    } catch (e) {
      setError(e.message || '发送申请失败');
    }
  };

  const respondReq = async (id, accept) => {
    try {
      await api('/im/friends/respond', {
        method: 'POST',
        body: JSON.stringify({ requestId: id, accept }),
      });
      loadFriends();
    } catch (e) {
      setError(e.message);
    }
  };

  const recall = async (msgId) => {
    try {
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'im:recall', messageId: msgId, conversationId: activeConv.id }));
      } else {
        await api(`/im/messages/${msgId}/recall`, { method: 'POST' });
      }
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, status: 'recalled' } : m)));
    } catch (e) {
      setError(e.message || '撤回失败');
    }
  };

  const renderBody = (m, mine) => {
    if (m.status === 'recalled') {
      return <div className={`msg-bubble ${mine ? 'mine' : 'theirs'}`} style={{ opacity: .55, fontStyle: 'italic' }}>消息已撤回</div>;
    }
    if (m.type === 'voice') {
      return (
        <div style={{ position: 'relative' }}>
          <VoiceBubble
            duration={m.body?.duration || 1}
            audioUrl={m.body?.audio}
            mine={mine}
            playingId={playingId}
            msgId={m.id}
            onToggle={setPlayingId}
          />
        </div>
      );
    }
    const text = m.body?.text || m.content || '';
    return <div className={`msg-bubble ${mine ? 'mine' : 'theirs'}`}>{text}</div>;
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside className="nx-side" style={{ width: 280 }}>
        <div className="nx-side-head">
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className={`btn-ghost${sideTab === 'chats' ? ' text-accent' : ''}`} style={{ fontWeight: 600 }} onClick={() => setSideTab('chats')}>会话</button>
            <button type="button" className={`btn-ghost${sideTab === 'friends' ? ' text-accent' : ''}`} style={{ fontWeight: 600 }} onClick={() => { setSideTab('friends'); loadFriends(); }}>
              好友{friendReqs.filter((r) => r.status === 'pending').length > 0 ? ` (${friendReqs.filter((r) => r.status === 'pending').length})` : ''}
            </button>
          </div>
          <button type="button" className="btn-icon" title="发起会话" onClick={() => startChat()} disabled={creating}>
            <Icons.plus size={16} />
          </button>
        </div>

        {sideTab === 'chats' ? (
          <>
            <div style={{ padding: '8px 12px' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: 8, color: 'var(--text-muted)' }}><Icons.search size={14} /></span>
                <input placeholder="搜索会话…" style={{ width: '100%', paddingLeft: 30 }} />
              </div>
            </div>
            <div className="scroll-y" style={{ flex: 1 }}>
              {conversations.length === 0 && (
                <div className="empty" style={{ padding: 32 }}>
                  <Icons.chat size={28} />
                  <div>暂无会话</div>
                  <button type="button" className="btn-default" onClick={() => startChat()} disabled={creating}>发起会话</button>
                </div>
              )}
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={`list-row${activeConv?.id === c.id ? ' active' : ''}`}
                  onClick={() => openConversation(c)}
                >
                  <div className="avatar">{(c.name || '会').charAt(0)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="font-med" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || '会话'}</span>
                      <span className="text-muted" style={{ fontSize: 11, flexShrink: 0 }}>{fmtTime(c.updated_at || c.last_msg_at)}</span>
                    </div>
                    <div className="text-xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {previewLast(c)}
                    </div>
                  </div>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="scroll-y" style={{ flex: 1, padding: 12 }}>
            <div className="font-semi" style={{ marginBottom: 8, fontSize: 12 }}>添加好友</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <input placeholder="对方用户 ID" value={addFriendId} onChange={(e) => setAddFriendId(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn-primary" onClick={sendFriendReq}>添加</button>
            </div>
            {friendReqs.filter((r) => r.status === 'pending').length > 0 && (
              <>
                <div className="font-semi" style={{ marginBottom: 8, fontSize: 12 }}>待处理申请</div>
                {friendReqs.filter((r) => r.status === 'pending').map((r) => (
                  <div key={r.id} className="card" style={{ marginBottom: 8, padding: 10 }}>
                    <div className="text-xs">{r.message}</div>
                    <div className="text-muted" style={{ fontSize: 11, margin: '4px 0 8px' }}>来自 {r.from_id}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn-primary" style={{ fontSize: 12 }} onClick={() => respondReq(r.id, true)}>接受</button>
                      <button type="button" className="btn-default" style={{ fontSize: 12 }} onClick={() => respondReq(r.id, false)}>拒绝</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            <div className="font-semi" style={{ margin: '12px 0 8px', fontSize: 12 }}>我的好友</div>
            {friends.length === 0 && <div className="empty" style={{ padding: 16 }}><div className="text-xs">暂无好友，从通讯录添加</div></div>}
            {friends.map((f) => (
              <button
                key={f.friend_id}
                type="button"
                className="list-row"
                style={{ width: '100%', border: 'none' }}
                onClick={() => startChat(f.friend_id)}
              >
                <div className="avatar">{String(f.friend_id).charAt(0)}</div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div className="font-med" style={{ fontSize: 13 }}>{f.friend_id}</div>
                  <div className="text-xs">点击发消息</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="chat-stage">
        {!activeConv ? (
          <div className="empty" style={{ flex: 1 }}>
            <Icons.chat size={32} />
            <div className="font-med">选择一个会话开始聊天</div>
            <div className="text-xs">支持文字与语音（钉钉风格气泡）</div>
          </div>
        ) : (
          <>
            <div className="nx-side-head" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
              <div>
                <div className="font-semi">{activeConv.name}</div>
                {typing && <div className="text-xs text-accent">对方正在输入…</div>}
              </div>
            </div>
            <div className="scroll-y" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((m) => {
                const mine = m.sender_id === user.id || m.senderId === user.id;
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <div>
                      {renderBody(m, mine)}
                      <div className="text-muted" style={{ fontSize: 10, marginTop: 3, textAlign: mine ? 'right' : 'left' }}>
                        {fmtTime(m.created_at)}
                        {mine && m.status !== 'recalled' && (
                          <button type="button" className="btn-ghost" style={{ fontSize: 10, padding: '0 4px', marginLeft: 6 }} onClick={() => recall(m.id)}>撤回</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={msgEndRef} />
            </div>
            <div className="composer">
              <button type="button" className="btn-icon" title="附件"><Icons.attach size={16} /></button>
              <button type="button" className="btn-icon" title="图片"><Icons.image size={16} /></button>
              {!recording ? (
                <button type="button" className="btn-icon" title="按住说话（点击开始）" onClick={startVoice} disabled={!activeConv}>
                  <Icons.mic size={16} />
                </button>
              ) : (
                <button type="button" className="btn-danger" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32 }} onClick={stopVoice}>
                  <Icons.record size={12} /> {recSec}″ 松开发送
                </button>
              )}
              <textarea
                rows={1}
                placeholder="输入消息…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                }}
              />
              <button type="button" className="btn-primary" onClick={sendMessage} style={{ height: 40, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icons.send size={14} /> 发送
              </button>
            </div>
          </>
        )}
        {error && <div style={{ padding: '6px 12px', background: 'rgba(239,95,95,.12)', color: 'var(--error)', fontSize: 12 }}>{error}</div>}
      </section>
    </div>
  );
}

function previewLast(c) {
  const m = c.lastMessage || c.last_message;
  if (m && typeof m === 'object') {
    if (m.type === 'voice') return `[语音] ${m.body?.duration || ''}″`;
    try {
      const b = typeof m.body === 'string' ? JSON.parse(m.body) : m.body;
      if (b?.text) return b.text;
    } catch { /* */ }
  }
  return c.last_message || c.last_msg || ' ';
}

function normalizeMsg(m) {
  let body = m.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = { text: body }; }
  }
  return {
    ...m,
    type: m.messageType || m.msgType || m.type || 'text',
    body: body || { text: m.content || '' },
  };
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts : ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
