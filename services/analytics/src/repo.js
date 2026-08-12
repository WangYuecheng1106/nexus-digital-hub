// nexus-analytics：数据分析服务 — 数据层
// 采集全模块事件、预设报表、自定义报表、仪表盘、数据导出、定时邮件报表
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('analytics');

migrate(db, [
  ['events', `CREATE TABLE events (
    id TEXT PRIMARY KEY, source_module TEXT, event_type TEXT, user_id TEXT,
    properties TEXT, created_at INTEGER)`],
  ['idx_evt_module', `CREATE INDEX idx_evt_module ON events(source_module, event_type, created_at)`],
  ['idx_evt_user', `CREATE INDEX idx_evt_user ON events(user_id, created_at)`],
  ['dashboards', `CREATE TABLE dashboards (
    id TEXT PRIMARY KEY, name TEXT, layout TEXT, owner_id TEXT, created_at INTEGER)`],
  ['reports', `CREATE TABLE reports (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, config TEXT, schedule TEXT, created_at INTEGER)`],
]);

// 种子事件：模拟近 30 天的活跃数据，便于报表演示
function seedEvents() {
  if (db.get('SELECT COUNT(*) c FROM events').c > 0) return;
  const modules = ['im', 'meeting', 'workflow', 'document', 'attendance', 'project', 'forum', 'calendar'];
  const eventTypes = {
    im: ['message_sent', 'conversation_created'],
    meeting: ['meeting_created', 'meeting_joined', 'meeting_ended'],
    workflow: ['task_assigned', 'task_approved', 'task_rejected'],
    document: ['doc_created', 'doc_edited'],
    attendance: ['check_in', 'check_out', 'late'],
    project: ['task_created', 'task_completed'],
    forum: ['post_created', 'comment_added'],
    calendar: ['event_created', 'event_reminder'],
  };
  const now = Date.now();
  const stmts = [];
  for (let d = 29; d >= 0; d--) {
    const day = now - d * 24 * 60 * 60 * 1000;
    for (const m of modules) {
      const types = eventTypes[m];
      const count = 5 + Math.floor(Math.random() * 20);
      for (let i = 0; i < count; i++) {
        const t = types[Math.floor(Math.random() * types.length)];
        const userId = `u_${1000 + Math.floor(Math.random() * 50)}`;
        stmts.push([snowflake(), m, t, userId, JSON.stringify({ random: Math.random() }), day + Math.floor(Math.random() * 86400000)]);
      }
    }
  }
  const tx = db.raw;
  db.exec('BEGIN');
  try {
    const stmt = tx.prepare('INSERT INTO events (id, source_module, event_type, user_id, properties, created_at) VALUES (?,?,?,?,?,?)');
    for (const s of stmts) stmt.run(...s);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
seedEvents();

// 事件采集
export function recordEvent({ sourceModule, eventType, userId, properties }) {
  const id = snowflake();
  db.run('INSERT INTO events (id, source_module, event_type, user_id, properties, created_at) VALUES (?,?,?,?,?,?)',
    id, sourceModule, eventType, userId || null, JSON.stringify(properties || {}), Date.now());
  return id;
}

// 预设报表：按类型返回聚合数据
// 类型：activity(活跃度) / meetings(会议) / approvals(审批) / attendance(考勤) / collaboration(协作)
export function presetReport(type, { days = 30 } = {}) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  if (type === 'activity') {
    const rows = db.all(`SELECT date(created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) c, COUNT(DISTINCT user_id) u
      FROM events WHERE created_at >= ? GROUP BY day ORDER BY day`, since);
    return { type, chartType: 'line', series: [{ name: '事件数', data: rows.map((r) => r.c) }, { name: '活跃用户', data: rows.map((r) => r.u) }], labels: rows.map((r) => r.day) };
  }
  if (type === 'meetings') {
    const rows = db.all(`SELECT event_type, COUNT(*) c FROM events WHERE source_module = 'meeting' AND created_at >= ? GROUP BY event_type`, since);
    return { type, chartType: 'bar', series: rows.map((r) => r.c), labels: rows.map((r) => r.event_type) };
  }
  if (type === 'approvals') {
    const rows = db.all(`SELECT event_type, COUNT(*) c FROM events WHERE source_module = 'workflow' AND created_at >= ? GROUP BY event_type`, since);
    return { type, chartType: 'pie', series: rows.map((r) => r.c), labels: rows.map((r) => r.event_type) };
  }
  if (type === 'attendance') {
    const rows = db.all(`SELECT date(created_at/1000, 'unixepoch', 'localtime') AS day, SUM(CASE WHEN event_type = 'late' THEN 1 ELSE 0 END) late, COUNT(*) total
      FROM events WHERE source_module = 'attendance' AND created_at >= ? GROUP BY day ORDER BY day`, since);
    return { type, chartType: 'area', series: [{ name: '打卡', data: rows.map((r) => r.total) }, { name: '迟到', data: rows.map((r) => r.late) }], labels: rows.map((r) => r.day) };
  }
  if (type === 'collaboration') {
    const rows = db.all(`SELECT source_module, COUNT(*) c FROM events WHERE created_at >= ? AND source_module IN ('im','document','project','forum') GROUP BY source_module ORDER BY c DESC`, since);
    return { type, chartType: 'funnel', series: rows.map((r) => r.c), labels: rows.map((r) => r.source_module) };
  }
  return { type, chartType: 'table', series: [], labels: [] };
}

// 自定义报表：根据 config 中的 module/eventType/分组维度查询
export function customReport(config) {
  const { module, eventType, groupBy = 'day', days = 30 } = config || {};
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  let sql = `SELECT date(created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) c FROM events WHERE created_at >= ?`;
  const params = [since];
  if (module) { sql += ' AND source_module = ?'; params.push(module); }
  if (eventType) { sql += ' AND event_type = ?'; params.push(eventType); }
  sql += ` GROUP BY day ORDER BY day`;
  const rows = db.all(sql, ...params);
  return { chartType: 'line', series: rows.map((r) => r.c), labels: rows.map((r) => r.day) };
}

// 仪表盘 CRUD
export function createDashboard(userId, name, layout) {
  const id = snowflake();
  db.run('INSERT INTO dashboards (id, name, layout, owner_id, created_at) VALUES (?,?,?,?,?)', id, name, JSON.stringify(layout || []), userId, Date.now());
  return db.get('SELECT * FROM dashboards WHERE id = ?', id);
}
export function listDashboards(userId) {
  return db.all('SELECT * FROM dashboards WHERE owner_id = ? ORDER BY created_at DESC', userId).map((d) => ({ ...d, layout: JSON.parse(d.layout) }));
}
export function getDashboard(id) { const d = db.get('SELECT * FROM dashboards WHERE id = ?', id); return d ? { ...d, layout: JSON.parse(d.layout) } : null; }
export function updateDashboard(id, { name, layout }) {
  db.run('UPDATE dashboards SET name = COALESCE(?, name), layout = COALESCE(?, layout) WHERE id = ?', name, layout ? JSON.stringify(layout) : null, id);
  return getDashboard(id);
}
export function deleteDashboard(id) { db.run('DELETE FROM dashboards WHERE id = ?', id); }

// 自定义报表 CRUD
export function createReport(name, type, config, schedule) {
  const id = snowflake();
  db.run('INSERT INTO reports (id, name, type, config, schedule, created_at) VALUES (?,?,?,?,?,?)',
    id, name, type || 'custom', JSON.stringify(config || {}), schedule || null, Date.now());
  return db.get('SELECT * FROM reports WHERE id = ?', id);
}
export function listReports() {
  return db.all('SELECT * FROM reports ORDER BY created_at DESC').map((r) => ({ ...r, config: JSON.parse(r.config) }));
}
export function getReport(id) { const r = db.get('SELECT * FROM reports WHERE id = ?', id); return r ? { ...r, config: JSON.parse(r.config), schedule: r.schedule ? JSON.parse(r.schedule) : null } : null; }
export function deleteReport(id) { db.run('DELETE FROM reports WHERE id = ?', id); }
export function setReportSchedule(id, schedule) {
  db.run('UPDATE reports SET schedule = ? WHERE id = ?', JSON.stringify(schedule || null), id);
  return getReport(id);
}

// 导出：CSV（Excel 通过 xlsx 在 index.js 处理）
export function exportEvents({ module, eventType, days = 30 } = {}) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  let sql = `SELECT id, source_module, event_type, user_id, properties, created_at FROM events WHERE created_at >= ?`;
  const params = [since];
  if (module) { sql += ' AND source_module = ?'; params.push(module); }
  if (eventType) { sql += ' AND event_type = ?'; params.push(eventType); }
  sql += ' ORDER BY created_at DESC LIMIT 10000';
  return db.all(sql, ...params);
}
