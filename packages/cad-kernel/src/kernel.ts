import { createHash, randomUUID } from 'node:crypto';

import type { CadImportOptions, CadImportStage, CadMeasureRequest, CadMeasurement, CadModelData, CadReference, CadSection, GeometrySourceType, Vec3 } from '@ols/shared-types';
import { UNIT_TO_MM } from '@ols/shared-types';

import { type RetainedBrep, buildBrep } from './brep';
import { analyzeFeatures } from './features';
import { fitCylinder, sampleFace } from './fit';
import { type ExactOps, EXTREMA_TOLERANCE_MM, MeasureError, type MeasureTables, runMeasure } from './measure';
import { buildMeshModel, parseStl } from './mesh';
import { KERNEL_VERSION, type OC, loadOcct, progress } from './occt';
import { sectionBrep, sectionMesh } from './section';
import { readStep } from './step';
import { parse3mf } from './threemf';
import { IDENTITY, add, len, scale, scaleMatrix, sub } from './vec';

export type ProgressFn = (stage: CadImportStage, fraction: number) => void;

export const MAX_DISPLAY_TRIANGLES = 8_000_000;
export const LARGE_MODEL_TRIANGLES = 1_500_000;

/** Placeholder product names written by exporters when the part has none. */
const GENERIC_PRODUCT_NAME = /^(Part \d+|Open CASCADE STEP translator.*|NONE|)$/i;

/** Length unit names as written by STEP processors -> mm. */
const STEP_UNITS: Record<string, number> = {
  millimetre: 1,
  millimeter: 1,
  mm: 1,
  centimetre: 10,
  centimeter: 10,
  metre: 1000,
  meter: 1000,
  inch: 25.4,
  foot: 304.8,
  micrometre: 0.001,
  micron: 0.001,
};

export function detectFormat(fileName: string, bytes: Uint8Array): GeometrySourceType {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const head = new TextDecoder().decode(bytes.subarray(0, 64));
  if (head.trimStart().startsWith('ISO-10303-21')) return 'step';
  if (ext === 'step' || ext === 'stp') throw Object.assign(new Error('file has a STEP extension but no ISO-10303-21 header'), { code: 'PARSE' });
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && ext === '3mf') return '3mf';
  if (ext === 'stl') return 'stl';
  throw Object.assign(new Error(`unsupported CAD format ".${ext}" (supported: .step, .stp, .stl, .3mf)`), { code: 'UNSUPPORTED' });
}

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export function geometryRevision(sha: string, unitScaleToMm: number): string {
  const k = createHash('sha256').update(KERNEL_VERSION).digest('hex').slice(0, 8);
  return `${sha.slice(0, 16)}-${k}-u${unitScaleToMm}`;
}

interface Loaded {
  tables: MeasureTables;
  brep: RetainedBrep | null;
  mesh: { positions: Float32Array; indices: Uint32Array } | null;
}

export class CadKernel {
  private models = new Map<string, Loaded>();

  constructor(private readonly occtDir?: string) {}

  /** Start loading the wasm early (takes several seconds). */
  warmUp(): Promise<unknown> {
    return loadOcct(this.occtDir);
  }

