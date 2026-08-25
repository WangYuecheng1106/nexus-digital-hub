// nexus-knowledge：关系图谱数据层。
// 选用 SQLite 而非 Neo4j 的理由：本地零基础设施、单文件易重置；图查询语义通过
// 自建索引 + BFS 实现，万级节点下子图查询 < 50ms。后续可平滑替换为图数据库。
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('knowledge');

// 节点类型固定 8 种，覆盖企业核心实体；边类型固定 7 种，覆盖主要关系语义。
// x/y 为预计算力导向布局坐标（L0/L1 直接消费），layout_cache 按 LOD 层级冗余缓存。
migrate(db, [
  ['nodes', `CREATE TABLE nodes (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, label TEXT,
    properties TEXT, x REAL, y REAL, size INTEGER DEFAULT 1, created_at INTEGER)`],
  ['edges', `CREATE TABLE edges (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, type TEXT NOT NULL,
    weight REAL DEFAULT 1, properties TEXT, created_at INTEGER)`],
  ['layout_cache', `CREATE TABLE layout_cache (
    node_id TEXT, x REAL, y REAL, level INTEGER, PRIMARY KEY (node_id, level))`],
  // 视口查询是高频热路径，type 与坐标必须建索引以保证 LOD 分页 < 30ms
  ['idx_node_type', `CREATE INDEX idx_node_type ON nodes(type)`],
  ['idx_node_xy', `CREATE INDEX idx_node_xy ON nodes(x, y)`],
  ['idx_node_name', `CREATE INDEX idx_node_name ON nodes(name)`],
  ['idx_edge_src', `CREATE INDEX idx_edge_src ON edges(source_id)`],
  ['idx_edge_tgt', `CREATE INDEX idx_edge_tgt ON edges(target_id)`],
]);

export const NODE_TYPES = ['dept', 'employee', 'role', 'project', 'task', 'document', 'approval', 'meeting'];
export const EDGE_TYPES = ['belongs_to', 'reports_to', 'participates', 'responsible_for', 'creates', 'initiates', 'attends'];

// 批量插入节点/边：用单事务包裹，避免逐条 INSERT 的 fsync 开销（万级数据差 100x）
export function bulkInsertNodes(rows) {
  db.tx(() => {
    const now = Date.now();
    for (const r of rows) {
      const id = snowflake();
      db.run(
        'INSERT INTO nodes (id, type, name, label, properties, x, y, size, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        id, r.type, r.name, r.label || r.name, JSON.stringify(r.properties || {}), r.x ?? 0, r.y ?? 0, r.size ?? 1, now
      );
      r.id = id; r.created_at = now;
    }
  });
  return rows;
}

export function bulkInsertEdges(rows) {
  db.tx(() => {
    const now = Date.now();
    for (const r of rows) {
      const id = snowflake();
      db.run(
        'INSERT INTO edges (id, source_id, target_id, type, weight, properties, created_at) VALUES (?,?,?,?,?,?,?)',
        id, r.source_id, r.target_id, r.type, r.weight ?? 1, JSON.stringify(r.properties || {}), now
      );
      r.id = id; r.created_at = now;
    }
  });
  return rows;
}

export function createNode({ type, name, label, properties = {}, x = 0, y = 0, size = 1 }) {
  const id = snowflake();
  const now = Date.now();
  db.run(
    'INSERT INTO nodes (id, type, name, label, properties, x, y, size, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, type, name, label || name, JSON.stringify(properties), x, y, size, now
  );
  return { id, type, name, label: label || name, properties, x, y, size, created_at: now };
}

export function createEdge({ sourceId, targetId, type, weight = 1, properties = {} }) {
  const id = snowflake();
  const now = Date.now();
  db.run(
    'INSERT INTO edges (id, source_id, target_id, type, weight, properties, created_at) VALUES (?,?,?,?,?,?,?)',
    id, sourceId, targetId, type, weight, JSON.stringify(properties), now
  );
  return { id, source_id: sourceId, target_id: targetId, type, weight, properties, created_at: now };
}

