// Messages between the main process (CadHost) and the CAD kernel utility process.

import type { CadImportOptions, CadImportStage, CadMeasureRequest, Vec3 } from '@ols/shared-types';

export type KernelRequest =
  | { id: number; op: 'warmUp' }
  | { id: number; op: 'import'; bytes: Uint8Array; fileName: string; options: CadImportOptions; modelId: string }
  | { id: number; op: 'measure'; modelId: string; request: CadMeasureRequest }
  | { id: number; op: 'section'; modelId: string; origin: Vec3; normal: Vec3 }
  | { id: number; op: 'release'; modelId: string };

type Distribute<T> = T extends { op: infer O } ? { op: O } & Omit<T, 'id'> : never;
export type KernelCall = Distribute<KernelRequest>;

export type KernelReply =
  | { id: number; type: 'ready' }
  | { id: number; type: 'progress'; stage: CadImportStage; fraction: number }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; error: { code: string; message: string } };
