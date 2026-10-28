import type { CadModelData, CadModelRef, Vec3 } from '@ols/shared-types';
import { GizmoHelper, GizmoViewport, Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

import { toolPick } from '@/lib/cad';
import { type CadViewKind, useCad } from '@/stores/cad';
import { useProject } from '@/stores/project';

import { QUALITY_MARK, measurementText } from './format';
import { edgePoints, modelGeometry, triangleSubset, visibleTriangles } from './geometry';
import { type CadPick, type PickMode, resolvePick } from './picking';
import { ViewerToolbar } from './ViewerToolbar';

const COLORS = { hover: '#38bdf8', selected: '#f97316', tool: '#a3e635', preview: '#22d3ee', axis: '#f472b6', annotation: '#facc15' };

/** Pick granularity forced by the active tool. */
function effectivePickMode(tool: string, mode: PickMode): PickMode {
  if (tool === 'length') return 'edge';
  if (tool === 'face-distance' || tool === 'area' || tool === 'section') return 'face';
  return mode;
}

function worldPerPixel(e: ThreeEvent<PointerEvent | MouseEvent>, heightPx: number): number {
  const cam = e.camera;
  if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
    const c = cam as THREE.OrthographicCamera;
    return (c.top - c.bottom) / c.zoom / Math.max(1, heightPx);
  }
  const c = cam as THREE.PerspectiveCamera;
  return (2 * e.point.distanceTo(c.position) * Math.tan(THREE.MathUtils.degToRad(c.fov / 2))) / Math.max(1, heightPx);
}

function ModelView({ data, modelRef }: { data: CadModelData; modelRef: CadModelRef }) {
  const geo = modelGeometry(data);
  const isolated = useCad((s) => s.isolated);
  const hidden = useMemo(() => {
    if (isolated?.modelId === data.modelId) return data.parts.map((p) => p.index).filter((i) => i !== isolated.partIndex);
    return modelRef.hiddenParts;
  }, [isolated, data, modelRef.hiddenParts]);
  const vis = useMemo(() => visibleTriangles(data, hidden), [data, hidden]);
  const meshGeo = useMemo(() => {
    if (!vis) return geo.mesh;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.mesh.getAttribute('position'));
    g.setAttribute('normal', geo.mesh.getAttribute('normal'));
    g.setIndex(new THREE.BufferAttribute(vis.index, 1));
    if (vis.index.length > 0) g.boundsTree = new MeshBVH(g);
    return g;
  }, [geo, vis]);
  useEffect(
    () => () => {
      if (meshGeo !== geo.mesh) meshGeo.dispose();
    },
    [meshGeo, geo],
  );
  const edgeGeo = useMemo(() => {
    if (hidden.length === 0) return geo.edges;
    const keep = data.edges.filter((e) => !hidden.includes(e.partIndex)).map((e) => e.index);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(edgePoints(data, keep), 3));
    return g;
  }, [geo, data, hidden]);
  useEffect(
    () => () => {
      if (edgeGeo !== geo.edges) edgeGeo.dispose();
    },
    [edgeGeo, geo],
  );

  const style = useCad((s) => s.style);
  const tool = useCad((s) => s.tool);
  const pickMode = effectivePickMode(tool, useCad((s) => s.pickMode));
  const height = useThree((s) => s.size.height);
  const meshRef = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    if (meshRef.current) meshRef.current.raycast = acceleratedRaycast;
  }, []);

  const toPick = (e: ThreeEvent<PointerEvent | MouseEvent>): CadPick | null => {
    if (e.faceIndex === undefined || e.faceIndex === null) return null;
    const tri = vis ? vis.triMap[e.faceIndex] : e.faceIndex;
    if (tri === undefined) return null;
    return resolvePick(data, tri, [e.point.x, e.point.y, e.point.z], worldPerPixel(e, height), pickMode);
  };

  const xray = style === 'xray';
  const showEdges = style !== 'shaded';
  const showVertices = pickMode === 'vertex' || tool === 'distance';
  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={meshGeo}
        dispose={null}
        renderOrder={xray ? 1 : 0}
        onPointerMove={(e) => {
          e.stopPropagation();
          useCad.getState().setHover(toPick(e));
        }}
        onPointerOut={() => useCad.getState().setHover(null)}
        onClick={(e) => {
          if (e.delta > 4) return;
          e.stopPropagation();
          const p = toPick(e);
          if (!p) return;
          if (useCad.getState().tool !== 'select') void toolPick(p);
          else useCad.getState().select(p, e.shiftKey || e.ctrlKey || e.metaKey);
        }}
      >
        <meshStandardMaterial
          color={data.exact ? '#9aa6b5' : '#b5a48f'}
          metalness={0.1}
          roughness={0.6}
          side={THREE.DoubleSide}
          wireframe={style === 'wireframe'}
          transparent={xray}
          opacity={xray ? 0.22 : 1}
          depthWrite={!xray}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {showEdges && (
        <lineSegments geometry={edgeGeo} dispose={null} renderOrder={2}>
          <lineBasicMaterial color={style === 'wireframe' || xray ? '#cbd5e1' : '#0b1220'} transparent opacity={xray ? 0.8 : 1} />
        </lineSegments>
      )}
      {showVertices && data.vertices.length > 0 && (
        <points geometry={geo.vertices} dispose={null}>
          <pointsMaterial size={5} sizeAttenuation={false} color="#e2e8f0" />
        </points>
      )}
    </group>
  );
}

