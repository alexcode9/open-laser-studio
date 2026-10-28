// CAD kernel utility process (Electron utilityProcess). Untrusted CAD files are parsed here,
// isolated from the main process: a crash, hang or memory blow-up only takes this process down.
// The file bytes arrive over the message port; nothing is read from or written to disk, and
// STEP external references are never followed.

import { CadKernel } from '@ols/cad-kernel';

import type { KernelReply, KernelRequest } from './protocol';

const port = process.parentPort;
const kernel = new CadKernel(process.env.OLS_OCCT_DIR || undefined);

const send = (m: KernelReply): void => port.postMessage(m);

function errorOf(e: unknown): { code: string; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  const code = typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : 'KERNEL';
  return { code, message };
}

async function run(req: KernelRequest): Promise<unknown> {
  switch (req.op) {
    case 'warmUp':
      await kernel.warmUp();
      return true;
    case 'import':
      return kernel.import(req.bytes, req.fileName, req.options, (stage, fraction) => send({ id: req.id, type: 'progress', stage, fraction }), req.modelId);
    case 'measure':
      return kernel.measure(req.modelId, req.request);
    case 'section':
      return kernel.section(req.modelId, req.origin, req.normal);
    case 'release':
      return kernel.release(req.modelId);
  }
}

port.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as KernelRequest;
  run(req).then(
    (value) => send({ id: req.id, type: 'result', value }),
    (err: unknown) => send({ id: req.id, type: 'error', error: errorOf(err) }),
  );
});

send({ id: 0, type: 'ready' });
