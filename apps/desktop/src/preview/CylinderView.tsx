import { formatDeg } from '@ols/geometry-adapters';
import type { MeshBuffers, Project } from '@ols/shared-types';
import { Badge } from '@ols/ui';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { modelGeometry } from '@/cad/geometry';
import { call } from '@/lib/ipc';
import { useCad } from '@/stores/cad';
import { usePlan } from '@/stores/plan';
import { activeTimeline, sampleAt, usePlayback } from '@/stores/playback';
import { useProject } from '@/stores/project';
import { useView } from '@/stores/view';

import { renderArtwork } from './artwork';

const HEAD_HEIGHT = 70;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function useArtworkTexture(project: Project): THREE.CanvasTexture | null {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  const deb = useDebounced(project, 200);
  useEffect(() => {
    let cancelled = false;
    void renderArtwork(deb, deb.mode === 'cylinder' ? '#c9a27a' : '#b98d62').then((canvas) => {
      if (cancelled) return;
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      // Cylinder UVs are (u/L, s/C) with s growing down the canvas; the flat plane uses default flip.
      t.flipY = deb.mode !== 'cylinder';
      t.wrapT = THREE.RepeatWrapping;
      setTex((old) => {
        old?.dispose();
        return t;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [deb]);
  return tex;
}

function useCylinderMesh(project: Project): THREE.BufferGeometry | null {
  const spec = project.workpiece;
  const key = `${spec.diameterMm}|${spec.lengthMm}`;
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    void call('geometry:cylinderMesh', { spec: { ...spec, rotationSign: spec.rotationSign === -1 ? -1 : 1 }, toleranceMm: 0.05, axialSegments: 1 })
      .then((m: MeshBuffers) => {
        if (cancelled) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
        g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        g.computeBoundingSphere();
        setGeo((old) => {
          old?.dispose();
          return g;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return geo;
}

function useLineGeometry(positions: Float32Array | undefined): THREE.BufferGeometry | null {
  return useMemo(() => {
    if (!positions || positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    return g;
  }, [positions]);
}

/** The CAD model bound as workpiece, placed in the pose frame by its model→workpiece transform. */
function CadWorkpieceMesh({ project }: { project: Project }) {
  const binding = project.cad?.activeWorkpiece ?? null;
  const data = useCad((s) => (binding ? s.models[binding.modelId] : undefined));
  const matrix = useMemo(() => (binding ? new THREE.Matrix4().fromArray(binding.modelToWorkpiece) : null), [binding]);
  if (!binding || !data || !matrix) return null;
  const geo = modelGeometry(data);
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh geometry={geo.mesh} renderOrder={2}>
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={geo.edges} renderOrder={3}>
        <lineBasicMaterial color="#bae6fd" transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

function Scene({ project }: { project: Project }) {
  const plan = usePlan((s) => s.result);
  const planned = usePlan((s) => s.planned);
  const showTravel = useView((s) => s.showTravel);
  const showToolpath = useView((s) => s.showToolpath);
  const tex = useArtworkTexture(project);
  const cylGeo = useCylinderMesh(project);
  const valid = plan && planned?.mode === project.mode;
  const markGeo = useLineGeometry(valid ? plan.markPositions : undefined);
  const travelGeo = useLineGeometry(valid ? plan.travelPositions : undefined);
  const progressGeo = useMemo(() => {
    if (!markGeo) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', markGeo.getAttribute('position'));
    g.setDrawRange(0, 0);
    return g;
  }, [markGeo]);

  const pose = useRef<THREE.Group>(null);
  const carriage = useRef<THREE.Group>(null);
  const spot = useRef<THREE.Mesh>(null);
  const beamGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), []);
  const beamLine = useMemo(() => {
    const l = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: '#ff3b30' }));
    l.visible = false;
    l.frustumCulled = false;
    return l;
  }, [beamGeo]);
  const beam = useRef<THREE.Line>(beamLine);

  const cyl = project.mode === 'cylinder';
  const R = project.workpiece.diameterMm / 2;
  const L = project.workpiece.lengthMm;
  const g = project.machine.galvo;
  const topY = cyl ? R : 0;
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const tl = activeTimeline();
    const s = tl ? sampleAt(tl, usePlayback.getState().tS) : null;
    const grp = pose.current;
    if (!grp) return;
    if (!s) {
      grp.rotation.x = 0;
      grp.position.x = 0;
      if (spot.current) spot.current.visible = false;
      if (beam.current) beam.current.visible = false;
      progressGeo?.setDrawRange(0, 0);
      return;
    }
    grp.rotation.x = cyl ? s.rotX : 0;
    grp.position.x = cyl ? s.tx : 0;
    if (carriage.current) carriage.current.position.x = grp.position.x;
    if (spot.current) {
      spot.current.visible = true;
      spot.current.position.set(s.spot[0], s.spot[1], s.spot[2]);
      (spot.current.material as THREE.MeshBasicMaterial).color.set(s.laser ? '#ff3b30' : '#38bdf8');
    }
    if (beam.current) {
      beam.current.visible = s.laser;
      if (s.laser && spot.current) {
        spot.current.getWorldPosition(tmp);
        const pos = beamGeo.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, 0, topY + HEAD_HEIGHT, 0);
        pos.setXYZ(1, tmp.x, tmp.y, tmp.z);
        pos.needsUpdate = true;
      }
    }
    if (progressGeo && valid && plan) {
      const seg = Math.max(0, Math.min(plan.markVertexOffsets.length - 1, Math.round(s.segment) + 1));
      progressGeo.setDrawRange(0, plan.markVertexOffsets[seg] ?? 0);
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[120, 220, 160]} intensity={1.4} />
      <directionalLight position={[-150, 80, -120]} intensity={0.4} />

      {/* Galvo head and field-of-view frame on the focal plane. */}
      <mesh position={[0, topY + HEAD_HEIGHT + 10, 0]}>
        <boxGeometry args={[46, 20, 36]} />
        <meshStandardMaterial color="#2b3038" metalness={0.4} roughness={0.5} />
      </mesh>
      <lineSegments position={[0, topY + 0.02, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(g.fieldWidthMm, 0.001, g.fieldHeightMm)]} />
        <lineBasicMaterial color="#64748b" transparent opacity={0.5} />
      </lineSegments>
      <primitive object={beamLine} />

      {cyl ? (
        <>
          {/* Linear (U) carriage follows the axial translation only. */}
          <group ref={carriage}>
            <mesh position={[-8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[R * 1.35, R * 1.35, 14, 48]} />
              <meshStandardMaterial color="#3f4652" metalness={0.6} roughness={0.35} />
            </mesh>
            <mesh position={[-8, -R * 1.35 - 12, 0]}>
              <boxGeometry args={[40, 24, R * 2.4]} />
              <meshStandardMaterial color="#262b33" />
            </mesh>
          </group>
          <mesh position={[L / 2 - 40, -R * 1.35 - 30, 0]}>
            <boxGeometry args={[L + 220, 6, R * 2.6]} />
            <meshStandardMaterial color="#1a1e24" />
          </mesh>
          {/* Workpiece in the pose frame: rotation about X (A), translation along X (U). */}
          <group ref={pose}>
            {cylGeo && (
              <mesh geometry={cylGeo}>
                <meshStandardMaterial map={tex} color={tex ? '#ffffff' : '#c9a27a'} roughness={0.75} side={THREE.DoubleSide} />
              </mesh>
            )}
            <mesh position={[L / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[R * 0.15, R * 0.15, L + 0.5, 12]} />
                <meshBasicMaterial color="#111" />
            </mesh>
            <CadWorkpieceMesh project={project} />
            {showToolpath && markGeo && (
              <lineSegments geometry={markGeo}>
                <lineBasicMaterial color="#e2e8f0" transparent opacity={0.55} />
              </lineSegments>
            )}
            {showToolpath && progressGeo && (
              <lineSegments geometry={progressGeo}>
                <lineBasicMaterial color="#f97316" />
              </lineSegments>
            )}
            {showTravel && travelGeo && (
              <lineSegments geometry={travelGeo}>
                <lineBasicMaterial color="#64748b" transparent opacity={0.5} />
              </lineSegments>
            )}
            <mesh ref={spot} visible={false}>
              <sphereGeometry args={[0.9, 12, 12]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
          </group>
        </>
      ) : (
        <group ref={pose}>
          <mesh position={[g.fieldWidthMm / 2 - g.centerXMm, -0.6, g.fieldHeightMm / 2 - g.centerYMm]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[g.fieldWidthMm, g.fieldHeightMm]} />
            <meshStandardMaterial map={tex} color={tex ? '#ffffff' : '#b98d62'} roughness={0.8} />
          </mesh>
          {showToolpath && markGeo && (
            <lineSegments geometry={markGeo}>
              <lineBasicMaterial color="#e2e8f0" transparent opacity={0.55} />
            </lineSegments>
          )}
          {showToolpath && progressGeo && (
            <lineSegments geometry={progressGeo}>
              <lineBasicMaterial color="#f97316" />
            </lineSegments>
          )}
          {showTravel && travelGeo && (
            <lineSegments geometry={travelGeo}>
              <lineBasicMaterial color="#64748b" transparent opacity={0.5} />
            </lineSegments>
          )}
          <mesh ref={spot} visible={false}>
            <sphereGeometry args={[0.9, 12, 12]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
        </group>
      )}
      <gridHelper args={[600, 60, '#334155', '#1e293b']} position={[0, cyl ? -R * 1.35 - 33.5 : -1, 0]} />
    </>
  );
}

function Readout() {
  const [s, setS] = useState<ReturnType<typeof sampleAt>>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const tl = activeTimeline();
      setS(tl ? sampleAt(tl, usePlayback.getState().tS) : null);
    }, 100);
    return () => clearInterval(id);
  }, []);
  const source = usePlayback((st) => st.source);
  if (!s) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-card/85 px-2 py-1.5 font-mono text-[10.5px] leading-4 backdrop-blur" data-testid="pose-readout">
      <div className="mb-0.5 flex items-center gap-1.5">
        <Badge tone={source === 'machine' ? 'sim' : 'muted'}>{source === 'machine' ? 'sim machine' : 'planned preview'}</Badge>
        {s.laser && <Badge tone="danger">laser {s.power.toFixed(0)}%</Badge>}
      </div>
      <div>
        A {formatDeg(s.a)} · U {s.u.toFixed(2)} mm
      </div>
      <div>
        Gx {s.gx.toFixed(2)} · Gy {s.gy.toFixed(2)} mm
      </div>
      <div className="text-muted-foreground">
        section {s.section >= 0 ? s.section + 1 : '—'} · segment {s.segment >= 0 ? s.segment : '—'}
      </div>
    </div>
  );
}

export function CylinderView() {
  const project = useProject((s) => s.project)!;
  const cyl = project.mode === 'cylinder';
  const R = project.workpiece.diameterMm / 2;
  const bound = project.cad?.activeWorkpiece?.modelId;
  const cadName = useCad((s) => (bound ? s.models[bound]?.name : undefined));
  return (
    <div className="relative h-full w-full bg-[#090b0e]" data-testid="preview-3d">
      <Canvas key={project.mode} camera={{ position: cyl ? [70, 60 + R * 2, 120 + R * 3] : [0, 160, 150], fov: 40, near: 1, far: 5000 }} dpr={[1, 2]} frameloop="always">
        <color attach="background" args={['#090b0e']} />
        <Scene project={project} />
        {/* Orbit around the galvo field centre, where the beam meets the workpiece. */}
        <OrbitControls makeDefault target={[20, cyl ? R * 0.5 : 0, 0]} enableDamping dampingFactor={0.12} />
      </Canvas>
      <div className="pointer-events-none absolute top-2 left-2 text-[11px] text-muted-foreground">
        {cyl ? `Cylinder Ø${project.workpiece.diameterMm} × ${project.workpiece.lengthMm} mm` : 'Flat field'} · drag to orbit, wheel to zoom
        {cyl && cadName && (
          <span className="ml-1 text-sky-300" data-testid="cad-workpiece-label">
            · CAD: {cadName}
          </span>
        )}
      </div>
      <Readout />
    </div>
  );
}
