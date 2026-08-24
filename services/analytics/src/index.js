// nexus-analytics：服务入口 + HTTP 路由
// 事件采集、预设/自定义报表、仪表盘、CSV/Excel 导出、定时邮件报表
import { createService, asyncRoute, requireFields, notFound, pageParams, subscribeEvents } from '@nexus/shared';
import * as XLSX from 'xlsx';
import {
  db, recordEvent, presetReport, customReport,
  createDashboard, listDashboards, getDashboard, updateDashboard, deleteDashboard,
  createReport, listReports, getReport, deleteReport, setReportSchedule, exportEvents,
} from './repo.js';

const { ctx } = createService({
  name: 'analytics',
  port: 8097,
  publicPaths: ['/health', '/debug', '/internal/events'],
  setup(app, ctx) {
    setupRoutes(app);
    // 订阅全模块事件并入库，构成统一数据底座
    ctx.onEvent('*', (payload, meta) => {
      recordEvent({ sourceModule: meta.source, eventType: meta.type, userId: payload?.userId, properties: payload });
    });
    ctx.addDebug(() => ({
      events: db.get('SELECT COUNT(*) c FROM events').c,
      dashboards: db.get('SELECT COUNT(*) c FROM dashboards').c,
      reports: db.get('SELECT COUNT(*) c FROM reports').c,
    }));
  },
});

subscribeEvents('analytics', 8097, ['*']);

function setupRoutes(app) {
  // ---- 事件采集 ----
  app.post('/events', asyncRoute(async (req, res) => {
    requireFields(req.body, ['sourceModule', 'eventType']);
    const id = recordEvent({ sourceModule: req.body.sourceModule, eventType: req.body.eventType, userId: req.body.userId || String(req.user.sub), properties: req.body.properties });
    res.status(201).json({ id });
  }));

  // ---- 个人+团队总览（分析页一次拉取） ----
  app.get('/overview', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    res.json({
      days,
      activity: presetReport('activity', { days }),
      meetings: presetReport('meetings', { days }),
      approvals: presetReport('approvals', { days }),
      attendance: presetReport('attendance', { days }),
      collaboration: presetReport('collaboration', { days }),
    });
  });
  app.get('/reports/preset/:type', (req, res) => {
    const valid = ['activity', 'meetings', 'approvals', 'attendance', 'collaboration'];
    if (!valid.includes(req.params.type)) throw notFound('预设报表不存在');
    res.json(presetReport(req.params.type, { days: parseInt(req.query.days) || 30 }));
  });

  // ---- 自定义报表 ----
  app.get('/reports/custom/:id', (req, res) => {
    const r = getReport(req.params.id);
    if (!r) throw notFound('报表不存在');
    res.json({ ...r, data: customReport(r.config) });
  });
  app.post('/reports', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name']);
    res.status(201).json(createReport(req.body.name, req.body.type, req.body.config, req.body.schedule));
  }));
  app.get('/reports', (req, res) => res.json(listReports()));
  app.delete('/reports/:id', (req, res) => { deleteReport(req.params.id); res.json({ ok: true }); });

  // ---- 定时邮件报表（cron 表达式 + 收件人） ----
  app.post('/reports/:id/schedule', asyncRoute(async (req, res) => {
    requireFields(req.body, ['cron', 'recipients']);
    const r = setReportSchedule(req.params.id, { cron: req.body.cron, recipients: req.body.recipients, enabled: req.body.enabled !== false });
    if (!r) throw notFound('报表不存在');
    res.json(r);
  }));

  // ---- 仪表盘 CRUD ----
  app.get('/dashboards', (req, res) => res.json(listDashboards(String(req.user.sub))));
  app.post('/dashboards', asyncRoute(async (req, res) => {
    requireFields(req.body, ['name']);
    res.status(201).json(createDashboard(String(req.user.sub), req.body.name, req.body.layout || []));
  }));
  app.get('/dashboards/:id', (req, res) => { const d = getDashboard(req.params.id); if (!d) throw notFound('仪表盘不存在'); res.json(d); });
  app.put('/dashboards/:id', asyncRoute(async (req, res) => {
    const d = updateDashboard(req.params.id, req.body);
    if (!d) throw notFound('仪表盘不存在');
    res.json(d);
  }));
  app.delete('/dashboards/:id', (req, res) => { deleteDashboard(req.params.id); res.json({ ok: true }); });

  // ---- 数据导出：CSV / Excel ----
  app.get('/export', asyncRoute(async (req, res) => {
    const format = req.query.format || 'csv';
    const rows = exportEvents({ module: req.query.module, eventType: req.query.eventType, days: parseInt(req.query.days) || 30 });
    if (format === 'excel') {
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({ ...r, properties: r.properties, created_at: new Date(r.created_at).toISOString() })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'events');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('content-disposition', 'attachment; filename="analytics.xlsx"');
      res.end(buf);
      return;
    }
    // CSV
    const headers = ['id', 'source_module', 'event_type', 'user_id', 'properties', 'created_at'];
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => {
      let v = r[h];
      if (h === 'created_at') v = new Date(v).toISOString();
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))].join('\n');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="analytics.csv"');
    res.end(csv);
  }));
}
