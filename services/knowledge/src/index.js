// nexus-knowledge：服务入口与路由。
// 评审重点模块：万级节点 + FPS>=30 的渲染分层架构由本服务提供数据支撑。
// L0 鹰眼（/graph/overview）一次性返回全量坐标；L1 视口（/graph/viewport）按
// 缩放与边界框分页拉取；L2 子图（/graph/subgraph/:id）双击聚焦时按深度展开。
import { createService, asyncRoute, requireFields, badRequest, notFound, publishEvent } from '@nexus/shared';
import {
  db, createNode, createEdge, deleteNode, queryViewport, querySubgraph,
  queryOverview, searchNodes, filterByType, getStats, NODE_TYPES, EDGE_TYPES,
} from './repo.js';
import { seedGraph } from './layout.js';
import { organizePeople } from './organize.js';

const { ctx } = createService({
  name: 'knowledge',
  port: 8087,
  publicPaths: ['/health', '/debug', '/seed', '/graph/*'],
  setup(app, ctx) {
    // ---- 压测数据注入：生成节点 + 边 + 预计算布局，全流程 < 10s ----
    app.post('/seed', asyncRoute(async (req, res) => {
      const nodeCount = Math.min(50000, Math.max(100, parseInt(req.body?.nodeCount) || 10000));
      const edgeCount = Math.min(200000, Math.max(100, parseInt(req.body?.edgeCount) || 50000));
      const result = seedGraph({ nodeCount, edgeCount });
      publishEvent('knowledge.seeded', result, 'knowledge');
      res.status(201).json({ ok: true, ...result });
    }));

    // ---- L1 视口查询：LOD 核心，按缩放层级与边界框分页返回 ----
    app.get('/graph/viewport', (req, res) => {
      const zoom = parseFloat(req.query.zoom) || 1;
      const minX = parseFloat(req.query.minX);
      const minY = parseFloat(req.query.minY);
      const maxX = parseFloat(req.query.maxX);
      const maxY = parseFloat(req.query.maxY);
      if ([minX, minY, maxX, maxY].some(Number.isNaN)) throw badRequest('minX/minY/maxX/maxY 必填且为数字');
      const limit = Math.min(500, parseInt(req.query.limit) || 500);
      const offset = parseInt(req.query.offset) || 0;
      const result = queryViewport({ minX, minY, maxX, maxY, type: req.query.type, limit, offset });
      res.json({ zoom, ...result, limit, offset });
    });

    // ---- L2 子图查询：双击聚焦，按深度 1-3 展开 ----
    app.get('/graph/subgraph/:nodeId', (req, res) => {
      const depth = parseInt(req.query.depth) || 1;
      const result = querySubgraph(req.params.nodeId, depth);
      if (!result.center) throw notFound('节点不存在');
      res.json(result);
    });

    // ---- L0 鹰眼：全量坐标，仅 id/type/x/y/size，无 label ----
    app.get('/graph/overview', (req, res) => {
      res.json(queryOverview());
    });

    // ---- 关键词搜索 ----
    app.get('/graph/search', (req, res) => {
      res.json(searchNodes(String(req.query.q || ''), Math.min(200, parseInt(req.query.limit) || 50)));
    });

    // ---- 按类型筛选 ----
    app.get('/graph/filter', (req, res) => {
      const type = req.query.type;
      if (!type || !NODE_TYPES.includes(type)) throw badRequest(`type 必须为: ${NODE_TYPES.join(', ')}`);
      res.json(filterByType(type, Math.min(5000, parseInt(req.query.limit) || 1000)));
    });

    // ---- 调试端点：总节点/边 + 视口节点数（供 Playwright 断言内部状态）----
    app.get('/graph/stats', (req, res) => {
      const stats = getStats();
      // 视口节点数：用全量边界框估算，前端调试用
      const bounds = db.get('SELECT MIN(x) minX, MAX(x) maxX, MIN(y) minY, MAX(y) maxY FROM nodes') || {};
      const viewportNodeCount = db.get('SELECT COUNT(*) c FROM nodes').c;
      res.json({ ...stats, viewportNodeCount, bounds });
    });

    // ---- 节点 CRUD ----
    app.post('/graph/nodes', asyncRoute(async (req, res) => {
      requireFields(req.body, ['type', 'name']);
      if (!NODE_TYPES.includes(req.body.type)) throw badRequest(`type 必须为: ${NODE_TYPES.join(', ')}`);
      const node = createNode({
        type: req.body.type,
        name: req.body.name,
        label: req.body.label,
        properties: req.body.properties || {},
        x: req.body.x ?? 0,
        y: req.body.y ?? 0,
        size: req.body.size ?? 1,
      });
      publishEvent('knowledge.node_created', { id: node.id, type: node.type }, 'knowledge');
      res.status(201).json(node);
    }));

    app.delete('/graph/nodes/:id', (req, res) => {
      const r = deleteNode(req.params.id);
      publishEvent('knowledge.node_deleted', { id: req.params.id }, 'knowledge');
      res.json({ ok: true });
    });

    // ---- 边 CRUD ----
    app.post('/graph/edges', asyncRoute(async (req, res) => {
      requireFields(req.body, ['sourceId', 'targetId', 'type']);
      if (!EDGE_TYPES.includes(req.body.type)) throw badRequest(`type 必须为: ${EDGE_TYPES.join(', ')}`);
      const edge = createEdge({
        sourceId: req.body.sourceId,
        targetId: req.body.targetId,
        type: req.body.type,
        weight: req.body.weight ?? 1,
        properties: req.body.properties || {},
      });
      publishEvent('knowledge.edge_created', { id: edge.id }, 'knowledge');
      res.status(201).json(edge);
    }));

    // ---- AI 整理项目人员 → 图谱（对标 WeLink 连接知识）----
    app.post('/graph/organize-people', asyncRoute(async (req, res) => {
      let employees = req.body?.employees;
      if (!employees?.length) {
        // 从 contacts 拉取（服务间 HTTP）
        try {
          const token = req.headers.authorization || '';
          const r = await fetch('http://127.0.0.1:8092/employees?limit=200', {
            headers: { Authorization: token },
          });
          if (r.ok) {
            const data = await r.json();
            employees = Array.isArray(data) ? data : (data.items || []);
          }
        } catch { /* */ }
      }
      if (!employees?.length) throw badRequest('无法获取人员列表，请传入 employees 或确保通讯录服务可用');
      const result = organizePeople(employees, {
        projectName: req.body?.projectName || 'Nexus 项目',
        clearPeople: !!req.body?.clearPeople,
      });
      publishEvent('knowledge.people_organized', result, 'knowledge');
      res.status(201).json({ ...result, aiGenerated: true });
    }));

    // ---- 调试状态：供 /debug/state 聚合，Playwright 可读取图谱规模 ----
    ctx.addDebug(() => {
      const stats = getStats();
      return {
        totalNodes: stats.totalNodes,
        totalEdges: stats.totalEdges,
        nodeTypes: NODE_TYPES,
        edgeTypes: EDGE_TYPES,
      };
    });
  },
});

export { ctx };
