// nexus-calendar：HTTP REST 路由
// 日/周/月/议程四种视图共用一个查询函数，按时间区间过滤后由前端按视图渲染；
// 重复事件在此处展开为实例，避免前端重复实现展开逻辑。
import { asyncRoute, requireFields, badRequest, notFound, forbidden, publishEvent, pageParams, snowflake } from '@nexus/shared';
import { db, insertEvent, expandRepeats, detectConflicts, HOLIDAYS_2026 } from './repo.js';

export function setupRoutes(app) {
  // ---- 事件 CRUD ----
  app.post('/events', asyncRoute(async (req, res) => {
    requireFields(req.body, ['title', 'start_time', 'end_time']);
    if (req.body.end_time <= req.body.start_time) throw badRequest('结束时间必须晚于开始时间');
    const ev = insertEvent(String(req.user.sub), req.body);
    // 组织者默认参会，避免组织者自身漏掉会议
    db.run('INSERT OR IGNORE INTO event_attendees (event_id, user_id, status, responded_at) VALUES (?,?,?,?)',
      ev.id, String(req.user.sub), 'accepted', Date.now());
    publishEvent('calendar.event_created', { eventId: ev.id, organizerId: req.user.sub }, 'calendar');
    res.status(201).json(ev);
  }));

  app.get('/events', asyncRoute(async (req, res) => {
    const { from, to, view } = req.query;
    if (!from || !to) throw badRequest('需要 from 与 to 时间参数');
    const f = Number(from), t = Number(to);
    const rows = db.all('SELECT * FROM events WHERE start_time < ? AND end_time > ? ORDER BY start_time', t, f);
    // 仅返回当前用户可见的事件：组织者本人或被邀请且未拒绝
    const visible = [];
    for (const e of rows) {
      const attendee = db.get('SELECT status FROM event_attendees WHERE event_id = ? AND user_id = ?', e.id, String(req.user.sub));
      if (e.organizer_id !== String(req.user.sub) && (!attendee || attendee.status === 'declined')) continue;
      for (const inst of expandRepeats(e, f, t)) visible.push(inst);
    }
    res.json({ view: view || 'range', events: visible });
  }));

  app.get('/events/:id', (req, res) => {
    const ev = db.get('SELECT * FROM events WHERE id = ?', req.params.id);
    if (!ev) throw notFound('事件不存在');
    ev.attendees = db.all('SELECT user_id, status, responded_at FROM event_attendees WHERE event_id = ?', ev.id);
    ev.reminders = db.all('SELECT id, user_id, remind_before_min, sent FROM reminders WHERE event_id = ?', ev.id);
    res.json(ev);
  });

  app.put('/events/:id', asyncRoute(async (req, res) => {
    const ev = db.get('SELECT * FROM events WHERE id = ?', req.params.id);
    if (!ev) throw notFound('事件不存在');
    if (ev.organizer_id !== String(req.user.sub)) throw forbidden('仅组织者可编辑');
    const { title, desc, start_time, end_time, all_day, repeat_rule, location, color, meeting_link } = req.body;
    db.run(`UPDATE events SET title=COALESCE(?,title), desc=COALESCE(?,desc),
      start_time=COALESCE(?,start_time), end_time=COALESCE(?,end_time), all_day=COALESCE(?,all_day),
      repeat_rule=COALESCE(?,repeat_rule), location=COALESCE(?,location),
      color=COALESCE(?,color), meeting_link=COALESCE(?,meeting_link) WHERE id=?`,
      title, desc, start_time, end_time, all_day === undefined ? null : all_day ? 1 : 0,
      repeat_rule ? JSON.stringify(repeat_rule) : null, location, color, meeting_link, req.params.id);
    res.json({ ok: true });
  }));

  app.delete('/events/:id', (req, res) => {
    const ev = db.get('SELECT * FROM events WHERE id = ?', req.params.id);
    if (!ev) throw notFound('事件不存在');
    if (ev.organizer_id !== String(req.user.sub)) throw forbidden('仅组织者可删除');
    db.tx(() => {
      db.run('DELETE FROM event_attendees WHERE event_id = ?', req.params.id);
      db.run('DELETE FROM reminders WHERE event_id = ?', req.params.id);
      db.run('DELETE FROM events WHERE id = ?', req.params.id);
    });
    publishEvent('calendar.event_deleted', { eventId: req.params.id }, 'calendar');
    res.json({ ok: true });
  });

  // ---- 邀请参会人 ----
  app.post('/events/:id/invite', asyncRoute(async (req, res) => {
    requireFields(req.body, ['userIds']);
    const ev = db.get('SELECT * FROM events WHERE id = ?', req.params.id);
    if (!ev) throw notFound('事件不存在');
    const conflicts = detectConflicts(ev.id, req.body.userIds, ev.start_time, ev.end_time);
    db.tx(() => {
      for (const uid of req.body.userIds) {
        db.run('INSERT OR IGNORE INTO event_attendees (event_id, user_id, status) VALUES (?,?,?)', ev.id, uid, 'pending');
      }
    });
    publishEvent('calendar.event_invited', { eventId: ev.id, userIds: req.body.userIds }, 'calendar');
    res.json({ ok: true, conflicts });
  }));

  // ---- 参会人回复：accept/decline/tentative ----
  app.post('/events/:id/respond', (req, res) => {
    const status = ['accepted', 'declined', 'tentative'].includes(req.body.status) ? req.body.status : null;
    if (!status) throw badRequest('status 必须为 accepted/declined/tentative');
    const r = db.run('UPDATE event_attendees SET status = ?, responded_at = ? WHERE event_id = ? AND user_id = ?',
      status, Date.now(), req.params.id, String(req.user.sub));
    if (r.changes === 0) throw notFound('未找到邀请记录');
    publishEvent('calendar.event_responded', { eventId: req.params.id, userId: req.user.sub, status }, 'calendar');
    res.json({ ok: true, status });
  });

  // ---- 提醒：为事件添加提醒（事件开始前 N 分钟） ----
  app.post('/events/:id/reminders', (req, res) => {
    requireFields(req.body, ['remind_before_min']);
    const id = snowflake();
    db.run('INSERT INTO reminders (id, event_id, user_id, remind_before_min, created_at) VALUES (?,?,?,?,?)',
      id, req.params.id, String(req.user.sub), req.body.remind_before_min, Date.now());
    res.status(201).json({ id });
  });

  app.get('/reminders/due', (req, res) => {
    res.json(db.all(`SELECT r.id, r.event_id, r.user_id, r.remind_before_min, e.title, e.start_time
      FROM reminders r JOIN events e ON e.id = r.event_id
      WHERE r.sent = 0 AND (e.start_time - r.remind_before_min * 60000) <= ?`, Date.now()));
  });

  // ---- 视图聚合：日/周/月/议程 ----
  // 单独端点便于前端按视图直接拉取；底层复用 /events 的展开逻辑
  app.get('/views/:view', asyncRoute(async (req, res) => {
    const view = req.params.view;
    const now = new Date();
    let from, to;
    if (view === 'day') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      to = from + 86400000;
    } else if (view === 'week') {
      const day = now.getDay() || 7;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1).getTime();
      to = from + 86400000 * 7;
    } else if (view === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    } else if (view === 'agenda') {
      from = Date.now();
      to = from + 86400000 * 30;
    } else throw badRequest('未知视图');
    const rows = db.all('SELECT * FROM events WHERE start_time < ? AND end_time > ? ORDER BY start_time', to, from);
    const items = [];
    for (const e of rows) {
      if (e.organizer_id !== String(req.user.sub) &&
        !db.get('SELECT 1 FROM event_attendees WHERE event_id = ? AND user_id = ? AND status != ?', e.id, String(req.user.sub), 'declined')) continue;
      for (const inst of expandRepeats(e, from, to)) items.push(inst);
    }
    items.sort((a, b) => a.instance_start - b.instance_start);
    res.json({ view, from, to, items });
  }));

  // ---- 节假日 ----
  app.get('/holidays', (req, res) => {
    const year = req.query.year ? Number(req.query.year) : 2026;
    const list = year === 2026 ? HOLIDAYS_2026 : [];
    res.json({ year, holidays: list });
  });

  // ---- 共享日历：列出某用户/某类型日历下的事件 ----
  app.get('/calendars/:type', (req, res) => {
    const { page, size, offset } = pageParams(req);
    const total = db.get('SELECT COUNT(*) c FROM events WHERE calendar_type = ?', req.params.type).c;
    const rows = db.all('SELECT * FROM events WHERE calendar_type = ? ORDER BY start_time DESC LIMIT ? OFFSET ?',
      req.params.type, size, offset);
    res.json({ page, size, total, items: rows });
  });
}
