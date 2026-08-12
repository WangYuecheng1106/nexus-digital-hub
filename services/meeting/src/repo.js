// nexus-meeting：数据层 —— 会议、参会者、录制、会议室的持久化
// 选用 SQLite 嵌入存储：会议元数据写多读少且需事务保证，单机部署避免引入外部 DB
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('meeting');

migrate(db, [
  ['meetings', `CREATE TABLE meetings (
    id TEXT PRIMARY KEY, meeting_no TEXT UNIQUE NOT NULL, title TEXT, type TEXT NOT NULL,
    password TEXT, host_id TEXT NOT NULL, status TEXT DEFAULT 'waiting',
    recording INTEGER DEFAULT 0, locked INTEGER DEFAULT 0,
    created_at INTEGER, started_at INTEGER, ended_at INTEGER, description TEXT)`],
  ['participants', `CREATE TABLE participants (
    meeting_id TEXT, user_id TEXT, name TEXT, role TEXT DEFAULT 'participant',
    hand_raised INTEGER DEFAULT 0, audio_muted INTEGER DEFAULT 0, video_off INTEGER DEFAULT 0,
    joined_at INTEGER, left_at INTEGER, waiting INTEGER DEFAULT 1,
    PRIMARY KEY (meeting_id, user_id))`],
  ['recordings', `CREATE TABLE recordings (
    id TEXT PRIMARY KEY, meeting_id TEXT, started_at INTEGER, ended_at INTEGER,
    size INTEGER, url TEXT, created_by TEXT)`],
  ['idx_rec_meeting', `CREATE INDEX idx_rec_meeting ON recordings(meeting_id)`],
  ['rooms', `CREATE TABLE rooms (
    id TEXT PRIMARY KEY, name TEXT, capacity INTEGER, equipment TEXT,
    location TEXT, status TEXT DEFAULT 'available')`],
  ['room_bookings', `CREATE TABLE room_bookings (
    id TEXT PRIMARY KEY, room_id TEXT, meeting_id TEXT, user_id TEXT,
    start_time INTEGER, end_time INTEGER, status TEXT DEFAULT 'confirmed')`],
  ['idx_booking_room', `CREATE INDEX idx_booking_room ON room_bookings(room_id, start_time, end_time)`],
]);

// 9 位会议号：碰撞概率极低但仍有重试必要，循环生成直到唯一
export function genMeetingNo() {
  for (let i = 0; i < 5; i++) {
    const no = String(Math.floor(100000000 + Math.random() * 900000000));
    if (!db.get('SELECT 1 FROM meetings WHERE meeting_no = ?', no)) return no;
  }
  throw new Error('meeting_no collision');
}

export function createMeeting(hostId, body) {
  const id = snowflake();
  const now = Date.now();
  const meetingNo = genMeetingNo();
  db.run(`INSERT INTO meetings (id, meeting_no, title, type, password, host_id, status, created_at, description)
          VALUES (?,?,?,?,?,?, 'waiting', ?, ?)`,
    id, meetingNo, body.title || '即时会议', body.type || 'instant',
    body.password || '', hostId, now, body.description || '');
  // 预约会议的受邀者预先落库为 waiting=1，加入时再激活
  if (body.participants?.length) {
    for (const uid of body.participants) {
      db.run('INSERT OR IGNORE INTO participants (meeting_id, user_id, joined_at) VALUES (?,?,?)', id, uid, now);
    }
  }
  return db.get('SELECT * FROM meetings WHERE id = ?', id);
}

export const getMeeting = (id) => db.get('SELECT * FROM meetings WHERE id = ?', id);
export const getMeetingByNo = (no) => db.get('SELECT * FROM meetings WHERE meeting_no = ?', no);
export const listMeetings = (hostId) =>
  db.all('SELECT * FROM meetings WHERE host_id = ? ORDER BY created_at DESC', hostId);

export function updateMeetingStatus(id, status) {
  const now = Date.now();
  if (status === 'active') db.run('UPDATE meetings SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?', status, now, id);
  else if (status === 'ended') db.run('UPDATE meetings SET status = ?, ended_at = ? WHERE id = ?', status, now, id);
  else db.run('UPDATE meetings SET status = ? WHERE id = ?', status, id);
}

