import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, wsConnect } from '../api.js';
import { MeetingRTC } from './meeting-rtc.js';
import { Icons } from '../icons.jsx';

export default function Meeting({ user }) {
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [meetingNo, setMeetingNo] = useState('');
  const [participants, setParticipants] = useState([]);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState([]);
  const [notes, setNotes] = useState('');

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const wsRef = useRef(null);
  const rtcRef = useRef(null);
  const remoteStreamsRef = useRef({});

  useEffect(() => {
    api('/meeting/meetings').then((d) => setRecent(Array.isArray(d) ? d : (d.items || []))).catch(() => {});
  }, []);

  const createInstant = async () => {
    setError('');
    try {
      const m = await api('/meeting/meetings', {
        method: 'POST',
        body: JSON.stringify({ type: 'instant', title: (user.display_name || '用户') + '的会议' }),
      });
      const start = Date.now();
      api('/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          title: m.title || '即时会议',
          start_time: start,
          end_time: start + 3600000,
          meeting_link: m.meeting_no || m.meetingNo,
        }),
      }).catch(() => {});
      await joinMeeting(m.id || m.meeting?.id, m);
    } catch (e) { setError(e.message || '创建会议失败'); }
  };

  const joinByNo = async () => {
    if (!meetingNo.trim()) return;
    setError('');
    try {
      const m = await api('/meeting/meetings/join-by-no', {
        method: 'POST',
        body: JSON.stringify({ meetingNo: meetingNo.trim() }),
      });
      await joinMeeting(m.id || m.meeting?.id, m);
    } catch (e) { setError(e.message || '加入失败'); }
  };

  const joinMeeting = useCallback(async (meetingId, meta) => {
    if (!meetingId) { setError('会议 ID 无效'); return; }
    setActiveMeeting({ id: meetingId, meeting_no: meta?.meeting_no || meta?.meetingNo, ...meta });
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch (e) {
      setError('无法访问摄像头/麦克风（可继续使用信令与聊天）: ' + e.message);
    }

    wsRef.current = wsConnect('/ws/meeting', (msg) => {
      switch (msg.type) {
        case 'meeting:joined':
          setParticipants(msg.participants || []);
          for (const p of msg.participants || []) {
            if (p.userId !== user.id) rtcRef.current?.createOffer(p.userId);
          }
          break;
        case 'meeting:participant_joined':
          setParticipants((prev) => [...prev.filter((x) => x.userId !== msg.participant?.userId), msg.participant].filter(Boolean));
          break;
        case 'meeting:participant_left':
          setParticipants((prev) => prev.filter((p) => p.userId !== msg.userId));
          break;
        case 'meeting:signal':
          rtcRef.current?.handleSignal(msg);
          break;
        case 'meeting:chat':
          setChat((prev) => [...prev, msg]);
          break;
        case 'meeting:raise_hand':
          setParticipants((prev) => prev.map((p) => (p.userId === msg.userId ? { ...p, handRaised: msg.raised } : p)));
          break;
        case 'meeting:mute':
          setParticipants((prev) => prev.map((p) => (p.userId === msg.userId ? { ...p, audioMuted: msg.muted } : p)));
          break;
        case 'meeting:recording':
          setRecording(msg.action === 'start');
          break;
        default:
          break;
      }
    });

    setTimeout(() => {
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'meeting:join', meetingId }));
        rtcRef.current = new MeetingRTC(wsRef.current, user.id, localStreamRef.current, (uid, stream) => {
          remoteStreamsRef.current[uid] = stream;
          const el = document.getElementById('remote-video-' + uid);
          if (el) el.srcObject = stream;
        });
      }
    }, 400);
  }, [user.id]);

  const toggleMute = () => {
    const m = !muted; setMuted(m);
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !m; });
    wsRef.current?.send(JSON.stringify({ type: 'meeting:mute', meetingId: activeMeeting?.id, muted: m }));
  };
  const toggleVideo = () => {
    const off = !videoOff; setVideoOff(off);
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !off; });
  };
  const toggleScreenShare = async () => {
    if (!screenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        rtcRef.current?.replaceVideoTrack(stream.getVideoTracks()[0]);
        setScreenSharing(true);
        stream.getVideoTracks()[0].onended = () => toggleScreenShare();
      } catch { setError('屏幕共享失败'); }
    } else {
      rtcRef.current?.replaceVideoTrack(localStreamRef.current?.getVideoTracks()[0]);
      setScreenSharing(false);
    }
  };
  const toggleRecording = () => {
    wsRef.current?.send(JSON.stringify({ type: 'meeting:recording', meetingId: activeMeeting?.id, action: recording ? 'stop' : 'start' }));
    setRecording(!recording);
  };
  const raiseHand = () => {
    const r = !handRaised; setHandRaised(r);
    wsRef.current?.send(JSON.stringify({ type: 'meeting:raise_hand', meetingId: activeMeeting?.id, raised: r }));
  };
  const sendChat = () => {
    if (!chatInput.trim()) return;
    wsRef.current?.send(JSON.stringify({ type: 'meeting:chat', meetingId: activeMeeting?.id, text: chatInput }));
    setChat((prev) => [...prev, { userId: user.id, text: chatInput }]);
    setChatInput('');
  };
  const leave = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    rtcRef.current?.close();
    wsRef.current?.close();
    setActiveMeeting(null); setParticipants([]); setChat([]);
    setMuted(false); setVideoOff(false); setScreenSharing(false); setRecording(false); setHandRaised(false);
  };

  if (activeMeeting) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', color: '#ddd' }}>
          <span className="font-semi">会议号 {activeMeeting.meeting_no || String(activeMeeting.id).slice(-9)}</span>
          <span className="text-xs">{participants.length + 1} 人在会</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 12, padding: 16, alignContent: 'flex-start', overflow: 'auto' }}>
          <div style={{ position: 'relative', width: 280, height: 180, background: '#1a1816', borderRadius: 8, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: videoOff ? 'none' : 'block' }} />
            {videoOff || !localStreamRef.current ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="avatar accent" style={{ width: 56, height: 56, fontSize: 20 }}>{(user.display_name || '我').charAt(0)}</div>
              </div>
            ) : null}
            <div style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 11, background: 'rgba(0,0,0,.65)', padding: '2px 6px', borderRadius: 4, color: '#fff' }}>{user.display_name} · 我</div>
          </div>
          {participants.map((p) => (
            <div key={p.userId} style={{ position: 'relative', width: 280, height: 180, background: '#1a1816', borderRadius: 8, border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              <video id={'remote-video-' + p.userId} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: remoteStreamsRef.current[p.userId] ? 'block' : 'none' }} />
              {!remoteStreamsRef.current[p.userId] && (
                <div className="avatar" style={{ width: 56, height: 56, fontSize: 18 }}>{(p.name || p.userId || '?').charAt(0)}</div>
              )}
              <div style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 11, background: 'rgba(0,0,0,.65)', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>{p.name || p.userId}</div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid #222', padding: 10, maxHeight: 140, display: 'flex', flexDirection: 'column', background: '#111' }}>
          <div className="scroll-y" style={{ flex: 1, marginBottom: 6 }}>
            {chat.map((m, i) => <div key={i} style={{ fontSize: 12, color: '#bbb', marginBottom: 2 }}><b style={{ color: m.userId === user.id ? 'var(--accent)' : '#9b9b9b' }}>{m.userId === user.id ? '我' : m.userId}</b> {m.text}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} style={{ flex: 1, background: '#0c0c0c', borderColor: '#333' }} placeholder="会议聊天…" />
            <button type="button" className="btn-primary" onClick={sendChat}>发送</button>
          </div>
        </div>
        <div style={{ padding: 14, display: 'flex', justifyContent: 'center', gap: 8, background: '#0c0c0c', borderTop: '1px solid #222' }}>
          {[
            [Icons.mic, muted, toggleMute, '静音'],
            [Icons.cam, videoOff, toggleVideo, '摄像头'],
            [Icons.screen, screenSharing, toggleScreenShare, '共享'],
            [Icons.record, recording, toggleRecording, '录制'],
            [Icons.hand, handRaised, raiseHand, '举手'],
          ].map(([Icon, on, fn, title], i) => (
            <button key={i} type="button" title={title} onClick={fn} className={`btn-icon${on ? ' active' : ''}`} style={{ width: 44, height: 44, background: on ? 'rgba(239,95,95,.2)' : '#1a1a1a', color: on ? 'var(--error)' : '#ddd' }}>
              <Icon size={18} />
            </button>
          ))}
          <button type="button" title="离开" onClick={leave} className="btn-icon" style={{ width: 44, height: 44, background: 'var(--error)', color: '#fff' }}>
            <Icons.phoneOff size={18} />
          </button>
        </div>
        {error && <div style={{ padding: 8, textAlign: 'center', color: 'var(--error)', fontSize: 12 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="scroll-y" style={{ height: '100%', padding: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 440px) 1fr', gap: 16, maxWidth: 980, margin: '0 auto', alignItems: 'start' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--accent)', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Icons.video size={36} /></div>
          <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 6, letterSpacing: '-0.02em' }}>视频会议</div>
          <div className="text-xs" style={{ marginBottom: 20 }}>摄像头预览 · 屏幕共享 · 会中聊天 · 听记草稿</div>
          <button type="button" className="btn-primary" onClick={createInstant} style={{ width: '100%', padding: 11, marginBottom: 14 }}>立即发起会议</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="输入会议号加入…" value={meetingNo} onChange={(e) => setMeetingNo(e.target.value)} style={{ flex: 1 }} />
            <button type="button" className="btn-default" onClick={joinByNo}>加入</button>
          </div>
          {error && <div className="text-error" style={{ marginTop: 12, fontSize: 12 }}>{error}</div>}
        </div>
        <div>
          <div className="font-semi" style={{ marginBottom: 10 }}>最近会议</div>
          {recent.slice(0, 6).map((m) => (
            <button key={m.id} type="button" className="card" style={{ width: '100%', textAlign: 'left', marginBottom: 8, cursor: 'pointer' }} onClick={() => joinMeeting(m.id, m)}>
              <div className="font-med">{m.title || '会议'}</div>
              <div className="text-xs">会议号 {m.meeting_no || m.meetingNo || m.id} · {m.status || '可加入'}</div>
            </button>
          ))}
          {recent.length === 0 && <div className="text-xs">还没有会议记录。发起后会出现在这里，并写入今日日程。</div>}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="font-semi" style={{ marginBottom: 8 }}>AI 听记草稿</div>
            <textarea placeholder="会中要点会记在这里（可先手动记）…" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} style={{ width: '100%' }} />
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 8 }}
              disabled={!notes.trim()}
              onClick={async () => {
                try {
                  const r = await api('/ai/complete', { method: 'POST', body: JSON.stringify({ task: 'transcribe', text: notes }) });
                  setNotes(r.text);
                  setError('');
                } catch (e) {
                  setError(e.message || '请先在设置填写 API Key');
                }
              }}
            >用模型整理纪要</button>
          </div>
        </div>
      </div>
    </div>
  );
}
