import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api, dingtalkLogin, getToken } from '../api.js';

// ---------- 类型样式 ----------
const TYPE_META = {
  dept: { color: '#5b5fc7', label: '部门' },
  employee: { color: '#3d8b6e', label: '员工' },
  product_line: { color: '#141413', label: '产品线' },
  team: { color: '#7c6fad', label: '小组' },
  role: { color: '#7c3aed', label: '角色' },
  project: { color: '#b45309', label: '项目' },
  task: { color: '#be185d', label: '任务' },
  document: { color: '#0f766e', label: '文档' },
  approval: { color: '#a16207', label: '审批' },
  meeting: { color: '#1d4ed8', label: '会议' },
};

// ---------- 继任风险元数据 ----------
const RISK_META = {
  high: { color: '#dc2626', label: '高风险' },
  medium: { color: '#f59e0b', label: '中风险' },
  low: { color: '#16a34a', label: '低风险' },
};

// ---------- 图谱坐标换算（与后端 LOD 对齐） ----------
const SCALE = 0.12;
function worldToScreen(wx, wy, zoom, offset, w, h) {
  return { x: wx * zoom * SCALE + offset.x + w / 2, y: wy * zoom * SCALE + offset.y + h / 2 };
}
function screenToWorld(sx, sy, zoom, offset, w, h) {
  const k = zoom * SCALE;
  return { x: (sx - offset.x - w / 2) / k, y: (sy - offset.y - h / 2) / k };
}
function computeFit(nodes, w, h) {
  if (!nodes.length) return { zoom: 1, offset: { x: 0, y: 0 } };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x == null || n.y == null) continue;
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  if (!Number.isFinite(minX)) return { zoom: 1, offset: { x: 0, y: 0 } };
  const bw = Math.max(40, maxX - minX);
  const bh = Math.max(40, maxY - minY);
  const zoom = Math.max(0.6, Math.min(6, Math.min((w * 0.85) / (bw * SCALE), (h * 0.85) / (bh * SCALE))));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { zoom, offset: { x: -cx * zoom * SCALE, y: -cy * zoom * SCALE } };
}

// ---------- 树布局：组织树（垂直 tidy tree，父上子下） ----------
function buildOrgTree(overview, edges) {
  const nodeById = new Map(overview.map((n) => [n.id, n]));
  const childrenOf = new Map();
  // 关系：dept contains dept / dept belongs_to employee(仅建父子链，不把员工当部门容器)
  for (const e of edges || []) {
    const src = nodeById.get(e.source_id);
    const tgt = nodeById.get(e.target_id);
    if (!src || !tgt || src.id === tgt.id) continue;
    if (src.type !== 'employee') {
      if (!childrenOf.has(e.source_id)) childrenOf.set(e.source_id, []);
      if (!childrenOf.get(e.source_id).includes(tgt)) childrenOf.get(e.source_id).push(tgt);
    }
  }
  const isChild = new Set();
  for (const list of childrenOf.values()) for (const c of list) isChild.add(c.id);
  const roots = overview.filter((n) => !isChild.has(n.id));

  // 垂直 tidy tree：y = depth * 行高；x 用中序遍历分配（居中对称）
  const ROW_H = 150;
  const COL_W = 120;
  let xCursor = 0;
  const assign = (node, depth) => {
    const kids = (childrenOf.get(node.id) || []).filter((c) => c && nodeById.has(c.id));
    const my = { ...node, isTree: true, yRoot: depth * ROW_H };
    if (kids.length === 0) {
      my.xRoot = xCursor;
      xCursor += COL_W;
      return my;
    }
    const sub = kids.map((k) => assign(k, depth + 1));
    my.xRoot = sub.length % 2 === 1 ? sub[Math.floor(sub.length / 2)].xRoot : (sub[Math.floor((sub.length - 1) / 2)].xRoot + sub[Math.floor(sub.length / 2)].xRoot) / 2;
    my.sub = sub;
    return my;
  };
  const tree = roots.map((r) => assign(r, 0));

  // 展平
  const flat = [];
  const flatten = (n) => {
    flat.push({ ...n, x: n.xRoot, y: n.yRoot });
    const sub = n.sub;
    delete n.sub;
    for (const s of sub || []) flatten(s);
  };
  for (const r of tree) flatten(r);
  if (!flat.length) return { nodes: [], edges: [] };

  // 对称化：以根为轴，整体往左移动一半宽度
  let minX = Infinity, maxX = -Infinity;
  for (const n of flat) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; }
  const shift = (minX + maxX) / 2;
  for (const n of flat) n.x -= shift;

  const treeNodes = flat;
  const treeEdges = [];
  const seenE = new Set();
  for (const e of edges || []) {
    const src = nodeById.get(e.source_id);
    const tgt = nodeById.get(e.target_id);
    if (!src || !tgt) continue;
    const key = `${e.source_id}-${e.target_id}`;
    if (seenE.has(key)) continue;
    seenE.add(key);
    if (src.type !== 'employee' && childrenOf.has(e.source_id)) {
      treeEdges.push({ source_id: e.source_id, target_id: e.target_id, isTree: true });
    }
  }
  return { nodes: treeNodes, edges: treeEdges };
}

