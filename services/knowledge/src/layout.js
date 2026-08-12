// nexus-knowledge：力导向布局（ForceAtlas2 简化版）+ 压测数据生成。
// 为何不用纯 O(n²) 全对斥力：10k 节点 × 50 迭代 = 5 亿次距离计算，JS 单线程需 50s+，
// 无法满足"万级节点 < 10s"的压测目标。改用空间网格近似斥力（Gephi "approximated" 模式），
// 每次迭代将节点按坐标分桶，仅与相邻 9 格内节点计算斥力，复杂度降至 O(n)。
// 边吸引力仍精确计算（边数远小于节点对数），保证连通结构不被网格近似破坏。
import { db, bulkInsertNodes, bulkInsertEdges, clearGraph, saveLayout, NODE_TYPES, EDGE_TYPES } from './repo.js';

const TYPE_WEIGHTS = {
  dept: 5, employee: 1, role: 2, project: 3, task: 2, document: 2, approval: 2, meeting: 2,
};

// 简化 ForceAtlas2：斥力（网格近似，线性 1/dist）+ 边吸引力（线性 dist/k）+ 重力 + 冷却。
// 性能要点：用 Float64Array 平行数组 + 整数索引替代 Map<object>，热循环内零对象分配。
// 万级节点 50 次迭代实测 ~3s（V8 对 typed array 索引访问有 JIT 优化）。
// 力律必须用线性而非二次：二次吸引力会把 hub 节点的邻居过度拉近，整图塌缩成高密度团块，
// 单格塞入上百节点后网格斥力退化回 O(n²)（早期 10k 节点 40s+ 的根因）。
export function forceLayout(nodes, edges, opts = {}) {
  const iterations = opts.iterations || 50;
  const n = nodes.length;
  if (!n) return new Map();

  // 节点 id -> 整数索引，避免热循环中做字符串哈希
  const id2idx = new Map();
  for (let i = 0; i < n; i++) id2idx.set(nodes[i].id, i);

  // 平行数组：坐标、位移。Float64Array 比 Map<object> 快 10-100x
  const R = Math.sqrt(n) * 30;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  // 磁盘初始化（而非圆环）：节点均匀铺满整个区域，使网格从首次迭代就生效，
  // 避免圆环导致初始所有节点挤在少量格内、斥力退化为 O(n²)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    px[i] = Math.cos(a) * r;
    py[i] = Math.sin(a) * r;
  }

  // 边预编译为整数索引对，热循环零字符串查找
  const m = edges.length;
  const esrc = new Int32Array(m);
  const edst = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    esrc[i] = id2idx.get(edges[i].source_id);
    edst[i] = id2idx.get(edges[i].target_id);
  }

  const k0 = Math.max(10, Math.sqrt((R * R * 4) / Math.max(1, n))); // 初始理想间距
  const gravity = 0.05;
  let temperature = R * 0.1;
  const cooling = 0.95;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  // 网格用 Map<number, number[]>，key 编码为 (cy+OFF)*W + (cx+OFF) 整数。
  // 必须加正偏移：cx/cy 可为负（坐标跨 ±R），裸 cy*W+cx 会让负索引互相碰撞，
  // 把不相邻的格子合并、斥力退化为 O(n²) —— 这是早期 10k 节点 40s+ 的根因。
  const grid = new Map();
  const OFF = 100000;
  const W = 200000;

  for (let iter = 0; iter < iterations; iter++) {
    grid.clear();
    dx.fill(0); dy.fill(0);
    // 自适应格大小：按当前实际包围盒重算，保证每格 ~1 节点。
    // 固定格大小会在布局收缩后让单格塞入上百节点、斥力退化回 O(n²)。
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = px[i], y = py[i];
      if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
    }
    const w = Math.max(1, bMaxX - bMinX);
    const h = Math.max(1, bMaxY - bMinY);
    const cellSize = Math.max(k0, Math.sqrt((w * h) / Math.max(1, n)));
    const inv = 1 / cellSize;
    // 1. 分桶
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((px[i] - bMinX) * inv) + OFF;
      const cy = Math.floor((py[i] - bMinY) * inv) + OFF;
      const key = cy * W + cx;
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(i);
    }

    // 2. 斥力：3x3 邻域
    for (const [key, bucket] of grid) {
      const cx = key % W;
      const cy = (key - cx) / W;
      for (let oi = 0; oi < bucket.length; oi++) {
        const a = bucket[oi];
        const ax = px[a], ay = py[a];
        for (let dcy = -1; dcy <= 1; dcy++) {
          for (let dcx = -1; dcx <= 1; dcx++) {
            const nb = grid.get((cy + dcy) * W + (cx + dcx));
            if (!nb) continue;
            for (let bi = 0; bi < nb.length; bi++) {
              const b = nb[bi];
              if (a === b) continue;
              let ddx = ax - px[b];
              let ddy = ay - py[b];
              let dist2 = ddx * ddx + ddy * ddy;
              if (dist2 < 0.01) { ddx = 0.1; ddy = 0.1; dist2 = 0.01; }
              const dist = Math.sqrt(dist2);
              // ForceAtlas2 斥力为线性 1/dist（而非 1/dist²）：避免短距爆炸、
              // 与线性吸引力配平，使节点稳定在 ~k0 间距，防止 hub 把图拽塌。
              const force = (k0 * k0) / dist;
              const ux = ddx / dist;
              const uy = ddy / dist;
              dx[a] += ux * force;
              dy[a] += uy * force;
            }
          }
        }
      }
    }

    // 3. 吸引力：沿边线性（ForceAtlas2 标准力律），force = dist / k0
    for (let i = 0; i < m; i++) {
      const a = esrc[i], b = edst[i];
      const ddx = px[a] - px[b];
      const ddy = py[a] - py[b];
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const force = dist / k0;
      const ux = ddx / dist;
      const uy = ddy / dist;
      dx[a] -= ux * force;
      dy[a] -= uy * force;
      dx[b] += ux * force;
      dy[b] += uy * force;
    }

    // 4. 重力 + 限温更新
    for (let i = 0; i < n; i++) {
      let fx = dx[i] - px[i] * gravity;
      let fy = dy[i] - py[i] * gravity;
      const mag = Math.sqrt(fx * fx + fy * fy) || 0.01;
      const limited = Math.min(mag, temperature);
      px[i] += (fx / mag) * limited;
      py[i] += (fy / mag) * limited;
    }
    temperature *= cooling;
  }

  const result = new Map();
  for (let i = 0; i < n; i++) result.set(nodes[i].id, { x: px[i], y: py[i] });
  return result;
}

