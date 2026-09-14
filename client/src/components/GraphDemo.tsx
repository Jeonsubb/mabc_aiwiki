import { useEffect, useRef, useState, useCallback } from 'react';

interface GraphNode {
  id: string;
  title: string;
  summary: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  weight: number;
}

const DEMO_DATA = {
  nodes: [
    { id: 'n1', title: '블로그 기획', summary: '콘텐츠 방향, 발행 주기, 독자층 정리', color: '#58a6ff' },
    { id: 'n2', title: '콘텐츠 발행 실험', summary: '제목/썸네일/포맷 실험 기록', color: '#3fb950' },
    { id: 'n3', title: '아이디어 정리 방법', summary: '생각을 주제별로 나누는 기준', color: '#d29922' },
    { id: 'n4', title: '독자 반응 추적', summary: '어떤 글이 반응이 좋았는지 기록', color: '#f78166' },
    { id: 'n5', title: '주간 회고 루틴', summary: '매주 아이디어를 정리하는 습관', color: '#a371f7' },
    { id: 'n6', title: '개인 지식 저장소', summary: '흩어진 대화/아이디어를 모으는 공간', color: '#79c0ff' },
  ],
  edges: [
    { from: 'n1', to: 'n2', weight: 3 },
    { from: 'n1', to: 'n3', weight: 4 },
    { from: 'n2', to: 'n4', weight: 3 },
    { from: 'n3', to: 'n6', weight: 2 },
    { from: 'n5', to: 'n1', weight: 2 },
    { from: 'n5', to: 'n3', weight: 3 },
    { from: 'n6', to: 'n1', weight: 3 },
    { from: 'n6', to: 'n3', weight: 2 },
  ],
};