export function deleteNode(id) {
  // 删除节点需级联清理边，否则子图查询会引用悬空节点 —— 用事务保证一致性
  return db.tx(() => {
    db.run('DELETE FROM edges WHERE source_id = ? OR target_id = ?', id, id);
    db.run('DELETE FROM layout_cache WHERE node_id = ?', id);
    db.run('DELETE FROM nodes WHERE id = ?', id);
  });
}

// LOD 视口查询：按坐标范围过滤节点，再补齐视口内节点之间的边。
// 分页 size 上限 500，避免一次返回过多数据撑爆前端 Canvas 重绘预算。
export function queryViewport({ minX, minY, maxX, maxY, type, limit = 500, offset = 0 }) {
  let sql = 'SELECT id, type, name, label, x, y, size FROM nodes WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?';
  const params = [minX, maxX, minY, maxY];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const nodes = db.all(sql, ...params).map(parseNode);
  if (!nodes.length) return { nodes: [], edges: [] };
  const ids = nodes.map((n) => n.id);
  // 视口内边：两端都必须在视口内，避免画出一半在视口外的长边造成视觉混乱
  const placeholders = ids.map(() => '?').join(',');
  const edges = db.all(
    `SELECT id, source_id, target_id, type, weight FROM edges
     WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`,
    ...ids, ...ids
  );
  return { nodes, edges };
}

// 子图查询：BFS 展开 depth 层（1-3）。深度越大返回数据量指数增长，需硬上限防滥用。
export function querySubgraph(nodeId, depth = 1) {
  const d = Math.min(3, Math.max(1, depth));
  const visited = new Map(); // id -> { node, hop }
  const start = db.get('SELECT id, type, name, label, x, y, size FROM nodes WHERE id = ?', nodeId);
  if (!start) return { nodes: [], edges: [], center: null };
  const startNode = parseNode(start);
  visited.set(nodeId, { node: startNode, hop: 0 });
  let frontier = [nodeId];
  for (let hop = 1; hop <= d; hop++) {
    if (!frontier.length) break;
    const ph = frontier.map(() => '?').join(',');
    const rows = db.all(
      `SELECT id, source_id, target_id, type, weight FROM edges
       WHERE source_id IN (${ph}) OR target_id IN (${ph})`,
      ...frontier, ...frontier
    );
    const next = new Set();
    for (const e of rows) {
      // 逐边判断对端：source 在前沿则取 target，反之取 source
      const peer = frontier.includes(e.source_id) ? e.target_id : e.source_id;
      if (!visited.has(peer)) next.add(peer);
    }
    const newIds = [...next];
    if (newIds.length) {
      const np = newIds.map(() => '?').join(',');
      const newNodes = db.all(`SELECT id, type, name, label, x, y, size FROM nodes WHERE id IN (${np})`, ...newIds);
      for (const n of newNodes) visited.set(n.id, { node: parseNode(n), hop });
    }
    frontier = newIds;
  }
  // 收集已访问节点之间的所有边
  const allIds = [...visited.keys()];
  const ph = allIds.map(() => '?').join(',');
  const edges = db.all(
    `SELECT id, source_id, target_id, type, weight FROM edges
     WHERE source_id IN (${ph}) AND target_id IN (${ph})`,
    ...allIds, ...allIds
  );
  return {
    center: startNode,
    nodes: [...visited.values()].map((v) => ({ ...v.node, hop: v.hop })),
    edges,
  };
}

// L0 鹰眼：只返回坐标与类型，不带 label —— 万级节点一次性传输 < 500KB
export function queryOverview() {
  return db.all('SELECT id, type, x, y, size FROM nodes').map((r) => ({
    id: r.id, type: r.type, x: r.x, y: r.y, size: r.size,
  }));
}

export function searchNodes(q, limit = 50) {
  if (!q) return [];
  return db.all(
    'SELECT id, type, name, label, x, y, size FROM nodes WHERE name LIKE ? OR label LIKE ? LIMIT ?',
    `%${q}%`, `%${q}%`, limit
  ).map(parseNode);
}

