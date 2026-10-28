// CAD import, inspection and measurement types. Runtime payloads (CadModelData) are produced by
// packages/cad-kernel in the CAD utility process; persisted types (CadWorkspace and friends)
// mirror crates/laser-project/src/cad.rs.

export type Vec3 = [number, number, number];
/** 4x4 matrix, column-major (three.js `Matrix4.elements` layout), millimetres. */
export type Mat4 = number[];

/**
 * - analytical: read directly from an analytical B-Rep surface/curve (e.g. cylinder radius).
 * - computed: evaluated numerically by the kernel (curve integration, extrema, projection) with a stated tolerance.
 * - mesh-derived: computed from triangles.
 * - fitted: an ideal feature fitted to mesh/point samples, with a residual.
 */
export type MeasurementQuality = 'analytical' | 'computed' | 'mesh-derived' | 'fitted';
export type GeometrySourceType = 'step' | 'stl' | '3mf';
export type DisplayUnit = 'mm' | 'cm' | 'in';
/** Units a mesh file may be declared in during unit confirmation. */
export type SourceLengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'um';

export const UNIT_TO_MM: Record<SourceLengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, um: 0.001 };

export type SurfaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'bspline' | 'bezier' | 'revolution' | 'extrusion' | 'offset' | 'other' | 'mesh';
export type CurveKind = 'line' | 'circle' | 'ellipse' | 'hyperbola' | 'parabola' | 'bspline' | 'bezier' | 'offset' | 'other' | 'polyline';
export type TopologyKind = 'part' | 'solid' | 'shell' | 'face' | 'edge' | 'vertex' | 'mesh';

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface CadPlaneInfo {
  origin: Vec3;
  /** Outward normal (face orientation applied). */
  normal: Vec3;
}

export interface CadCylinderInfo {
  radiusMm: number;
  axisOrigin: Vec3;
  /** Unit direction of the analytical axis (surface parameterisation direction). */
  axisDirection: Vec3;
  /** Face extent along the axis, as distances from `axisOrigin` along `axisDirection`. */
  axialMinMm: number;
  axialMaxMm: number;
  /** Angular span of the face (rad). 2π for a full revolution. */
  angularSpanRad: number;
  /** true = material outside (bore/hole), false = boss/shaft, null = not reliably established. */
  inner: boolean | null;
  /** Fitted cylinders only: RMS radial residual of the samples (mm). */
  residualMm?: number;
}

export interface CadConeInfo {
  apex: Vec3;
  axisDirection: Vec3;
  semiAngleRad: number;
  refRadiusMm: number;
}

export interface CadSphereInfo {
  center: Vec3;
  radiusMm: number;
}

export interface CadTorusInfo {
  center: Vec3;
  axisDirection: Vec3;
  majorRadiusMm: number;
  minorRadiusMm: number;
}

export interface CadFaceInfo {
  index: number;
  partIndex: number;
  kind: SurfaceKind;
  quality: MeasurementQuality;
  areaMm2: number;
  centroid: Vec3;
  /** First triangle and triangle count in `CadMeshBuffers.indices` (faces are contiguous). */
  triStart: number;
  triCount: number;
  edgeIndices: number[];
  plane?: CadPlaneInfo;
  cylinder?: CadCylinderInfo;
  cone?: CadConeInfo;
  sphere?: CadSphereInfo;
  torus?: CadTorusInfo;
  /** Geometric fingerprint used to validate persisted references after a reimport. */
  signature: string;
}

export interface CadEdgeInfo {
  index: number;
  partIndex: number;
  kind: CurveKind;
  quality: MeasurementQuality;
  lengthMm: number;
  /** Numerical tolerance of `lengthMm` (0 for exact closed forms). */
  lengthToleranceMm: number;
  faceIndices: number[];
  vertexIndices: number[];
  /** Range in `CadMeshBuffers.edgeSegments` (segment = 2 points). */
  segStart: number;
  segCount: number;
  line?: { start: Vec3; end: Vec3; direction: Vec3 };
  circle?: { center: Vec3; normal: Vec3; radiusMm: number; angularSpanRad: number };
  signature: string;
}

export interface CadVertexInfo {
  index: number;
  partIndex: number;
  position: Vec3;
}

export interface CadPartNode {
  id: string;
  name: string;
  kind: 'assembly' | 'part';
  /** Transform relative to the parent node. */
  transform: Mat4;
  children: CadPartNode[];
  /** Set on leaves (part instances). */
  partIndex?: number;
}

