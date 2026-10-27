// zod schemas for every renderer -> main payload. The main process validates all input with
// these before touching the native core; renderer input is never trusted.

import { z } from 'zod';

const finite = z.number().finite();
const nonNeg = finite.nonnegative();
const id = z.string().min(1).max(200);

export const PathCmdSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('M'), x: finite, y: finite }),
  z.object({ t: z.literal('L'), x: finite, y: finite }),
  z.object({ t: z.literal('Q'), x1: finite, y1: finite, x: finite, y: finite }),
  z.object({ t: z.literal('C'), x1: finite, y1: finite, x2: finite, y2: finite, x: finite, y: finite }),
  z.object({ t: z.literal('Z') }),
]);

export const LaserSettingsSchema = z.object({
  mode: z.enum(['line', 'fill', 'image']),
  source: z.enum(['blue', 'ir']),
  speedMmS: finite.positive().max(100000),
  powerPct: finite.min(0).max(100),
  passes: z.number().int().min(1).max(100),
  hatchSpacingMm: finite.positive().max(100),
  hatchAngleDeg: finite,
  crosshatch: z.boolean(),
  fillOutline: z.boolean(),
  linesPerMm: finite.positive().max(100),
  dither: z.enum(['threshold', 'floydSteinberg', 'grayscale']),
  threshold: z.number().int().min(0).max(255),
  invert: z.boolean(),
  bidirectional: z.boolean(),
  overscanMm: nonNeg.max(50),
});

export const LayerSchema = z.object({
  id,
  name: z.string().max(200),
  color: z.string().max(32),
  visible: z.boolean(),
  locked: z.boolean(),
  output: z.boolean(),
  settings: LaserSettingsSchema,
});

export const TransformSchema = z.object({
  x: finite,
  y: finite,
  rotationDeg: finite,
  scaleX: finite,
  scaleY: finite,
});

export const ShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rect'), width: nonNeg, height: nonNeg }),
  z.object({ kind: z.literal('ellipse'), rx: nonNeg, ry: nonNeg }),
  z.object({ kind: z.literal('line'), points: z.array(finite).max(2_000_000), closed: z.boolean() }),
  z.object({ kind: z.literal('path'), commands: z.array(PathCmdSchema).max(2_000_000) }),
  z.object({
    kind: z.literal('text'),
    text: z.string().max(10_000),
    fontSizeMm: finite.positive().max(1000),
    fontFamily: z.string().max(200),
    outline: z.array(PathCmdSchema).nullish(),
  }),
  z.object({ kind: z.literal('image'), widthMm: finite.positive(), heightMm: finite.positive(), assetId: id }),
]);

export const DesignObjectSchema = z.object({
  id,
  name: z.string().max(200),
  layerId: id,
  visible: z.boolean(),
  locked: z.boolean(),
  groupId: z.string().max(200).nullish(),
  transform: TransformSchema,
  shape: ShapeSchema,
});

export const CylinderSpecSchema = z.object({
  diameterMm: finite.positive().max(1000),
  lengthMm: finite.positive().max(5000),
  angularZeroDeg: finite,
  axialZeroMm: finite,
  rotationSign: z.union([z.literal(1), z.literal(-1)]),
});

export const CylinderJobSettingsSchema = z.object({
  strategy: z.enum(['indexed', 'coupled']),
  sectionWidthMm: finite.positive(),
  maxFocusErrorMm: finite.positive(),
  sectionOverlapMm: nonNeg,
  angularWindowMm: nonNeg,
  helicalPitchMm: finite.positive(),
});

/** Machine profile is validated structurally here and semantically in Rust. */
export const MachineProfileSchema = z
  .object({
    schemaVersion: z.number().int(),
    id: z.string().max(200),
    name: z.string().max(200),
    host: z.string().max(255),
    tcpPort: z.number().int().min(1).max(65535),
    httpPort: z.number().int().min(1).max(65535),
    galvo: z.record(z.string(), z.unknown()),
    rotary: z.record(z.string(), z.unknown()),
    linear: z.record(z.string(), z.unknown()),
    externalSettleS: nonNeg.max(60),
    limitsValidated: z.boolean(),
  })
  .loose();