  async import(bytes: Uint8Array, fileName: string, opts: CadImportOptions = {}, onProgress: ProgressFn = () => {}, modelId: string = randomUUID()): Promise<CadModelData> {
    const t0 = Date.now();
    const format = detectFormat(fileName, bytes);
    const sha = sha256(bytes);
    const name = fileName.replace(/\.[^.]+$/, '');
    if (format === 'stl' || format === '3mf') return this.importMesh(bytes, fileName, name, sha, opts, onProgress, modelId, t0, format);

    const oc = await loadOcct(this.occtDir);
    const step = readStep(oc, bytes, (s) => onProgress(s, s === 'reading' ? 0.05 : 0.15));
    if (step.tree.length === 1 && step.parts.length === 1 && GENERIC_PRODUCT_NAME.test(step.tree[0]!.name)) {
      step.tree[0]!.name = name;
      step.parts[0]!.name = name;
    }
    const unitKey = step.declaredUnit.split(',')[0]!.trim().toLowerCase();
    const unitScale = STEP_UNITS[unitKey] ?? 1;
    const deflection = opts.deflectionMm ?? autoDeflection(oc, step.parts.map((p) => p.shape));
    const built = buildBrep(oc, step.parts, {
      deflectionMm: deflection,
      angularDeflectionRad: opts.angularDeflectionRad ?? 0.3,
      maxTriangles: MAX_DISPLAY_TRIANGLES,
      onProgress: (s, f) => onProgress(s, s === 'meshing' ? 0.15 + f * 0.25 : 0.4 + f * 0.5),
    });
    onProgress('features', 0.92);
    const features = analyzeFeatures(built.faces, built.edges);
    const warnings = [...step.warnings, ...built.warnings];
    if (built.mesh.triangleToFace.length > LARGE_MODEL_TRIANGLES) warnings.push(`Large model: ${built.mesh.triangleToFace.length} display triangles.`);
    const revision = geometryRevision(sha, unitScale);
    const data: CadModelData = {
      modelId,
      name: step.tree.length === 1 && step.tree[0]!.name && !GENERIC_PRODUCT_NAME.test(step.tree[0]!.name) ? step.tree[0]!.name : name,
      fileName,
      sourceType: 'step',
      declaredUnit: step.declaredUnit,
      unitScaleToMm: unitScale,
      unitsConfirmed: step.declaredUnit !== 'unspecified',
      exact: true,
      sha256: sha,
      byteLength: bytes.byteLength,
      kernelVersion: KERNEL_VERSION,
      geometryRevision: revision,
      deflectionMm: deflection,
      sourceToModel: scaleMatrix(unitScale),
      tree: step.tree,
      parts: built.parts,
      faces: built.faces,
      edges: built.edges,
      vertices: built.vertices,
      bounds: built.bounds,
      features,
      mesh: built.mesh,
      stats: {
        partCount: built.parts.length,
        solidCount: built.solidCount,
        shellCount: built.shellCount,
        faceCount: built.faces.length,
        edgeCount: built.edges.length,
        vertexCount: built.vertices.length,
        triangleCount: built.mesh.triangleToFace.length,
      },
      validation: built.validation,
      warnings,
      importMs: Date.now() - t0,
    };
    this.models.set(modelId, {
      tables: { modelId, geometryRevision: revision, exact: true, faces: built.faces, edges: built.edges, vertices: built.vertices },
      brep: built.retained,
      mesh: { positions: built.mesh.positions, indices: built.mesh.indices },
    });
    onProgress('done', 1);
    return data;
  }

  private importMesh(bytes: Uint8Array, fileName: string, name: string, sha: string, opts: CadImportOptions, onProgress: ProgressFn, modelId: string, t0: number, format: 'stl' | '3mf'): CadModelData {
    onProgress('reading', 0.1);
    const parsed =
      format === '3mf'
        ? parse3mf(bytes)
        : { meshes: [parseStl(bytes, name)], declaredUnit: 'unspecified' as const, unitScaleToMm: 1, unitsConfirmed: false, warnings: [] as string[] };
    const unitScale = opts.unit ? UNIT_TO_MM[opts.unit] : parsed.unitScaleToMm;
    const confirmed = !!opts.unit || parsed.unitsConfirmed;
    onProgress('analyzing', 0.4);
    const built = buildMeshModel(parsed.meshes, unitScale);
    applyFittedCylinders(built.faces, built.mesh.positions, built.mesh.indices);
    const box = built.parts.reduce(
      (b, p) => ({ min: b.min.map((v, i) => Math.min(v, p.bounds.min[i]!)) as Vec3, max: b.max.map((v, i) => Math.max(v, p.bounds.max[i]!)) as Vec3 }),
      { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 },
    );
    const size = sub(box.max, box.min);
    const revision = geometryRevision(sha, unitScale);
    const warnings = [...parsed.warnings, ...built.warnings];
    if (format === 'stl' && !opts.unit) warnings.push('STL files carry no units. Confirm the unit before measuring.');
    const data: CadModelData = {
      modelId,
      name: parsed.meshes[0]?.name || name,
      fileName,
      sourceType: format,
      declaredUnit: parsed.declaredUnit,
      unitScaleToMm: unitScale,
      unitsConfirmed: confirmed,
      exact: false,
      sha256: sha,
      byteLength: bytes.byteLength,
      kernelVersion: KERNEL_VERSION,
      geometryRevision: revision,
      deflectionMm: 0,
      sourceToModel: scaleMatrix(unitScale),
      tree: meshTree(built.parts.map((p) => p.name)),
      parts: built.parts,
      faces: built.faces,
      edges: built.edges,
      vertices: [],
      bounds: { aabb: box, size, center: scale(add(box.min, box.max), 0.5), diagonalMm: len(size), obb: null, volumeMm3: built.volumeMm3, areaMm2: built.areaMm2, quality: 'mesh-derived' },
      features: analyzeFeatures(built.faces, built.edges),
      mesh: built.mesh,
      stats: {
        partCount: built.parts.length,
        solidCount: built.closed ? built.parts.length : 0,
        shellCount: built.parts.length,
        faceCount: built.faces.length,
        edgeCount: built.edges.length,
        vertexCount: 0,
        triangleCount: built.mesh.triangleToFace.length,
      },
      validation: { valid: built.parts.every((p) => p.valid), messages: built.closed ? [] : ['Mesh is not watertight.'] },
      warnings,
      importMs: Date.now() - t0,
    };
    this.models.set(modelId, { tables: { modelId, geometryRevision: revision, exact: false, faces: built.faces, edges: built.edges, vertices: [] }, brep: null, mesh: { positions: built.mesh.positions, indices: built.mesh.indices } });
    onProgress('done', 1);
    return data;
  }

