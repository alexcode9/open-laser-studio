import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { app, utilityProcess } from 'electron';

import type { KernelReply, KernelRequest } from '../cad/protocol';
import type { KernelChild, SpawnKernel } from './cad';

/** Directory with `opencascade.full.js` / `.wasm`: extraResources when packaged, the workspace package in dev. */
export function resolveOcctDir(): string {
  if (process.env.OLS_OCCT_DIR) return process.env.OLS_OCCT_DIR;
  if (app.isPackaged) return join(process.resourcesPath, 'occt', 'dist');
  const kernelEntry = createRequire(import.meta.url).resolve('@ols/cad-kernel');
  return dirname(createRequire(kernelEntry).resolve('opencascade.js/dist/opencascade.full.js'));
}

export function utilityKernel(entry: string, occtDir: string, log: (msg: string, data?: Record<string, unknown>) => void): SpawnKernel {
  return (): KernelChild => {
    const p = utilityProcess.fork(entry, [], {
      serviceName: 'Open Laser Studio CAD kernel',
      stdio: 'pipe',
      // OCCT runs in wasm32 (max 4 GB linear memory); the JS heap only holds result buffers.
      execArgv: ['--max-old-space-size=4096'],
      env: { ...process.env, OLS_OCCT_DIR: occtDir },
    });
    p.stderr?.on('data', (b: Buffer) => log('cad kernel stderr', { text: b.toString('utf8').slice(0, 2000) }));
    return {
      postMessage: (m: KernelRequest) => p.postMessage(m),
      onMessage: (fn) => p.on('message', (m: KernelReply) => fn(m)),
      onExit: (fn) => p.on('exit', fn),
      kill: () => {
        p.kill();
      },
    };
  };
}
