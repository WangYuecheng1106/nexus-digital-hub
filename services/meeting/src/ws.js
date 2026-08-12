// nexus-meeting：WebSocket 信令处理
// WebRTC 信令本身无状态，但会议实时状态（在线成员、共享源）需在内存维护，
// 避免每条信令都查库；DB 仅持久化会议元数据与历史记录。
import {
  addParticipant, admitParticipant, getMeeting,
  listParticipants, removeParticipant, startRecording, stopRecording,
  updateMeetingStatus, updateParticipantState, setLock,
} from './repo.js';

// 内存态：meetingId -> { users: Set<userId>, sharer, recordingId }
// 进程重启会丢失实时状态，但会议元数据仍在 DB，客户端可重连恢复
const rooms = new Map();
const getRoom = (id) => rooms.get(id) || { users: new Set(), sharer: null, recordingId: null };

export function handleWsMessage(hub) {
  return async (socket, msg) => {
    const uid = socket.userId;
    switch (msg.type) {
      case 'meeting:join': {
        const m = getMeeting(msg.meetingId);
        if (!m) throw new Error('会议不存在');
        if (m.password && m.password !== msg.password) throw new Error('会议密码错误');
        if (m.locked && m.host_id !== uid) throw new Error('会议已锁定');
        const isHost = m.host_id === uid;
        // 等候室：非主持人加入需主持人审批；主持人直接进入并激活会议
        const waiting = !isHost && m.status === 'waiting' ? 1 : 0;
        addParticipant(m.id, uid, isHost ? 'host' : 'participant', waiting);
        if (isHost && m.status === 'waiting') updateMeetingStatus(m.id, 'active');
        const room = rooms.get(m.id) || getRoom(m.id);
        if (!waiting) room.users.add(uid);
        rooms.set(m.id, room);
        const participants = listParticipants(m.id).filter((p) => room.users.has(p.user_id));
        socket.send(JSON.stringify({
          type: 'meeting:joined', meetingId: m.id, yourRole: isHost ? 'host' : 'participant',
          waiting, participants,
        }));
        if (!waiting) hub.sendTo([...room.users].filter((u) => u !== uid),
          { type: 'meeting:user_joined', meetingId: m.id, userId: uid });
        break;
      }
      case 'meeting:admit': {
        // 主持人审批等候室成员：将其加入在线集合并通知
        const m = getMeeting(msg.meetingId);
        if (m?.host_id !== uid) throw new Error('仅主持人可审批');
        admitParticipant(msg.meetingId, msg.userId);
        const room = rooms.get(msg.meetingId) || getRoom(msg.meetingId);
        room.users.add(msg.userId);
        rooms.set(msg.meetingId, room);
        hub.sendTo(msg.userId, { type: 'meeting:admitted', meetingId: msg.meetingId });
        hub.sendTo([...room.users].filter((u) => u !== msg.userId),
          { type: 'meeting:user_joined', meetingId: msg.meetingId, userId: msg.userId });
        break;
      }
      case 'meeting:leave': {
        const room = rooms.get(msg.meetingId);
        if (room) {
          room.users.delete(uid);
          if (room.sharer === uid) room.sharer = null;
          hub.sendTo([...room.users], { type: 'meeting:user_left', meetingId: msg.meetingId, userId: uid });
        }
        removeParticipant(msg.meetingId, uid);
        break;
      }
      case 'meeting:signal': {
        // SDP/ICE 直接转发给目标，服务端不解析媒体内容，保持信令无状态
        hub.sendTo(msg.targetUserId, {
          type: 'meeting:signal', fromUserId: uid, meetingId: msg.meetingId,
          sdp: msg.sdp, candidate: msg.candidate,
        });
        break;
      }
      case 'meeting:screen_share': {
        const room = rooms.get(msg.meetingId);
        if (!room) break;
        room.sharer = msg.sourceId ? uid : null;
        hub.sendTo([...room.users], {
          type: 'meeting:screen_share', meetingId: msg.meetingId,
          userId: uid, sourceId: msg.sourceId,
        });
        break;
      }
      case 'meeting:raise_hand': {
        updateParticipantState(msg.meetingId, uid, 'hand_raised', msg.raised);
        const room = rooms.get(msg.meetingId);
        if (room) hub.sendTo([...room.users],
          { type: 'meeting:raise_hand', meetingId: msg.meetingId, userId: uid, raised: msg.raised });
        break;
      }
      case 'meeting:mute': {
        updateParticipantState(msg.meetingId, uid, 'audio_muted', msg.muted);
        const room = rooms.get(msg.meetingId);
        if (room) hub.sendTo([...room.users],
          { type: 'meeting:mute', meetingId: msg.meetingId, userId: uid, muted: msg.muted });
        break;
      }
      case 'meeting:kick': {
        const m = getMeeting(msg.meetingId);
        if (m?.host_id !== uid) throw new Error('仅主持人可踢人');
        const room = rooms.get(msg.meetingId);
        if (room) {
          room.users.delete(msg.userId);
          hub.sendTo(msg.userId, { type: 'meeting:kicked', meetingId: msg.meetingId });
          hub.sendTo([...room.users], { type: 'meeting:user_left', meetingId: msg.meetingId, userId: msg.userId });
        }
        removeParticipant(msg.meetingId, msg.userId);
        break;
      }
      case 'meeting:recording': {
        const m = getMeeting(msg.meetingId);
        if (m?.host_id !== uid) throw new Error('仅主持人可录制');
        const room = rooms.get(msg.meetingId) || getRoom(msg.meetingId);
        if (msg.action === 'start') room.recordingId = startRecording(msg.meetingId, uid);
        else if (msg.action === 'stop' && room.recordingId) stopRecording(room.recordingId);
        rooms.set(msg.meetingId, room);
        hub.sendTo([...room.users],
          { type: 'meeting:recording', meetingId: msg.meetingId, action: msg.action, by: uid });
        break;
      }
      case 'meeting:chat': {
        // 会议内聊天复用 IM 事件总线持久化；此处仅广播给在场成员
        const room = rooms.get(msg.meetingId);
        if (room) hub.sendTo([...room.users],
          { type: 'meeting:chat', meetingId: msg.meetingId, userId: uid, text: msg.text, t: Date.now() });
        break;
      }
      case 'meeting:lock': {
        const m = getMeeting(msg.meetingId);
        if (m?.host_id !== uid) throw new Error('仅主持人可锁定');
        setLock(msg.meetingId, msg.locked);
        const room = rooms.get(msg.meetingId);
        if (room) hub.sendTo([...room.users],
          { type: 'meeting:lock', meetingId: msg.meetingId, locked: msg.locked });
        break;
      }
      case 'meeting:ping':
        socket.send(JSON.stringify({ type: 'meeting:pong', t: Date.now() }));
        break;
    }
  };
}

// 供 HTTP 路由与调试端点查询实时状态
export const roomState = () => rooms;
export const activeRoomCount = () => rooms.size;