export interface CadPartInfo {
  index: number;
  name: string;
  /** Path of node ids from the root, e.g. "0/1/0". */
  path: string;
  /** Instance transform from the part's own coordinates to model coordinates. */
  worldTransform: Mat4;
  solidCount: number;
  shellCount: number;
  faceStart: number;
  faceCount: number;
  edgeStart: number;
  edgeCount: number;
  vertexStart: number;
  vertexCount: number;
  bounds: Aabb;
  volumeMm3: number | null;
  areaMm2: number;
  valid: boolean;
}

export interface CadObb {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  halfSizes: Vec3;
}

export interface CadBoundsReport {
  /** Axis-aligned in model coordinates (normalised mm, assembly transforms applied). */
  aabb: Aabb;
  size: Vec3;
  center: Vec3;
  diagonalMm: number;
  /** Part-aligned (oriented) box when the kernel could establish one. */
  obb: CadObb | null;
  volumeMm3: number | null;
  areaMm2: number;
  quality: MeasurementQuality;
}

export interface CylinderFeature {
  id: string;
  partIndex: number;
  faceIndices: number[];
  radiusMm: number;
  diameterMm: number;
  axisOrigin: Vec3;
  axisDirection: Vec3;
  axialMinMm: number;
  axialMaxMm: number;
  lengthMm: number;
  areaMm2: number;
  /** Combined angular coverage of the grouped faces (rad, capped at 2π). */
  angularSpanRad: number;
  fullRevolution: boolean;
  inner: boolean | null;
  quality: MeasurementQuality;
  /** Fitted cylinders only: RMS radial residual (mm). */
  residualMm?: number;
}

export interface CircularFeature {
  id: string;
  kind: 'hole' | 'bore' | 'circular-edge';
  partIndex: number;
  faceIndices: number[];
  edgeIndices: number[];
  center: Vec3;
  axisDirection: Vec3;
  radiusMm: number;
  diameterMm: number;
  quality: MeasurementQuality;
  /** Holes only: both ends open onto planar faces. */
  through?: boolean;
  depthMm?: number;
}

export interface AxisCandidate {
  id: string;
  origin: Vec3;
  direction: Vec3;
  cylinderIds: string[];
  score: number;
  reason: string;
  quality: MeasurementQuality;
}

export interface CadFeatureReport {
  cylinders: CylinderFeature[];
  circles: CircularFeature[];
  planeFaceIndices: number[];
  axisCandidates: AxisCandidate[];
  /** Groups of coaxial, equal-radius cylinder features that the user may merge. */
  groupingSuggestions: { cylinderIds: string[]; reason: string }[];
}

export interface CadMeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleToFace: Uint32Array;
  /** Line segment endpoints (xyz pairs). */
  edgeSegments: Float32Array;
  segmentToEdge: Uint32Array;
  vertexPositions: Float32Array;
}

export interface CadModelStats {
  partCount: number;
  solidCount: number;
  shellCount: number;
  faceCount: number;
  edgeCount: number;
  vertexCount: number;
  triangleCount: number;
}

export interface CadModelData {
  modelId: string;
  name: string;
  fileName: string;
  sourceType: GeometrySourceType;
  /** Unit declared by the file ("millimetre", "INCH", ...) or "unspecified". */
  declaredUnit: string;
  unitScaleToMm: number;
  /** False until the user confirms units for files that do not declare them. */
  unitsConfirmed: boolean;
  /** True when exact B-Rep geometry is retained for queries. */
  exact: boolean;
  sha256: string;
  byteLength: number;
  kernelVersion: string;
  geometryRevision: string;
  deflectionMm: number;
  /** Source file coordinates -> normalised model coordinates (mm). */
  sourceToModel: Mat4;
  tree: CadPartNode[];
  parts: CadPartInfo[];
  faces: CadFaceInfo[];
  edges: CadEdgeInfo[];
  vertices: CadVertexInfo[];
  bounds: CadBoundsReport;
  features: CadFeatureReport;
  mesh: CadMeshBuffers;
  stats: CadModelStats;
  validation: { valid: boolean; messages: string[] };
  warnings: string[];
  importMs: number;
}

export interface CadImportOptions {
  /** Absolute chordal deflection for display tessellation (mm). */
  deflectionMm?: number;
  angularDeflectionRad?: number;
  /** Mesh formats: unit the user confirmed. */
  unit?: SourceLengthUnit;
}

