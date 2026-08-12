import React, { useState, useRef, useEffect } from 'react';

// 钉钉风格语音气泡：时长决定宽度、声纹、点击播放/暂停、进度
// 参考：钉钉 voice 消息 media_id + duration；QQ/钉钉非线性气泡宽度
export default function VoiceBubble({ duration = 1, audioUrl, mine, playingId, msgId, onToggle }) {
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);
  const playing = playingId === msgId;
  const dur = Math.min(60, Math.max(1, Math.round(duration)));

  // 非线性宽度：短语音也够点，长语音接近上限（钉钉/QQ 实践）
  const width = Math.round(72 + Math.min(160, Math.pow(dur / 60, 0.65) * 160));

  useEffect(() => {
    if (!playing) { setProgress(0); return; }
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => { setProgress(0); onToggle?.(null); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    a.play().catch(() => onToggle?.(null));
    return () => {
      a.pause();
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
    };
  }, [playing]);

  return (
    <button
      type="button"
      className={`msg-bubble voice-bubble ${mine ? 'mine' : 'theirs'}${playing ? ' playing' : ''}`}
      style={{ width, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left', border: mine ? 'none' : undefined }}
      onClick={() => onToggle?.(playing ? null : msgId)}
      title={playing ? '暂停' : '播放语音'}
    >
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}
      <span className="voice-wave" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} style={{ animationDelay: `${i * 0.12}s`, height: playing ? undefined : `${6 + (i % 3) * 3}px` }} />
        ))}
      </span>
      <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', opacity: 0.9 }}>{dur}″</span>
      {playing && (
        <span style={{
          position: 'absolute', left: 0, bottom: 0, height: 2,
          width: `${progress * 100}%`, background: mine ? 'rgba(255,255,255,.55)' : 'var(--accent)',
          borderRadius: 1,
        }} />
      )}
    </button>
  );
}
