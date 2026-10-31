import type {
  AppInfo,
  AppSettings,
  CadAlignResult,
  DiscoveredDevice,
  CadMeasurement,
  CadModelData,
  CadProgress,
  CadRestoreResult,
  CadSection,
  GcodeDiagnostic,
  ImportedPath,
  JobLogEntry,
  MeshBuffers,
  PathCmd,
  PlanResult,
  PrepareReport,
  Project,
  ProtocolLogEntry,
  SafetyTransition,
  SessionSnapshot,
  TimelineBuffers,
} from '@ols/shared-types';
import type { z } from 'zod';

import type { EventChannel, InvokeChannel } from './channels';
import type { InputSchemas } from './schemas';

export * from './channels';
export * from './schemas';

export interface GcodeAnalysis {
  analysis: {
    lines: number;
    motionBlocks: number;
    markDistanceMm: number;
    travelDistanceMm: number;
    estimatedTimeS: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    errors: number;
    warnings: number;
    unknownLines: number[];
  };
  diagnostics: GcodeDiagnostic[];
}

export interface MachineCommandResult {
  snapshot: SessionSnapshot;
  report: PrepareReport | null;
}

export interface Outputs {
  'app:info': AppInfo;
  'settings:get': AppSettings;
  'settings:update': AppSettings;
  'settings:requestDeveloperMode': AppSettings;
  'settings:setSimulationOnly': AppSettings;
  'project:sample': Project;
  'project:normalize': Project;
  /** `warnings`: recoverable problems found while loading (e.g. a CAD file failing its checksum). */
  'project:open': { project: Project; path: string; warnings: string[] } | null;
  'project:save': { path: string } | null;
  'import:svg': { name: string; paths: ImportedPath[] } | null;
  'import:image': { name: string; dataUrl: string } | null;
  'text:toPath': PathCmd[];
  'geometry:cylinderMesh': MeshBuffers;
  'toolpath:plan': PlanResult;
  'toolpath:preview': TimelineBuffers;
  'gcode:analyze': GcodeAnalysis;
  'gcode:export': { path: string } | null;
  'machine:create': SessionSnapshot;
  'machine:setProject': SessionSnapshot;
  'machine:command': MachineCommandResult;
  'machine:inject': SessionSnapshot;
  'machine:timeline': TimelineBuffers;
  'machine:log': ProtocolLogEntry[];
  'machine:jobLog': JobLogEntry[];
  'machine:safetyHistory': SafetyTransition[];
  'machine:programListing': string[];
  'machine:setSpeed': { speed: number };
  'device:discover': DiscoveredDevice[];
  'device:identify': DiscoveredDevice;
  'cad:importDialog': CadModelData | null;
  'cad:importBytes': CadModelData;
  'cad:cancel': { cancelled: boolean };
  'cad:confirmUnits': CadModelData;
  'cad:measure': CadMeasurement;
  'cad:release': { released: boolean };
  'cad:restore': CadRestoreResult;
  'cad:alignToRotary': CadAlignResult;
  'cad:section': CadSection;
  'cad:exportReport': { path: string } | null;
}

/**
 * Channels carrying a whole project are typed with the shared `Project` interface on the
 * renderer side; the zod schema still validates them at runtime in main.
 */
interface ProjectInputs {
  'project:normalize': Project;
  'project:save': { project: Project; path: string | null; saveAs: boolean; thumbnailPng: Uint8Array | null };
  'toolpath:plan': { project: Project };
  'toolpath:preview': { project: Project; sampleDt: number };
  'machine:create': { project: Project };
  'machine:setProject': { project: Project };
}

export type Input<C extends InvokeChannel> = C extends keyof ProjectInputs ? ProjectInputs[C] : z.input<(typeof InputSchemas)[C]>;
export type Output<C extends InvokeChannel> = Outputs[C];

export interface EventPayloads {
  'machine:snapshot': SessionSnapshot;
  'app:log': { level: 'info' | 'warn' | 'error'; message: string; tS: number };
  'cad:progress': CadProgress;
}

export interface IpcError {
  code: string;
  message: string;
}

/** Every invoke handler returns this envelope (Electron mangles thrown error messages). */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: IpcError };

/** API exposed on `window.ols` by the preload script. */
export interface OlsBridge {
  invoke<C extends InvokeChannel>(channel: C, input: Input<C>): Promise<Envelope<Output<C>>>;
  on<E extends EventChannel>(channel: E, listener: (payload: EventPayloads[E]) => void): () => void;
}

/** Parse "[CODE] message" errors produced by the native module. */
export function parseNativeError(message: string): IpcError {
  const m = /\[([A-Z_]+)\]\s*(.*)$/s.exec(message);
  if (m?.[1]) return { code: m[1], message: m[2] ?? message };
  return { code: 'INTERNAL', message };
}
