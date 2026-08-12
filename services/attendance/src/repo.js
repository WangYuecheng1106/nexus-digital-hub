// nexus-attendance：考勤打卡、排班、请假与统计的数据层。
// 嵌入式 SQLite 存储，所有 SQL 集中于此，业务路由只调用本模块导出的函数。
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('attendance');

migrate(db, [
  ['shifts', `CREATE TABLE shifts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
    flexible INTEGER DEFAULT 0, grace_min INTEGER DEFAULT 0, created_at INTEGER)`],
  ['user_shifts', `CREATE TABLE user_shifts (
    user_id TEXT, shift_id TEXT, date TEXT,
    PRIMARY KEY (user_id, date))`],
  ['punches', `CREATE TABLE punches (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, punch_time INTEGER NOT NULL,
    type TEXT NOT NULL, method TEXT NOT NULL, location TEXT, note TEXT, photo TEXT,
    shift_id TEXT, status TEXT DEFAULT 'normal', created_at INTEGER)`],
  ['idx_punch_user_time', `CREATE INDEX idx_punch_user_time ON punches(user_id, punch_time)`],
  ['leave_requests', `CREATE TABLE leave_requests (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, days REAL NOT NULL,
    reason TEXT, status TEXT DEFAULT 'pending', workflow_id TEXT, created_at INTEGER)`],
  ['leave_balances', `CREATE TABLE leave_balances (
    user_id TEXT, type TEXT, balance REAL DEFAULT 0, used REAL DEFAULT 0,
    PRIMARY KEY (user_id, type))`],
]);

// 内置班次：固定班、弹性班、早中夜轮班
export function seedShifts() {
  if (db.get('SELECT COUNT(*) c FROM shifts').c > 0) return;
  const now = Date.now();
  const defaults = [
    ['shift-fixed', '标准班 09:00-18:00', '09:00', '18:00', 0, 15],
    ['shift-flexible', '弹性班 08:30-10:00 弹性', '08:30', '18:30', 1, 30],
    ['shift-early', '早班 06:00-14:00', '06:00', '14:00', 0, 10],
    ['shift-middle', '中班 14:00-22:00', '14:00', '22:00', 0, 10],
    ['shift-night', '夜班 22:00-06:00', '22:00', '06:00', 0, 10],
  ];
  for (const [id, name, s, e, flex, grace] of defaults) {
    db.run('INSERT OR IGNORE INTO shifts (id,name,start_time,end_time,flexible,grace_min,created_at) VALUES (?,?,?,?,?,?,?)',
      id, name, s, e, flex, grace, now);
  }
  // 演示用户默认分配标准班
  for (const u of ['user-admin', 'user-zhangwei', 'user-lina', 'user-wangfang', 'user-chenjie', 'user-liuyang']) {
    for (const t of ['annual', 'sick', 'personal']) {
      db.run('INSERT OR IGNORE INTO leave_balances (user_id,type,balance,used) VALUES (?,?,?,0)', u, t, t === 'annual' ? 10 : 5);
    }
  }
}

// "HH:MM" → 当日分钟数，便于与打卡时间比较
function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 获取用户某天生效班次：优先 user_shifts 指定，否则回退到标准班
export function getEffectiveShift(userId, date) {
  const assigned = db.get('SELECT s.* FROM user_shifts us JOIN shifts s ON s.id = us.shift_id WHERE us.user_id = ? AND us.date = ?',
    String(userId), date);
  return assigned || db.get("SELECT * FROM shifts WHERE id = 'shift-fixed'");
}

// 判定打卡状态：late/early/normal/overtime，弹性班只记 normal
export function classifyPunch(shift, punchTime, type) {
  if (!shift || shift.flexible) return 'normal';
  const d = new Date(punchTime);
  const dayMin = d.getHours() * 60 + d.getMinutes();
  const start = timeToMin(shift.start_time);
  const end = timeToMin(shift.end_time);
  const grace = shift.grace_min || 0;
  // 夜班跨天：下班时间小于上班时间，将下班基准加 24h
  const endAdj = end < start ? end + 24 * 60 : end;
  if (type === 'check_in') {
    return dayMin > start + grace ? 'late' : 'normal';
  }
  const base = dayMin < start ? dayMin + 24 * 60 : dayMin;
  if (base < endAdj - grace) return 'early';
  if (base > endAdj + 30) return 'overtime';
  return 'normal';
}