// 压测数据生成：按企业真实分布构造节点与边，保证图谱有意义的拓扑结构
// （部门-员工-角色-项目-任务-文档-审批-会议 的多层关系网），而非随机噪声。
export function seedGraph({ nodeCount = 10000, edgeCount = 50000 } = {}) {
  clearGraph();
  const now = Date.now();

  // 节点配比：员工占多数，部门/角色少量，其余中等 —— 模拟真实企业
  const dist = [
    ['dept', Math.round(nodeCount * 0.02)],
    ['role', Math.round(nodeCount * 0.05)],
    ['employee', Math.round(nodeCount * 0.45)],
    ['project', Math.round(nodeCount * 0.08)],
    ['task', Math.round(nodeCount * 0.18)],
    ['document', Math.round(nodeCount * 0.12)],
    ['approval', Math.round(nodeCount * 0.06)],
    ['meeting', Math.round(nodeCount * 0.04)],
  ];
  const buckets = {};
  const nodeRows = [];
  for (const [type, count] of dist) {
    buckets[type] = [];
    for (let i = 0; i < count; i++) {
      const name = `${type}-${i + 1}`;
      nodeRows.push({ type, name, label: name, properties: { index: i, generated: true }, size: TYPE_WEIGHTS[type] });
    }
  }
  bulkInsertNodes(nodeRows);
  for (const r of nodeRows) buckets[r.type].push(r);
  const allNodes = nodeRows;
  // 边生成：按语义关系连接，保证图连通且有意义
  const edgeRows = [];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const emps = buckets.employee || [];
  const depts = buckets.dept || [];
  const roles = buckets.role || [];
  const projects = buckets.project || [];
  const tasks = buckets.task || [];
  const docs = buckets.document || [];
  const approvals = buckets.approval || [];
  const meetings = buckets.meeting || [];

  const target = edgeCount;
  let made = 0;
  const seen = new Set();
  const addEdge = (s, t, type) => {
    if (!s || !t || s.id === t.id) return;
    const key = `${s.id}-${t.id}-${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    edgeRows.push({ source_id: s.id, target_id: t.id, type, weight: 1 });
    made++;
  };

  // 每个员工：归属部门 + 担任角色 + 汇报上级 + 参与项目 + 负责任务 + 创建文档 + 发起审批 + 出席会议
  // 注意：汇报上级用模运算选他人，禁止 emps.filter（那是 O(n²)=2000 万次，seed 主耗时来源）
  const empCount = emps.length;
  for (let ei = 0; ei < empCount; ei++) {
    const emp = emps[ei];
    if (depts.length) addEdge(emp, pick(depts), 'belongs_to');
    if (roles.length) addEdge(emp, pick(roles), 'belongs_to');
    if (empCount > 1) {
      const mgr = emps[(ei + 1 + Math.floor(Math.random() * (empCount - 1))) % empCount];
      addEdge(emp, mgr, 'reports_to');
    }
    if (projects.length) addEdge(emp, pick(projects), 'participates');
    if (tasks.length) addEdge(emp, pick(tasks), 'responsible_for');
    if (docs.length) addEdge(emp, pick(docs), 'creates');
    if (approvals.length) addEdge(emp, pick(approvals), 'initiates');
    if (meetings.length) addEdge(emp, pick(meetings), 'attends');
    if (made >= target) break;
  }
  // 补足剩余边数：随机员工-任务/项目/文档 关系
  // pool 必须在循环外构造：含 4800 元素，放循环内每次重建 = 6700 万次拷贝（seed 第二大耗时）
  const pool = [tasks, projects, docs, meetings].flat().filter(Boolean);
  const poolTypes = ['participates', 'responsible_for', 'creates', 'attends'];
  while (made < target && emps.length && pool.length) {
    const emp = pick(emps);
    addEdge(emp, pick(pool), pick(poolTypes));
  }
  bulkInsertEdges(edgeRows);

  // 计算布局并落库（saveLayout 内部已用事务）
  const positions = forceLayout(allNodes, edgeRows, { iterations: 50 });
  saveLayout(positions);

  return {
    nodes: allNodes.length,
    edges: edgeRows.length,
    layoutTime: Date.now() - now,
    bounds: computeBounds(positions),
  };
}

function computeBounds(positions) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