export const ProjectSchema = z.object({
  schemaVersion: z.number().int().min(0),
  name: z.string().max(500),
  mode: z.enum(['flat', 'cylinder']),
  document: z.object({ layers: z.array(LayerSchema).min(1).max(256), objects: z.array(DesignObjectSchema).max(100_000) }),
  workpiece: CylinderSpecSchema,
  cylinder: CylinderJobSettingsSchema,
  machine: MachineProfileSchema,
  assets: z.record(z.string(), z.string().startsWith('data:image/')),
});

export const InjectionSchema = z.object({
  atS: finite.nullable(),
  kind: z.discriminatedUnion('type', [
    z.object({ type: z.literal('f1Disconnect') }),
    z.object({ type: z.literal('f1Reconnect') }),
    z.object({ type: z.literal('axisDisconnect') }),
    z.object({ type: z.literal('axisReconnect') }),
    z.object({ type: z.literal('axisFault'), code: z.string().regex(/^[A-Z_]{1,32}$/) }),
    z.object({ type: z.literal('axisDropNextCompletion') }),
    z.object({ type: z.literal('axisDelay'), seconds: nonNeg.max(60) }),
    z.object({ type: z.literal('axisLimitHit') }),
    z.object({ type: z.literal('axisPositionError'), aDeg: finite, uMm: finite }),
    z.object({ type: z.literal('estopButton') }),
  ]),
});

export const MachineCommandSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('connect') }),
  z.object({ cmd: z.literal('disconnect') }),
  z.object({ cmd: z.literal('home') }),
  z.object({ cmd: z.literal('prepare') }),
  z.object({ cmd: z.literal('arm'), confirmed: z.boolean() }),
  z.object({ cmd: z.literal('disarm') }),
  z.object({ cmd: z.literal('start') }),
  z.object({ cmd: z.literal('pause') }),
  z.object({ cmd: z.literal('resume') }),
  z.object({ cmd: z.literal('stop') }),
  z.object({ cmd: z.literal('estop') }),
  z.object({ cmd: z.literal('resetFault'), confirmed: z.boolean() }),
  z.object({ cmd: z.literal('resetEstop'), confirmed: z.boolean(), hardwareReleased: z.boolean() }),
]);

export const InputSchemas = {
  'app:info': z.void(),
  'settings:get': z.void(),
  'settings:update': z.object({ theme: z.enum(['dark', 'light']).optional(), simSpeed: finite.min(0.1).max(50).optional() }),
  'settings:requestDeveloperMode': z.object({ enable: z.boolean() }),
  'settings:setSimulationOnly': z.object({ simulationOnly: z.boolean() }),
  'project:sample': z.void(),
  'project:normalize': ProjectSchema,
  'project:open': z.void(),
  'project:save': z.object({
    project: ProjectSchema,
    path: z.string().max(4096).nullable(),
    saveAs: z.boolean(),
    thumbnailPng: z.instanceof(Uint8Array).nullable(),
  }),
  'import:svg': z.void(),
  'import:image': z.void(),
  'text:toPath': z.object({ text: z.string().max(10_000), fontSizeMm: finite.positive().max(1000), fontFamily: z.string().max(200) }),
  'geometry:cylinderMesh': z.object({
    spec: CylinderSpecSchema,
    toleranceMm: finite.positive().max(10),
    axialSegments: z.number().int().min(1).max(512),
  }),
  'toolpath:plan': z.object({ project: ProjectSchema }),
  'toolpath:preview': z.object({ project: ProjectSchema, sampleDt: finite.min(0.001).max(1) }),
  'gcode:analyze': z.object({ text: z.string().max(50_000_000), dialect: z.enum(['xtool-f1', 'generic']) }),
  'gcode:export': z.object({ lines: z.array(z.string().max(1000)).max(5_000_000), suggestedName: z.string().max(200) }),
  'machine:create': z.object({ project: ProjectSchema }),
  'machine:setProject': z.object({ project: ProjectSchema }),
  'machine:command': MachineCommandSchema,
  'machine:inject': InjectionSchema,
  'machine:timeline': z.object({ fromSample: z.number().int().min(0), fromEvent: z.number().int().min(0) }),
  'machine:log': z.object({ sinceSeq: z.number().int().min(0) }),
  'machine:jobLog': z.void(),
  'machine:safetyHistory': z.void(),
  'machine:programListing': z.void(),
  'machine:setSpeed': z.object({ speed: finite.min(0).max(50) }),
  'device:probeF1': z.void(),
} as const;

export type MachineCommand = z.infer<typeof MachineCommandSchema>;
