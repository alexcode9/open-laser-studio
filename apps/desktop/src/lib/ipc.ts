import type { EventChannel, EventPayloads, Input, InvokeChannel, OlsBridge, Output } from '@ols/ipc-contracts';

declare global {
  interface Window {
    ols?: OlsBridge;
  }
}

export class IpcCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpcCallError';
  }
}

function bridge(): OlsBridge {
  if (!window.ols) throw new IpcCallError('UNAVAILABLE', 'Desktop bridge not available (not running inside Electron).');
  return window.ols;
}

type Args<C extends InvokeChannel> = Input<C> extends void | undefined ? [] : [Input<C>];

/** Invoke a main-process channel; unwraps the envelope and throws `IpcCallError` on failure. */
export async function call<C extends InvokeChannel>(channel: C, ...args: Args<C>): Promise<Output<C>> {
  const env = await bridge().invoke(channel, args[0] as Input<C>);
  if (!env.ok) throw new IpcCallError(env.error.code, env.error.message);
  return env.value;
}

export function subscribe<E extends EventChannel>(channel: E, fn: (p: EventPayloads[E]) => void): () => void {
  if (!window.ols) return () => {};
  return window.ols.on(channel, fn);
}

export function errorMessage(e: unknown): string {
  if (e instanceof IpcCallError) return `${e.message} (${e.code})`;
  return e instanceof Error ? e.message : String(e);
}
