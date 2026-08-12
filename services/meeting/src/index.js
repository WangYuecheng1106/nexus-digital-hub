// nexus-meeting：服务入口 + HTTP 路由
// 端口 8084：HTTP REST 管理会议元数据，WebSocket /ws 承载 WebRTC 信令
import { createService, createWsHub, asyncRoute, requireFields, forbidden, notFound, conflict, publishEvent, subscribeEvents } from '@nexus/shared';
import { handleWsMessage, roomState, activeRoomCount } from './ws.js';
import {
  db, createMeeting, getMeeting, getMeetingByNo, listMeetings, updateMeetingStatus,
  setLock, admitParticipant, removeParticipant, listParticipants, listWaiting,
  startRecording, stopRecording, listRecordings, listRooms, createRoom, bookRoom, listRoomBookings,
} from './repo.js';

let hub;

function hostOnly(meeting, userId) {
  if (meeting.host_id !== userId) throw forbidden('仅主持人可执行该操作');
}

const { ctx } = createService({
  name: 'meeting',
  port: 8084,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    hub = createWsHub({ server: ctx.server, path: '/ws', onMessage: handleWsMessage(() => hub) });
    setupRoutes(app);
    ctx.addDebug(() => ({
      activeRooms: activeRoomCount(),
      activeParticipants: [...roomState().values()].reduce((n, r) => n + r.users.size, 0),
      recordingRooms: [...roomState().values()].filter((r) => r.recordingId).length,
      totalMeetings: db.get('SELECT COUNT(*) c FROM meetings').c,
    }));
  },
});

subscribeEvents('meeting', 8084, ['calendar.event_updated']);

function setupRoutes(app) {
  // ---- 会议创建 ----
  app.post('/meetings', asyncRoute(async (req, res) => {
    requireFields(req.body, ['type']);
    const m = createMeeting(String(req.user.sub), req.body);
    publishEvent('meeting.created', { meetingId: m.id, meetingNo: m.meeting_no, hostId: m.host_id }, 'meeting');
    res.status(201).json(m);
  }));

  app.get('/meetings', (req, res) => {
    res.json(listMeetings(String(req.user.sub)));
  });

  app.get('/meetings/:id', (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) throw notFound('会议不存在');
    m.participants = listParticipants(m.id);
    res.json(m);
  });

  // 通过会议号加入：校验密码后返回会议信息，客户端再走 ws 完成 WebRTC 协商
  app.post('/meetings/join-by-no', asyncRoute(async (req, res) => {
    requireFields(req.body, ['meetingNo']);
    const m = getMeetingByNo(String(req.body.meetingNo));
    if (!m) throw notFound('会议号不存在');
    if (m.password && m.password !== req.body.password) throw forbidden('会议密码错误');
    res.json(m);
  }));

  app.post('/meetings/:id/end', asyncRoute(async (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) throw notFound('会议不存在');
    hostOnly(m, String(req.user.sub));
    updateMeetingStatus(m.id, 'ended');
    const room = roomState().get(m.id);
    if (room) hub.sendTo([...room.users], { type: 'meeting:ended', meetingId: m.id });
    publishEvent('meeting.ended', { meetingId: m.id }, 'meeting');
    res.json({ ok: true });
  }));

  app.post('/meetings/:id/lock', asyncRoute(async (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) throw notFound('会议不存在');
    hostOnly(m, String(req.user.sub));
    setLock(m.id, req.body.locked);
    res.json({ ok: true });
  }));

  // ---- 等候室 ----
  app.get('/meetings/:id/waiting', (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) throw notFound('会议不存在');
    hostOnly(m, String(req.user.sub));
    res.json(listWaiting(m.id));
  });

  app.post('/meetings/:id/admit', asyncRoute(async (req, res) => {
    requireFields(req.body, ['userId']);
    const m = getMeeting(req.params.id);
    if (!m) throw notFound('会议不存在');
    hostOnly(m, String(req.user.sub));
    admitParticipant(m.id, req.body.userId);
    hub.sendTo(req.body.userId, { type: 'meeting:admitted', meetingId: m.id });
    res.json({ ok: true });
  }));

  // ---- 参会者管理 ----
  app.get('/meetings/:id/participants', (req, res) => {
    res.json(listParticipants(req.params.id));
  });

  app.delete('/meetings/:id/participants/:userId', (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) throw notFound('会议不存在');
    hostOnly(m, String(req.user.sub));
    removeParticipant(m.id, req.params.userId);
    hub.sendTo(req.params.userId, { type: 'meeting:kicked', meetingId: m.id });
    res.json({ ok: true });
  });

  // ---- 录制管理 ----
  app.post('/meetings/:id/recording', asyncRoute(async (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) throw notFound('会议不存在');
    hostOnly(m, String(req.user.sub));
    const action = req.body.action;
    if (action === 'start') {
      const rid = startRecording(m.id, String(req.user.sub));
      res.json({ recordingId: rid });
    } else if (action === 'stop') {
      const r = stopRecording(req.body.recordingId);
      res.json({ recording: r });
    } else throw conflict('未知录制操作');
  }));

  app.get('/meetings/:id/recordings', (req, res) => {
    res.json(listRecordings(req.params.id));
  });

  // ---- 会议室预定 ----
  app.get('/rooms', (req, res) => res.json(listRooms()));
  app.post('/rooms', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name']);
    res.status(201).json(createRoom(req.body));
  }));
  app.post('/rooms/:id/book', asyncRoute(async (req, res) => {
    requireFields(req.body, ['startTime', 'endTime']);
    const b = bookRoom(req.params.id, req.body.meetingId, String(req.user.sub),
      Number(req.body.startTime), Number(req.body.endTime));
    if (!b) throw conflict('会议室该时段已被预定');
    res.status(201).json(b);
  }));
  app.get('/rooms/:id/bookings', (req, res) => res.json(listRoomBookings(req.params.id)));
}
