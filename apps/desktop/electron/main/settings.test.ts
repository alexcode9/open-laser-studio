import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsStore } from './settings';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ols-settings-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('SettingsStore safety flags', () => {
  it('starts in simulation-only mode without developer mode', () => {
    const s = new SettingsStore(dir).get();
    expect(s.simulationOnly).toBe(true);
    expect(s.developerMode).toBe(false);
  });

  it('refuses to leave simulation-only without developer mode', () => {
    const st = new SettingsStore(dir);
    expect(() => st.setSimulationOnly(false)).toThrow(/developer mode/);
    expect(st.get().simulationOnly).toBe(true);
    st.setDeveloperMode(true);
    expect(st.setSimulationOnly(false).simulationOnly).toBe(false);
    // turning developer mode off re-enables simulation-only
    expect(st.setDeveloperMode(false).simulationOnly).toBe(true);
  });

  it('never persists or restores the safety flags', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ simulationOnly: false, developerMode: true, theme: 'light', simSpeed: 5 }));
    const st = new SettingsStore(dir);
    expect(st.get()).toMatchObject({ simulationOnly: true, developerMode: false, theme: 'light', simSpeed: 5 });
    st.setDeveloperMode(true);
    st.setSimulationOnly(false);
    st.update({ theme: 'dark' });
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(saved).not.toHaveProperty('simulationOnly');
    expect(saved).not.toHaveProperty('developerMode');
    expect(new SettingsStore(dir).get().simulationOnly).toBe(true);
  });

  it('sanitizes a corrupt settings file', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'neon', simSpeed: 1e9, recentFiles: [1, 'a.ols'] }));
    expect(new SettingsStore(dir).get()).toMatchObject({ theme: 'dark', simSpeed: 1, recentFiles: ['a.ols'] });
  });
});
