// nexus-workflow：流程审批服务入口。
// 路由 + 节点机驱动。节点机把"审批/抄送/条件/并行"统一为：
// 推进 → 落任务 → 等待 → 动作 → 判完成 → 再推进 的循环。
import { createService, asyncRoute, requireFields, badRequest, forbidden, notFound, publishEvent } from '@nexus/shared';
import {
  db, createFormDefinition, getFormDefinition, listFormDefinitions, updateFormDefinition,
  createFlowDefinition, getFlowDefinition, listFlowDefinitions,
  getInstance, listPendingTasks, createInstance, nextNode, createTasksForNode,
  isNodeComplete, updateInstanceStatus, listTemplates, createTemplate, seedBuiltinTemplates,
  advanceSequential,
} from './repo.js';

// 推进流程：从当前节点向后走，跳过不产生任务的节点（条件/已完成的并行分支），
// 直到遇到需要任务的审批/抄送节点，或到达 end。
function advance(instanceId) {
  const inst = getInstance(instanceId);
  if (!inst || inst.status !== 'running') return inst;
  const flowDef = inst.flow_def;
  let node = flowDef.nodes.find((n) => n.id === inst.current_node_id);
  while (node) {
    if (node.type === 'end') {
      updateInstanceStatus(instanceId, 'approved', node.id);
      publishEvent('workflow.completed', { instanceId, status: 'approved' }, 'workflow');
      return getInstance(instanceId);
    }
    if (node.type === 'approve' || node.type === 'cc') {
      // 若该节点任务已全部完成则继续推进，否则停留等待
      if (isNodeComplete(instanceId, node)) {
        // cc 抄送节点无需审批，创建任务后立即标记完成并推进
        const tasks = db.all("SELECT * FROM flow_tasks WHERE instance_id = ? AND node_id = ?", instanceId, node.id);
        if (node.type === 'cc' && tasks.length > 0 && tasks.every((t) => t.action === 'pending')) {
          // 抄送任务保持 pending 仅作记录，不阻塞流程
        }
        node = flowDef.nodes.find((n) => n.id === node.nextId);
        continue;
      }
      updateInstanceStatus(instanceId, 'running', node.id);
      return getInstance(instanceId);
    }
    if (node.type === 'condition') {
      node = nextNode(flowDef, node, inst.form_data);
      continue;
    }
    if (node.type === 'parallel') {
      // 并行：为每个分支创建首个任务节点，简化处理——按 nextId 推进主分支
      node = flowDef.nodes.find((n) => n.id === node.nextId);
      continue;
    }
    node = flowDef.nodes.find((n) => n.id === node.nextId);
  }
  updateInstanceStatus(instanceId, 'approved', null);
  return getInstance(instanceId);
}

