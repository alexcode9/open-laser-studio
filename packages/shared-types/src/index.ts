// TypeScript mirrors of the Rust serde types (camelCase). The Rust core is the source of
// truth; keep these in sync with crates/laser-*/src (see docs/architecture/OVERVIEW.md).

import type { CadWorkspace } from './cad';

export * from './cad';

export type WorkspaceMode = 'flat' | 'cylinder';
export type CylinderStrategy = 'indexed' | 'coupled';
export type LayerMode = 'line' | 'fill' | 'image';
export type DitherMode = 'threshold' | 'floydSteinberg' | 'grayscale';
export type LaserSource = 'blue' | 'ir';

export type PathCmd =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'Q'; x1: number; y1: number; x: number; y: number }
  | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: 'Z' };

export interface LaserSettings {
  mode: LayerMode;
  source: LaserSource;
  speedMmS: number;
  powerPct: number;
  passes: number;
  hatchSpacingMm: number;
  hatchAngleDeg: number;
  crosshatch: boolean;
  fillOutline: boolean;
  linesPerMm: number;
  dither: DitherMode;
  threshold: number;
  invert: boolean;
  bidirectional: boolean;
  overscanMm: number;
}

export interface Layer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  output: boolean;
  settings: LaserSettings;
}

export interface Transform2 {
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

export type Shape =
  | { kind: 'rect'; width: number; height: number }
  | { kind: 'ellipse'; rx: number; ry: number }
  | { kind: 'line'; points: number[]; closed: boolean }
  | { kind: 'path'; commands: PathCmd[] }
  | { kind: 'text'; text: string; fontSizeMm: number; fontFamily: string; outline?: PathCmd[] | null }
  | { kind: 'image'; widthMm: number; heightMm: number; assetId: string };

export type ShapeKind = Shape['kind'];

export interface DesignObject {
  id: string;
  name: string;
  layerId: string;
  visible: boolean;
  locked: boolean;
  groupId?: string | null;
  transform: Transform2;
  shape: Shape;
}

export interface Document {
  layers: Layer[];
  objects: DesignObject[];
}

export interface CylinderSpec {
  diameterMm: number;
  lengthMm: number;
  angularZeroDeg: number;
  axialZeroMm: number;
  rotationSign: number;
}

export interface CylinderJobSettings {
  strategy: CylinderStrategy;
  sectionWidthMm: number;
  maxFocusErrorMm: number;
  sectionOverlapMm: number;
  angularWindowMm: number;
  helicalPitchMm: number;
}

export interface GalvoConfig {
  fieldWidthMm: number;
  fieldHeightMm: number;
  centerXMm: number;
  centerYMm: number;
  invertX: boolean;
  invertY: boolean;
  rotationDeg: number;
  maxMarkSpeedMmS: number;
  maxTravelSpeedMmS: number;
}

export interface RotaryAxisConfig {
  enabled: boolean;
  motorStepsPerRev: number;
  microsteps: number;
  gearRatio: number;
  directionInverted: boolean;
  homeOffsetDeg: number;
  maxVelocityDegS: number;
  maxAccelDegS2: number;
  backlashDeg: number;
  encoderCountsPerRev: number | null;
  indexInput: boolean;
}

export interface LinearAxisConfig {
  enabled: boolean;
  motorStepsPerRev: number;
  microsteps: number;
  leadscrewPitchMm: number;
  gearRatio: number;
  directionInverted: boolean;
  homeOffsetMm: number;
  travelMinMm: number;
  travelMaxMm: number;
  maxVelocityMmS: number;
  maxAccelMmS2: number;
  backlashMm: number;
  limitSwitchActiveLow: boolean;
  encoderCountsPerMm: number | null;
}

export interface MachineProfile {
  schemaVersion: number;
  id: string;
  name: string;
  deviceKind: string;
  host: string;
  tcpPort: number;
  httpPort: number;
  galvo: GalvoConfig;
  rotary: RotaryAxisConfig;
  linear: LinearAxisConfig;
  externalSettleS: number;
  limitsValidated: boolean;
  notes: string;
}

export interface Project {
  schemaVersion: number;
  name: string;
  mode: WorkspaceMode;
  document: Document;
  workpiece: CylinderSpec;
  cylinder: CylinderJobSettings;
  machine: MachineProfile;
  assets: Record<string, string>;
  /** Imported CAD models, measurements and the CAD-derived workpiece binding. */
  cad?: CadWorkspace | null;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MachinePosition {
  gxMm: number;
  gyMm: number;
  aDeg: number;
  uMm: number;
}

export interface Section {
  index: number;
  uCenterMm: number;
  sCenterMm: number;
  aDeg: number;
  machineUMm: number;
  surfaceBounds: Bounds;
  firstSegment: number;
  segmentCount: number;
  maxFocusErrorMm: number;
}

export interface ToolpathStats {
  segmentCount: number;
  markLengthMm: number;
  travelLengthMm: number;
  estimatedTimeS: number;
  sectionCount: number;
  galvoBounds: Bounds | null;
  aRangeDeg: [number, number] | null;
  uRangeMm: [number, number] | null;
}

export interface ToolpathSummary {
  mode: WorkspaceMode;
  strategy: CylinderStrategy | null;
  stats: ToolpathStats;
  sections: Section[];
  warnings: string[];
  errors: string[];
  simulationOnly: boolean;
  executable: boolean;
}

export interface PlanResult {
  summary: ToolpathSummary;
  markPositions: Float32Array;
  travelPositions: Float32Array;
  markVertexOffsets: Uint32Array;
  /** `[x0, y0, x1, y1, kind]` per segment; kind 0 travel, 1 mark, 2 barrier. */
  segments2d: Float32Array;
  gcodeListing: string[];
  gcodePrograms: string[][];
  gcodeSupported: boolean;
}

export interface TimelineEvent {
  tS: number;
  kind: string;
  message: string;
}

export interface TimelineBuffers {
  t: Float64Array;
  gx: Float64Array;
  gy: Float64Array;
  a: Float64Array;
  u: Float64Array;
  laser: Float64Array;
  power: Float64Array;
  state: Float64Array;
  section: Float64Array;
  segment: Float64Array;
  rotX: Float64Array;
  tx: Float64Array;
  spotX: Float64Array;
  spotY: Float64Array;
  spotZ: Float64Array;
  events: TimelineEvent[];
  durationS: number;
}

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  radialSegments: number;
  axialSegments: number;
}

export type SafetyState =
  | 'DISCONNECTED'
  | 'CONNECTED'
  | 'IDLE'
  | 'PREPARING'
  | 'READY'
  | 'ARMED'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'FAULT'
  | 'ESTOP';

/** Numeric codes used in timeline `state` columns (laser-simulator `state_code`). */
export const SAFETY_STATE_CODES: SafetyState[] = [
  'DISCONNECTED',
  'CONNECTED',
  'IDLE',
  'PREPARING',
  'READY',
  'ARMED',
  'RUNNING',
  'PAUSED',
  'STOPPING',
  'FAULT',
  'ESTOP',
];

export type ControllerState = 'DISABLED' | 'IDLE' | 'MOVING' | 'HOMING' | 'FAULT' | 'ESTOP';

export interface ControllerStatus {
  state: ControllerState;
  aDeg: number;
  uMm: number;
  homed: boolean;
  enabled: boolean;
}

export type JobStep =
  | 'moveExternal'
  | 'waitExternal'
  | 'verifyExternal'
  | 'settle'
  | 'executeF1'
  | 'waitF1'
  | 'advance'
  | 'done';

export interface JobProgress {
  unit: number;
  unitCount: number;
  step: JobStep;
  progress: number;
  elapsedS: number;
  estimatedS: number;
  paused: boolean;
  pauseRequested: boolean;
}

export type JobOutcome =
  | { type: 'completed'; durationS: number }
  | { type: 'failed'; reason: string }
  | { type: 'stopped' }
  | { type: 'emergencyStopped' };

export interface SessionSnapshot {
  tS: number;
  safetyState: SafetyState;
  lastFault: string | null;
  armed: boolean;
  laserPermitted: boolean;
  laserOn: boolean;
  powerPct: number;
  position: MachinePosition;
  f1Connected: boolean;
  axesConnected: boolean;
  axisStatus: ControllerStatus | null;
  homing: boolean;
  prepared: boolean;
  job: JobProgress | null;
  outcome: JobOutcome | null;
  timelineSamples: number;
  timelineEvents: number;
  simulated: boolean;
}

export interface PrepareReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  units: number;
  estimatedS: number;
}

