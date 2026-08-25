// AI 整理：产品线 → 大部门 → 小组 → 个人（类 Obsidian 层级图谱）
import { createNode, createEdge, db } from './repo.js';

const TEAMS = {
  研发部: ['前端组', '后端组', '平台组'],
  人力资源部: ['招聘组', '员工关系组'],
  财务部: ['核算组', '资金组'],
  市场部: ['品牌组', '增长组'],
};

function teamFor(emp, deptName, index) {
  const list = TEAMS[deptName] || ['核心组', '协作组'];
  const title = String(emp.position || emp.title || '');
  if (/前端/.test(title)) return list.find((t) => /前端/.test(t)) || list[0];
  if (/后端|服务/.test(title)) return list.find((t) => /后端|平台/.test(t)) || list[0];
  return list[index % list.length];
}

/**
 * 层级：产品线(中心) → 大部门 → 小组 → 个人
 */
export function organizePeople(employees = [], { projectName = 'Nexus 产品线', clearPeople = false } = {}) {
  if (!Array.isArray(employees) || employees.length === 0) {
    throw new Error('人员列表为空');
  }

  if (clearPeople) {
    const old = db.all(`SELECT id FROM nodes WHERE properties LIKE '%"aiOrganized":true%'`);
    for (const n of old) {
      db.run('DELETE FROM edges WHERE source_id = ? OR target_id = ?', n.id, n.id);
      db.run('DELETE FROM nodes WHERE id = ?', n.id);
    }
  }

  const product = createNode({
    type: 'product_line',
    name: projectName,
    label: projectName,
    properties: { aiOrganized: true, kind: '产品线', summary: '组织协作中枢' },
    x: 0,
    y: 0,
    size: 4.5,
  });

  const deptMap = new Map();
  const teamMap = new Map();
  const personNodes = [];
  const deptNames = [...new Set(employees.map((e) => e.dept || e.dept_name || e.department || '未分配部门'))];
  const R_DEPT = 420;
  const R_TEAM = 220;
  const R_PERSON = 110;

  deptNames.forEach((deptName, di) => {
    const angle = (2 * Math.PI * di) / Math.max(1, deptNames.length) - Math.PI / 2;
    const dNode = createNode({
      type: 'dept',
      name: deptName,
      label: deptName,
      properties: {
        aiOrganized: true,
        kind: '大部门',
        headcount: employees.filter((e) => (e.dept || e.dept_name || e.department || '未分配部门') === deptName).length,
      },
      x: Math.cos(angle) * R_DEPT,
      y: Math.sin(angle) * R_DEPT,
      size: 3.2,
    });
    deptMap.set(deptName, dNode);
    createEdge({
      sourceId: product.id,
      targetId: dNode.id,
      type: 'contains',
      weight: 2,
      properties: { aiOrganized: true },
    });
  });

  employees.forEach((emp, i) => {
    const deptName = emp.dept || emp.dept_name || emp.department || '未分配部门';
    const deptNode = deptMap.get(deptName);
    const teamName = teamFor(emp, deptName, i);
    const teamKey = `${deptName}::${teamName}`;
    if (!teamMap.has(teamKey)) {
      const teamsInDept = [...teamMap.keys()].filter((k) => k.startsWith(deptName + '::')).length;
      const tAngle = (2 * Math.PI * teamsInDept) / Math.max(3, (TEAMS[deptName] || ['a', 'b']).length);
      const tNode = createNode({
        type: 'team',
        name: teamName,
        label: teamName,
        properties: { aiOrganized: true, kind: '小组', dept: deptName },
        x: (deptNode?.x || 0) + Math.cos(tAngle) * R_TEAM,
        y: (deptNode?.y || 0) + Math.sin(tAngle) * R_TEAM,
        size: 2.2,
      });
      teamMap.set(teamKey, tNode);
      createEdge({
        sourceId: deptNode.id,
        targetId: tNode.id,
        type: 'contains',
        weight: 1.5,
        properties: { aiOrganized: true },
      });
    }
    const teamNode = teamMap.get(teamKey);
    const membersInTeam = personNodes.filter((p) => p.teamKey === teamKey).length;
    const pAngle = (2 * Math.PI * membersInTeam) / 6;
    const pNode = createNode({
      type: 'employee',
      name: emp.name || emp.display_name || `成员${i + 1}`,
      label: emp.name || emp.display_name,
      properties: {
        aiOrganized: true,
        kind: '个人',
        userId: emp.user_id || emp.id,
        title: emp.position || emp.title || '成员',
        email: emp.email || '',
        phone: emp.phone || '',
        dept: deptName,
        team: teamName,
      },
      x: teamNode.x + Math.cos(pAngle) * R_PERSON,
      y: teamNode.y + Math.sin(pAngle) * R_PERSON,
      size: 1.3,
    });
    personNodes.push({ emp, node: pNode, teamKey });
    createEdge({
      sourceId: teamNode.id,
      targetId: pNode.id,
      type: 'member_of',
      weight: 1,
      properties: { aiOrganized: true },
    });
  });

  let reportEdges = 0;
  for (const { emp, node } of personNodes) {
    const mgrId = emp.manager_id || emp.managerId || emp.supervisor_id;
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

  return {
    productLine: 1,
    departments: deptMap.size,
    teams: teamMap.size,
    people: personNodes.length,
    reportEdges,
    summary: `已整理：1 条产品线 · ${deptMap.size} 个大部门 · ${teamMap.size} 个小组 · ${personNodes.length} 人`,
  };
}