  measure(modelId: string, req: CadMeasureRequest): Promise<CadMeasurement> {
    const m = this.models.get(modelId);
    if (!m) throw new MeasureError('model is not loaded');
    return loadOcct(this.occtDir).then((oc) => runMeasure(m.tables, req, m.brep ? exactOps(oc, m.brep) : null));
  }

  async section(modelId: string, origin: Vec3, normal: Vec3): Promise<CadSection> {
    const m = this.models.get(modelId);
    if (!m) throw new MeasureError('model is not loaded');
    if (m.brep) {
      const oc = await loadOcct(this.occtDir);
      return sectionBrep(oc, m.brep, origin, normal);
    }
    if (!m.mesh) throw new MeasureError('model has no display mesh');
    return sectionMesh(m.mesh.positions, m.mesh.indices, origin, normal);
  }

  release(modelId: string): boolean {
    return this.models.delete(modelId);
  }

  loaded(): string[] {
    return [...this.models.keys()];
  }
}

function applyFittedCylinders(faces: CadModelData['faces'], positions: Float32Array, indices: Uint32Array): void {
  for (const f of faces) {
    if (f.kind !== 'mesh') continue;
    const fit = fitCylinder(sampleFace(positions, indices, f.triStart, f.triCount));
    if (!fit) continue;
    f.kind = 'cylinder';
    f.quality = 'fitted';
    f.cylinder = fit;
    f.signature = `fit|r${fit.radiusMm.toFixed(4)}|${fit.axisDirection.map((c) => c.toFixed(4)).join(',')}`;
  }
}

function meshTree(names: string[]): CadModelData['tree'] {
  const leaves = names.map((name, i) => ({ id: String(i), name, kind: 'part' as const, transform: [...IDENTITY], children: [], partIndex: i }));
  if (leaves.length <= 1) return leaves;
  return [{ id: 'root', name: 'Assembly', kind: 'assembly', transform: [...IDENTITY], children: leaves }];
}

function autoDeflection(oc: OC, shapes: OC[]): number {
  const box = new oc.Bnd_Box_1();
  for (const s of shapes) oc.BRepBndLib.Add(s, box, false);
  if (box.IsVoid()) return 0.05;
  const a = box.CornerMin();
  const b = box.CornerMax();
  const diag = Math.hypot(b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z());
  return Math.min(1, Math.max(0.005, diag * 4e-4));
}

function exactOps(oc: OC, brep: RetainedBrep): ExactOps {
  const shapeOf = (r: CadReference): OC => {
    if (r.kind === 'point' && r.point) return new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt_3(...r.point)).Vertex();
    const list = r.kind === 'face' ? brep.faces : r.kind === 'edge' ? brep.edges : r.kind === 'vertex' ? brep.vertices : r.kind === 'part' ? brep.parts : null;
    const s = list && r.index !== null ? list[r.index] : undefined;
    if (!s) throw new MeasureError(`unknown ${r.kind} reference`);
    return s;
  };
  const extrema = (a: OC, b: OC) => {
    const d = new oc.BRepExtrema_DistShapeShape_2(a, b, oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad, progress(oc));
    if (!d.IsDone() || d.NbSolution() < 1) throw new MeasureError('the kernel could not compute a minimum distance');
    const p = (q: OC): Vec3 => [q.X(), q.Y(), q.Z()];
    return { value: d.Value() as number, pa: p(d.PointOnShape1(1)), pb: p(d.PointOnShape2(1)) };
  };
  return {
    shortest: (a, b) => ({ ...extrema(shapeOf(a), shapeOf(b)), tolerance: EXTREMA_TOLERANCE_MM }),
    projectOnFace: (face, point) => {
      const f = brep.faces[face];
      if (!f) throw new MeasureError('unknown face');
      return extrema(new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt_3(...point)).Vertex(), f).pb;
    },
  };
}