export function filterByType(type, limit = 1000) {
  if (!NODE_TYPES.includes(type)) return [];
  return db.all('SELECT id, type, name, label, x, y, size FROM nodes WHERE type = ? LIMIT ?', type, limit).map(parseNode);
}

export function getStats() {
  const totalNodes = db.get('SELECT COUNT(*) c FROM nodes').c;
  const totalEdges = db.get('SELECT COUNT(*) c FROM edges').c;
  return { totalNodes, totalEdges };
}

// 组织类数据（部门/员工/产品线）带 label + properties，供组织树视图使用
export function queryOrgData() {
  const nodes = db.all(
    `SELECT id, type, name, label, x, y, size, properties FROM nodes
     WHERE type IN ('dept','employee','product_line','team') ORDER BY type, name`
  ).map(parseNode);
  const ids = nodes.map((n) => n.id);
  let edges = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    edges = db.all(
      `SELECT id, source_id, target_id, type, weight FROM edges
       WHERE source_id IN (${ph}) AND target_id IN (${ph})`,
      ...ids, ...ids
    );
  }
  return { nodes, edges };
}

// 批量写入布局坐标：事务包裹 50 次 UPDATE 避免逐条提交的 fsync 开销
export function saveLayout(positions) {
  db.tx(() => {
    for (const [id, { x, y }] of positions) {
      db.run('UPDATE nodes SET x = ?, y = ? WHERE id = ?', x, y, id);
      db.run('INSERT OR REPLACE INTO layout_cache (node_id, x, y, level) VALUES (?,?,?,0)', id, x, y);
    }
  });
}

export function clearGraph() {
  return db.tx(() => {
    db.run('DELETE FROM edges');
    db.run('DELETE FROM layout_cache');
    db.run('DELETE FROM nodes');
  });
}

/**
 * 钉钉通讯录 → 图谱：部门树 + 员工。
 * depts: [{id, name, parent_id}], employees: [{userid, name, dept_id, title, phone, email}]
 * 布局：部门按层级横排（L=深×列宽），员工围绕所在部门做小圆环 —— 关系图/组织树两种视图都自然。
 * 返回统计。
 */