export default function GraphApp() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState({ totalNodes: 0, totalEdges: 0 });
  const [mode, setMode] = useState('tree'); // tree | graph | succession
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [succession, setSuccession] = useState(null);

  const overviewRef = useRef([]);
  const treeRef = useRef({ nodes: [], edges: [] });
  const viewportRef = useRef({ nodes: [], edges: [] });
  const riskMapRef = useRef(new Map()); // dept_id -> risk
  const [cam, setCam] = useState({ zoom: 1, offset: { x: 0, y: 0 } });
  const camRef = useRef(cam);
  const dragRef = useRef(null);
  const dragMovedRef = useRef(false);
  const fpsRef = useRef({ frames: 0, lastTime: 0 });
  
  // 节点拖拽相关状态
  const isNodeDraggingRef = useRef(false);
  const draggedNodeIdRef = useRef(null);
  const nodeStartDragRef = useRef({ x: 0, y: 0 });
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [fps, setFps] = useState(60);

  useEffect(() => { camRef.current = cam; }, [cam]);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  // 尺寸自适应
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: Math.max(320, Math.floor(cr.width)), height: Math.max(240, Math.floor(cr.height)) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 初始化：拉配置 + 尝试钉钉免登 + 载入图谱
  const init = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api('/dingtalk/config').catch(() => null);
      setConfig(cfg);
      // 跳转 / 钉钉端内自动免登；浏览器演示态跳过一次
      if (!getToken()) {
        const dingUser = await dingtalkLogin();
        if (dingUser) setUser(dingUser);
      }
    } catch { /* 后端不可用 */ }

    let ok = false;
    try {
      const s = await api('/knowledge/graph/stats');
      setStats(s);
      ok = s.totalNodes > 0;
    } catch { /* */ }
    if (!ok) {
      // 无数据 → 注入演示数据，保证首次打开即可用
      try {
        await api('/knowledge/graph/seed-demo', { method: 'POST' });
        const s = await api('/knowledge/graph/stats');
        setStats(s);
      } catch (e) { setError('图谱数据初始化失败：' + (e.message || e)); }
    }
    try {
      const [overview, org, edges] = await Promise.all([
        api('/knowledge/graph/overview'),
        api('/knowledge/graph/org').catch(() => ({ nodes: [], edges: [] })),
        api('/knowledge/graph/viewport?zoom=1&minX=-4000&minY=-4000&maxX=4000&maxY=4000&limit=1000'),
      ]);
      overviewRef.current = overview.nodes || overview || [];
      viewportRef.current = edges;
      // 组织树优先用带 label 的组织数据；取不到再用 overview
      const orgNodes = (org.nodes || []).length ? org.nodes : overviewRef.current;
      const orgEdges = (org.edges || []).length ? org.edges : (edges.edges || []);
      treeRef.current = buildOrgTree(orgNodes, orgEdges);
      const nodes = treeRef.current.nodes.length ? treeRef.current.nodes : overviewRef.current;
      const fitted = computeFit(nodes, size.width, size.height);
      setCam(fitted);
    } catch (e) { setError('图谱加载失败：' + (e.message || e)); }
    setLoading(false);
  }, [size.width, size.height]);

  useEffect(() => { init(); }, [init]);

  // 同步钉钉通讯录 → 图谱；未配置则弹配置弹窗
  const syncOrg = async () => {
    setSyncing(true);
    setError('');
    try {
      const r = await api('/dingtalk/sync/org', { method: 'POST', body: JSON.stringify({}), timeoutError: true });
      showToast(`同步完成：${r.departments} 部门 · ${r.employees} 员工`);
      await init();
    } catch (e) {
      setError(e.message || '同步失败');
      if (e.message && /未配置|Key/i.test(e.message)) setShowConfig(true);
    }
    setSyncing(false);
  };

  const loadDemo = async () => {
    setLoading(true);
    try {
      await api('/knowledge/graph/seed-demo', { method: 'POST' });
      await init();
      showToast('已载入演示组织数据');
    } catch (e) { setError('载入演示数据失败：' + (e.message || e)); }
    setLoading(false);
  };

  const doSearch = async (q) => {
    if (!q) { setResults([]); return; }
    try {
      const r = await api(`/knowledge/graph/search?q=${encodeURIComponent(q)}&limit=20`);
      const list = Array.isArray(r) ? r : (r.items || []);
      const withProps = await Promise.all(list.map(async (n) => {
        try { return { ...n, props: n.properties || {} }; } catch { return n; }
      }));
      setResults(withProps.slice(0, 8));
    } catch { setResults([]); }
  };

  // 继任风险分析：进入「继任风险」视图时拉取，并写入 riskMapRef 供 Canvas 着色
  const loadSuccession = useCallback(async () => {
    try {
      const r = await api('/knowledge/graph/succession');
      setSuccession(r);
      const m = new Map();
      for (const d of r.departments || []) m.set(d.dept_id, d.risk);
      riskMapRef.current = m;
    } catch (e) { setError('继任风险分析失败：' + (e.message || e)); }
  }, []);

  // AI 智能分析总结（模拟 AI 生成，实际可接入钉钉 AI Agent 或大模型 API）
  const generateAISummary = useCallback(async () => {
    if (!succession) return '';
    setAiLoading(true);
    setAiSummary('');
    try {
      // 模拟 AI 思考过程
      await new Promise(r => setTimeout(r, 1500));
      
      const { summary, departments } = succession;
      const parts = [];
      
      // 总体评估
      if (summary.high > 0) {
        parts.push(`⚠️ **整体风险偏高**：当前共有 ${summary.high} 个部门处于高风险状态，${summary.medium} 个处于中风险。建议优先处理空缺的关键岗位。`);
      } else if (summary.medium > 0) {
        parts.push(`⚡ **存在潜在风险**：共有 ${summary.medium} 个部门处于中风险状态，建议为这些部门储备候选人才。`);
      } else {
        parts.push(`✅ **组织状况良好**：所有部门均有明确的负责人和继任梯队，组织稳定性高。`);
      }
      
      // 详细建议
      const highRiskDepts = departments.filter(d => d.risk === 'high');
      const mediumRiskDepts = departments.filter(d => d.risk === 'medium');
      
      if (highRiskDepts.length > 0) {
        parts.push('\n**高风险部门紧急行动建议：**');
        for (const d of highRiskDepts.slice(0, 3)) {
          if (!d.head) {
            parts.push(`• **${d.dept_name}**（${d.headcount}人）：⚠️ 岗位空缺，需立即指定临时负责人或启动招聘流程。`);
          } else {
            parts.push(`• **${d.dept_name}**：⚠️ 负责人 ${d.head.name} 名下无明确副手，建议尽快培养或物色继任者。`);
          }
        }
        if (highRiskDepts.length > 3) {
          parts.push(`  …等 ${highRiskDepts.length} 个部门需要关注。`);
        }
      }
      
      if (mediumRiskDepts.length > 0) {
        parts.push('\n**中风险部门建议：**');
        for (const d of mediumRiskDepts.slice(0, 2)) {
          parts.push(`• **${d.dept_name}**：${d.reason}。建议在 ${d.child_depts > 0 ? '下属部门' : '团队内部'}中发掘培养候选人。`);
        }
      }
      
      parts.push('\n**低风险部门最佳实践：**');
      parts.push(`• 已有 ${summary.low} 个部门拥有健全的继任梯队，可作为组织发展的标杆案例。`);
      
      return parts.join('\n');
    } catch (e) {
      return 'AI 分析失败：' + (e.message || e);
    } finally {
      setAiLoading(false);
    }
  }, [succession]);

  // 在组织树上聚焦到某个部门（不触发子图 fetch，避免破坏树布局）
  const focusDeptInTree = useCallback((deptId) => {
    const tn = treeRef.current.nodes.find((n) => n.id === deptId);
    if (!tn) return;
    setSelected(tn);
    const z = Math.max(camRef.current.zoom, 2.4);
    setCam({ zoom: z, offset: { x: -tn.x * z * SCALE, y: -tn.y * z * SCALE } });
  }, []);

  const focusNode = async (n) => {
    setSelected(n);
    try {
      const sg = await api(`/knowledge/graph/subgraph/${n.id}?depth=2`);
      viewportRef.current = sg;
      const nodes = [...(sg.nodes || []), ...overviewRef.current.filter((o) => sg.nodes?.some((x) => x.id === o.id))];
      const unique = [...new Map(nodes.map((x) => [x.id, x])).values()].length ? nodes : overviewRef.current;
      const fitted = computeFit(unique, size.width, size.height);
      setCam(fitted);
    } catch { /* */ }
  };

  const clearFocus = () => { setSelected(null); setResults([]); };

  // ---------- Canvas 渲染 ----------
  useEffect(() => {
    let raf;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const { zoom: z, offset: off } = camRef.current;
        fpsRef.current.frames++;
        const now = performance.now();
        if (now - fpsRef.current.lastTime >= 1000) {
          setFps(fpsRef.current.frames);
          fpsRef.current = { frames: 0, lastTime: now };
        }
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f6f3ee';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(28,25,23,0.04)';
        for (let gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
        for (let gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

        const isTreeLike = (mode === 'tree' || mode === 'succession');
        const vp = isTreeLike ? treeRef.current : viewportRef.current;
        const vpById = new Map((vp.nodes || []).map((n) => [n.id, n]));
        // 边
        for (const e of vp.edges || []) {
          const s = vpById.get(e.source_id) || { x: e.source_x, y: e.source_y };
          const t = vpById.get(e.target_id) || { x: e.target_x, y: e.target_y };
          if (s.x == null || t.x == null) continue;
          const a = worldToScreen(s.x, s.y, z, off, w, h);
          const b = worldToScreen(t.x, t.y, z, off, w, h);
          ctx.strokeStyle = mode === 'succession' ? 'rgba(120, 113, 108, 0.28)' : 'rgba(91, 95, 199, 0.25)';
          ctx.lineWidth = isTreeLike ? 1.4 : 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        // 节点
        for (const n of vp.nodes || []) {
          const p = worldToScreen(n.x, n.y, z, off, w, h);
          // 继任风险模式下，部门节点按风险三态着色 + 外环
          let color = TYPE_META[n.type]?.color || '#8a847c';
          let riskRing = null;
          if (mode === 'succession' && n.type === 'dept') {
            const rk = riskMapRef.current.get(n.id);
            if (rk && RISK_META[rk]) { color = RISK_META[rk].color; riskRing = RISK_META[rk].color; }
          }
          const r = Math.max(isTreeLike ? 5 : 4, (n.size || 3) * Math.sqrt(z) * (isTreeLike ? 1 : 1));
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
          ctx.fillStyle = color + '22'; ctx.fill();
          if (riskRing) {
            ctx.beginPath(); ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
            ctx.strokeStyle = riskRing; ctx.lineWidth = 2.4; ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.fill();
          if (selected?.id === n.id) { ctx.strokeStyle = '#141413'; ctx.lineWidth = 2; ctx.stroke(); }
          const showLabel = isTreeLike || z > 1.6 || n.type === 'dept' || n.type === 'product_line';
          if (showLabel) {
            ctx.fillStyle = '#1c1917';
            ctx.font = `${n.type === 'dept' || n.type === 'product_line' ? 'bold 12' : '11'}px Source Sans 3, sans-serif`;
            ctx.fillText(n.label || n.name || '', p.x + r + 5, p.y + 4);
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [mode, selected, size.width, size.height]);

  // 交互：拖拽/点击/滚轮
  const pickNearest = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { zoom: z, offset: off } = camRef.current;
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, z, off, canvas.width, canvas.height);
    const isTreeLike = (mode === 'tree' || mode === 'succession');
    const pool = isTreeLike
      ? treeRef.current.nodes
      : [...(viewportRef.current.nodes || []), ...overviewRef.current.slice(0, 2000)];
    let nearest = null, minDist = Infinity;
    for (const n of pool) {
      const d = Math.hypot(n.x - world.x, n.y - world.y);
      if (d < minDist) { minDist = d; nearest = n; }
    }
    if (nearest && minDist < (isTreeLike ? 40 : 90) / z) return nearest;
    return null;
  };

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      {/* 顶栏 */}
      <header className="nx-topbar" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <b style={{ whiteSpace: 'nowrap' }}>关系图谱</b>
          <span className="tag" style={{ whiteSpace: 'nowrap' }}>{config?.configured ? '钉钉已连接' : '演示态'}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              placeholder="搜索员工、部门…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); doSearch(e.target.value); }}
              style={{ width: 200, height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
            />
            {results.length > 0 && (
              <div className="search-pop" style={{ position: 'absolute', top: 44, left: 0 }}>
                {results.map((r) => (
                  <button key={r.id} type="button" className="list-row" onClick={() => { focusNode(r); clearFocus(); setSearch(r.label || r.name); }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_META[r.type]?.color || '#666' }} />
                    <span>{r.label || r.name}</span>
                    <span className="text-xs" style={{ opacity: .6 }}>{TYPE_META[r.type]?.label || r.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'flex-end' }}>
          {/* 视图切换 */}
          <div className="seg" style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" className={mode === 'tree' ? 'seg-active' : ''} style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setMode('tree')}>组织树</button>
            <button type="button" className={mode === 'graph' ? 'seg-active' : ''} style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setMode('graph')}>关系图</button>
            <button type="button" className={mode === 'succession' ? 'seg-active' : ''} style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => { setMode('succession'); if (!succession) loadSuccession(); }}>继任风险</button>
          </div>
          <button type="button" className="btn-default" style={{ fontSize: 12 }} onClick={() => { const pool = (mode === 'tree' || mode === 'succession') ? treeRef.current.nodes : overviewRef.current; const f = computeFit(pool, size.width, size.height); setCam(f); }}>适应画布</button>
          {config?.configured ? (
            <button type="button" className="btn-primary" style={{ fontSize: 12 }} onClick={syncOrg} disabled={syncing}>
              {syncing ? '同步中…' : '同步钉钉通讯录'}
            </button>
          ) : (
            <>
              <button type="button" className="btn-default" style={{ fontSize: 12 }} onClick={loadDemo}>载入演示数据</button>
              <button type="button" className="btn-primary" style={{ fontSize: 12 }} onClick={() => setShowConfig(true)}>接入钉钉</button>
            </>
          )}
          {user && <span className="text-xs">{user.display_name}</span>}
          <div className="avatar sm accent">{user ? (user.display_name || '钉')[0] : '演'}</div>
        </div>
      </header>

      {/* 主区 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }} ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={mode === 'succession' ? Math.max(320, size.width - 332) : size.width}
          height={size.height}
          style={{ flex: 1, cursor: 'grab' }}
          onWheel={(e) => { e.preventDefault(); setCam((c) => ({ ...c, zoom: Math.max(0.4, Math.min(12, c.zoom * (e.deltaY > 0 ? 0.9 : 1.1))) })); }}
          onMouseDown={(e) => {
            const n = pickNearest(e);
            // 仅在关系图模式下允许拖拽节点
            if (n && mode === 'graph') {
              draggedNodeIdRef.current = n.id;
              nodeStartDragRef.current = { x: e.clientX, y: e.clientY };
              isNodeDraggingRef.current = true;
              setSelected(n); // 直接选中，便于显示详情
              // 不初始化画布平移
              return;
            }
            dragMovedRef.current = false;
            dragRef.current = { x: e.clientX - cam.offset.x, y: e.clientY - cam.offset.y, sx: e.clientX, sy: e.clientY };
          }}
          onMouseMove={(e) => {
            if (isNodeDraggingRef.current && draggedNodeIdRef.current) {
              // 拖拽节点逻辑
              const nodeId = draggedNodeIdRef.current;
              const pool = viewportRef.current.nodes || [];
              const node = pool.find(n => n.id === nodeId);
              if (node) {
                const canvas = canvasRef.current;
                const { zoom: z, offset: off } = camRef.current;
                const k = z * SCALE;
                // 将屏幕坐标转换为世界坐标
                node.x = (e.clientX - off.x - canvas.width / 2) / k;
                node.y = (e.clientY - off.y - canvas.height / 2) / k;
                // 强制重绘
                setCam((c) => ({ ...c, offset: { ...c.offset } })); // 触发重渲染
              }
              return;
            }
            if (!dragRef.current) return;
            if (Math.hypot(e.clientX - dragRef.current.sx, e.clientY - dragRef.current.sy) > 4) dragMovedRef.current = true;
            setCam((c) => ({ ...c, offset: { x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y } }));
          }}
          onMouseUp={(e) => {
            if (isNodeDraggingRef.current) {
              isNodeDraggingRef.current = false;
              draggedNodeIdRef.current = null;
              return;
            }
            const wasDrag = dragMovedRef.current;
            dragRef.current = null;
            if (wasDrag) return;
            const n = pickNearest(e);
            if (n) focusNode(n);
            else setSelected(null);
          }}
          onMouseLeave={() => { dragRef.current = null; }}
        />

        {/* 继任风险面板（仅 succession 模式显示） */}
        {mode === 'succession' && succession && (
          <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="font-semi" style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }} />
                  继任风险分析
                </div>
                <button 
                  type="button" 
                  className="btn-primary" 
                  style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={async () => { 
                    const summary = await generateAISummary(); 
                    setAiSummary(summary); 
                  }}
                  disabled={aiLoading}
                >
                  {aiLoading ? '分析中…' : '🤖 AI 分析'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 11 }}>
                <span style={{ background: '#dc262622', color: '#dc2626', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>高 {succession.summary.high}</span>
                <span style={{ background: '#f59e0b22', color: '#f59e0b', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>中 {succession.summary.medium}</span>
                <span style={{ background: '#16a34a22', color: '#16a34a', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>低 {succession.summary.low}</span>
                <span style={{ opacity: .55, padding: '2px 0' }}>· {succession.summary.total} 部门 / {succession.summary.total_headcount} 人</span>
              </div>
              {aiSummary && (
                <div style={{ marginTop: 10, padding: 10, background: 'rgba(124, 111, 173, 0.08)', border: '1px solid rgba(124, 111, 173, 0.3)', borderRadius: 8, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  <b style={{ color: '#7c6fad' }}>🤖 AI 分析报告</b>
                  <div style={{ marginTop: 6 }}>{aiSummary}</div>
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
              {(succession.departments || []).map((d) => {
                const rm = RISK_META[d.risk] || { color: '#8a847c', label: '' };
                return (
                  <button key={d.dept_id} type="button" onClick={() => focusDeptInTree(d.dept_id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: selected?.id === d.dept_id ? 'var(--bg-hover, #f1ede5)' : 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: rm.color, flexShrink: 0 }} />
                      <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{d.dept_name}</b>
                      <span style={{ fontSize: 10, color: rm.color, fontWeight: 600 }}>{rm.label}</span>
                    </div>
                    <div style={{ fontSize: 11, opacity: .8, lineHeight: 1.6, paddingLeft: 17 }}>
                      <div>负责人：{d.head ? <b>{d.head.name}</b> : <span style={{ color: '#dc2626' }}>空缺</span>}{d.head?.title ? ` · ${d.head.title}` : ''}</div>
                      <div>规模：{d.headcount} 人 · 子部门 {d.child_depts} · 候选 {d.successor_count}</div>
                      <div style={{ opacity: .65 }}>{d.reason}</div>
                      {d.successors?.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {d.successors.map((s) => (
                            <span key={s.id} style={{ fontSize: 10, background: '#16a34a22', color: '#16a34a', padding: '1px 6px', borderRadius: 999 }}>{s.name}·{s.title}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
              {!succession.departments?.length && (
                <div style={{ padding: 20, textAlign: 'center', opacity: .55, fontSize: 12 }}>暂无部门数据，请先同步通讯录或载入演示数据。</div>
              )}
            </div>
          </div>
        )}

        {/* 图例 + 统计 */}
        <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', padding: 10, borderRadius: 10, fontSize: 12, lineHeight: 1.7, zIndex: 3, boxShadow: 'var(--shadow)', maxWidth: 190 }}>
          <div className="font-semi" style={{ marginBottom: 4 }}>图例</div>
          {mode === 'succession' ? (
            Object.entries(RISK_META).map(([k, m]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, boxShadow: `0 0 0 2px ${m.color}55` }} /> {m.label}
              </div>
            ))
          ) : (
            Object.entries(TYPE_META).filter(([, m]) => ['dept', 'employee'].includes(m.label === '部门' ? 'dept' : m.label === '员工' ? 'employee' : '')).map(([t, m]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} /> {m.label}
              </div>
            ))
          )}
          <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <div>节点: {stats.totalNodes?.toLocaleString()}</div>
            <div>关系: {stats.totalEdges?.toLocaleString()}</div>
            <div>FPS: {fps}</div>
          </div>
        </div>

        {/* 选中节点详情（继任风险模式下由右侧风险面板承载，不重复弹层；关系图模式下显示增强版） */}
        {selected && (
          <div className="graph-popover" role="dialog" aria-label="节点信息" style={{ right: 14, top: 14, left: 'auto', maxWidth: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' }}>
              <span className="tag" style={{ background: (TYPE_META[selected.type]?.color || '#666') + '22', color: TYPE_META[selected.type]?.color || '#666' }}>
                {TYPE_META[selected.type]?.label || selected.type}
              </span>
              <button type="button" className="btn-icon" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.label || selected.name}</div>
            <div className="graph-popover-rows" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {selected.properties?.dept && <div className="graph-popover-row"><span>部门</span><b>{selected.properties.dept}</b></div>}
              {selected.properties?.title && <div className="graph-popover-row"><span>职位</span><b>{selected.properties.title}</b></div>}
              {selected.properties?.phone && <div className="graph-popover-row"><span>电话</span><b>{selected.properties.phone}</b></div>}
              {selected.properties?.email && <div className="graph-popover-row"><span>邮箱</span><b>{selected.properties.email}</b></div>}
              {selected.properties?.headcount != null && <div className="graph-popover-row"><span>人数</span><b>{selected.properties.headcount}</b></div>}
              {selected.dingtalk?.userid && <div className="graph-popover-row"><span>钉钉ID</span><b>{selected.dingtalk.userid}</b></div>}
            </div>
            {/* 钉钉融合操作（仅在钉钉环境或演示态显示按钮） */}
            {(selected.type === 'employee' || selected.dingtalk?.userid) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <button 
                  type="button" 
                  className="btn-default" 
                  style={{ flex: 1, fontSize: 11, padding: '4px 8px', minWidth: 100 }}
                  onClick={() => {
                    // 尝试调用钉钉 JSAPI 发起单聊
                    if (typeof window.dd !== 'undefined' && window.dd.chat && window.dd.chat.create) {
                      window.dd.chat.create({
                        userIds: [selected.dingtalk?.userid || selected.id],
                        onSuccess: (res) => {
                          showToast('已发起钉钉单聊');
                          if (res && res.chatId) {
                            window.dd.chat.open({ chatId: res.chatId });
                          }
                        },
                        onFail: () => showToast('发起单聊失败')
                      });
                    } else {
                      showToast('请在钉钉客户端内使用此功能');
                    }
                  }}
                >💬 发起单聊</button>
                <button 
                  type="button" 
                  className="btn-default" 
                  style={{ flex: 1, fontSize: 11, padding: '4px 8px', minWidth: 100 }}
                  onClick={() => {
                    // 打开钉钉审批中心
                    if (typeof window.dd !== 'undefined' && window.dd.app && window.dd.app.open) {
                      window.dd.app.open({
                        path: '/appstore/approval/my-apply/list',
                        onFail: () => showToast('无法打开审批中心')
                      });
                    } else {
                      showToast('请在钉钉客户端内使用此功能');
                    }
                  }}
                >📋 查看审批</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn-default" style={{ flex: 1, fontSize: 11 }} onClick={clearFocus}>收起</button>
            </div>
            {/* 提示 */}
            {mode === 'graph' && (
              <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text)', opacity: 0.6, textAlign: 'center' }}>
                💡 在关系图模式下，按住节点可拖动调整位置
              </div>
            )}
          </div>
        )}

        {/* 加载 / 空态 / 错误 */}
        {loading && <div className="load-mask">图谱加载中…</div>}
        {error && !loading && (
          <div className="empty" style={{ position: 'absolute', inset: 0 }}>
            <div className="font-semi">{error}</div>
            <button type="button" className="btn-default" onClick={() => { setError(''); init(); }}>重试</button>
          </div>
        )}
        {!loading && !error && stats.totalNodes === 0 && (
          <div className="empty" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
            <div className="font-semi">还没有图谱数据</div>
            <div className="text-xs">接入钉钉同步通讯录，或先载入演示数据看看效果。</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-primary" onClick={() => setShowConfig(true)}>接入钉钉</button>
              <button type="button" className="btn-default" onClick={loadDemo}>载入演示数据</button>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="toast" style={{ position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 10 }}>{toast}</div>}

      {/* 配置弹窗 */}
      {showConfig && (
        <ConfigModal
          config={config}
          onClose={() => setShowConfig(false)}
          onSave={async (v) => {
            try {
              await api('/dingtalk/config', { method: 'POST', body: JSON.stringify(v) });
              setConfig({ ...config, configured: true, hasKey: true, corpId: v.corpId });
              setShowConfig(false);
              showToast('钉钉配置已保存，可开始同步');
            } catch (e) { setError('保存失败：' + (e.message || e)); }
          }}
        />
      )}
    </div>
  );
}

function ConfigModal({ config, onClose, onSave }) {
  const [form, setForm] = useState({ appKey: '', appSecret: '', corpId: '', agentId: '' });
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 520, maxWidth: '92vw' }}>
        <div className="modal-head">
          <h3>接入钉钉（H5 微应用）</h3>
          <button type="button" className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ fontSize: 13, lineHeight: 1.8 }}>
          <p className="text-xs" style={{ opacity: .7 }}>
            在 钉钉开发者后台（open-dev.dingtalk.com）创建「企业内部应用」，添加「网页应用(H5)」能力，
            把「应用首页地址 / PC端首页地址」填为你部署的这个页面地址；再到「凭证与基础信息」复制
            Client ID / Client Secret / CorpId / AgentId 填入下方。保存后点「同步钉钉通讯录」，组织架构就会进入图谱。
          </p>
          {[
            ['appKey', 'Client ID（AppKey）'],
            ['appSecret', 'Client Secret（AppSecret）'],
            ['corpId', 'CorpId'],
            ['agentId', 'AgentId（可选）'],
          ].map(([k, label]) => (
            <label key={k} style={{ display: 'block', marginBottom: 8 }}>
              <span className="text-xs">{label}</span>
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={config?.hasKey && k === 'appSecret' ? '(已保存，留空则沿用)' : ''} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }} />
            </label>
          ))}
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-default" onClick={onClose}>取消</button>
          <button type="button" className="btn-primary" onClick={() => onSave(form)}>保存并接入</button>
        </div>
      </div>
    </div>
  );
}