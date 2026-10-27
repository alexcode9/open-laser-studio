import type { AppInfo, AppSettings } from '@ols/shared-types';
import { create } from 'zustand';

import { call, errorMessage } from '@/lib/ipc';

import { toast } from './view';

interface SettingsState {
  info: AppInfo | null;
  settings: AppSettings;
  load: () => Promise<void>;
  requestDeveloperMode: (enable: boolean) => Promise<void>;
  setSimulationOnly: (on: boolean) => Promise<void>;
  setTheme: (t: 'dark' | 'light') => Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  info: null,
  settings: { simulationOnly: true, developerMode: false, theme: 'dark', recentFiles: [], simSpeed: 1 },
  load: async () => {
    const [info, settings] = await Promise.all([call('app:info'), call('settings:get')]);
    set({ info, settings });
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  },
  requestDeveloperMode: async (enable) => {
    try {
      set({ settings: await call('settings:requestDeveloperMode', { enable }) });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  },
  setSimulationOnly: async (simulationOnly) => {
    try {
      set({ settings: await call('settings:setSimulationOnly', { simulationOnly }) });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  },
  setTheme: async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    set({ settings: await call('settings:update', { theme }) });
  },
}));