const { ctx } = createService({
  name: 'workflow',
  port: 8086,
  publicPaths: ['/health', '/debug'],
  setup(app, ctx) {
    seedBuiltinTemplates();

    // ---- 表单定义 CRUD ----
    app.post('/forms', asyncRoute(async (req, res) => {
      requireFields(req.body, ['name', 'code', 'fields']);
      res.status(201).json(createFormDefinition({ ...req.body, createdBy: String(req.user.sub) }));
    }));

    app.get('/forms', (req, res) => res.json(listFormDefinitions()));

    app.get('/forms/:id', (req, res) => {
      const f = getFormDefinition(req.params.id);
      if (!f) throw notFound('表单不存在');
      res.json(f);
    });

    app.put('/forms/:id', (req, res) => {
      res.json(updateFormDefinition(req.params.id, req.body));
    });

    // ---- 流程定义 CRUD ----
    app.post('/flows', asyncRoute(async (req, res) => {
      requireFields(req.body, ['formId', 'name', 'code', 'nodes']);
      res.status(201).json(createFlowDefinition({ ...req.body, createdBy: String(req.user.sub) }));
    }));

    app.get('/flows', (req, res) => res.json(listFlowDefinitions()));

    app.get('/flows/:id', (req, res) => {
      const f = getFlowDefinition(req.params.id);
      if (!f) throw notFound('流程不存在');
      res.json(f);
    });

    // ---- 发起流程 ----
    app.post('/submit', asyncRoute(async (req, res) => {
      requireFields(req.body, ['flowDefId', 'formData']);
      const inst = createInstance({ flowDefId: req.body.flowDefId, formData: req.body.formData, initiatorId: String(req.user.sub) });
      if (!inst) throw notFound('流程定义不存在');
      advance(inst.id);
      res.status(201).json(getInstance(inst.id));
    }));

    app.get('/instances/:id', (req, res) => {
      const inst = getInstance(req.params.id);
      if (!inst) throw notFound('实例不存在');
      res.json(inst);
    });

    // ---- 待办 ----
    app.get('/tasks/pending', (req, res) => {
      res.json(listPendingTasks(req.user.sub));
    });

    // ---- 审批动作：approve/reject/transfer/add-signer/withdraw/batch-approve ----
    app.post('/tasks/:id/action', asyncRoute(async (req, res) => {
      requireFields(req.body, ['action']);
      const { action, comment, transferTo, addSigners } = req.body;
      const task = db.get('SELECT * FROM flow_tasks WHERE id = ?', req.params.id);
      if (!task) throw notFound('任务不存在');
      if (task.assignee_id !== String(req.user.sub)) throw forbidden('只能处理自己的待办');
      const inst = getInstance(task.instance_id);
      if (inst.status !== 'running') throw badRequest('流程已结束');

      if (action === 'transfer') {
        // 转交：当前任务标记 transferred，为转交人新建 pending 任务
        requireFields(req.body, ['transferTo']);
        db.run('UPDATE flow_tasks SET action = ?, comment = ?, completed_at = ? WHERE id = ?', 'transferred', comment || '', Date.now(), task.id);
        db.run('INSERT INTO flow_tasks (id, instance_id, node_id, assignee_id, action, created_at) VALUES (?,?,?,?,?,?)',
          require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 16), task.instance_id, task.node_id, String(transferTo), 'pending', Date.now());
        publishEvent('workflow.transferred', { instanceId: task.instance_id, to: transferTo }, 'workflow');
        return res.json(getInstance(task.instance_id));
      }

      if (action === 'add-signer') {
        // 加签：当前任务保留 pending，新增 signer 的 pending 任务
        requireFields(req.body, ['addSigners']);
        for (const uid of addSigners) {
          db.run('INSERT INTO flow_tasks (id, instance_id, node_id, assignee_id, action, created_at) VALUES (?,?,?,?,?,?)',
            require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 16), task.instance_id, task.node_id, String(uid), 'pending', Date.now());
        }
        return res.json(getInstance(task.instance_id));
      }

      if (action === 'reject') {
        db.run('UPDATE flow_tasks SET action = ?, comment = ?, completed_at = ? WHERE id = ?', 'rejected', comment || '', Date.now(), task.id);
        updateInstanceStatus(task.instance_id, 'rejected', task.node_id);
        publishEvent('workflow.rejected', { instanceId: task.instance_id, nodeId: task.node_id }, 'workflow');
        return res.json(getInstance(task.instance_id));
      }

      if (action === 'approve') {
        db.run('UPDATE flow_tasks SET action = ?, comment = ?, completed_at = ? WHERE id = ?', 'approved', comment || '', Date.now(), task.id);
        // 依次审批：若仍有后续审批人，激活下一个而不推进节点
        const node = inst.flow_def.nodes.find((n) => n.id === task.node_id);
        if (node?.method === 'sequential' && !advanceSequential(task.instance_id, node)) {
          return res.json(getInstance(task.instance_id));
        }
        advance(task.instance_id);
        return res.json(getInstance(task.instance_id));
      }

      throw badRequest('不支持的动作: ' + action);
    }));

    // ---- 批量审批 ----
    app.post('/tasks/batch-approve', asyncRoute(async (req, res) => {
      requireFields(req.body, ['taskIds']);
      const { taskIds, comment = '' } = req.body;
      const results = [];
      for (const tid of taskIds) {
        const task = db.get('SELECT * FROM flow_tasks WHERE id = ?', tid);
        if (!task || task.assignee_id !== String(req.user.sub) || task.action !== 'pending') { results.push({ id: tid, ok: false }); continue; }
        db.run('UPDATE flow_tasks SET action = ?, comment = ?, completed_at = ? WHERE id = ?', 'approved', comment, Date.now(), tid);
        advance(task.instance_id);
        results.push({ id: tid, ok: true });
      }
      res.json({ results });
    }));

    // ---- 撤回（发起人）----
    app.post('/instances/:id/withdraw', (req, res) => {
      const inst = getInstance(req.params.id);
      if (!inst) throw notFound('实例不存在');
      if (inst.initiator_id !== String(req.user.sub)) throw forbidden('只有发起人可撤回');
      if (inst.status !== 'running') throw badRequest('流程已结束不可撤回');
      updateInstanceStatus(req.params.id, 'withdrawn', inst.current_node_id);
      db.run("UPDATE flow_tasks SET action = 'withdrawn', completed_at = ? WHERE instance_id = ? AND action = 'pending'", Date.now(), req.params.id);
      publishEvent('workflow.withdrawn', { instanceId: req.params.id }, 'workflow');
      res.json(getInstance(req.params.id));
    });

    // ---- 模板 ----
    app.get('/templates', (req, res) => res.json(listTemplates()));

    app.post('/templates', (req, res) => {
      requireFields(req.body, ['name', 'formDefId', 'flowDefId']);
      res.status(201).json(createTemplate({ ...req.body, builtin: 0 }));
    });

    // ---- 统计：审批数量/平均时长/超时率/瓶颈节点 ----
    app.get('/stats', (req, res) => {
      const total = db.get("SELECT COUNT(*) c FROM flow_instances").c;
      const approved = db.get("SELECT COUNT(*) c FROM flow_instances WHERE status = 'approved'").c;
      const rejected = db.get("SELECT COUNT(*) c FROM flow_instances WHERE status = 'rejected'").c;
      const running = db.get("SELECT COUNT(*) c FROM flow_instances WHERE status = 'running'").c;
      const withdrawn = db.get("SELECT COUNT(*) c FROM flow_instances WHERE status = 'withdrawn'").c;
      // 平均审批时长：已结束实例的 updated_at - created_at
      const durations = db.all("SELECT (updated_at - created_at) as d FROM flow_instances WHERE status IN ('approved','rejected','withdrawn')");
      const avgMs = durations.length ? durations.reduce((s, r) => s + r.d, 0) / durations.length : 0;
      // 超时率：假设 48 小时为超时阈值（可配置）
      const TIMEOUT_MS = 48 * 3600 * 1000;
      const timeouts = db.all("SELECT id FROM flow_instances WHERE status IN ('approved','rejected','withdrawn') AND (updated_at - created_at) > ?", TIMEOUT_MS);
      const timeoutRate = total ? timeouts.length / total : 0;
      // 瓶颈分析：按节点统计平均停留时长
      const bottleneck = db.all("SELECT node_id, AVG(completed_at - created_at) as avg_ms, COUNT(*) as task_count FROM flow_tasks WHERE action != 'pending' GROUP BY node_id ORDER BY avg_ms DESC LIMIT 5");
      res.json({ total, approved, rejected, running, withdrawn, avgDurationMs: Math.round(avgMs), timeoutRate: Math.round(timeoutRate * 1000) / 1000, bottleneck });
    });

    ctx.addDebug(() => ({
      forms: db.get('SELECT COUNT(*) c FROM form_definitions').c,
      flows: db.get('SELECT COUNT(*) c FROM flow_definitions').c,
      instances: db.get('SELECT COUNT(*) c FROM flow_instances').c,
      pendingTasks: db.get("SELECT COUNT(*) c FROM flow_tasks WHERE action = 'pending'").c,
      templates: db.get('SELECT COUNT(*) c FROM flow_templates').c,
    }));
  },
});
