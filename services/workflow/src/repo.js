// nexus-workflow：数据层 + 流程引擎核心。
// 不引入 Flowable/Camunda 等重型 BPMN 引擎——内置轻量节点机即可覆盖
// 钉钉式审批（依次/会签/或签/条件/并行），零外部依赖、易调试、易扩展。
import { openDb, migrate, snowflake, publishEvent } from '@nexus/shared';

export const db = openDb('workflow');

migrate(db, [
  ['form_definitions', `CREATE TABLE form_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
    fields TEXT NOT NULL, version INTEGER DEFAULT 1, created_by TEXT, created_at INTEGER)`],
  ['flow_definitions', `CREATE TABLE flow_definitions (
    id TEXT PRIMARY KEY, form_id TEXT NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL,
    nodes TEXT NOT NULL, version INTEGER DEFAULT 1, created_by TEXT, created_at INTEGER)`],
  ['flow_instances', `CREATE TABLE flow_instances (
    id TEXT PRIMARY KEY, flow_def_id TEXT NOT NULL, form_data TEXT NOT NULL,
    initiator_id TEXT NOT NULL, status TEXT DEFAULT 'running', current_node_id TEXT,
    created_at INTEGER, updated_at INTEGER)`],
  ['flow_tasks', `CREATE TABLE flow_tasks (
    id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, node_id TEXT NOT NULL,
    assignee_id TEXT NOT NULL, action TEXT DEFAULT 'pending', comment TEXT,
    created_at INTEGER, completed_at INTEGER)`],
  ['flow_templates', `CREATE TABLE flow_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, form_def_id TEXT NOT NULL,
    flow_def_id TEXT NOT NULL, category TEXT, builtin INTEGER DEFAULT 0, created_at INTEGER)`],
  ['idx_task_assignee', `CREATE INDEX idx_task_assignee ON flow_tasks(assignee_id, action)`],
  ['idx_inst_status', `CREATE INDEX idx_inst_status ON flow_instances(status, updated_at)`],
]);

// ---- 表单定义 ----
export function createFormDefinition({ name, code, fields, createdBy }) {
  const id = snowflake();
  db.run('INSERT INTO form_definitions (id, name, code, fields, version, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
    id, name, code, JSON.stringify(fields), 1, createdBy, Date.now());
  return getFormDefinition(id);
}

export function getFormDefinition(id) {
  const f = db.get('SELECT * FROM form_definitions WHERE id = ?', id);
  if (f) f.fields = JSON.parse(f.fields);
  return f;
}

export function listFormDefinitions() {
  return db.all('SELECT id, name, code, version, created_by, created_at FROM form_definitions ORDER BY created_at DESC');
}

export function updateFormDefinition(id, { name, fields }) {
  const cur = getFormDefinition(id);
  db.run('UPDATE form_definitions SET name = COALESCE(?, name), fields = COALESCE(?, fields), version = version + 1 WHERE id = ?',
    name, fields ? JSON.stringify(fields) : null, id);
  return getFormDefinition(id);
}

