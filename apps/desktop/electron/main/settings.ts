import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppSettings } from '@ols/shared-types';

import { log } from './logger';

const DEFAULTS: AppSettings = {
  simulationOnly: true,
  developerMode: false,
  theme: 'dark',
  recentFiles: [],
  simSpeed: 1,
};

/**
 * Settings store. Hardware-related flags are deliberately NOT restored from disk: every launch
 * starts with `simulationOnly = true` and `developerMode = false`.
 */
export class SettingsStore {
  private value: AppSettings = { ...DEFAULTS };
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, 'settings.json');
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AppSettings>;
      this.value = {
        ...DEFAULTS,
        theme: raw.theme === 'light' ? 'light' : 'dark',
        recentFiles: Array.isArray(raw.recentFiles) ? raw.recentFiles.filter((f) => typeof f === 'string').slice(0, 10) : [],
        simSpeed: typeof raw.simSpeed === 'number' && raw.simSpeed > 0 && raw.simSpeed <= 50 ? raw.simSpeed : 1,
      };
    } catch {
      // First launch or unreadable file: defaults.
    }
  }

  get(): AppSettings {
    return { ...this.value, recentFiles: [...this.value.recentFiles] };
  }

  update(patch: Partial<Pick<AppSettings, 'theme' | 'simSpeed'>>): AppSettings {
    this.value = { ...this.value, ...patch };
    this.persist();
    return this.get();
  }

  setDeveloperMode(on: boolean): AppSettings {
    this.value.developerMode = on;
    if (!on) this.value.simulationOnly = true;
    log('warn', 'developer mode changed', { developerMode: on });
    return this.get();
  }

  setSimulationOnly(on: boolean): AppSettings {
    if (!on && !this.value.developerMode) {
      throw Object.assign(new Error('Leaving simulation-only mode requires developer mode'), { code: 'SAFETY' });
    }
    this.value.simulationOnly = on;
    log('warn', 'simulationOnly changed', { simulationOnly: on });
    return this.get();
  }

  addRecent(path: string): void {
    this.value.recentFiles = [path, ...this.value.recentFiles.filter((p) => p !== path)].slice(0, 10);
    this.persist();
  }

  private persist(): void {
    const { theme, recentFiles, simSpeed } = this.value;
    try {
      writeFileSync(this.file, JSON.stringify({ theme, recentFiles, simSpeed }, null, 2));
    } catch (e) {
      log('warn', 'could not persist settings', { error: String(e) });
    }
  }
}
