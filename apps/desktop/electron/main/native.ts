import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type {
  ImportedPath,
  JobLogEntry,
  MeshBuffers,
  NativeInfo,
  PathCmd,
  PlanResult,
  PrepareReport,
  Project,
  ProtocolLogEntry,
  SafetyTransition,
  SessionSnapshot,
  TimelineBuffers,
} from '@ols/shared-types';

/** Must equal `laser_core::NATIVE_API_VERSION`. */
export const EXPECTED_NATIVE_API_VERSION = 1;

export interface NativeSimSession {
  setProject(project: Project): void;
  connect(): void;
  disconnect(): void;
  home(): void;
  prepare(): PrepareReport;
  arm(userConfirmed: boolean): void;
  disarm(): void;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  emergencyStop(source: string): void;
  resetFault(userConfirmed: boolean): void;
  resetEstop(userConfirmed: boolean, hardwareReleased: boolean): void;
  inject(injection: unknown): void;
  tick(dtS: number): SessionSnapshot;
  snapshot(): SessionSnapshot;
  timeline(fromSample: number, fromEvent: number): TimelineBuffers;
  logSince(seq: number): ProtocolLogEntry[];
  jobLog(): JobLogEntry[];
  safetyHistory(): SafetyTransition[];
  programListing(): string[];
}

export interface NativeModule {
  nativeInfo(): NativeInfo;
  sampleProject(): Project;
  defaultMachineProfile(): unknown;
  normalizeProject(project: Project): Project;
  cylinderMesh(spec: unknown, toleranceMm: number, axialSegments: number): MeshBuffers;
  importSvg(svg: string): ImportedPath[];
  textToPath(text: string, fontSizeMm: number, fontFamily: string): PathCmd[];
  saveOls(project: Project, thumbnailPng: Buffer | null): Buffer;
  loadOls(data: Buffer): { project: Project; thumbnailPng: Buffer | null };
  analyzeGcode(text: string, dialect: string): unknown;
  planToolpath(project: Project, signal?: AbortSignal): Promise<PlanResult>;
  kinematicPreview(project: Project, sampleDt: number, signal?: AbortSignal): Promise<TimelineBuffers>;
  f1ProbeMachineInfo(opts: {
    host: string;
    tcpPort: number;
    httpPort: number;
    simulationOnly: boolean;
    developerMode: boolean;
  }): unknown;
  SimSession: new (project: Project, config?: unknown) => NativeSimSession;
}

function candidates(appPath: string, resourcesPath: string): string[] {
  return [
    process.env.OLS_NATIVE_PATH ?? '',
    join(resourcesPath, 'native', 'laser_node.node'),
    join(appPath, 'native', 'laser_node.node'),
    join(appPath, '..', 'native', 'laser_node.node'),
  ].filter((p) => p && existsSync(p));
}

/** Load the native core and verify the API handshake. Throws with a readable message. */
export function loadNative(appPath: string, resourcesPath: string): NativeModule {
  const found = candidates(appPath, resourcesPath);
  if (found.length === 0) {
    throw new Error('Native core not found. Run `pnpm build:native` to build crates/laser-node.');
  }
  const require = createRequire(import.meta.url);
  const mod = require(found[0]!) as NativeModule;
  const info = mod.nativeInfo();
  if (info.apiVersion !== EXPECTED_NATIVE_API_VERSION) {
    throw new Error(
      `Native core API version ${info.apiVersion} does not match the app (${EXPECTED_NATIVE_API_VERSION}). Rebuild with \`pnpm build:native\`.`,
    );
  }
  return mod;
}
