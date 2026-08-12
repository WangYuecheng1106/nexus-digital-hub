import React, { useRef, useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

// 关系图谱：L0 鹰眼 + L1 视口 + L2 聚焦子图 三层渲染架构
// 参考钉钉/WeLink 组织关系与 Viva Engage 社区连接：万级节点下保持 FPS>=30
export default function KnowledgeGraph() {
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

  const overviewRef = useRef([]); // L0 全量节点坐标
  const viewportRef = useRef({ nodes: [], edges: [] }); // L1 视口数据
  const dragRef = useRef(null);
  const fpsRef = useRef({ frames: 0, lastTime: 0 });

  const [organizeMsg, setOrganizeMsg] = useState('');
  const [organizing, setOrganizing] = useState(false);

  // 响应式画布
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: Math.floor(cr.width), height: Math.floor(cr.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 初始化：加载全量节点位置（L0 鹰眼）
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
      overviewRef.current = overview.nodes || [];
      render();
    } catch (e) { console.error('graph init', e); }
    setLoading(false);
  }, []);

  const organizePeople = async () => {
    setOrganizing(true);
    setOrganizeMsg('');
    try {
      let employees = [];
      try {
        const d = await api('/contacts/employees');
        employees = Array.isArray(d) ? d : (d.items || []);
      } catch { /* 后端也会自行拉取 */ }
      const r = await api('/knowledge/graph/organize-people', {
        method: 'POST',
        body: JSON.stringify({ employees, projectName: 'Nexus 项目', clearPeople: true }),
      });
      setOrganizeMsg(r.summary || `已整理 ${r.people} 人`);
      await initGraph();
      setFilter('employee');
    } catch (e) {
      setOrganizeMsg(e.message || '整理失败');
    }
    setOrganizing(false);
  };

  useEffect(() => { initGraph(); }, [initGraph]);

  // 视口查询（L1）
  const loadViewport = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || overviewRef.current.length === 0) return;
    const w = canvas.width, h = canvas.height;
    const minX = -offset.x / zoom;
    const minY = -offset.y / zoom;
    const maxX = (w - offset.x) / zoom;
    const maxY = (h - offset.y) / zoom;
    try {
      const data = await api(`/knowledge/graph/viewport?zoom=${zoom}&minX=${minX}&minY=${minY}&maxX=${maxX}&maxY=${maxY}&filter=${filter}`);
      viewportRef.current = data;
      setStats((s) => ({ ...s, viewportNodes: data.nodes?.length || 0 }));
    } catch { /* */ }
    render();
  }, [zoom, offset, filter, size.width, size.height]);

  useEffect(() => { loadViewport(); }, [loadViewport]);

  const TYPE_COLORS = { dept: '#1677ff', employee: '#52c41a', role: '#722ed1', project: '#fa8c16', task: '#eb2f96', document: '#13c2c2', approval: '#faad14', meeting: '#2f54eb' };
  const TYPE_LABELS = { dept: '部门', employee: '员工', role: '角色', project: '项目', task: '任务', document: '文档', approval: '审批', meeting: '会议' };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    fpsRef.current.frames++;
    const now = performance.now();
    if (now - fpsRef.current.lastTime >= 1000) {
      setFps(fpsRef.current.frames);
      fpsRef.current = { frames: 0, lastTime: now };
    }

    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, w, h);

    // L0: 鹰眼层
    if (overviewRef.current.length > 0) {
      for (const node of overviewRef.current) {
        const x = node.x * zoom * 0.1 + offset.x + w / 2;
        const y = node.y * zoom * 0.1 + offset.y + h / 2;
        if (x < -5 || x > w + 5 || y < -5 || y > h + 5) continue;
        ctx.fillStyle = TYPE_COLORS[node.type] || '#666';
        ctx.fillRect(x, y, 2, 2);
      }
    }

    // L1: 视口层
    const vp = viewportRef.current;
    if (vp.edges) {
      ctx.strokeStyle = 'rgba(100, 150, 200, 0.15)';
      ctx.lineWidth = 1;
      for (const e of vp.edges) {
        const sx = e.source_x * zoom * 0.1 + offset.x + w / 2;
        const sy = e.source_y * zoom * 0.1 + offset.y + h / 2;
        const tx = e.target_x * zoom * 0.1 + offset.x + w / 2;
        const ty = e.target_y * zoom * 0.1 + offset.y + h / 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }
    if (vp.nodes) {
      for (const n of vp.nodes) {
        const x = n.x * zoom * 0.1 + offset.x + w / 2;
        const y = n.y * zoom * 0.1 + offset.y + h / 2;
        ctx.fillStyle = TYPE_COLORS[n.type] || '#666';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, (n.size || 3) * Math.sqrt(zoom)), 0, Math.PI * 2);
        ctx.fill();
        if (zoom > 2) {
          ctx.fillStyle = '#fff';
          ctx.font = '11px sans-serif';
          ctx.fillText(n.label || n.name || '', x + 6, y + 4);
        }
      }
    }

    // L2: 聚焦子图
    if (subgraph) {
      ctx.strokeStyle = 'rgba(22, 119, 255, 0.6)';
      ctx.lineWidth = 2;
      for (const e of subgraph.edges || []) {
        const sx = e.source_x * zoom * 0.1 + offset.x + w / 2;
        const sy = e.source_y * zoom * 0.1 + offset.y + h / 2;
        const tx = e.target_x * zoom * 0.1 + offset.x + w / 2;
        const ty = e.target_y * zoom * 0.1 + offset.y + h / 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      for (const n of subgraph.nodes || []) {
        const x = n.x * zoom * 0.1 + offset.x + w / 2;
        const y = n.y * zoom * 0.1 + offset.y + h / 2;
        ctx.fillStyle = '#1677ff';
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(n.label || n.name || '', x + 10, y + 4);
      }
    }
  }, [zoom, offset, subgraph, size.width, size.height]);

  useEffect(() => {
    let raf;
    const loop = () => { render(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.5, Math.min(10, z * delta)));
  };

  const onDoubleClick = async (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - offset.x - canvas.width / 2) / (zoom * 0.1);
    const y = (e.clientY - rect.top - offset.y - canvas.height / 2) / (zoom * 0.1);
    let nearest = null, minDist = Infinity;
    for (const n of viewportRef.current.nodes || []) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < minDist) { minDist = d; nearest = n; }
    }
    if (nearest && minDist < 60) {
      setSelectedNode(nearest);
      try {
        const sg = await api(`/knowledge/graph/subgraph/${nearest.id}?depth=2`);
        setSubgraph(sg);
      } catch { /* */ }
    }
  };

  const onMouseDown = (e) => { dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; };
  const onMouseMove = (e) => { if (dragRef.current) setOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y }); };
  const onMouseUp = () => { dragRef.current = null; };

  const doSearch = async () => {
    if (!search) return;
    try {
      const results = await api(`/knowledge/graph/search?q=${encodeURIComponent(search)}`);
      if (results.length > 0) {
        const node = results[0];
        const canvas = canvasRef.current;
        const w = canvas?.width || 1200, h = canvas?.height || 800;
        setOffset({ x: -node.x * zoom * 0.1 + w / 2, y: -node.y * zoom * 0.1 + h / 2 });
        setZoom(3);
        setSelectedNode(node);
        const sg = await api(`/knowledge/graph/subgraph/${node.id}?depth=2`);
        setSubgraph(sg);
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
          style={{ width: '100%', height: '100%', cursor: dragRef ? 'grabbing' : 'grab' }}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, background: 'rgba(0,0,0,0.7)', padding: 8, borderRadius: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: '90%' }}>
          <input placeholder="搜索节点…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} style={{ background: '#fff' }} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ background: '#fff' }}>
            <option value="all">全部</option>
            <option value="dept">部门</option>
            <option value="employee">员工</option>
            <option value="project">项目</option>
            <option value="task">任务</option>
            <option value="document">文档</option>
          </select>
          <button type="button" className="btn-default" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); setSubgraph(null); }} style={{ background: '#fff' }}>重置</button>
          <button type="button" className="btn-primary" onClick={organizePeople} disabled={organizing} style={{ fontSize: 12 }}>
            {organizing ? '整理中…' : 'AI 整理人员'}
          </button>
          {organizeMsg && <span style={{ color: '#9ad', fontSize: 11, maxWidth: 280 }}>{organizeMsg}</span>}
        </div>
        <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(0,0,0,0.7)', color: '#fff', padding: 8, borderRadius: 8, fontSize: 12, lineHeight: 1.8 }}>
          <div>FPS: <span style={{ color: fps >= 30 ? '#52c41a' : '#ff4d4f' }}>{fps}</span></div>
          <div>总节点: {stats.totalNodes?.toLocaleString()}</div>
          <div>总边: {stats.totalEdges?.toLocaleString()}</div>
          <div>视口节点: {stats.viewportNodes}</div>
          <div>缩放: {zoom.toFixed(2)}x</div>
        </div>
        {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 18 }}>加载图谱数据中…</div>}
      </div>
      {selectedNode && (
        <div style={{ width: 280, background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)', padding: 16, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 16 }}>节点详情</span>
            <span onClick={() => { setSelectedNode(null); setSubgraph(null); }} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span className="tag" style={{ background: (TYPE_COLORS[selectedNode.type] || '#666') + '22', color: TYPE_COLORS[selectedNode.type] }}>{TYPE_LABELS[selectedNode.type] || selectedNode.type}</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{selectedNode.label || selectedNode.name}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>ID: {selectedNode.id}</div>
          {subgraph && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>关联节点 ({subgraph.nodes?.length || 0})</div>
              {(subgraph.nodes || []).slice(0, 20).map((n) => (
                <div key={n.id} onClick={() => setSelectedNode(n)} style={{ padding: 6, cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[n.type] || '#666' }} />
                  <span style={{ fontSize: 13 }}>{n.label || n.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