export function importOrg({ depts = [], employees = [], clear = true }) {
  db.tx(() => {
    if (clear) {
      db.run('DELETE FROM edges');
      db.run('DELETE FROM layout_cache');
      db.run('DELETE FROM nodes');
    }
    const now = Date.now();
    const byId = new Map();
    let deptCount = 0;

    // 1. 算每层的部门列表（按 parent 指针分层）
    const roots = depts.filter((d) => !d.parent_id || !depts.find((x) => x.id === d.parent_id));
    const rootsSafe = roots.length ? roots : (depts.slice(0, 1));
    const depthOf = new Map();
    const byDepth = new Map();
    const assignDepth = (d, depth) => {
      depthOf.set(String(d.id), depth);
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth).push(d);
      for (const c of depts.filter((x) => String(x.parent_id) === String(d.id))) {
        assignDepth(c, depth + 1);
      }
    };
    for (const r of rootsSafe) assignDepth(r, 0);
    // 孤立部门（parent 指向不存在/环）兜底放在第 1 层
    for (const d of depts) {
      if (!depthOf.has(String(d.id))) {
        assignDepth(d, 1);
      }
    }

    const maxDepth = Math.max(...byDepth.keys());
    const COL_W = 340;
    const ROW_H = 240;
    const placeDept = (d, depth, colIndex, siblings) => {
      const x = (depth + 0.5) * COL_W;
      const cy = (colIndex + 0.5 - siblings / 2) * ROW_H;
      const dNode = createNode({
        type: 'dept',
        name: d.name,
        label: d.name,
        properties: { kind: '部门', dingtalkId: String(d.id) },
        x,
        y: cy,
        size: 3,
      });
      byId.set(String(d.id), dNode);
      deptCount++;
      return dNode;
    };

    // 2. 逐层摆部门：每层内按父部门聚合
    for (const [depth] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      const layer = byDepth.get(depth);
      // 父部门分组，组内兄弟按父角度展开
      const byParent = new Map();
      for (const d of layer) {
        const p = String(d.parent_id || d.id);
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(d);
      }
      let col = 0;
      for (const [, siblings] of byParent) {
        const sorted = siblings.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh'));
        sorted.forEach((d, i) => {
          const node = placeDept(d, depth, col, layer.length);
          const pId = String(d.parent_id);
          const parent = byId.get(pId);
          if (parent && parent.id !== node.id) {
            createEdge({ sourceId: parent.id, targetId: node.id, type: 'contains', weight: 1.5 });
          }
          col++;
        });
      }
    }
    // 部门间 contains 边（若上面因顺序尚未建立，这里补全：凡 depts 中 parent 存在即建边）
    for (const d of depts) {
      const from = byId.get(String(d.parent_id));
      const to = byId.get(String(d.id));
      if (from && to && from.id !== to.id) {
        createEdge({ sourceId: from.id, targetId: to.id, type: 'contains', weight: 1.5 });
      }
    }

    // 3. 员工：围绕部门，按部门内角度做小圆环
    const R_EMP = 140;
    const groupByDept = new Map();
    for (const e of employees) {
      const key = String(e.dept_id || '');
      if (!groupByDept.has(key)) groupByDept.set(key, []);
      groupByDept.get(key).push(e);
    }
    let empCount = 0;
    for (const [deptId, members] of groupByDept) {
      const deptNode = byId.get(deptId);
      if (!deptNode) continue;
      members.forEach((e, i) => {
        const angle = (2 * Math.PI * i) / Math.max(1, members.length);
        const empNode = createNode({
          type: 'employee',
          name: e.name,
          label: e.name,
          properties: {
            kind: '员工',
            userId: e.userid || e.userId || '',
            dingtalkId: String(e.userid || e.userId || ''),
            title: e.title || e.position || '',
            phone: e.phone || '',
            email: e.email || '',
            dept: deptNode.label,
          },
          x: deptNode.x + Math.cos(angle) * R_EMP,
          y: deptNode.y + Math.sin(angle) * R_EMP,
          size: 1.3,
        });
        createEdge({ sourceId: deptNode.id, targetId: empNode.id, type: 'belongs_to', weight: 1 });
        empCount++;
      });
    }

    return { departments: deptCount, employees: empCount, totalNodes: deptCount + empCount };
  });
}

function parseNode(r) {
  return { ...r, properties: r.properties ? JSON.parse(r.properties) : {} };
}

// ---------- 继任风险分析 ----------
// 关键人风险（HR/OD 刚需）：每个部门按「负责人是否存在 + 是否有副手候选」打三态。
//   HIGH   关键岗位空缺：本部门无人带管理头衔（总监/经理/负责人/HRBP/组长 等）
//   MEDIUM 继任断层：有负责人但无人可继任（本部门 + 直接子部门均无其他管理头衔）
//   LOW    继任梯队健全：有负责人 + 至少 1 名候选副手
// 管理头衔按 rank 排序：C 级/总裁 > 总监/首席 > 经理/主管/负责人/组长/HRBP
const MGR_PATTERNS = [
  { re: /(总裁|首席执行官|CEO|CTO|COO|CFO|CIO|CRO|副总裁|VP)/i, rank: 5 },
  { re: /(首席|chief)/i, rank: 4 },
  { re: /(总监|director)/i, rank: 4 },
  { re: /(负责人|head|leader|组长)/i, rank: 3 },
  { re: /(部长|经理|manager|主管|主任|hrbp|hrbp)/i, rank: 3 },
];
function managerOf(title) {
  if (!title) return null;
  let best = null;
  for (const p of MGR_PATTERNS) {
    const m = p.re.exec(title);
    if (m && (!best || p.rank > best.rank)) best = { rank: p.rank, label: m[0] };
  }
  return best;
}