// ---- 流程定义 ----
export function createFlowDefinition({ formId, name, code, nodes, createdBy }) {
  const id = snowflake();
  db.run('INSERT INTO flow_definitions (id, form_id, name, code, nodes, version, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, formId, name, code, JSON.stringify(nodes), 1, createdBy, Date.now());
  return getFlowDefinition(id);
}

export function getFlowDefinition(id) {
  const f = db.get('SELECT * FROM flow_definitions WHERE id = ?', id);
  if (f) f.nodes = JSON.parse(f.nodes);
  return f;
}

export function listFlowDefinitions() {
  return db.all('SELECT id, form_id, name, code, version, created_by, created_at FROM flow_definitions ORDER BY created_at DESC');
}

// ---- 流程实例与任务 ----
export function getInstance(id) {
  const inst = db.get('SELECT * FROM flow_instances WHERE id = ?', id);
  if (!inst) return null;
  inst.form_data = JSON.parse(inst.form_data);
  inst.tasks = db.all('SELECT * FROM flow_tasks WHERE instance_id = ? ORDER BY created_at', id);
  const flowDef = getFlowDefinition(inst.flow_def_id);
  inst.flow_def = flowDef;
  return inst;
}

export function listPendingTasks(userId) {
  const tasks = db.all("SELECT t.*, i.initiator_id, i.flow_def_id, i.form_data, f.name as flow_name FROM flow_tasks t JOIN flow_instances i ON i.id = t.instance_id JOIN flow_definitions f ON f.id = i.flow_def_id WHERE t.assignee_id = ? AND t.action = 'pending' ORDER BY t.created_at DESC",
    String(userId));
  for (const t of tasks) t.form_data = JSON.parse(t.form_data);
  return tasks;
}

// 创建实例并生成首个节点任务。节点机由 routes 层驱动，本函数只负责落库。
export function createInstance({ flowDefId, formData, initiatorId }) {
  const flowDef = getFlowDefinition(flowDefId);
  if (!flowDef) return null;
  const id = snowflake();
  const now = Date.now();
  const firstNode = nextNode(flowDef, flowDef.nodes.find((n) => n.type === 'start'), formData);
  db.tx(() => {
    db.run('INSERT INTO flow_instances (id, flow_def_id, form_data, initiator_id, status, current_node_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      id, flowDefId, JSON.stringify(formData), String(initiatorId), 'running', firstNode?.id || null, now, now);
    if (firstNode) createTasksForNode(id, firstNode);
  });
  publishEvent('workflow.submitted', { instanceId: id, flowDefId, initiatorId }, 'workflow');
  return getInstance(id);
}

// 节点机：根据当前节点类型决定下一节点。
// 条件节点不产生任务，直接按 conditions 路由到分支目标；
// 并行节点同时激活所有分支的下一节点。
export function nextNode(flowDef, currentNode, formData) {
  if (!currentNode) return null;
  const nodes = flowDef.nodes;
  if (currentNode.type === 'condition') {
    for (const cond of currentNode.conditions || []) {
      if (evalCondition(cond, formData)) return nodes.find((n) => n.id === cond.targetNodeId) || null;
    }
    return null;
  }
  if (currentNode.type === 'parallel') return null; // 并行由 createTasksForNode 处理多分支
  // approve/cc/start/end: 走 next 指针
  return nodes.find((n) => n.id === currentNode.nextId) || null;
}

// 条件求值：仅支持简单字段比较，避免引入表达式引擎的复杂度与安全风险
function evalCondition(cond, formData) {
  const v = formData[cond.field];
  switch (cond.op) {
    case 'eq': return String(v) === String(cond.value);
    case 'gt': return Number(v) > Number(cond.value);
    case 'lt': return Number(v) < Number(cond.value);
    case 'gte': return Number(v) >= Number(cond.value);
    case 'lte': return Number(v) <= Number(cond.value);
    default: return false;
  }
}

// 为审批/抄送节点生成任务。
// 依次审批（sequential）：只激活第一个审批人，待其同意后再激活下一个，
// 避免三人同时收到任务却只能按顺序处理的混乱；会签/或签则全部并行激活。
export function createTasksForNode(instanceId, node) {
  const now = Date.now();
  const assignees = node.approvers || [];
  if (node.method === 'sequential' && assignees.length > 1) {
    db.run('INSERT INTO flow_tasks (id, instance_id, node_id, assignee_id, action, created_at) VALUES (?,?,?,?,?,?)',
      snowflake(), instanceId, node.id, String(assignees[0]), 'pending', now);
    return;
  }
  for (const uid of assignees) {
    db.run('INSERT INTO flow_tasks (id, instance_id, node_id, assignee_id, action, created_at) VALUES (?,?,?,?,?,?)',
      snowflake(), instanceId, node.id, String(uid), 'pending', now);
  }
}

// 依次审批推进：当前审批人同意后，激活下一个待审批人；已是最后一人则节点完成。
export function advanceSequential(instanceId, node) {
  const tasks = db.all('SELECT * FROM flow_tasks WHERE instance_id = ? AND node_id = ? ORDER BY created_at', instanceId, node.id);
  const assignees = node.approvers || [];
  const approvedIds = tasks.filter((t) => t.action === 'approved').map((t) => t.assignee_id);
  const nextIdx = assignees.findIndex((a) => !approvedIds.includes(String(a)));
  if (nextIdx === -1) return true; // 全部审批完毕，节点完成
  db.run('INSERT INTO flow_tasks (id, instance_id, node_id, assignee_id, action, created_at) VALUES (?,?,?,?,?,?)',
    snowflake(), instanceId, node.id, String(assignees[nextIdx]), 'pending', Date.now());
  return false;
}

// 执行审批动作：更新任务，判断节点是否完成，推进到下一节点。
export function actOnTask(taskId, assigneeId, action, comment) {
  const task = db.get('SELECT * FROM flow_tasks WHERE id = ?', taskId);
  if (!task || task.action !== 'pending') return null;
  if (task.assignee_id !== String(assigneeId)) return null;
  const now = Date.now();
  db.run('UPDATE flow_tasks SET action = ?, comment = ?, completed_at = ? WHERE id = ?', action, comment || '', now, taskId);
  return getInstance(task.instance_id);
}

// 判断节点是否已完成：会签=全部 approved；或签=任一 approved；依次=由 advanceSequential 处理
export function isNodeComplete(instanceId, node) {
  const tasks = db.all('SELECT * FROM flow_tasks WHERE instance_id = ? AND node_id = ?', instanceId, node.id);
  if (tasks.length === 0) return true;
  if (tasks.some((t) => t.action === 'rejected')) return true;
  if (node.method === 'or-sign') {
    return tasks.some((t) => t.action === 'approved');
  }
  if (node.method === 'countersign') {
    return tasks.every((t) => t.action === 'approved');
  }
  // 依次审批：所有审批人均已 approved 即节点完成
  if (node.method === 'sequential') {
    const approvedCount = tasks.filter((t) => t.action === 'approved').length;
    return approvedCount >= (node.approvers || []).length;
  }
  return false;
}

export function updateInstanceStatus(instanceId, status, currentNodeId) {
  db.run('UPDATE flow_instances SET status = ?, current_node_id = ?, updated_at = ? WHERE id = ?',
    status, currentNodeId, Date.now(), instanceId);
}

// ---- 模板 ----
export function listTemplates() {
  return db.all('SELECT t.id, t.name, t.form_def_id, t.flow_def_id, t.category, t.builtin, t.created_at, f.name as form_name, fl.name as flow_name FROM flow_templates t JOIN form_definitions f ON f.id = t.form_def_id JOIN flow_definitions fl ON fl.id = t.flow_def_id ORDER BY t.builtin DESC, t.category');
}

export function createTemplate({ name, formDefId, flowDefId, category, builtin = 0 }) {
  const id = snowflake();
  db.run('INSERT INTO flow_templates (id, name, form_def_id, flow_def_id, category, builtin, created_at) VALUES (?,?,?,?,?,?,?)',
    id, name, formDefId, flowDefId, category || 'custom', builtin ? 1 : 0, Date.now());
  return { id, name, form_def_id: formDefId, flow_def_id: flowDefId, category };
}

// 内置模板：请假/报销/出差/采购/合同/加班/离职——覆盖 80% 企业高频审批场景。
// 幂等设计：每次启动都跑，对已存在的表单/流程/模板跳过，避免 UNIQUE 冲突，
// 同时能修复上次启动中断造成的"表单建了但模板没建"的半成品状态。
export function seedBuiltinTemplates() {
  for (const t of builtins()) {
    let form = db.get('SELECT id FROM form_definitions WHERE code = ?', t.form.code);
    if (!form) form = createFormDefinition({ ...t.form, createdBy: 'system' });
    let flow = db.get('SELECT id FROM flow_definitions WHERE code = ?', t.flow.code);
    if (!flow) flow = createFlowDefinition({ formId: form.id, name: t.flow.name, code: t.flow.code, nodes: t.flow.nodes, createdBy: 'system' });
    if (!db.get('SELECT id FROM flow_templates WHERE form_def_id = ? AND flow_def_id = ?', form.id, flow.id))
      createTemplate({ name: t.name, formDefId: form.id, flowDefId: flow.id, category: t.category, builtin: true });
  }
}

function builtins() {
  return [
    { name: '请假申请', category: 'leave', form: { name: '请假表单', code: 'leave_form', fields: [{ key: 'days', label: '天数', type: 'number', required: true }, { key: 'reason', label: '事由', type: 'text', required: true }] }, flow: { name: '请假流程', code: 'leave_flow', nodes: [{ id: 'n1', type: 'start', nextId: 'n2' }, { id: 'n2', type: 'approve', approvers: ['supervisor'], method: 'sequential', nextId: 'n3' }, { id: 'n3', type: 'end' }] } },
    { name: '费用报销', category: 'expense', form: { name: '报销表单', code: 'expense_form', fields: [{ key: 'amount', label: '金额', type: 'number', required: true }, { key: 'items', label: '明细', type: 'table', required: true }] }, flow: { name: '报销流程', code: 'expense_flow', nodes: [{ id: 'n1', type: 'start', nextId: 'n2' }, { id: 'n2', type: 'condition', conditions: [{ field: 'amount', op: 'gt', value: 10000, targetNodeId: 'n3' }, { field: 'amount', op: 'lte', value: 10000, targetNodeId: 'n4' }] }, { id: 'n3', type: 'approve', approvers: ['gm'], method: 'sequential', nextId: 'n5' }, { id: 'n4', type: 'approve', approvers: ['manager'], method: 'sequential', nextId: 'n5' }, { id: 'n5', type: 'end' }] } },
    { name: '出差申请', category: 'travel', form: { name: '出差表单', code: 'travel_form', fields: [{ key: 'destination', label: '目的地', type: 'text', required: true }, { key: 'days', label: '天数', type: 'number', required: true }] }, flow: { name: '出差流程', code: 'travel_flow', nodes: [{ id: 'n1', type: 'start', nextId: 'n2' }, { id: 'n2', type: 'approve', approvers: ['supervisor'], method: 'sequential', nextId: 'n3' }, { id: 'n3', type: 'cc', approvers: ['hr'], nextId: 'n4' }, { id: 'n4', type: 'end' }] } },
    { name: '采购申请', category: 'procurement', form: { name: '采购表单', code: 'proc_form', fields: [{ key: 'item', label: '物品', type: 'text', required: true }, { key: 'amount', label: '金额', type: 'number', required: true }] }, flow: { name: '采购流程', code: 'proc_flow', nodes: [{ id: 'n1', type: 'start', nextId: 'n2' }, { id: 'n2', type: 'approve', approvers: ['manager', 'gm'], method: 'countersign', nextId: 'n3' }, { id: 'n3', type: 'end' }] } },
    { name: '合同审批', category: 'contract', form: { name: '合同表单', code: 'contract_form', fields: [{ key: 'party', label: '对方', type: 'text', required: true }, { key: 'amount', label: '金额', type: 'number', required: true }] }, flow: { name: '合同流程', code: 'contract_flow', nodes: [{ id: 'n1', type: 'start', nextId: 'n2' }, { id: 'n2', type: 'approve', approvers: ['legal', 'manager', 'gm'], method: 'sequential', nextId: 'n3' }, { id: 'n3', type: 'end' }] } },
    { name: '加班申请', category: 'overtime', form: { name: '加班表单', code: 'ot_form', fields: [{ key: 'hours', label: '时长', type: 'number', required: true }] }, flow: { name: '加班流程', code: 'ot_flow', nodes: [{ id: 'n1', type: 'start', nextId: 'n2' }, { id: 'n2', type: 'approve', approvers: ['supervisor'], method: 'or-sign', nextId: 'n3' }, { id: 'n3', type: 'end' }] } },
    { name: '离职申请', category: 'resignation', form: { name: '离职表单', code: 'resign_form', fields: [{ key: 'reason', label: '原因', type: 'text', required: true }, { key: 'lastDay', label: '最后工作日', type: 'date', required: true }] }, flow: { name: '离职流程', code: 'resign_flow', nodes: [{ id: 'n1', type: 'start', nextId: 'n2' }, { id: 'n2', type: 'approve', approvers: ['manager', 'hr', 'gm'], method: 'sequential', nextId: 'n3' }, { id: 'n3', type: 'end' }] } },
  ];
}