function PickHighlight({ data, picks, color, opacity, lineWidth = 3 }: { data: CadModelData; picks: CadPick[]; color: string; opacity: number; lineWidth?: number }) {
  const geo = modelGeometry(data);
  const facesKey = picks.filter((p) => p.kind === 'face').map((p) => p.index).join(',');
  const edgesKey = picks.filter((p) => p.kind === 'edge').map((p) => p.index).join(',');
  const verts = picks.filter((p) => p.kind === 'vertex');
  const faceGeo = useMemo(() => {
    if (!facesKey) return null;
    const ranges = facesKey.split(',').map((i) => data.faces[Number(i)]).filter((f) => !!f).map((f) => [f.triStart, f.triCount] as [number, number]);
    return triangleSubset(geo.mesh, ranges);
  }, [facesKey, geo, data]);
  useEffect(() => () => faceGeo?.dispose(), [faceGeo]);
  const edgePts = useMemo(() => (edgesKey ? Array.from(edgePoints(data, edgesKey.split(',').map(Number))) : null), [edgesKey, data]);
  return (
    <>
      {faceGeo && (
        <mesh geometry={faceGeo} renderOrder={3} raycast={() => null}>
          <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
      )}
      {edgePts && edgePts.length >= 6 && <Line points={edgePts} segments color={color} lineWidth={lineWidth} renderOrder={4} depthTest={false} />}
      {verts.map((v) => {
        const p = data.vertices[v.index]?.position;
        return p ? (
          <mesh key={`v${v.index}`} position={p} renderOrder={5} raycast={() => null}>
            <sphereGeometry args={[Math.max(0.15, data.bounds.diagonalMm * 0.004), 12, 12]} />
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
        ) : null;
      })}
    </>
  );
}

function axisSegment(o: Vec3, d: Vec3, t0: number, t1: number): [Vec3, Vec3] {
  const pad = (t1 - t0) * 0.12;
  const at = (t: number): Vec3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  return [at(t0 - pad), at(t1 + pad)];
}

function Highlights({ data }: { data: CadModelData }) {
  const hover = useCad((s) => s.hover);
  const selection = useCad((s) => s.selection);
  const toolPicks = useCad((s) => s.toolPicks);
  const preview = useCad((s) => s.preview);
  const id = data.modelId;
  const sel = selection.filter((p) => p.modelId === id);
  const picks = toolPicks.filter((p) => p.modelId === id);
  const selectedFaces = new Set(sel.filter((p) => p.kind === 'face').map((p) => p.index));
  const axes = data.features.cylinders.filter((c) => c.faceIndices.some((f) => selectedFaces.has(f)) || (preview?.modelId === id && preview.cylinderId === c.id));
  const previewCyl = preview?.modelId === id ? data.features.cylinders.find((c) => c.id === preview.cylinderId) : undefined;
  const previewPicks: CadPick[] = previewCyl ? previewCyl.faceIndices.map((f) => ({ modelId: id, kind: 'face', index: f, point: [0, 0, 0], face: f })) : [];
  return (
    <>
      {previewPicks.length > 0 && <PickHighlight data={data} picks={previewPicks} color={COLORS.preview} opacity={0.45} />}
      {sel.length > 0 && <PickHighlight data={data} picks={sel} color={COLORS.selected} opacity={0.5} />}
      {picks.length > 0 && <PickHighlight data={data} picks={picks} color={COLORS.tool} opacity={0.5} />}
      {hover?.modelId === id && <PickHighlight data={data} picks={[hover]} color={COLORS.hover} opacity={0.3} lineWidth={2} />}
      {axes.map((c) => (
        <Line key={c.id} points={axisSegment(c.axisOrigin, c.axisDirection, c.axialMinMm, c.axialMaxMm)} color={COLORS.axis} lineWidth={1.5} dashed dashSize={3} gapSize={2} depthTest={false} renderOrder={6} />
      ))}
    </>
  );
}