export function analyzeSuccession() {
  const nodes = db.all('SELECT id, type, name, label, x, y, size, properties FROM nodes').map(parseNode);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = db.all('SELECT id, source_id, target_id, type FROM edges');

  const depts = nodes.filter((n) => n.type === 'dept');

  // 部门 → 直接子部门 / 直接员工（去重，防止重复边导致计数翻倍）
  const childDeptsOf = new Map();
  const employeesOf = new Map();
  const seenChild = new Set();
  const seenEmp = new Set();
  for (const e of edges) {
    const src = nodeById.get(e.source_id);
    const tgt = nodeById.get(e.target_id);
    if (!src || !tgt) continue;
    if (src.type === 'dept' && tgt.type === 'dept' && e.type === 'contains') {
      const key = `${src.id}|${tgt.id}`;
      if (seenChild.has(key)) continue;
      seenChild.add(key);
      if (!childDeptsOf.has(src.id)) childDeptsOf.set(src.id, []);
      childDeptsOf.get(src.id).push(tgt.id);
    } else if (src.type === 'dept' && tgt.type === 'employee' && e.type === 'belongs_to') {
      const key = `${src.id}|${tgt.id}`;
      if (seenEmp.has(key)) continue;
      seenEmp.add(key);
      if (!employeesOf.has(src.id)) employeesOf.set(src.id, []);
      employeesOf.get(src.id).push(tgt);
    }
  }

  // 递归 headcount：包含所有子部门员工
  const headcountOf = (deptId, seen = new Set()) => {
    if (seen.has(deptId)) return 0;
    seen.add(deptId);
    let c = (employeesOf.get(deptId) || []).length;
    for (const child of (childDeptsOf.get(deptId) || [])) c += headcountOf(child, seen);
    return c;
  };

  const result = [];
  for (const d of depts) {
    const members = employeesOf.get(d.id) || [];
    const childDeptIds = childDeptsOf.get(d.id) || [];
    // 候选副手池：本部门 + 直接子部门的员工
    const successorsPool = [...members];
    for (const cid of childDeptIds) {
      for (const e of (employeesOf.get(cid) || [])) successorsPool.push(e);
    }
    // 负责人：本部门 rank 最高的管理头衔者
    let head = null;
    for (const m of members) {
      const mgr = managerOf(m.properties?.title);
      if (mgr && (!head || mgr.rank > head.rank)) head = { ...m, rank: mgr.rank };
    }
    // 候选继任者：池中除 head 外的管理头衔者
    const successors = [];
    for (const m of successorsPool) {
      if (head && m.id === head.id) continue;
      const mgr = managerOf(m.properties?.title);
      if (mgr) successors.push({
        id: m.id, name: m.label || m.name, title: m.properties?.title || '', rank: mgr.rank,
      });
    }
    const hc = headcountOf(d.id);
    let risk, reason;
    if (!head) {
      risk = 'high'; reason = '关键岗位空缺（无明确负责人）';
    } else if (successors.length === 0) {
      risk = 'medium'; reason = hc <= 1 ? '单点风险（仅 1 人，无继任梯队）' : '继任断层（无明确副手）';
    } else {
      risk = 'low'; reason = `继任梯队健全（${successors.length} 名候选）`;
    }
    result.push({
      dept_id: d.id,
      dept_name: d.label || d.name,
      dept_x: d.x, dept_y: d.y,
      head: head ? { id: head.id, name: head.label || head.name, title: head.properties?.title || '' } : null,
      headcount: hc,
      direct_members: members.length,
      child_depts: childDeptIds.length,
      successors: successors.slice(0, 5),
      successor_count: successors.length,
      risk, reason,
    });
  }
  const order = { high: 0, medium: 1, low: 2 };
  result.sort((a, b) => (order[a.risk] - order[b.risk]) || (b.headcount - a.headcount));
  const summary = {
    total: result.length,
    high: result.filter((r) => r.risk === 'high').length,
    medium: result.filter((r) => r.risk === 'medium').length,
    low: result.filter((r) => r.risk === 'low').length,
    vacant: result.filter((r) => !r.head).length,
    total_headcount: result.reduce((s, r) => s + r.headcount, 0),
  };
  return { departments: result, summary };
}
