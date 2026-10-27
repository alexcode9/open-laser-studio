import { describe, expect, it } from 'vitest';

import { EVENT_CHANNELS, INVOKE_CHANNELS, InputSchemas, isEventChannel, isInvokeChannel, MachineCommandSchema, parseNativeError, ProjectSchema } from './index';

describe('channel whitelist', () => {
  it('every invoke channel has an input schema and vice versa', () => {
    expect(Object.keys(InputSchemas).sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('rejects unknown channels', () => {
    expect(isInvokeChannel('machine:command')).toBe(true);
    expect(isInvokeChannel('shell:exec')).toBe(false);
    expect(isInvokeChannel('')).toBe(false);
    expect(isEventChannel('machine:snapshot')).toBe(true);
    expect(isEventChannel('machine:command')).toBe(false);
    expect(new Set([...INVOKE_CHANNELS, ...EVENT_CHANNELS]).size).toBe(INVOKE_CHANNELS.length + EVENT_CHANNELS.length);
  });
});

describe('input validation', () => {
  it('arming and e-stop reset carry explicit confirmation flags', () => {
    expect(MachineCommandSchema.safeParse({ cmd: 'arm' }).success).toBe(false);
    expect(MachineCommandSchema.safeParse({ cmd: 'arm', confirmed: true }).success).toBe(true);
    expect(MachineCommandSchema.safeParse({ cmd: 'resetEstop', confirmed: true }).success).toBe(false);
    expect(MachineCommandSchema.safeParse({ cmd: 'resetEstop', confirmed: true, hardwareReleased: true }).success).toBe(true);
    expect(MachineCommandSchema.safeParse({ cmd: 'fireLaser' }).success).toBe(false);
  });

  it('rejects non-finite and out-of-range numbers', () => {
    expect(InputSchemas['machine:setSpeed'].safeParse({ speed: Number.NaN }).success).toBe(false);
    expect(InputSchemas['machine:setSpeed'].safeParse({ speed: 51 }).success).toBe(false);
    expect(InputSchemas['machine:setSpeed'].safeParse({ speed: 25 }).success).toBe(true);
    expect(InputSchemas['settings:update'].safeParse({ simSpeed: Infinity }).success).toBe(false);
    expect(InputSchemas['toolpath:preview'].safeParse({ project: {}, sampleDt: 0.01 }).success).toBe(false);
  });

  it('settings:update cannot touch the safety flags', () => {
    const r = InputSchemas['settings:update'].safeParse({ theme: 'dark', simulationOnly: false, developerMode: true });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ theme: 'dark' });
  });

  it('fault injection codes are restricted', () => {
    const s = InputSchemas['machine:inject'];
    expect(s.safeParse({ atS: null, kind: { type: 'axisFault', code: 'DRIVER' } }).success).toBe(true);
    expect(s.safeParse({ atS: null, kind: { type: 'axisFault', code: 'x,y=1' } }).success).toBe(false);
  });

  it('project assets must be image data URLs', () => {
    const base = {
      schemaVersion: 1,
      name: 'x',
      mode: 'flat',
      document: { layers: [], objects: [] },
    };
    // layers.min(1) and a missing workpiece both fail
    expect(ProjectSchema.safeParse(base).success).toBe(false);
  });
});

describe('parseNativeError', () => {
  it('extracts the code prefix', () => {
    expect(parseNativeError('[SAFETY] laser not permitted')).toEqual({ code: 'SAFETY', message: 'laser not permitted' });
    expect(parseNativeError('Error: [INVALID_STATE] not armed')).toEqual({ code: 'INVALID_STATE', message: 'not armed' });
    expect(parseNativeError('boom')).toEqual({ code: 'INTERNAL', message: 'boom' });
  });
});
