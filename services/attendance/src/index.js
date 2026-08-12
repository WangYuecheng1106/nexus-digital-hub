// nexus-attendance：考勤服务 HTTP 路由。
// 端口 8091。功能：GPS/WiFi/人脸/外勤打卡、排班、请假、个人与部门月报、CSV 导出。
import { createService, asyncRoute, requireFields, badRequest, notFound, publishEvent, requirePerm } from '@nexus/shared';
import {
  db, seedShifts, recordPunch, getRecords, getEffectiveShift, classifyPunch,
  createLeave, getLeaveBalances, personalReport, deptReport, exportCsv,
} from './repo.js';

const INTERNAL_TOKEN = process.env.NEXUS_INTERNAL_TOKEN || 'nexus-internal-dev-token';

// 通过 contacts 服务解析部门成员（解耦：考勤不直接持有组织架构）
async function resolveDeptUserIds(deptId) {
  try {
    const r = await fetch(`http://localhost:8092/employees?dept=${encodeURIComponent(deptId)}`, {
      headers: { 'x-internal-token': INTERNAL_TOKEN, 'x-user-id': 'internal' },
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    const list = await r.json();
    return list.map((e) => e.id);
  } catch { return null; }
}

const { ctx } = createService({
  name: 'attendance',
  port: 8091,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    // ---- 打卡：GPS / WiFi / 人脸 / 外勤 ----
    app.post('/punch', asyncRoute(async (req, res) => {
      requireFields(req.body, ['method']);
      const { method, type, location, note, photo } = req.body;
      if (!['gps', 'wifi', 'face', 'field'].includes(method)) throw badRequest('非法打卡方式');
      const punch = recordPunch(req.user.sub, { method, type, location, note, photo });
      publishEvent('att.punch', punch, 'attendance');
      res.status(201).json(punch);
    }));

    // ---- 打卡记录查询 ----
    app.get('/records', (req, res) => {
      const userId = String(req.query.user || req.user.sub);
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      // 普通员工只能查自己；管理员可查任意人
      if (userId !== String(req.user.sub) && !(req.user.perms || []).includes('att:manage')) {
        return res.status(403).json({ error: 'forbidden', message: '只能查看自己的考勤记录' });
      }
      res.json(getRecords(userId, month));
    });

    // ---- 班次管理 ----
    app.get('/shifts', (req, res) => {
      res.json(db.all('SELECT * FROM shifts ORDER BY created_at'));
    });

    app.post('/shifts', requirePerm('att:manage'), asyncRoute(async (req, res) => {
      requireFields(req.body, ['name', 'startTime', 'endTime']);
      const { name, startTime, endTime, flexible = 0, graceMin = 0 } = req.body;
      const id = `shift-${Date.now().toString(36)}`;
      db.run('INSERT INTO shifts (id,name,start_time,end_time,flexible,grace_min,created_at) VALUES (?,?,?,?,?,?,?)',
        id, name, startTime, endTime, flexible ? 1 : 0, graceMin, Date.now());
      res.status(201).json({ id });
    }));

    // 排班：为用户指定某日班次
    app.post('/shifts/assign', requirePerm('att:manage'), (req, res) => {
      requireFields(req.body, ['userId', 'shiftId', 'date']);
      db.run('INSERT OR REPLACE INTO user_shifts (user_id, shift_id, date) VALUES (?,?,?)',
        String(req.body.userId), req.body.shiftId, req.body.date);
      res.json({ ok: true });
    });

    // ---- 请假申请（联动 workflow 审批）----
    app.post('/leave', asyncRoute(async (req, res) => {
      requireFields(req.body, ['type', 'startDate', 'endDate', 'days']);
      const { type, startDate, endDate, days, reason } = req.body;
      const leave = createLeave(req.user.sub, { type, startDate, endDate, days, reason });
      // 发布事件供 workflow 服务发起审批流；审批通过后回调更新状态
      publishEvent('att.leave_requested', { leaveId: leave.id, userId: req.user.sub, type, days, startDate, endDate }, 'attendance');
      res.status(201).json(leave);
    }));

    // 请假审批回调（workflow 服务调用）
    app.post('/leave/:id/decision', (req, res) => {
      if (req.headers['x-internal-token'] !== INTERNAL_TOKEN) return res.status(403).json({ error: 'forbidden' });
      const { status } = req.body;
      if (!['approved', 'rejected'].includes(status)) throw badRequest('非法状态');
      const leave = db.get('SELECT * FROM leave_requests WHERE id = ?', req.params.id);
      if (!leave) throw notFound('请假单不存在');
      db.tx(() => {
        db.run('UPDATE leave_requests SET status = ? WHERE id = ?', status, leave.id);
        if (status === 'rejected') {
          db.run('UPDATE leave_balances SET used = used - ? WHERE user_id = ? AND type = ?', leave.days, leave.user_id, leave.type);
        }
      });
      res.json({ ok: true });
    });

    app.get('/leave/balances/:userId', (req, res) => {
      const uid = String(req.params.userId);
      if (uid !== String(req.user.sub) && !(req.user.perms || []).includes('att:manage')) {
        return res.status(403).json({ error: 'forbidden', message: '只能查看自己的假期余额' });
      }
      res.json(getLeaveBalances(uid));
    });

    // ---- 个人月报 ----
    app.get('/report/personal', (req, res) => {
      const userId = String(req.query.user || req.user.sub);
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      if (userId !== String(req.user.sub) && !(req.user.perms || []).includes('att:report')) {
        return res.status(403).json({ error: 'forbidden', message: '无考勤报表权限' });
      }
      res.json(personalReport(userId, month));
    });

    // ---- 部门月报 ----
    app.get('/report/dept', requirePerm('att:report'), asyncRoute(async (req, res) => {
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      const dept = req.query.dept || req.user.dept;
      if (!dept) return res.json([]);
      const userIds = (await resolveDeptUserIds(dept)) || [String(req.user.sub)];
      res.json(deptReport(userIds, month));
    }));

    // ---- CSV 导出 ----
    app.get('/export', requirePerm('att:report'), asyncRoute(async (req, res) => {
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      const dept = req.query.dept || req.user.dept;
      let userIds = req.query.user ? [String(req.query.user)] : null;
      if (!userIds && dept) userIds = (await resolveDeptUserIds(dept)) || [String(req.user.sub)];
      if (!userIds) userIds = [String(req.user.sub)];
      const csv = exportCsv(userIds, month);
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="attendance-${month}.csv"`);
      // BOM 保证 Excel 正确识别 UTF-8
      res.send('\ufeff' + csv);
    }));

    ctx.addDebug(() => ({
      shifts: db.get('SELECT COUNT(*) c FROM shifts').c,
      punches: db.get('SELECT COUNT(*) c FROM punches').c,
      leaveRequests: db.get('SELECT COUNT(*) c FROM leave_requests').c,
    }));
  },
});

seedShifts();
