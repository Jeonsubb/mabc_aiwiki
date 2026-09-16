import { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphNode, GraphEdge } from '@shared/api';
function mulberryHash(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStarTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const empty = new THREE.Texture(canvas);
    empty.needsUpdate = true;
    return empty;
  }

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2;
  ctx.clearRect(0, 0, size, size);

  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.28);
  coreGrad.addColorStop(0, 'rgba(255,255,255,1)');
  coreGrad.addColorStop(0.06, 'rgba(255,255,255,0.98)');
  coreGrad.addColorStop(0.16, 'rgba(255,255,255,0.8)');
  coreGrad.addColorStop(0.28, 'rgba(255,255,255,0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * 0.28, 0, Math.PI * 2);
  ctx.fill();

  const haloGrad = ctx.createRadialGradient(cx, cy, maxR * 0.12, cx, cy, maxR * 0.95);
  haloGrad.addColorStop(0, 'rgba(200,225,250,0)');
  haloGrad.addColorStop(0.08, 'rgba(190,215,245,0.4)');
  haloGrad.addColorStop(0.22, 'rgba(150,180,220,0.22)');
  haloGrad.addColorStop(0.5, 'rgba(110,140,185,0.07)');
  haloGrad.addColorStop(1, 'rgba(80,100,140,0)');
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * 0.95, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface SessionNode {
  id: string;
  title: string;
  position: [number, number, number];
  groupId: number;
}

const FALLBACK_SESSION_NODES: SessionNode[] = [
  // 묶음1: 왼쪽 위 / 작은 별자리
  { id: 'g1-1', title: '세션 A-1', position: [-3.9, 2.6, 0.0], groupId: 1 },
  { id: 'g1-2', title: '세션 A-2', position: [-2.7, 3.1, 0.0], groupId: 1 },
  { id: 'g1-3', title: '세션 A-3', position: [-1.8, 2.2, 0.0], groupId: 1 },
  { id: 'g1-4', title: '세션 A-4', position: [-3.1, 1.7, 0.0], groupId: 1 },

  // 묶음2: 오른쪽 위 / 작은 별자리
  { id: 'g2-1', title: '세션 B-1', position: [3.4, 2.7, 0.0], groupId: 2 },
  { id: 'g2-2', title: '세션 B-2', position: [4.4, 1.9, 0.0], groupId: 2 },
  { id: 'g2-3', title: '세션 B-3', position: [2.8, 1.4, 0.0], groupId: 2 },
  { id: 'g2-4', title: '세션 B-4', position: [4.0, 2.9, 0.0], groupId: 2 },

  // 묶음3: 가운데 아래 / 작은 별자리
  { id: 'g3-1', title: '세션 C-1', position: [-1.2, -3.1, 0.0], groupId: 3 },
  { id: 'g3-2', title: '세션 C-2', position: [0.6, -3.6, 0.0], groupId: 3 },
  { id: 'g3-3', title: '세션 C-3', position: [1.7, -2.7, 0.0], groupId: 3 },
  { id: 'g3-4', title: '세션 C-4', position: [-0.2, -2.4, 0.0], groupId: 3 },
];
const FALLBACK_EDGES = [
  ['g1-1', 'g1-2'],
  ['g1-2', 'g1-3'],
  ['g1-3', 'g1-4'],
  ['g2-1', 'g2-2'],
  ['g2-2', 'g2-3'],
  ['g2-3', 'g2-4'],
  ['g3-1', 'g3-2'],
  ['g3-2', 'g3-3'],
  ['g3-3', 'g3-4'],
  ['g1-2', 'g2-2'],
  ['g2-3', 'g3-2'],
] as const;


type TagDef = {
  id: string;
  label: string;
  nodeIds: string[];
};

const FALLBACK_TAG_DEFS: TagDef[] = [
  { id: 'tag-a', label: '태그 A', nodeIds: ['g1-1', 'g1-2', 'g1-3', 'g1-4'] },
  { id: 'tag-b', label: '태그 B', nodeIds: ['g2-1', 'g2-2', 'g2-3', 'g2-4'] },
  { id: 'tag-c', label: '태그 C', nodeIds: ['g3-1', 'g3-2', 'g3-3', 'g3-4'] },
];

const DEMO_SESSION = {
  id: 'g3-3',
  title: '물류 창고 화재 보상 문의',
  sessionId: 'session_kr_012',
  summary: '물류 창고 화재로 재고를 잃은 사용자가 보상을 문의한 대화. 데모용 요약.',
  dialog: [
    ['사용자', '저번 주 물류 창고에서 화재가 났어요. 재고가 전부 탔습니다.'],
    ['상담사', '구매하신 상품이 맞으면 보상 정책 확인해드릴게요. 먼저 회사명과 화재 시점 알려주실 수 있나요?'],
  ],
};

interface OrbitOnlyProps {
  infoPanelVisible?: boolean;
  graphNodes?: GraphNode[];
  graphEdges?: GraphEdge[];
  onSelect?: (node: SessionNode | null) => void;
}

export default function OrbitOnly({
  infoPanelVisible = true,
  graphNodes = [],
  graphEdges = [],
  onSelect,
}:  OrbitOnlyProps = {}) {
  const SAMPLE_SESSION_NODES = useMemo<SessionNode[]>(() => {
    if (graphNodes.length === 0) {
      return [];
    }

    const radius = Math.max(3, graphNodes.length * 0.55);

    return graphNodes.map((node, index) => {
      const angle = (index / graphNodes.length) * Math.PI * 2;
      const distance = radius + (index % 2) * 0.8;

      return {
        id: node.id,
        title: node.title,
        position: [
          Math.cos(angle) * distance,
          Math.sin(angle) * distance,
          0,
        ],
        groupId: (index % 3) + 1,
      };
    });
  }, [graphNodes]);

  const SAMPLE_EDGES = useMemo<ReadonlyArray<readonly [string, string]>>(
    () => {
      if (graphNodes.length === 0) {
        return [];
      }

      const validNodeIds = new Set(graphNodes.map((node) => node.id));

      return graphEdges
        .filter(
          (edge) =>
            validNodeIds.has(edge.source) &&
            validNodeIds.has(edge.target),
        )
        .map((edge) => [edge.source, edge.target] as const);
    },
    [graphNodes, graphEdges],
  );

  const TAG_DEFS = useMemo<TagDef[]>(() => {
    if (graphNodes.length === 0) {
      return [];
    }

    const tagNodeIds = new Map<string, string[]>();

    for (const node of graphNodes) {
      for (const tag of node.tags) {
        const nodeIds = tagNodeIds.get(tag) ?? [];
        nodeIds.push(node.id);
        tagNodeIds.set(tag, nodeIds);
      }
    }

    return Array.from(tagNodeIds.entries())
      .map(([tag, nodeIds]) => ({
        id: `tag-${tag}`,
        label: tag,
        nodeIds,
      }));
  }, [graphNodes]);

  const mountRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [titleVisible, setTitleVisible] = useState(false);
  const [titleContent, setTitleContent] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [showFullDialog, setShowFullDialog] = useState(false);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const activeTagIdRef = useRef<string | null>(null);
  const handleTagClick = (tagId: string) => {
    selectedIdRef.current = null;
    setSelectedId(null);
    setTitleVisible(false);
    setTitleContent('');
    setInfoOpen(false);
    onSelect?.(null);
    setActiveTagId((prev) => (prev === tagId ? null : tagId));
  };
  const labelRef = useRef<HTMLDivElement | null>(null);
  const updateLabelPositionRef = useRef<((id: string | null) => void) | null>(null);
  const updateHighlightForSelectedRef = useRef<((id: string | null) => void) | null>(null);
  const updateHighlightForActiveTagRef = useRef<((tagId: string | null) => void) | null>(null);

  useEffect(() => {
    if (!mountRef.current || SAMPLE_SESSION_NODES.length === 0) return;

    const scene = new THREE.Scene();
    scene.background = null;

    const nodePositions = SAMPLE_SESSION_NODES.map((n) => n.position);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of nodePositions) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const contentWidth = Math.max(maxX - minX, 4);
    const contentHeight = Math.max(maxY - minY, 4);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const padding = 0.15;
    const marginX = contentWidth * padding;
    const marginY = contentHeight * padding;

    const neededWidth = contentWidth * 1.3;
    const neededHeight = contentHeight * 1.3;
    const viewAspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
    const width = Math.max(neededWidth, neededHeight * viewAspect);
    const height = Math.max(neededHeight, neededWidth / viewAspect);

    const camera = new THREE.OrthographicCamera(
      centerX - width / 2,
      centerX + width / 2,
      centerY + height / 2,
      centerY - height / 2,
      0.1,
      100,
    );
    camera.position.set(0, 0, 10);
    camera.lookAt(centerX, centerY, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1.8);
    light.position.set(2, 3, 4);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x1a2530, 0.4));

    const nodeColorByGroup = (groupId: number): number => {
      if (groupId === 2) return 0x7d94a8;
      if (groupId === 3) return 0xd9c27a;
      return 0x5f9b7a;
    };

    const starTexture = makeStarTexture();

    const nodeBaseColor = 0xc8d6e5;
    const nodeHighlightColor = 0xe9f4ff;

    const nodeSpriteMaterial = new THREE.SpriteMaterial({
      map: starTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      color: nodeBaseColor,
    });

    const nodeSprites = SAMPLE_SESSION_NODES.map((node) => {
      const material = nodeSpriteMaterial.clone();
      const sprite = new THREE.Sprite(material);
      const position = node.position;
      sprite.position.set(position[0], position[1], position[2] + 0.002);
      const baseScale = 0.55;
      sprite.scale.set(baseScale, baseScale, 1);
      sprite.userData = {
        nodeId: node.id,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: (2 * Math.PI) / (3 + Math.random() * 3),
        pulseAmplitude: 0.14 + Math.random() * 0.08,
        pulseScaleAmplitude: 0.05 + Math.random() * 0.04,
        tierOpacity: 0.85,
        baseScale,
        hoverScale: 0,
        targetHoverScale: 0,
        currentOpacity: 0.85,
        targetOpacity: 0.85,
        currentScale: baseScale,
        targetScale: baseScale,
        targetColor: nodeBaseColor,
      };
      scene.add(sprite);
      return sprite;
    });

    const nodeTextures = [starTexture];

    const nodeIdToTagIds: Record<string, string[]> = {};
    for (const tag of TAG_DEFS) {
      for (const nid of tag.nodeIds) {
        if (!nodeIdToTagIds[nid]) nodeIdToTagIds[nid] = [];
        nodeIdToTagIds[nid].push(tag.id);
      }
    }

    const nodeMap = Object.fromEntries(
      SAMPLE_SESSION_NODES.map((n) => [n.id, n]),
    ) as Record<string, SessionNode>;

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x7a9aa8,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    const edgeHighlightMaterial = new THREE.LineBasicMaterial({
      color: 0xe9f4ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const edgeGeometries: THREE.BufferGeometry[] = [];
    const edgeHighlightGeometries: THREE.Line[] = [];
    const edgeHighlightMaterials: THREE.LineBasicMaterial[] = [];
    const edgeHighlightTargetOpacity: number[] = [];

    for (const [sourceId, targetId] of SAMPLE_EDGES) {
      const source = nodeMap[sourceId];
      const target = nodeMap[targetId];
      if (!source || !target) continue;

      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([
        source.position[0], source.position[1], source.position[2],
        target.position[0], target.position[1], target.position[2],
      ]);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geometry, edgeMaterial);
      scene.add(line);
      edgeGeometries.push(geometry);

      const highlightGeometry = new THREE.BufferGeometry();
      highlightGeometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
      const highlightMaterial = edgeHighlightMaterial.clone();
      const highlightLine = new THREE.Line(highlightGeometry, highlightMaterial);
      highlightLine.visible = false;
      scene.add(highlightLine);
      edgeHighlightGeometries.push(highlightLine);
      edgeHighlightMaterials.push(highlightMaterial);
      edgeHighlightTargetOpacity.push(0);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.target.set(0, 0, 0);
    controls.update();

    const dragStart = { current: null as { x: number; y: number; left: number; right: number; top: number; bottom: number } | null };
    const isDragging = { current: false as boolean };
    const didDrag = { current: false as boolean };
    const selectedHitOnDown = { current: null as SessionNode | null };
    const hoverId = { current: null as string | null };

    const nodeRadiusForHit = 0.22;

    const eventToWorld = (e: MouseEvent): { x: number; y: number } | null => {
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const x = viewLeft + (mx / rect.width) * (viewRight - viewLeft);
      const y = viewTop - (my / rect.height) * (viewTop - viewBottom);
      return { x, y };
    };

    const hitNodeFromEvent = (e: MouseEvent): SessionNode | null => {
      const world = eventToWorld(e);
      if (!world) return null;
      return hitNode(world.x, world.y);
    };

    const hitNode = (wx: number, wy: number): SessionNode | null => {
      for (const n of SAMPLE_SESSION_NODES) {
        const dx = wx - n.position[0];
        const dy = wy - n.position[1];
        if (dx * dx + dy * dy <= nodeRadiusForHit * nodeRadiusForHit) {
          return n;
        }
      }
      return null;
    };

    const updateHighlights = () => {
      const selected = selectedIdRef.current;
      const activeTag = activeTagIdRef.current;
      const connectedIds = new Set<string>();
      if (selected != null) {
        for (const [sourceId, targetId] of SAMPLE_EDGES) {
          if (sourceId === selected) connectedIds.add(targetId);
          if (targetId === selected) connectedIds.add(sourceId);
        }
      }
      for (const sprite of nodeSprites) {
        const ud = sprite.userData;
        if (!ud) continue;
        const nodeId = ud.nodeId;
        const isSelected = nodeId === selected;
        const isConnected = selected != null && connectedIds.has(nodeId);
        const inTag = activeTag != null && nodeIdToTagIds[nodeId]?.includes(activeTag);
        if (isSelected) {
          ud.targetColor = nodeHighlightColor;
          ud.baseScale = 0.36;
          ud.tierOpacity = 1;
          ud.pulseAmplitude = 0;
          ud.pulseScaleAmplitude = 0;
          ud.targetScale = 0.36;
          ud.targetOpacity = 1;
        } else if (inTag) {
          ud.targetColor = nodeHighlightColor;
          ud.baseScale = 0.36;
          ud.tierOpacity = 1;
          ud.pulseAmplitude = 0;
          ud.pulseScaleAmplitude = 0;
          ud.targetScale = 0.36;
          ud.targetOpacity = 1;
        } else if (isConnected) {
          ud.targetColor = nodeHighlightColor;
          ud.baseScale = 0.26;
          ud.tierOpacity = 0.6;
          ud.pulseAmplitude = 0.1;
          ud.pulseScaleAmplitude = 0.04;
          ud.targetScale = 0.26;
          ud.targetOpacity = 0.6;
        } else {
          ud.targetColor = nodeBaseColor;
          if (selected == null) {
            ud.baseScale = 0.22;
            ud.tierOpacity = 0.85;
            ud.pulseAmplitude = 0.18;
            ud.pulseScaleAmplitude = 0.06;
            ud.targetScale = 0.22;
            ud.targetOpacity = 0.85;
          } else {
            ud.baseScale = 0.14;
            ud.tierOpacity = 0.3;
            ud.pulseAmplitude = 0.08;
            ud.pulseScaleAmplitude = 0.03;
            ud.targetScale = 0.14;
            ud.targetOpacity = 0.3;
          }
        }
      }
      const tagEdges = new Set<number>();
      if (activeTag != null) {
        for (let i = 0; i < SAMPLE_EDGES.length; i++) {
          const [sourceId, targetId] = SAMPLE_EDGES[i];
          const sIn = nodeIdToTagIds[sourceId]?.includes(activeTag);
          const tIn = nodeIdToTagIds[targetId]?.includes(activeTag);
          if (sIn && tIn) tagEdges.add(i);
        }
      }
      for (let i = 0; i < SAMPLE_EDGES.length; i++) {
        if (activeTag != null) {
          edgeHighlightTargetOpacity[i] = tagEdges.has(i) ? 0.95 : 0;
        } else {
          const [sourceId, targetId] = SAMPLE_EDGES[i];
          const connected = selected == null
            ? false
            : (sourceId === selected || targetId === selected);
          edgeHighlightTargetOpacity[i] = connected ? 0.95 : 0;
        }
      }
    };
    updateHighlightForSelectedRef.current = updateHighlights;
    updateHighlightForActiveTagRef.current = updateHighlights;

    const updateHoverForMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        hoverId.current = null;
        for (const sprite of nodeSprites) {
          const ud = sprite.userData;
          if (!ud) continue;
          ud.targetHoverScale = 0;
        }
        return;
      }
      const hit = hitNodeFromEvent(e);
      const newHoverId = hit ? hit.id : null;
      if (newHoverId === hoverId.current) return;
      hoverId.current = newHoverId;
      for (const sprite of nodeSprites) {
        const ud = sprite.userData;
        if (!ud) continue;
        ud.targetHoverScale = (newHoverId != null && ud.nodeId === newHoverId) ? 1 : 0;
      }
    };

    const minScale = 4;
    const maxScale = 40;
    let viewLeft = centerX - width / 2;
    let viewRight = centerX + width / 2;
    let viewTop = centerY + height / 2;
    let viewBottom = centerY - height / 2;

    function updateCameraFrustum() {
      camera.left = viewLeft;
      camera.right = viewRight;
      camera.top = viewTop;
      camera.bottom = viewBottom;
      camera.updateProjectionMatrix();
    }

    const _projectVec = new THREE.Vector3();

    const worldToScreen = (wx: number, wy: number): { x: number; y: number } | null => {
      const rect = mountRef.current?.getBoundingClientRect();
      const canvas = renderer.domElement;
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      _projectVec.set(wx, wy, 0);
      _projectVec.project(camera);
      const xCss = (_projectVec.x * 0.5 + 0.5) * canvas.clientWidth;
      const yCss = (0.5 - _projectVec.y * 0.5) * canvas.clientHeight;
      return { x: xCss + canvas.offsetLeft, y: yCss + canvas.offsetTop };
    };

    const updateLabelPosition = (id: string | null) => {
      const label = labelRef.current;
      if (!label) return;
      if (id == null) {
        label.style.display = 'none';
        return;
      }
      const node = nodeMap[id];
      if (!node) { label.style.display = 'none'; return; }
      const sp = worldToScreen(node.position[0], node.position[1]);
      if (!sp) { label.style.display = 'none'; return; }
      const viewWorldW = viewRight - viewLeft;
      const canvasEl = renderer.domElement;
      const spriteScreenH = (0.32 / viewWorldW) * canvasEl.clientWidth;
      const offsetY = spriteScreenH + 6;
      label.style.display = 'block';
      label.style.left = sp.x + 'px';
      label.style.top = (sp.y + offsetY) + 'px';
    };
    updateLabelPositionRef.current = updateLabelPosition;

    const animateRef = { current: 0 as number | null };

    function animate() {
      animateRef.current = requestAnimationFrame(animate);
      const now = performance.now() / 1000;
      const dt = 1 / 60;
      const lerpSpeed = 4;
      const lerpFactor = 1 - Math.exp(-lerpSpeed * dt);
      for (const sprite of nodeSprites) {
        const ud = sprite.userData;
        if (!ud || ud.pulseAmplitude == null) continue;
        ud.currentOpacity += (ud.targetOpacity - ud.currentOpacity) * lerpFactor;
        ud.currentScale += (ud.targetScale - ud.currentScale) * lerpFactor;
        ud.hoverScale += (ud.targetHoverScale - ud.hoverScale) * (1 - Math.exp(-3 * dt));
        sprite.material.color.lerp(new THREE.Color(ud.targetColor), lerpFactor);
        const pulse = Math.sin(now * ud.pulseSpeed + ud.pulsePhase);
        const opacityOffset = pulse * ud.pulseAmplitude;
        const baseOpacity = ud.currentOpacity;
        sprite.material.opacity = Math.max(baseOpacity * 0.7, baseOpacity + opacityOffset);
        if (ud.pulseScaleAmplitude > 0) {
          const scaleOffset = pulse * ud.pulseScaleAmplitude;
          const s = ud.currentScale * (1 + ud.hoverScale * 2) + scaleOffset;
          sprite.scale.set(s, s, 1);
        } else {
          sprite.scale.set(ud.currentScale * (1 + ud.hoverScale * 2), ud.currentScale * (1 + ud.hoverScale * 2), 1);
        }
      }
      for (let i = 0; i < edgeHighlightMaterials.length; i++) {
        const target = edgeHighlightTargetOpacity[i] ?? 0;
        const current = edgeHighlightMaterials[i].opacity;
        edgeHighlightMaterials[i].opacity += (target - current) * (1 - Math.exp(-2 * dt));
        const line = edgeHighlightGeometries[i];
        if (line) line.visible = edgeHighlightMaterials[i].opacity > 0.01;
      }
      controls.update();
      renderer.render(scene, camera);
    }

    updateHighlightForActiveTagRef.current?.(activeTagIdRef.current);
    animate();

    const onMouseDown = (e: MouseEvent) => {
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      dragStart.current = { x: e.clientX, y: e.clientY, left: viewLeft, right: viewRight, top: viewTop, bottom: viewBottom };
      isDragging.current = true;
      didDrag.current = false;
      selectedHitOnDown.current = hitNodeFromEvent(e);
      for (const sprite of nodeSprites) {
        const ud = sprite.userData;
        if (!ud) continue;
        ud.targetHoverScale = 0;
      }
      hoverId.current = null;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      const worldDx = (dx / rect.width) * (dragStart.current.right - dragStart.current.left);
      const worldDy = (dy / rect.height) * (dragStart.current.top - dragStart.current.bottom);

      viewLeft = dragStart.current.left - worldDx;
      viewRight = dragStart.current.right - worldDx;
      viewTop = dragStart.current.top + worldDy;
      viewBottom = dragStart.current.bottom + worldDy;
      updateCameraFrustum();
      updateLabelPosition(selectedIdRef.current);

      if (!didDrag.current) {
        const moved = Math.abs(dx) > 2 || Math.abs(dy) > 2;
        if (moved) didDrag.current = true;
      }
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      const hitOnDown = selectedHitOnDown.current;
      selectedHitOnDown.current = null;
      dragStart.current = null;

      if (didDrag.current) {
        didDrag.current = false;
        return;
      }

      if (hitOnDown) {
        setActiveTagId(null);
        setSelectedId(hitOnDown.id);
        setTitleContent(hitOnDown.title);
        setTitleVisible(true);
        updateHighlightForSelectedRef.current?.(hitOnDown.id);
        setInfoOpen(true);
        onSelect?.(hitOnDown);
        if (hitOnDown.id === 'g3-3') {
          setShowFullDialog(false);
        }
      } else {
        setActiveTagId(null);
        setSelectedId(null);
        setTitleVisible(false);
        updateHighlightForSelectedRef.current?.(null);
        setInfoOpen(false);
        onSelect?.(null);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const nx = mx / rect.width;
      const ny = my / rect.height;

      const curWidth = viewRight - viewLeft;
      const curHeight = viewTop - viewBottom;
      const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      const newWidth = Math.max(minScale, Math.min(maxScale, curWidth * factor));
      const newHeight = newWidth * (rect.height / rect.width);

      const worldX = viewLeft + nx * curWidth;
      const worldY = viewTop - ny * curHeight;

      viewLeft = worldX - nx * newWidth;
      viewRight = worldX + (1 - nx) * newWidth;
      viewTop = worldY + ny * newHeight;
      viewBottom = worldY - (1 - ny) * newHeight;
      updateCameraFrustum();

      updateLabelPosition(selectedIdRef.current);
    };

    const canvasEl = renderer.domElement;
    const onMouseLeave = () => {
      hoverId.current = null;
      for (const sprite of nodeSprites) {
        const ud = sprite.userData;
        if (!ud) continue;
        ud.targetHoverScale = 0;
      }
    };
    canvasEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    canvasEl.addEventListener('mousemove', updateHoverForMouseMove);
    canvasEl.addEventListener('mouseleave', onMouseLeave);

    const onResize = () => {
      if (!mountRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      if (width === 0 || height === 0) return;

      const curWidth = viewRight - viewLeft;
      const curHeight = viewTop - viewBottom;
      const centerX = (viewLeft + viewRight) / 2;
      const centerY = (viewTop + viewBottom) / 2;

      const newHalfWidth = curWidth / 2;
      const newHalfHeight = newHalfWidth * (height / width);

      viewLeft = centerX - newHalfWidth;
      viewRight = centerX + newHalfWidth;
      viewTop = centerY + newHalfHeight;
      viewBottom = centerY - newHalfHeight;
      updateCameraFrustum();
      renderer.setSize(width, height);
      updateLabelPosition(selectedIdRef.current);
    };
    window.addEventListener('resize', onResize);

    return () => {
      if (animateRef.current != null) {
        cancelAnimationFrame(animateRef.current);
        animateRef.current = null;
      }
      window.removeEventListener('resize', onResize);
      canvasEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvasEl.removeEventListener('wheel', onWheel);
      canvasEl.removeEventListener('mousemove', updateHoverForMouseMove);
      canvasEl.removeEventListener('mouseleave', onMouseLeave);
      controls.dispose();

      nodeSprites.forEach((sprite) => {
        sprite.removeFromParent();
      });
      nodeTextures.forEach((texture) => {
        texture.dispose();
      });
      nodeSpriteMaterial.dispose();

      edgeGeometries.forEach((geo) => {
        if (geo) {
          geo.dispose();
        }
      });
      edgeMaterial.dispose();

      renderer.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
    }, [SAMPLE_SESSION_NODES, SAMPLE_EDGES, TAG_DEFS]);

  useEffect(() => {
  selectedIdRef.current = selectedId;
  updateHighlightForSelectedRef.current?.(selectedId);
}, [selectedId]);

  useEffect(() => {
    activeTagIdRef.current = activeTagId;
    updateHighlightForActiveTagRef.current?.(activeTagId);
  }, [activeTagId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    updateLabelPositionRef.current?.(selectedId ?? null);
  }, [selectedId]);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: infoPanelVisible ? '70vh' : '100%',
        backgroundColor: '#020305',
        backgroundImage: "linear-gradient(rgba(0,0,0,0.75), rgba(0,0,0,0.75)), url('/milky-way.avif')",        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        outline: 'none',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          top: 12,
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 6,
          zIndex: 2,
          pointerEvents: 'auto',
        }}
      >
        {TAG_DEFS.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => handleTagClick(tag.id)}
            style={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              background: activeTagId === tag.id ? 'rgba(200, 214, 226, 0.18)' : 'rgba(200, 214, 226, 0.08)',
              border: '1px solid rgba(159, 182, 196, 0.3)',
              borderRadius: 5,
              color: '#dfe9f2',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 10px',
              fontFamily: 'inherit',
              letterSpacing: '0.02em',
            }}
          >
            {tag.label}
          </button>
        ))}
      </div>
      {selectedId != null && (
        <div
          ref={labelRef}
          style={{
            position: 'absolute',
            transform: 'translate(-50%, 0)',
            display: 'none',
            pointerEvents: 'none',
            color: '#f2f7ff',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.02em',
            textShadow: '0 0 6px rgba(8, 20, 28, 0.95), 0 0 2px rgba(8, 20, 28, 0.9)',
            whiteSpace: 'nowrap',
            background: 'rgba(5, 9, 12, 0.55)',
            padding: '2px 6px',
            borderRadius: 4,
            backdropFilter: 'blur(2px)',
            border: '1px solid rgba(159, 182, 196, 0.2)',
          }}
        >
          {titleContent}
        </div>
      )}
      {selectedId != null && infoOpen && infoPanelVisible && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: 16,
            width: 260,
            background: 'rgba(6, 12, 16, 0.92)',
            border: '1px solid rgba(159, 182, 196, 0.25)',
            borderRadius: 8,
            padding: '10px 12px',
            color: '#e9f4ff',
            fontFamily: 'inherit',
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            backdropFilter: 'blur(6px)',
            pointerEvents: 'auto',
          }}
        >
          {selectedIdRef.current === 'g3-3' ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, letterSpacing: '0.02em' }}>
                물류 창고 화재 보상 문의
              </div>
              <div style={{ fontSize: 11, color: '#b9c6d2', marginBottom: 8, letterSpacing: '0.02em' }}>
                세션 ID: session_kr_012
              </div>
              <div style={{ fontSize: 12, color: '#cfd9e1', marginBottom: 10, lineHeight: 1.5 }}>
                물류 창고 화재로 재고를 잃은 사용자가 보상을 문의한 대화. 데모용 요약.
              </div>
              <div style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowFullDialog((v) => !v)}
                  style={{
                    background: 'rgba(200, 214, 226, 0.08)',
                    border: '1px solid rgba(159, 182, 196, 0.3)',
                    borderRadius: 5,
                    color: '#dfe9f2',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: '4px 10px',
                    width: '100%',
                  }}
                >
                  {showFullDialog ? '접기' : '대화 전체 보기'}
                </button>
              </div>
              {showFullDialog && (
                <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 10, lineHeight: 1.6, fontSize: 12, color: '#e4ecf5' }}>
                  <div style={{ marginBottom: 6, color: '#9fb6c4', fontWeight: 500 }}>사용자</div>
                  <div>저번 주 물류 창고에서 화재가 났어요. 재고가 전부 탔습니다.</div>
                  <div style={{ marginBottom: 6, color: '#9fb6c4', fontWeight: 500, marginTop: 8 }}>상담사</div>
                  <div>구매하신 상품이 맞으면 보상 정책 확인해드릴게요. 먼저 회사명과 화재 시점 알려주실 수 있나요?</div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setInfoOpen(false);
                  setSelectedId(null);
                  setTitleVisible(false);
                  updateHighlightForSelectedRef.current?.(null);
                }}
                style={{
                  background: 'rgba(200, 214, 226, 0.08)',
                  border: '1px solid rgba(159, 182, 196, 0.3)',
                  borderRadius: 5,
                  color: '#dfe9f2',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '4px 10px',
                  width: '100%',
                }}
              >
                닫기
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, letterSpacing: '0.02em' }}>
                {titleContent}
              </div>
              <div style={{ fontSize: 12, color: '#b9c6d2', marginBottom: 10, lineHeight: 1.5 }}>
                샘플이라 대화 원문이 없습니다
              </div>
              <button
                type="button"
                onClick={() => {
                  setInfoOpen(false);
                  setSelectedId(null);
                  setTitleVisible(false);
                  updateHighlightForSelectedRef.current?.(null);
                }}
                style={{
                  background: 'rgba(200, 214, 226, 0.08)',
                  border: '1px solid rgba(159, 182, 196, 0.3)',
                  borderRadius: 5,
                  color: '#dfe9f2',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '4px 10px',
                  width: '100%',
                }}
              >
                닫기
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// touch
