// nexus-calendar：日程服务 — 数据层
// 选用嵌入式 SQLite（node:sqlite）承载日程数据：单机零基础设施、WAL 模式下并发读性能充足；
// 后续若扩为多副本可平滑切到 PostgreSQL，业务层 SQL 不需改动。
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('calendar');

migrate(db, [
  ['events', `CREATE TABLE events (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, desc TEXT, start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL, all_day INTEGER DEFAULT 0, repeat_rule TEXT,
    location TEXT, organizer_id TEXT NOT NULL, calendar_type TEXT DEFAULT 'personal',
    color TEXT, meeting_link TEXT, created_at INTEGER)`],
  ['idx_event_time', `CREATE INDEX idx_event_time ON events(start_time, end_time)`],
  ['idx_event_organizer', `CREATE INDEX idx_event_organizer ON events(organizer_id)`],
  ['attendees', `CREATE TABLE event_attendees (
    event_id TEXT, user_id TEXT, status TEXT DEFAULT 'pending',
    responded_at INTEGER, PRIMARY KEY (event_id, user_id))`],
  ['reminders', `CREATE TABLE reminders (
    id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, remind_before_min INTEGER,
    sent INTEGER DEFAULT 0, created_at INTEGER)`],
  ['idx_reminder', `CREATE INDEX idx_reminder ON reminders(sent, user_id)`],
]);

// 2026 中国法定节假日与调休安排。来源：国务院办公厅 2026 年放假通知。
// 内置静态表避免外部依赖；每年初由管理员通过 /holidays 重新发布即可。
export const HOLIDAYS_2026 = [
  { date: '2026-01-01', name: '元旦', type: 'holiday' },
  { date: '2026-02-15', name: '春节', type: 'holiday' }, { date: '2026-02-16', name: '春节', type: 'holiday' },
  { date: '2026-02-17', name: '春节', type: 'holiday' }, { date: '2026-02-18', name: '春节', type: 'holiday' },
  { date: '2026-02-19', name: '春节', type: 'holiday' }, { date: '2026-02-20', name: '春节', type: 'holiday' },
  { date: '2026-02-21', name: '春节调休', type: 'work' },
  { date: '2026-04-04', name: '清明节', type: 'holiday' }, { date: '2026-04-05', name: '清明节', type: 'holiday' },
  { date: '2026-04-06', name: '清明节', type: 'holiday' },
  { date: '2026-05-01', name: '劳动节', type: 'holiday' }, { date: '2026-05-02', name: '劳动节', type: 'holiday' },
  { date: '2026-05-03', name: '劳动节', type: 'holiday' }, { date: '2026-05-04', name: '劳动节', type: 'holiday' },
  { date: '2026-05-05', name: '劳动节', type: 'holiday' },
  { date: '2026-06-19', name: '端午节', type: 'holiday' }, { date: '2026-06-20', name: '端午节', type: 'holiday' },
  { date: '2026-06-21', name: '端午节', type: 'holiday' },
  { date: '2026-09-25', name: '中秋节', type: 'holiday' }, { date: '2026-09-26', name: '中秋节', type: 'holiday' },
  { date: '2026-09-27', name: '中秋节', type: 'holiday' },
  { date: '2026-10-01', name: '国庆节', type: 'holiday' }, { date: '2026-10-02', name: '国庆节', type: 'holiday' },
  { date: '2026-10-03', name: '国庆节', type: 'holiday' }, { date: '2026-10-04', name: '国庆节', type: 'holiday' },
  { date: '2026-10-05', name: '国庆节', type: 'holiday' }, { date: '2026-10-06', name: '国庆节', type: 'holiday' },
  { date: '2026-10-07', name: '国庆节', type: 'holiday' }, { date: '2026-10-08', name: '国庆节调休', type: 'work' },
];

export function insertEvent(organizerId, body) {
  const id = snowflake();
  const now = Date.now();
  db.run(`INSERT INTO events (id,title,desc,start_time,end_time,all_day,repeat_rule,location,
    organizer_id,calendar_type,color,meeting_link,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, body.title, body.desc || '', body.start_time, body.end_time, body.all_day ? 1 : 0,
    body.repeat_rule ? JSON.stringify(body.repeat_rule) : null, body.location || '',
    organizerId, body.calendar_type || 'personal', body.color || '#1677FF', body.meeting_link || '', now);
  return db.get('SELECT * FROM events WHERE id = ?', id);
}

// 重复规则展开：将一个带 repeat_rule 的事件在查询区间内展开为多个实例。
// 不写死实例表是为了避免海量数据；按需展开兼顾存储与查询效率。
export function expandRepeats(event, from, to) {
  const rule = event.repeat_rule ? JSON.parse(event.repeat_rule) : null;
  if (!rule || !rule.freq || rule.freq === 'none') {
    return [{ ...event, instance_start: event.start_time, instance_end: event.end_time }];
  }
  const until = rule.until || to;
  const instances = [];
  const dur = event.end_time - event.start_time;
  let cur = event.start_time;
  const dayMs = 86400000;
  let guard = 0;
  while (cur <= until && cur <= to && guard < 1000) {
    guard++;
    if (cur >= from) instances.push({ ...event, instance_start: cur, instance_end: cur + dur });
    if (rule.freq === 'daily') cur += dayMs * (rule.interval || 1);
    else if (rule.freq === 'weekly') cur += dayMs * 7 * (rule.interval || 1);
    else if (rule.freq === 'monthly') cur = addMonths(cur, rule.interval || 1);
    else if (rule.freq === 'yearly') cur = addMonths(cur, 12 * (rule.interval || 1));
    else break;
  }
  return instances;
}

function addMonths(ts, m) {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + m);
  return d.getTime();
}

// 冲突检测：同一组织者/参会人时间段重叠即视为冲突。返回冲突事件列表。
export function detectConflicts(eventId, userIds, start, end) {
  const ids = userIds.map(() => '?').join(',');
  const rows = db.all(
    `SELECT e.* FROM events e JOIN event_attendees a ON a.event_id = e.id
     WHERE a.user_id IN (${ids}) AND a.status != 'declined'
     AND e.start_time < ? AND e.end_time > ? AND e.id != ?`,
    ...userIds, end, start, eventId || '');
  return rows;
}

export function listRemindersDue(now) {
  return db.all(`SELECT r.id, r.event_id, r.user_id, r.remind_before_min, e.title, e.start_time
    FROM reminders r JOIN events e ON e.id = r.event_id
    WHERE r.sent = 0 AND (e.start_time - r.remind_before_min * 60000) <= ?`, now);
}