export type CadImportStage = 'reading' | 'transferring' | 'meshing' | 'analyzing' | 'features' | 'done';

export interface CadProgress {
  requestId: string;
  stage: CadImportStage;
  fraction: number;
  message?: string;
}

// ---------------------------------------------------------------------------------------------
// References and measurements

export type CadRefKind = 'face' | 'edge' | 'vertex' | 'point' | 'part';

export interface CadReference {
  modelId: string;
  geometryRevision: string;
  kind: CadRefKind;
  /** Face/edge/vertex/part index within the model (valid only for `geometryRevision`). */
  index: number | null;
  /** Picked point in model coordinates (kind = point, or the pick location on a face). */
  point: Vec3 | null;
  /** Face/edge index the point was picked on (kind = point). */
  onFace: number | null;
  signature: string | null;
}

export type CadMeasurementKind = 'distance' | 'radius' | 'diameter' | 'angle' | 'length' | 'area' | 'plane-distance';

export interface CadMeasurement {
  id: string;
  kind: CadMeasurementKind;
  /** mm, mm² or degrees. */
  value: number;
  unit: 'mm' | 'mm2' | 'deg';
  quality: MeasurementQuality;
  references: CadReference[];
  tolerance: number | null;
  label: string;
  /** Model-space anchor points for the annotation (dimension line endpoints, label point). */
  anchors: Vec3[];
  /** Extra values (delta x/y/z, oriented angle, axis, fitting residual...). */
  details: Record<string, number | string | boolean | null>;
  persistent: boolean;
  /** Set when a referenced topology no longer matches the loaded geometry. */
  stale: boolean;
}

export type CadMeasureRequest =
  | { kind: 'distance'; a: CadReference; b: CadReference }
  | { kind: 'length'; a: CadReference }
  | { kind: 'radius'; a: CadReference }
  | { kind: 'angle'; a: CadReference; b: CadReference }
  | { kind: 'area'; refs: CadReference[] }
  | { kind: 'face-distance'; a: CadReference; b: CadReference };

export interface CadSection {
  origin: Vec3;
  normal: Vec3;
  /** Intersection polylines in model millimetres. */
  polylines: Vec3[][];
  lengthMm: number;
  quality: MeasurementQuality;
}

// ---------------------------------------------------------------------------------------------
// Persisted workspace (mirrors crates/laser-project/src/cad.rs)

export interface CadModelRef {
  id: string;
  name: string;
  fileName: string;
  sourceType: GeometrySourceType;
  declaredUnit: string;
  unitScaleToMm: number;
  unitsConfirmed: boolean;
  sha256: string;
  byteLength: number;
  /** Path inside the .ols archive (set on save). */
  assetPath: string;
  geometryRevision: string;
  kernelVersion: string;
  deflectionMm: number;
  sourceToModel: Mat4;
  /** Model -> workpiece (cylinder local frame). Identity until aligned. */
  modelToWorkpiece: Mat4;
  hiddenParts: number[];
}

export interface CadWorkpieceBinding {
  modelId: string;
  cylinderId: string;
  faces: CadReference[];
  diameterMm: number;
  axialMinMm: number;
  axialMaxMm: number;
  axisOrigin: Vec3;
  axisDirection: Vec3;
  seamAngleDeg: number;
  reversed: boolean;
  modelToWorkpiece: Mat4;
}

export interface CadWorkspace {
  models: CadModelRef[];
  measurements: CadMeasurement[];
  activeWorkpiece: CadWorkpieceBinding | null;
  displayUnit: DisplayUnit;
  displayPrecision: number;
}

export interface CadAlignParams {
  axisOrigin: Vec3;
  axisDirection: Vec3;
  axialMinMm: number;
  axialMaxMm: number;
  seamAngleDeg: number;
  reversed: boolean;
  /** Optional preferred seam reference direction (projected perpendicular to the axis). */
  seamReference?: Vec3 | null;
}

export interface CadAlignResult {
  modelToWorkpiece: Mat4;
  workpieceToModel: Mat4;
  lengthMm: number;
  /** Seam reference direction actually used (model coordinates, unit, perpendicular to axis). */
  seamDirection: Vec3;
}

export interface CadRestoreResult {
  modelId: string;
  status: 'ok' | 'changed' | 'missing';
  message: string | null;
  data: CadModelData | null;
}
