import React, { useRef, useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

const TYPE_COLORS = {
  product_line: '#141413',
  dept: '#5b5fc7',
  team: '#7c6fad',
  employee: '#3d8b6e',
  role: '#7c3aed',
  project: '#b45309',
  task: '#be185d',
  document: '#0f766e',
  approval: '#a16207',
  meeting: '#1d4ed8',
};
const TYPE_LABELS = {
  product_line: '产品线',
  dept: '大部门',
  team: '小组',
  employee: '个人',
  role: '角色',
  project: '项目',
  task: '任务',
  document: '文档',
  approval: '审批',
  meeting: '会议',
};
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
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  const bw = Math.max(40, maxX - minX);
  const bh = Math.max(40, maxY - minY);
  const zoom = Math.max(0.6, Math.min(6, Math.min((w * 0.82) / (bw * SCALE), (h * 0.82) / (bh * SCALE))));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { zoom, offset: { x: -cx * zoom * SCALE, y: -cy * zoom * SCALE } };
}

export default function KnowledgeGraph({ navigate }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [stats, setStats] = useState({ totalNodes: 0, totalEdges: 0, viewportNodes: 0 });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedNode, setSelectedNode] = useState(null);
  const [fps, setFps] = useState(60);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [subgraph, setSubgraph] = useState(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });

  const overviewRef = useRef([]);
  const viewportRef = useRef({ nodes: [], edges: [] });
  const dragRef = useRef(null);
  const fpsRef = useRef({ frames: 0, lastTime: 0 });
  const camRef = useRef({ zoom: 1, offset: { x: 0, y: 0 } });

  const [organizeMsg, setOrganizeMsg] = useState('');
  const [organizing, setOrganizing] = useState(false);
  const fitRetryRef = useRef(false);
  const dragMovedRef = useRef(false);

  const parseProps = (n) => {
    if (!n) return {};
    if (n.properties && typeof n.properties === 'object') return n.properties;
    if (typeof n.properties === 'string') {
      try { return JSON.parse(n.properties); } catch { return {}; }
    }
    return {};
  };

  useEffect(() => {
    camRef.current = { zoom, offset };
  }, [zoom, offset]);

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

  const fetchViewport = useCallback(async (z, off, typeFilter) => {
    const canvas = canvasRef.current;
    if (!canvas || overviewRef.current.length === 0) return;
    const w = canvas.width, h = canvas.height;
    const tl = screenToWorld(0, 0, z, off, w, h);
    const br = screenToWorld(w, h, z, off, w, h);
    const minX = Math.min(tl.x, br.x);
    const maxX = Math.max(tl.x, br.x);
    const minY = Math.min(tl.y, br.y);
    const maxY = Math.max(tl.y, br.y);
    const typeQ = typeFilter && typeFilter !== 'all' ? `&type=${encodeURIComponent(typeFilter)}` : '';
    try {
      const data = await api(`/knowledge/graph/viewport?zoom=${z}&minX=${minX}&minY=${minY}&maxX=${maxX}&maxY=${maxY}&limit=500${typeQ}`);
      let nodes = data.nodes || [];
      if (nodes.length === 0 && overviewRef.current.length && !fitRetryRef.current) {
        fitRetryRef.current = true;
        const fitted = computeFit(overviewRef.current, w, h);
        camRef.current = fitted;
        setZoom(fitted.zoom);
        setOffset(fitted.offset);
        const tl2 = screenToWorld(0, 0, fitted.zoom, fitted.offset, w, h);
        const br2 = screenToWorld(w, h, fitted.zoom, fitted.offset, w, h);
        const retry = await api(`/knowledge/graph/viewport?zoom=${fitted.zoom}&minX=${Math.min(tl2.x, br2.x)}&minY=${Math.min(tl2.y, br2.y)}&maxX=${Math.max(tl2.x, br2.x)}&maxY=${Math.max(tl2.y, br2.y)}&limit=500${typeQ}`);
        nodes = retry.nodes || [];
        viewportRef.current = retry;
      } else {
        viewportRef.current = data;
      }
      setStats((s) => ({ ...s, viewportNodes: nodes.length || (overviewRef.current.length ? Math.min(500, overviewRef.current.length) : 0) }));
    } catch { /* */ }
  }, []);

  const initGraph = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api('/knowledge/graph/stats');
      setStats(s);
      if (s.totalNodes === 0) {
        await api('/knowledge/seed', { method: 'POST', body: JSON.stringify({ nodeCount: 10000, edgeCount: 50000 }) });
        const s2 = await api('/knowledge/graph/stats');
        setStats(s2);
      }
      const overview = await api('/knowledge/graph/overview');
      overviewRef.current = overview.nodes || overview || [];
      const canvas = canvasRef.current;
      const w = canvas?.width || size.width;
      const h = canvas?.height || size.height;
      const fitted = computeFit(overviewRef.current, w, h);
      camRef.current = fitted;
      setZoom(fitted.zoom);
      setOffset(fitted.offset);
      await fetchViewport(fitted.zoom, fitted.offset, filter);
    } catch (e) { console.error('graph init', e); }
    setLoading(false);
  }, [fetchViewport, filter, size.width, size.height]);

  const organizePeople = async () => {
    setOrganizing(true);
    setOrganizeMsg('');
    try {
      let employees = [];
      try {
        const [d, depts] = await Promise.all([
          api('/contacts/employees'),
          api('/contacts/departments').catch(() => []),
        ]);
        employees = Array.isArray(d) ? d : (d.items || []);
        const deptList = Array.isArray(depts) ? depts : (depts.tree || depts.items || []);
        const flat = [];
        const walk = (nodes) => { for (const n of nodes || []) { flat.push(n); if (n.children) walk(n.children); } };
        walk(deptList);
        const nameById = Object.fromEntries(flat.map((x) => [x.id, x.name]));
        employees = employees.map((e) => ({
          ...e,
          dept: e.dept || e.dept_name || nameById[e.dept_id] || '未分配部门',
        }));
      } catch { /* */ }
      const r = await api('/knowledge/graph/organize-people', {
        method: 'POST',
        body: JSON.stringify({ employees, projectName: 'Nexus 产品线', clearPeople: true }),
      });
      setOrganizeMsg(r.summary || `已整理 ${r.people} 人`);
      await initGraph();
      setFilter('all');
    } catch (e) {
      setOrganizeMsg(e.message || '整理失败');
    }
    setOrganizing(false);
  };

  useEffect(() => { initGraph(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchViewport(zoom, offset, filter);
  }, [zoom, offset, filter, size.width, size.height, fetchViewport]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    // Obsidian 感：淡网格
    ctx.strokeStyle = 'rgba(28,25,23,0.04)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (let gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

    if (overviewRef.current.length > 0) {
      for (const node of overviewRef.current) {
        const p = worldToScreen(node.x, node.y, z, off, w, h);
        if (p.x < -6 || p.x > w + 6 || p.y < -6 || p.y > h + 6) continue;
        ctx.fillStyle = TYPE_COLORS[node.type] || '#8a847c';
        ctx.fillRect(p.x, p.y, 3, 3);
      }
    }

    const vp = viewportRef.current;
    const vpById = new Map((vp.nodes || []).map((n) => [n.id, n]));
    if (vp.edges) {
      ctx.strokeStyle = 'rgba(91, 95, 199, 0.22)';
      ctx.lineWidth = 1;
      for (const e of vp.edges) {
        const s = vpById.get(e.source_id) || { x: e.source_x, y: e.source_y };
        const t = vpById.get(e.target_id) || { x: e.target_x, y: e.target_y };
        if (s.x == null || t.x == null) continue;
        const a = worldToScreen(s.x, s.y, z, off, w, h);
        const b = worldToScreen(t.x, t.y, z, off, w, h);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    if (vp.nodes) {
      for (const n of vp.nodes) {
        const p = worldToScreen(n.x, n.y, z, off, w, h);
        const color = TYPE_COLORS[n.type] || '#8a847c';
        const r = Math.max(4, (n.size || 3) * Math.sqrt(z) * (n.type === 'product_line' ? 1.6 : 1));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = color + '22';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (selectedNode?.id === n.id) {
          ctx.strokeStyle = '#141413';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (z > 1.8 || n.type === 'product_line' || n.type === 'dept') {
          ctx.fillStyle = '#1c1917';
          ctx.font = `${n.type === 'product_line' ? 'bold 13' : '12'}px Source Sans 3, sans-serif`;
          ctx.fillText(n.label || n.name || '', p.x + r + 6, p.y + 4);
        }
      }
    }

    if (subgraph) {
      const sgById = new Map((subgraph.nodes || []).map((n) => [n.id, n]));
      ctx.strokeStyle = 'rgba(91, 95, 199, 0.55)';
      ctx.lineWidth = 2;
      for (const e of subgraph.edges || []) {
        const s = sgById.get(e.source_id) || { x: e.source_x, y: e.source_y };
        const t = sgById.get(e.target_id) || { x: e.target_x, y: e.target_y };
        if (s.x == null || t.x == null) continue;
        const a = worldToScreen(s.x, s.y, z, off, w, h);
        const b = worldToScreen(t.x, t.y, z, off, w, h);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const n of subgraph.nodes || []) {
        const p = worldToScreen(n.x, n.y, z, off, w, h);
        ctx.fillStyle = '#5b5fc7';
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#1c1917';
        ctx.font = 'bold 12px Source Sans 3, sans-serif';
        ctx.fillText(n.label || n.name || '', p.x + 10, p.y + 4);
      }
    }
  }, [subgraph, size.width, size.height, selectedNode]);

  useEffect(() => {
    let raf;
    const loop = () => { render(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.4, Math.min(12, z * delta)));
  };

  const openNode = async (nearest) => {
    setSelectedNode(nearest);
    try {
      const sg = await api(`/knowledge/graph/subgraph/${nearest.id}?depth=2`);
      setSubgraph(sg);
    } catch { /* */ }
  };

  const jumpFromNode = (n) => {
    if (!navigate) return;
    if (n.type === 'employee') navigate('contacts');
    else if (n.type === 'dept' || n.type === 'team' || n.type === 'product_line') navigate('contacts');
    else if (n.type === 'document') navigate('document');
    else if (n.type === 'approval') navigate('workflow');
    else if (n.type === 'meeting') navigate('meeting');
    else if (n.type === 'project' || n.type === 'task') navigate('project');
  };

  const pickNearest = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { zoom: z, offset: off } = camRef.current;
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, z, off, canvas.width, canvas.height);
    let nearest = null, minDist = Infinity;
    const pool = [...(viewportRef.current.nodes || []), ...overviewRef.current.slice(0, 2000)];
    for (const n of pool) {
      const d = Math.hypot(n.x - world.x, n.y - world.y);
      if (d < minDist) { minDist = d; nearest = n; }
    }
    if (nearest && minDist < 90 / z) return nearest;
    return null;
  };

  const onDoubleClick = async (e) => {
    const nearest = pickNearest(e);
    if (!nearest) return;
    await openNode(nearest);
    jumpFromNode(nearest);
  };

  const onMouseDown = (e) => {
    dragMovedRef.current = false;
    dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y, sx: e.clientX, sy: e.clientY };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    if (Math.hypot(e.clientX - dragRef.current.sx, e.clientY - dragRef.current.sy) > 4) dragMovedRef.current = true;
    setOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onMouseUp = async (e) => {
    const wasDrag = dragMovedRef.current;
    dragRef.current = null;
    if (wasDrag) return;
    const nearest = pickNearest(e);
    if (nearest) await openNode(nearest);
  };

  const doSearch = async () => {
    if (!search) return;
    try {
      const results = await api(`/knowledge/graph/search?q=${encodeURIComponent(search)}`);
      const list = Array.isArray(results) ? results : (results.items || []);
      if (list.length > 0) {
        const node = list[0];
        const canvas = canvasRef.current;
        const w = canvas?.width || 1200, h = canvas?.height || 800;
        const z = 3;
        setZoom(z);
        setOffset({ x: -node.x * z * SCALE, y: -node.y * z * SCALE });
        await openNode(node);
        void w; void h;
      }
    } catch { /* */ }
  };

  return (
    <div style={{ display: 'flex', height: '100%' }} ref={containerRef}>
      <div style={{ flex: 1, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          style={{ width: '100%', height: '100%', cursor: 'grab' }}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: 8, borderRadius: 10, alignItems: 'center', flexWrap: 'wrap', maxWidth: '90%', boxShadow: 'var(--shadow)' }}>
          <input placeholder="搜索节点…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="product_line">产品线</option>
            <option value="dept">大部门</option>
            <option value="team">小组</option>
            <option value="employee">个人</option>
            <option value="project">项目</option>
          </select>
          <button type="button" className="btn-default" onClick={() => {
            const fitted = computeFit(overviewRef.current, canvasRef.current?.width || 1200, canvasRef.current?.height || 800);
            setZoom(fitted.zoom); setOffset(fitted.offset); setSubgraph(null);
          }}>适应画布</button>
          <button type="button" className="btn-primary" onClick={organizePeople} disabled={organizing} style={{ fontSize: 12 }}>
            {organizing ? '整理中…' : 'AI 整理人员'}
          </button>
          {organizeMsg && <span className="text-xs" style={{ maxWidth: 280 }}>{organizeMsg}</span>}
        </div>
        <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', padding: 10, borderRadius: 10, fontSize: 12, lineHeight: 1.8, boxShadow: 'var(--shadow)' }}>
          <div>FPS: <span style={{ color: fps >= 30 ? 'var(--success)' : 'var(--error)' }}>{fps}</span></div>
          <div>总节点: {stats.totalNodes?.toLocaleString()}</div>
          <div>总边: {stats.totalEdges?.toLocaleString()}</div>
          <div>视口节点: {stats.viewportNodes}</div>
          <div>缩放: {zoom.toFixed(2)}×</div>
        </div>
        {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--bg) 70%, transparent)', fontSize: 16 }}>加载图谱数据中…</div>}
      </div>
      {selectedNode && (() => {
        const props = parseProps(selectedNode);
        const kind = props.kind || TYPE_LABELS[selectedNode.type] || selectedNode.type;
        const rows = [
          ['类型', kind],
          props.title && ['职位', props.title],
          props.dept && ['部门', props.dept],
          props.team && ['小组', props.team],
          props.email && ['邮箱', props.email],
          props.phone && ['电话', props.phone],
          props.headcount != null && ['人数', props.headcount],
          props.summary && ['说明', props.summary],
          props.userId && ['用户 ID', props.userId],
        ].filter(Boolean);
        return (
          <div className="graph-popover" role="dialog" aria-label="节点信息">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
              <span className="tag" style={{ background: (TYPE_COLORS[selectedNode.type] || '#666') + '22', color: TYPE_COLORS[selectedNode.type] || '#666' }}>{kind}</span>
              <button type="button" className="btn-icon" title="关闭" onClick={() => { setSelectedNode(null); setSubgraph(null); }}>✕</button>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 10 }}>{selectedNode.label || selectedNode.name}</div>
            <div className="graph-popover-rows">
              {rows.map(([k, v]) => (
                <div key={k} className="graph-popover-row"><span>{k}</span><b>{String(v)}</b></div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={() => jumpFromNode(selectedNode)}>打开模块</button>
              <button type="button" className="btn-default" onClick={() => openNode(selectedNode)}>刷新关联</button>
            </div>
            {subgraph && (
              <div style={{ marginTop: 16 }}>
                <div className="font-semi" style={{ marginBottom: 8, fontSize: 12 }}>关联 ({subgraph.nodes?.length || 0})</div>
                {(subgraph.nodes || []).slice(0, 16).map((n) => (
                  <button key={n.id} type="button" className="list-row" style={{ width: '100%', border: 'none', padding: '6px 8px' }} onClick={() => openNode(n)}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[n.type] || '#666', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, textAlign: 'left' }}>{n.label || n.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
