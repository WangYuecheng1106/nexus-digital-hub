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

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const wsRef = useRef(null);
  const rtcRef = useRef(null);
  const remoteStreamsRef = useRef({});

  const createInstant = async () => {
    setError('');
    try {
      const m = await api('/meeting/meetings', {
        method: 'POST',
        body: JSON.stringify({ type: 'instant', title: (user.display_name || '用户') + '的会议' }),
      });
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
          <div style={{ position: 'relative', width: 280, height: 180, background: '#111', borderRadius: 8, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            <div style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 11, background: 'rgba(0,0,0,.65)', padding: '2px 6px', borderRadius: 4 }}>{user.display_name} · 我</div>
          </div>
          {participants.map((p) => (
            <div key={p.userId} style={{ position: 'relative', width: 280, height: 180, background: '#151515', borderRadius: 8, border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              <video id={'remote-video-' + p.userId} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: remoteStreamsRef.current[p.userId] ? 'block' : 'none' }} />
              {!remoteStreamsRef.current[p.userId] && <span>{p.name || p.userId}</span>}
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
    <div className="scroll-y" style={{ height: '100%', padding: 24, display: 'flex', justifyContent: 'center' }}>
      <div className="card" style={{ width: 440, textAlign: 'center' }}>
        <div style={{ color: 'var(--accent)', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Icons.video size={36} /></div>
        <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 6, letterSpacing: '-0.02em' }}>视频会议</div>
        <div className="text-xs" style={{ marginBottom: 20 }}>WebRTC 信令 · 屏幕共享 · 会议录制</div>
        <button type="button" className="btn-primary" onClick={createInstant} style={{ width: '100%', padding: 11, marginBottom: 14 }}>立即发起会议</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="输入会议号加入…" value={meetingNo} onChange={(e) => setMeetingNo(e.target.value)} style={{ flex: 1 }} />
          <button type="button" className="btn-default" onClick={joinByNo}>加入</button>
        </div>
        {error && <div className="text-error" style={{ marginTop: 12, fontSize: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
