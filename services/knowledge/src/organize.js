// AI 整理项目人员 → 图谱节点/边（对标 WeLink「连接知识」+ 钉钉组织关系）
import { createNode, createEdge, db } from './repo.js';

/**
 * 根据通讯录/项目成员清单整理人员子图
 * employees: [{ id, name, dept, title, managerId?, projectIds? }]
 */
export function organizePeople(employees = [], { projectName = 'Nexus', clearPeople = false } = {}) {
  if (!Array.isArray(employees) || employees.length === 0) {
    throw new Error('人员列表为空');
  }

  if (clearPeople) {
    // 仅清理此前 AI 整理标记的人员节点
    const old = db.all(`SELECT id FROM nodes WHERE type = 'employee' AND properties LIKE '%"aiOrganized":true%'`);
    for (const n of old) {
      db.run('DELETE FROM edges WHERE source_id = ? OR target_id = ?', n.id, n.id);
      db.run('DELETE FROM nodes WHERE id = ?', n.id);
    }
  }

  // 项目中心节点
  const projectNode = createNode({
    type: 'project',
    name: projectName,
    label: projectName,
    properties: { aiOrganized: true, source: 'ai-organize-people' },
    x: 0,
    y: 0,
    size: 3,
  });

  const deptMap = new Map();
  const personNodes = [];
  const R = 280;
  const n = employees.length;

  employees.forEach((emp, i) => {
    const angle = (2 * Math.PI * i) / n;
    const deptName = emp.dept || emp.dept_name || '未分配部门';
    if (!deptMap.has(deptName)) {
      const di = deptMap.size;
      const dAngle = (2 * Math.PI * di) / Math.max(1, new Set(employees.map((e) => e.dept || e.dept_name || '未分配部门')).size);
      const dNode = createNode({
        type: 'dept',
        name: deptName,
        label: deptName,
        properties: { aiOrganized: true },
        x: Math.cos(dAngle) * (R * 1.6),
        y: Math.sin(dAngle) * (R * 1.6),
        size: 2.2,
      });
      deptMap.set(deptName, dNode);
      createEdge({
        sourceId: dNode.id,
        targetId: projectNode.id,
        type: 'participates',
        weight: 1,
        properties: { aiOrganized: true },
      });
    }
    const deptNode = deptMap.get(deptName);
    const pNode = createNode({
      type: 'employee',
      name: emp.name || emp.display_name || `成员${i + 1}`,
      label: emp.name || emp.display_name,
      properties: {
        aiOrganized: true,
        userId: emp.user_id || emp.id,
        title: emp.position || emp.title || '',
        email: emp.email || '',
      },
      x: Math.cos(angle) * R + (deptNode.x || 0) * 0.15,
      y: Math.sin(angle) * R + (deptNode.y || 0) * 0.15,
      size: 1.4,
    });
    personNodes.push({ emp, node: pNode });
    createEdge({
      sourceId: pNode.id,
      targetId: deptNode.id,
      type: 'belongs_to',
      weight: 1,
      properties: { aiOrganized: true },
    });
    createEdge({
      sourceId: pNode.id,
      targetId: projectNode.id,
      type: 'participates',
      weight: 1,
      properties: { aiOrganized: true },
    });
  });

  // 汇报关系
  let reportEdges = 0;
  for (const { emp, node } of personNodes) {
    const mgrId = emp.manager_id || emp.managerId;
    if (!mgrId) continue;
    const mgr = personNodes.find((p) => String(p.emp.user_id || p.emp.id) === String(mgrId));
    if (mgr) {
      createEdge({
        sourceId: node.id,
        targetId: mgr.node.id,
        type: 'reports_to',
        weight: 1,
        properties: { aiOrganized: true },
      });
      reportEdges++;
    }
  }

  // 同部门同事边（稀疏，避免完全图）
  const byDept = new Map();
  for (const item of personNodes) {
    const d = item.emp.dept || item.emp.dept_name || '未分配部门';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(item);
  }
  let collab = 0;
  for (const members of byDept.values()) {
    for (let i = 0; i < members.length; i++) {
      const j = (i + 1) % members.length;
      if (i === j) continue;
      createEdge({
        sourceId: members[i].node.id,
        targetId: members[j].node.id,
        type: 'participates',
        weight: 0.5,
        properties: { aiOrganized: true, relation: 'colleague' },
      });
      collab++;
      if (collab > members.length) break;
    }
  }

  return {
    projectNodeId: projectNode.id,
    departments: deptMap.size,
    people: personNodes.length,
    reportEdges,
    summary: `已将 ${personNodes.length} 名成员整理进「${projectName}」关系图谱（${deptMap.size} 个部门，${reportEdges} 条汇报关系）。AI 生成，请审阅。`,
  };
}
