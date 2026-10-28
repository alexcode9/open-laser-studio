// Loader for the opencascade.js WebAssembly build (OCCT 7.6). The binding surface is huge and
// its generated typings (9 MB) are not loaded by tsc; all kernel access goes through `OC`.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OC = any;

export const KERNEL_VERSION = 'occt-7.6/opencascade.js-2.0.0-beta.b5ff984';

let instance: Promise<OC> | null = null;

/** Directory containing `opencascade.full.js` and `opencascade.full.wasm`. */
export function defaultOcctDir(): string {
  const req = createRequire(import.meta.url);
  return dirname(req.resolve('opencascade.js/dist/opencascade.full.js'));
}

/** Initialise the kernel once per process. `dir` overrides the dist location (packaged app). */
export function loadOcct(dir?: string): Promise<OC> {
  instance ??= (async () => {
    const d = dir ?? process.env.OLS_OCCT_DIR ?? defaultOcctDir();
    // The emscripten loader expects CommonJS globals when it detects Node.
    const g = globalThis as unknown as { __dirname?: string; require?: NodeJS.Require };
    const req = createRequire(join(d, 'opencascade.full.js'));
    g.__dirname ??= d;
    g.require ??= req;
    const wasmBinary = await readFile(join(d, 'opencascade.full.wasm'));
    // require(esm) (Node >= 22.12) bypasses bundler/test-runner rewriting of dynamic import().
    const mod = req(join(d, 'opencascade.full.js')) as { default: (m: object) => Promise<OC> };
    return mod.default({
      wasmBinary,
      print: () => {},
      printErr: () => {},
      locateFile: (p: string) => join(d, p),
    });
  })();
  return instance;
}

export const progress = (oc: OC): OC => new oc.Message_ProgressRange_1();

/** Read a file into the kernel's in-memory filesystem. Nothing touches the host disk. */
export function withVirtualFile<T>(oc: OC, name: string, bytes: Uint8Array, fn: (path: string) => T): T {
  const dir = '/ols-import';
  try {
    oc.FS.mkdir(dir);
  } catch {
    // exists
  }
  const path = `${dir}/${name}`;
  oc.FS.writeFile(path, bytes);
  try {
    return fn(path);
  } finally {
    try {
      oc.FS.unlink(path);
    } catch {
      // already removed
    }
  }
}

export function enumValue(e: unknown): number {
  return typeof e === 'object' && e !== null && 'value' in e ? Number((e as { value: unknown }).value) : Number(e);
}
