import { type EventChannel, type InvokeChannel, isEventChannel, isInvokeChannel } from '@ols/ipc-contracts/channels';
import { contextBridge, ipcRenderer } from 'electron';

// Minimal, whitelisted bridge. No Node APIs and no raw ipcRenderer reach the renderer.
const api = {
  invoke(channel: InvokeChannel, input: unknown): Promise<unknown> {
    if (!isInvokeChannel(channel)) return Promise.reject(new Error(`channel not allowed: ${String(channel)}`));
    return ipcRenderer.invoke(channel, input);
  },
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void {
    if (!isEventChannel(channel)) throw new Error(`event not allowed: ${String(channel)}`);
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('ols', api);