export type LogDirection = 'tx' | 'rx' | 'info' | 'error' | 'blocked';

export interface ProtocolLogEntry {
  seq: number;
  tS: number;
  channel: string;
  direction: LogDirection;
  text: string;
}

export interface JobLogEntry {
  tS: number;
  unit: number;
  step: JobStep;
  message: string;
}

export interface SafetyTransition {
  from: SafetyState;
  to: SafetyState;
  event: string;
  detail: string | null;
  tS: number;
}

export type InjectionKind =
  | { type: 'f1Disconnect' }
  | { type: 'f1Reconnect' }
  | { type: 'axisDisconnect' }
  | { type: 'axisReconnect' }
  | { type: 'axisFault'; code: string }
  | { type: 'axisDropNextCompletion' }
  | { type: 'axisDelay'; seconds: number }
  | { type: 'axisLimitHit' }
  | { type: 'axisPositionError'; aDeg: number; uMm: number }
  | { type: 'estopButton' };

export interface Injection {
  atS: number | null;
  kind: InjectionKind;
}

export interface ImportedPath {
  id: string;
  commands: PathCmd[];
  strokeColor: string | null;
  fillColor: string | null;
}

export interface GcodeDiagnostic {
  lineNo: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface AppSettings {
  /** When true (default) nothing is ever written to real hardware. */
  simulationOnly: boolean;
  /** Explicit opt-in for real-device access; toggled only through a main-process dialog. */
  developerMode: boolean;
  theme: 'dark' | 'light';
  recentFiles: string[];
  simSpeed: number;
}

/** Inferred from firmware version / open ports. V2 write path is not implemented. */
export type FirmwareFamily = 'v1' | 'v2' | 'unknown';

export type DeviceSource = 'usb' | 'wifi' | 'manual';

export interface DevicePortProbe {
  http8080: boolean;
  tcp8780: boolean;
  tls28900: boolean;
}

/** Result of a read-only LAN/USB discovery or identify pass. */
export interface DiscoveredDevice {
  host: string;
  name: string | null;
  model: string | null;
  serial: string | null;
  source: DeviceSource;
  family: FirmwareFamily;
  firmware: string | null;
  ports: DevicePortProbe;
  machineInfo: unknown;
  raw: unknown;
}

export interface NativeInfo {
  apiVersion: number;
  version: string;
  target: string;
}

export interface AppInfo {
  version: string;
  native: NativeInfo | null;
  nativeError: string | null;
  platform: string;
}