const NODE_RADIUS = 26;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function GraphDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastClickTimeRef = useRef<number | null>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [nodeMap, setNodeMap] = useState<Record<string, GraphNode>>({});
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(1);
  const [detailVisible, setDetailVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, ox: 0, oy: 0 });

  const initGraph = useCallback(() => {
    const ns = DEMO_DATA.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary || '',
      color: n.color || '#58a6ff',
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 300,
      vx: 0,
      vy: 0,
    }));
    const map: Record<string, GraphNode> = {};
    ns.forEach((n) => (map[n.id] = n));
    const es = DEMO_DATA.edges.map((e) => ({
      from: map[e.from],
      to: map[e.to],
      weight: e.weight || 1,
    }));
    setNodes(ns);
    setNodeMap(map);
    setEdges(es);
  }, []);

  useEffect(() => {
    initGraph();
  }, [initGraph]);

  const resize = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    render();
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const screenToWorld = useCallback((sx: number, sy: number) => ({
    x: (sx - offsetX) / scale,
    y: (sy - offsetY) / scale,
  }), [offsetX, offsetY, scale]);

  const worldToScreen = useCallback((wx: number, wy: number) => ({
    x: wx * scale + offsetX,
    y: wy * scale + offsetY,
  }), [offsetX, offsetY, scale]);

  const hitNode = useCallback((x: number, y: number): GraphNode | null => {
    for (const n of nodes) {
      const s = worldToScreen(n.x, n.y);
      const dx = x - s.x;
      const dy = y - s.y;
      if (dx * dx + dy * dy <= (NODE_RADIUS + 6) * (NODE_RADIUS + 6)) return n;
    }
    return null;
  }, [nodes, worldToScreen]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = wrap.getBoundingClientRect();

    ctx.clearRect(0, 0, rect.width, rect.height);

    // 배경 격자
    ctx.save();
    ctx.strokeStyle = '#1f2733';
    ctx.lineWidth = 1;
    const step = 40;
    const x0 = (-offsetX % step + step) % step;
    const y0 = (-offsetY % step + step) % step;
    for (let x = x0; x < rect.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    }
    for (let y = y0; y < rect.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }
    ctx.restore();

    // 엣지
    edges.forEach((e) => {
      const active = selectedId && (e.from.id === selectedId || e.to.id === selectedId);
      const from = worldToScreen(e.from.x, e.from.y);
      const to = worldToScreen(e.to.x, e.to.y);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return;
      const nx = -dy / len;
      const ny = dx / len;
      const r1 = NODE_RADIUS + 4;
      const r2 = NODE_RADIUS + 4;
      const sx = from.x + nx * r1;
      const sy = from.y + ny * r1;
      const ex = to.x - nx * r2;
      const ey = to.y - ny * r2;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = active ? '#58a6ff' : '#3b434c';
      ctx.lineWidth = active ? 2.4 : 1.6;
      ctx.stroke();

      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 노드
    nodes.forEach((n) => {
      const s = worldToScreen(n.x, n.y);
      const highlight = n.id === hoveredId || n.id === selectedId;
      const radius = highlight ? NODE_RADIUS + 4 : NODE_RADIUS;

      ctx.save();

      // 그림자
      ctx.beginPath();
      ctx.arc(s.x, s.y + 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();

      // 본체
      const grad = ctx.createRadialGradient(s.x - 6, s.y - 6, 2, s.x, s.y, radius + 4);
      grad.addColorStop(0, highlight ? '#4a7ad9' : '#2c3440');
      grad.addColorStop(1, highlight ? '#2b4a86' : '#1b2129');
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = highlight ? '#79c0ff' : '#3b434d';
      ctx.lineWidth = highlight ? 2.4 : 1.5;
      ctx.stroke();

      // 색상 마크
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();

      // 텍스트
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const display = n.title.length > 10 ? n.title.slice(0, 9) + '…' : n.title;
      ctx.fillText(display, s.x, s.y + 1);

      ctx.restore();
    });
  }, [edges, nodes, offsetX, offsetY, scale, selectedId, hoveredId, worldToScreen]);

  useEffect(() => {
    render();
  }, [render]);

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    setDetailVisible(true);

    const n = nodeMap[id];
    if (n) {
      const wrap = wrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        const cx = n.x * scale + offsetX;
        const cy = n.y * scale + offsetY;
        if (cx < 0 || cx > rect.width || cy < 0 || cy > rect.height) {
          setOffsetX(rect.width / 2 - cx);
          setOffsetY(rect.height / 2 - cy);
        }
      }
    }
  }, [nodeMap, scale, offsetX, offsetY]);

  const hideDetail = useCallback(() => {
    setDetailVisible(false);
    setSelectedId(null);
  }, []);

  const showDetail = useCallback((id: string, focus?: boolean) => {
    const n = nodeMap[id];
    if (!n) return;
    setSelectedId(id);
    setDetailVisible(true);

    if (focus) {
      const wrap = wrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        const cx = n.x * scale + offsetX;
        const cy = n.y * scale + offsetY;
        if (cx < 0 || cx > rect.width || cy < 0 || cy > rect.height) {
          setOffsetX(rect.width / 2 - cx);
          setOffsetY(rect.height / 2 - cy);
        }
      }
    }
  }, [nodeMap, scale, offsetX]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const now = Date.now();
    const lastClick = lastClickTimeRef.current;
    lastClickTimeRef.current = now;
    const doubleClick = lastClick != null && now - lastClick < 320;

    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const p = screenToWorld(mx, my);
    const hit = hitNode(p.x, p.y);

    if (hit) {
      selectNode(hit.id);
      if (doubleClick) {
        showDetail(hit.id, true);
      } else {
        showDetail(hit.id, false);
      }
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY });
    } else {
      setSelectedId(null);
      setDetailVisible(false);
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY });
    }
  }, [screenToWorld, hitNode, selectNode, showDetail, offsetX, offsetY]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    setOffsetX(dragStart.ox + (e.clientX - dragStart.x));
    setOffsetY(dragStart.oy + (e.clientY - dragStart.y));
  }, [isDragging, dragStart]);

  const onMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldBefore = screenToWorld(mx, my);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    setScale(newScale);
    setOffsetX((prev) => prev + screenToWorld(mx, my).x - worldBefore.x);
    setOffsetY((prev) => prev + screenToWorld(mx, my).y - worldBefore.y);
  }, [scale, screenToWorld]);

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* 사이드바 */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          background: 'var(--panel, #161b22)',
          border: '1px solid var(--border, #2a313a)',
          borderRadius: 10,
          padding: 16,
          overflowY: 'auto',
          fontSize: 13,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>위키 노드 (주제/아이디어)</div>
        <div style={{ fontSize: 12, color: 'var(--muted, #8b949e)', marginBottom: 12 }}>
          그래프는 위키 노드 간 관련 연결을 보여줍니다.
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {nodes.map((n) => (
            <li
              key={n.id}
              className={`node-item${n.id === selectedId ? ' active' : ''}`}
              data-id={n.id}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border, #2a313a)',
                background: n.id === selectedId ? 'var(--accent-light, #79c0ff)' : 'var(--card, #1c2229)',
                color: n.id === selectedId ? '#0b1320' : 'var(--text, #e6edf3)',
                cursor: 'pointer',
                marginBottom: 6,
                transition: 'background 0.12s ease, border-color 0.12s ease',
              }}
              onClick={() => {
                selectNode(n.id);
                showDetail(n.id, true);
              }}
            >
              <div>{escapeHtml(n.title)}</div>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--muted, #8b949e)', marginTop: 2 }}>
                {escapeHtml(n.summary || '요약 없음')}
              </span>
            </li>
          ))}
        </ul>
        <div style={{ fontSize: 12, color: 'var(--muted, #8b949e)', borderTop: '1px solid var(--border, #2a313a)', paddingTop: 10, marginTop: 10 }}>
          <div style={{ color: 'var(--text, #e6edf3)', fontWeight: 600, marginBottom: 4 }}>범례</div>
          <div>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '1px solid var(--node-border, #30363d)', background: 'var(--node-bg, #21262d)', marginRight: 8, verticalAlign: 'middle' }} />
            위키 노드
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{ display: 'inline-block', width: 18, height: 2, background: 'var(--edge, #3b434c)', marginRight: 8, verticalAlign: 'middle' }} />
            관련 연결
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{ display: 'inline-block', width: 18, height: 2, background: 'var(--edge-active, #58a6ff)', marginRight: 8, verticalAlign: 'middle' }} />
            선택 노드 연결
          </div>
        </div>
      </div>

      {/* 캔버스 */}
      <div
        ref={wrapRef}
        style={{
          flex: 1,
          position: 'relative',
          background: 'var(--bg, #0e1217)',
          border: '1px solid var(--border, #2a313a)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'grab' }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
        />
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            fontSize: 11,
            color: 'var(--muted, #8b949e)',
            background: 'var(--panel, #161b22)',
            border: '1px solid var(--border, #2a313a)',
            padding: '4px 8px',
            borderRadius: 6,
            pointerEvents: 'none',
          }}
        >
          노드 드래그 이동 · 휠로 확대/축소
        </div>

        {/* 디테일 패널 */}
        {detailVisible && selectedId && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              right: 16,
              maxWidth: 360,
              background: 'var(--panel, #161b22)',
              border: '1px solid var(--border, #2a313a)',
              borderRadius: 10,
              padding: '12px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--accent, #58a6ff)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              위키 노드
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {escapeHtml(nodeMap[selectedId]?.title ?? '')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted, #8b949e)', marginTop: 6 }}>
              {escapeHtml(nodeMap[selectedId]?.summary ?? '요약 없음')}
            </div>
            <div style={{ fontSize: 12, marginTop: 8, color: 'var(--muted, #8b949e)' }}>
              {edges
                .filter((e) => e.from.id === selectedId || e.to.id === selectedId)
                .map((e) => (e.from.id === selectedId ? e.to : e.from).title)
                .join(', ') || '연결: 없음'}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  border: '1px solid var(--border, #2a313a)',
                  borderRadius: 6,
                  background: 'var(--accent, #58a6ff)',
                  color: '#0b1320',
                  borderColor: 'var(--accent, #58a6ff)',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const n = nodeMap[selectedId];
                  if (n) {
                    // 실제 MVP에서는 /node/:id로 연결
                    window.open(`#${n.id}`, '_self');
                  }
                }}
              >
                위키 보기
              </button>
              <button
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  border: '1px solid #fca5a5',
                  borderRadius: 6,
                  background: 'transparent',
                  color: 'var(--danger, #b91c1c)',
                  cursor: 'pointer',
                }}
                onClick={hideDetail}
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