export function setLock(id, locked) {
  db.run('UPDATE meetings SET locked = ? WHERE id = ?', locked ? 1 : 0, id);
}

export function addParticipant(meetingId, userId, role = 'participant', waiting = 1) {
  const now = Date.now();
  const existing = db.get('SELECT 1 FROM participants WHERE meeting_id = ? AND user_id = ?', meetingId, userId);
  if (existing) {
    // 复用记录便于历史回溯：清空离开时间，更新等候状态
    db.run('UPDATE participants SET waiting = ?, left_at = NULL, role = ? WHERE meeting_id = ? AND user_id = ?',
      waiting, role, meetingId, userId);
  } else {
    db.run('INSERT INTO participants (meeting_id, user_id, role, waiting, joined_at) VALUES (?,?,?,?,?)',
      meetingId, userId, role, waiting, now);
  }
}

export const getParticipant = (meetingId, userId) =>
  db.get('SELECT * FROM participants WHERE meeting_id = ? AND user_id = ?', meetingId, userId);
export const listParticipants = (meetingId) =>
  db.all('SELECT * FROM participants WHERE meeting_id = ? AND left_at IS NULL', meetingId);
export const listWaiting = (meetingId) =>
  db.all('SELECT * FROM participants WHERE meeting_id = ? AND waiting = 1', meetingId);

export function admitParticipant(meetingId, userId) {
  db.run('UPDATE participants SET waiting = 0 WHERE meeting_id = ? AND user_id = ?', meetingId, userId);
}

export function removeParticipant(meetingId, userId) {
  db.run('UPDATE participants SET left_at = ? WHERE meeting_id = ? AND user_id = ?',
    Date.now(), meetingId, userId);
}

export function updateParticipantState(meetingId, userId, field, value) {
  db.run(`UPDATE participants SET ${field} = ? WHERE meeting_id = ? AND user_id = ?`,
    value ? 1 : 0, meetingId, userId);
}

export function startRecording(meetingId, userId) {
  const id = snowflake();
  db.run('INSERT INTO recordings (id, meeting_id, started_at, created_by) VALUES (?,?,?)',
    id, meetingId, Date.now(), userId);
  db.run('UPDATE meetings SET recording = 1 WHERE id = ?', meetingId);
  return id;
}

export function stopRecording(recId) {
  const r = db.get('SELECT * FROM recordings WHERE id = ?', recId);
  db.run('UPDATE recordings SET ended_at = ? WHERE id = ?', Date.now(), recId);
  db.run('UPDATE meetings SET recording = 0 WHERE id = ?', r.meeting_id);
  return r;
}

export const listRecordings = (meetingId) =>
  db.all('SELECT * FROM recordings WHERE meeting_id = ? ORDER BY started_at DESC', meetingId);

export const listRooms = () => db.all('SELECT * FROM rooms ORDER BY name');
export const createRoom = (body) => {
  const id = snowflake();
  db.run('INSERT INTO rooms (id, name, capacity, equipment, location, status) VALUES (?,?,?,?,?,?)',
    id, body.name, body.capacity || 10, body.equipment || '', body.location || '', 'available');
  return db.get('SELECT * FROM rooms WHERE id = ?', id);
};

export function bookRoom(roomId, meetingId, userId, start, end) {
  // 冲突检测：同会议室时间区间重叠即拒绝，避免双重预定
  const conflict = db.get(`SELECT id FROM room_bookings WHERE room_id = ? AND status = 'confirmed'
    AND start_time < ? AND end_time > ?`, roomId, end, start);
  if (conflict) return null;
  const id = snowflake();
  db.run('INSERT INTO room_bookings (id, room_id, meeting_id, user_id, start_time, end_time) VALUES (?,?,?,?,?,?)',
    id, roomId, meetingId, userId, start, end);
  return db.get('SELECT * FROM room_bookings WHERE id = ?', id);
}

export const listRoomBookings = (roomId) =>
  db.all('SELECT * FROM room_bookings WHERE room_id = ? ORDER BY start_time', roomId);