function Annotations({ modelIds }: { modelIds: Set<string> }) {
  const cad = useProject((s) => s.project?.cad);
  if (!cad) return null;
  const unit = cad.displayUnit;
  const precision = cad.displayPrecision;
  return (
    <>
      {cad.measurements
        .filter((m) => m.references.some((r) => modelIds.has(r.modelId)))
        .map((m) => {
          const [a, b] = m.anchors;
          if (!a) return null;
          const label: Vec3 = b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : a;
          return (
            <group key={m.id}>
              {b && <Line points={[a, b]} color={m.stale ? '#94a3b8' : COLORS.annotation} lineWidth={1.5} depthTest={false} renderOrder={7} />}
              <Html position={label} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
                <div
                  data-testid="cad-annotation"
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10.5px] whitespace-nowrap shadow ${m.stale ? 'border-slate-500/50 bg-slate-800/85 text-slate-300 line-through' : 'border-yellow-400/50 bg-black/80 text-yellow-200'}`}
                >
                  {QUALITY_MARK[m.quality]}
                  {measurementText(m, unit, precision)}
                </div>
              </Html>
            </group>
          );
        })}
    </>
  );
}

const VIEW_DIRS: Record<Exclude<CadViewKind, 'fit' | 'axis'>, Vec3> = {
  iso: [1, -1, 0.8],
  front: [0, -1, 0],
  back: [0, 1, 0],
  // Tiny offsets keep the view direction off the orbit up-axis (+Z).
  top: [0, -1e-4, 1],
  bottom: [0, -1e-4, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

function ViewController({ bounds, axis, modelKey }: { bounds: THREE.Box3 | null; axis: Vec3 | null; modelKey: string }) {
  const view = useCad((s) => s.view);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (!bounds || bounds.isEmpty() || !controls) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const r = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5);
    let dir: THREE.Vector3;
    if (view.kind === 'fit') dir = camera.position.clone().sub(controls.target).normalize();
    else if (view.kind === 'axis') dir = axis ? new THREE.Vector3(...axis).normalize() : new THREE.Vector3(...VIEW_DIRS.iso).normalize();
    else dir = new THREE.Vector3(...VIEW_DIRS[view.kind]).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir = new THREE.Vector3(...VIEW_DIRS.iso).normalize();
    if (Math.abs(dir.z) > 0.9999) dir.y -= 1e-4;
    dir.normalize();
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    const fov = ortho ? 35 : (camera as THREE.PerspectiveCamera).fov;
    const dist = ortho ? r * 4 : (r / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 1.1;
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = ortho ? 0.01 : Math.max(dist / 2000, 1e-3);
    camera.far = dist + r * 50;
    if (ortho) (camera as THREE.OrthographicCamera).zoom = Math.min(size.width, size.height) / (2.3 * r);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.seq, controls, modelKey]);
  return null;
}

function SectionOverlay() {
  const section = useCad((s) => s.section);
  if (!section) return null;
  return (
    <group>
      {section.result.polylines.map((pl, i) =>
        pl.length >= 2 ? <Line key={i} points={pl} color="#f472b6" lineWidth={2} depthTest={false} renderOrder={8} /> : null,
      )}
    </group>
  );
}

function Scene({ items }: { items: { ref: CadModelRef; data: CadModelData }[] }) {
  const raycaster = useThree((s) => s.raycaster);
  const isolated = useCad((s) => s.isolated);
  useEffect(() => {
    (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }, [raycaster]);
  const shown = isolated ? items.filter((i) => i.data.modelId === isolated.modelId) : items;
  const bounds = useMemo(() => {
    if (shown.length === 0) return null;
    const b = new THREE.Box3();
    for (const { data } of shown) b.union(new THREE.Box3(new THREE.Vector3(...data.bounds.aabb.min), new THREE.Vector3(...data.bounds.aabb.max)));
    return b;
  }, [shown]);
  const activeId = useCad((s) => s.activeModelId);
  const active = shown.find((i) => i.data.modelId === activeId) ?? shown[0];
  const axis = active?.data.features.axisCandidates[0]?.direction ?? null;
  const modelIds = useMemo(() => new Set(shown.map((i) => i.data.modelId)), [shown]);
  return (
    <>
      <hemisphereLight args={['#f1f5f9', '#1e293b', 0.9]} />
      <directionalLight position={[300, -400, 500]} intensity={1.3} />
      <directionalLight position={[-300, 300, -200]} intensity={0.45} />
      {shown.map(({ ref, data }) => (
        <group key={data.modelId}>
          <ModelView data={data} modelRef={ref} />
          <Highlights data={data} />
        </group>
      ))}
      <SectionOverlay />
      <Annotations modelIds={modelIds} />
      <ViewController bounds={bounds} axis={axis} modelKey={shown.map((i) => i.data.geometryRevision).join('|')} />
    </>
  );
}

export function CadViewer() {
  const refs = useProject((s) => s.project?.cad?.models);
  const models = useCad((s) => s.models);
  const projection = useCad((s) => s.projection);
  const items = useMemo(() => (refs ?? []).flatMap((ref) => (models[ref.id] ? [{ ref, data: models[ref.id]! }] : [])), [refs, models]);
  const ortho = projection === 'orthographic';
  return (
    <div className="relative h-full w-full bg-[#0b0e13]" data-testid="cad-viewer">
      <Canvas
        key={projection}
        orthographic={ortho}
        camera={{ position: [250, -250, 200], up: [0, 0, 1], fov: 35, near: 0.1, far: 1e6, zoom: ortho ? 2 : 1 }}
        dpr={[1, 2]}
        onPointerMissed={(e) => {
          if (e.type === 'click' && useCad.getState().tool === 'select') useCad.getState().select(null);
        }}
      >
        <color attach="background" args={['#0b0e13']} />
        <Scene items={items} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.15} screenSpacePanning />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={['#f87171', '#4ade80', '#60a5fa']} labelColor="#0b0e13" />
        </GizmoHelper>
      </Canvas>
      <ViewerToolbar />
    </div>
  );
}
