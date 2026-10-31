import type { DeviceSource, DiscoveredDevice } from '@ols/shared-types';
import { create } from 'zustand';

import { call, errorMessage } from '@/lib/ipc';

import { useProject } from './project';
import { useSettings } from './settings';
import { toast } from './view';

export type FinderTab = 'wifi' | 'usb' | 'manual';

/** USB Ethernet gadget addresses used by xTool (Linux / macOS). */
export const USB_GADGET_HOSTS = ['201.234.3.1', '201.234.4.1'] as const;

export function isUsbGadgetHost(host: string): boolean {
  return (USB_GADGET_HOSTS as readonly string[]).includes(host);
}

export function connectionLabel(host: string | undefined | null): string {
  if (!host || !host.trim()) return 'No device';
  if (isUsbGadgetHost(host)) return 'USB';
  return `Wi-Fi ${host}`;
}

interface DevicesState {
  open: boolean;
  tab: FinderTab;
  scanning: boolean;
  results: Record<FinderTab, DiscoveredDevice[]>;
  error: string | null;
  selected: DiscoveredDevice | null;
  manualHost: string;
  setOpen: (open: boolean) => void;
  setTab: (tab: FinderTab) => void;
  setManualHost: (host: string) => void;
  scan: (transport: 'wifi' | 'usb') => Promise<void>;
  identify: (host: string) => Promise<DiscoveredDevice | null>;
  select: (device: DiscoveredDevice) => void;
  clearError: () => void;
}

function gated(): boolean {
  const s = useSettings.getState().settings;
  return s.developerMode && !s.simulationOnly;
}

export const useDevices = create<DevicesState>((set, get) => ({
  open: false,
  tab: 'wifi',
  scanning: false,
  results: { wifi: [], usb: [], manual: [] },
  error: null,
  selected: null,
  manualHost: '',
  setOpen: (open) => set({ open, error: open ? get().error : null }),
  setTab: (tab) => set({ tab }),
  setManualHost: (manualHost) => set({ manualHost }),
  clearError: () => set({ error: null }),

  scan: async (transport) => {
    if (!gated()) {
      set({ error: 'Enable developer mode and turn off simulation-only in Setup to scan for real devices.' });
      return;
    }
    set({ scanning: true, error: null, tab: transport });
    try {
      const devices = await call('device:discover', { transport, timeoutMs: transport === 'usb' ? 1500 : 2000 });
      set((s) => ({
        results: { ...s.results, [transport]: devices },
        scanning: false,
      }));
      if (devices.length === 0) {
        toast('info', transport === 'usb' ? 'No USB gadget answered at 201.234.3.1 / 201.234.4.1.' : 'No devices answered the Wi-Fi discovery probe.');
      }
    } catch (e) {
      set({ scanning: false, error: errorMessage(e) });
    }
  },

  identify: async (host) => {
    const h = host.trim();
    if (!h) {
      set({ error: 'Enter a host IP address.' });
      return null;
    }
    if (!gated()) {
      set({ error: 'Enable developer mode and turn off simulation-only in Setup to identify a device.' });
      return null;
    }
    set({ scanning: true, error: null, tab: 'manual' });
    try {
      const device = await call('device:identify', { host: h });
      set((s) => ({
        results: { ...s.results, manual: [device] },
        scanning: false,
      }));
      return device;
    } catch (e) {
      set({ scanning: false, error: errorMessage(e), results: { ...get().results, manual: [] } });
      return null;
    }
  },

  select: (device) => {
    useProject.getState().setMachine(
      (m) => ({
        ...m,
        host: device.host,
        tcpPort: 8780,
        httpPort: 8080,
      }),
      'device',
    );
    set({ selected: device, open: false });
    const src: DeviceSource = device.source;
    const label = device.name || device.model || device.host;
    if (device.family === 'v2') {
      toast('info', `Selected ${label} (${src}). V2 firmware is not yet supported for jobs — they still run on the simulator.`);
    } else {
      toast('info', `Selected ${label} (${src}). Jobs still run on the simulator.`);
    }
  },
}));
