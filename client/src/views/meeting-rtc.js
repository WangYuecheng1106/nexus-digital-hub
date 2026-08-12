// WebRTC 信令与连接管理：P2P mesh 架构，每对参与者之间建立独立 RTCPeerConnection
export class MeetingRTC {
  constructor(ws, userId, localStream, onRemoteStream) {
    this.ws = ws;
    this.userId = userId;
    this.localStream = localStream;
    this.onRemoteStream = onRemoteStream;
    this.pcs = {};
  }

  async createOffer(targetUserId) {
    if (this.pcs[targetUserId]) return;
    const pc = this._createPC(targetUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.ws.send(JSON.stringify({ type: 'meeting:signal', targetUserId, signal: { type: 'sdp', sdp: offer } }));
  }

  async handleSignal(msg) {
    const { signal, fromUserId } = msg;
    let pc = this.pcs[fromUserId];
    if (!pc) pc = this._createPC(fromUserId);
    if (signal.type === 'sdp') {
      await pc.setRemoteDescription(signal.sdp);
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.ws.send(JSON.stringify({ type: 'meeting:signal', targetUserId: fromUserId, signal: { type: 'sdp', sdp: answer } }));
      }
    } else if (signal.type === 'ice') {
      try { await pc.addIceCandidate(signal.candidate); } catch { /* */ }
    }
  }

  _createPC(targetUserId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.pcs[targetUserId] = pc;
    for (const track of this.localStream?.getTracks() || []) pc.addTrack(track, this.localStream);
    pc.ontrack = (e) => this.onRemoteStream(targetUserId, e.streams[0]);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.ws.send(JSON.stringify({ type: 'meeting:signal', targetUserId, signal: { type: 'ice', candidate: e.candidate } }));
    };
    return pc;
  }

  replaceVideoTrack(newTrack) {
    for (const pc of Object.values(this.pcs)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newTrack);
    }
  }

  close() {
    Object.values(this.pcs).forEach((pc) => pc.close());
    this.pcs = {};
  }
}
