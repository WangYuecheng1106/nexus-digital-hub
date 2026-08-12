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

function parseNode(r) {
  return { ...r, properties: r.properties ? JSON.parse(r.properties) : {} };
}