export function recordPunch(userId, { method, type, location, note, photo }) {
  const now = Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  const shift = getEffectiveShift(userId, date);
  // 未指定 type 时按当日已有打卡自动推断
  let punchType = type;
  if (!punchType) {
    const last = db.get("SELECT type FROM punches WHERE user_id = ? AND date(punch_time/1000,'unixepoch') = ? ORDER BY punch_time DESC LIMIT 1",
      String(userId), date);
    punchType = last?.type === 'check_in' ? 'check_out' : 'check_in';
  }
  const status = classifyPunch(shift, now, punchType);
  const id = snowflake();
  db.run(`INSERT INTO punches (id,user_id,punch_time,type,method,location,note,photo,shift_id,status,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, String(userId), now, punchType, method, location || '', note || '', photo || '',
    shift?.id || null, status, now);
  return { id, user_id: String(userId), punch_time: now, type: punchType, method, location, note, photo, status, shift_id: shift?.id };
}

export function getRecords(userId, month) {
  // month 形如 2026-08；按月份过滤 punches
  const start = Date.UTC(month.slice(0, 4), month.slice(5, 7) - 1, 1);
  const end = Date.UTC(month.slice(0, 4), month.slice(5, 7), 1);
  return db.all('SELECT * FROM punches WHERE user_id = ? AND punch_time >= ? AND punch_time < ? ORDER BY punch_time',
    String(userId), start, end);
}

export function createLeave(userId, { type, startDate, endDate, days, reason }) {
  const bal = db.get('SELECT * FROM leave_balances WHERE user_id = ? AND type = ?', String(userId), type);
  if (bal && bal.balance - bal.used < days) {
    const e = new Error('假期余额不足');
    e.status = 409; throw e;
  }
  const id = snowflake();
  db.tx(() => {
    db.run(`INSERT INTO leave_requests (id,user_id,type,start_date,end_date,days,reason,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      id, String(userId), type, startDate, endDate, days, reason || '', 'pending', Date.now());
    if (bal) db.run('UPDATE leave_balances SET used = used + ? WHERE user_id = ? AND type = ?', days, String(userId), type);
  });
  return { id, status: 'pending' };
}

export function getLeaveBalances(userId) {
  return db.all('SELECT type, balance, used FROM leave_balances WHERE user_id = ?', String(userId));
}

// 个人月报：出勤/迟到/早退/请假/加班/旷工 统计
export function personalReport(userId, month) {
  const records = getRecords(userId, month);
  const stats = { userId, month, attendDays: 0, late: 0, early: 0, overtime: 0, leaveDays: 0, absent: 0, totalPunches: records.length };
  const dayMap = new Map();
  for (const r of records) {
    const day = new Date(r.punch_time).toISOString().slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, {});
    dayMap.get(day)[r.type] = r;
    if (r.status === 'late') stats.late++;
    if (r.status === 'early') stats.early++;
    if (r.status === 'overtime') stats.overtime++;
  }
  stats.attendDays = dayMap.size;
  // 请假天数
  const leaves = db.all("SELECT days FROM leave_requests WHERE user_id = ? AND status = 'approved' AND start_date LIKE ?",
    String(userId), `${month}-%`);
  stats.leaveDays = leaves.reduce((s, l) => s + l.days, 0);
  return stats;
}

// 部门月报：聚合多个用户的个人月报
export function deptReport(userIds, month) {
  return userIds.map((u) => personalReport(u, month));
}

// CSV 导出：列含用户、日期、类型、方式、状态、位置、备注
export function exportCsv(userIds, month) {
  const rows = [['user_id', 'date', 'time', 'type', 'method', 'status', 'location', 'note']];
  for (const u of userIds) {
    for (const r of getRecords(u, month)) {
      const d = new Date(r.punch_time);
      rows.push([r.user_id, d.toISOString().slice(0, 10), d.toTimeString().slice(0, 8), r.type, r.method, r.status, r.location, r.note]);
    }
  }
  return rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
