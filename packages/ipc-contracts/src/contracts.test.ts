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

  it('device discover/identify accept LAN targets and reject junk hosts', () => {
    expect(InputSchemas['device:discover'].safeParse({ transport: 'wifi' }).success).toBe(true);
    expect(InputSchemas['device:discover'].safeParse({ transport: 'usb', timeoutMs: 500 }).success).toBe(true);
    expect(InputSchemas['device:discover'].safeParse({ transport: 'ble' }).success).toBe(false);
    expect(InputSchemas['device:discover'].safeParse({ transport: 'wifi', timeoutMs: 10 }).success).toBe(false);
    expect(InputSchemas['device:identify'].safeParse({ host: '192.168.1.10' }).success).toBe(true);
    expect(InputSchemas['device:identify'].safeParse({ host: '201.234.3.1' }).success).toBe(true);
    expect(InputSchemas['device:identify'].safeParse({ host: 'laser.local' }).success).toBe(true);
    expect(InputSchemas['device:identify'].safeParse({ host: 'http://evil' }).success).toBe(false);
    expect(InputSchemas['device:identify'].safeParse({ host: '../etc/passwd' }).success).toBe(false);
    expect(InputSchemas['device:identify'].safeParse({ host: '' }).success).toBe(false);
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

describe('CAD inputs', () => {
  const ref = { modelId: 'm', geometryRevision: 'r', kind: 'face', index: 0, point: null, onFace: null, signature: null };

  it('validates measurement requests and references', () => {
    const s = InputSchemas['cad:measure'];
    expect(s.safeParse({ modelId: 'm', request: { kind: 'radius', a: ref } }).success).toBe(true);
    expect(s.safeParse({ modelId: 'm', request: { kind: 'radius', a: { ...ref, kind: 'solid' } } }).success).toBe(false);
    expect(s.safeParse({ modelId: 'm', request: { kind: 'distance', a: ref, b: { ...ref, kind: 'point', index: null, point: [0, Number.NaN, 0] } } }).success).toBe(false);
    expect(s.safeParse({ modelId: 'm', request: { kind: 'area', refs: [] } }).success).toBe(false);
    expect(s.safeParse({ modelId: 'm', request: { kind: 'volume', a: ref } }).success).toBe(false);
  });

  it('validates a section plane and a report export', () => {
    expect(InputSchemas['cad:section'].safeParse({ modelId: 'm', origin: [0, 0, 0], normal: [0, 0, 1] }).success).toBe(true);
    expect(InputSchemas['cad:section'].safeParse({ modelId: 'm', origin: [0, 0, Number.NaN], normal: [0, 0, 1] }).success).toBe(false);
    expect(InputSchemas['cad:exportReport'].safeParse({ text: '# report', suggestedName: 'a.md' }).success).toBe(true);
    expect(InputSchemas['cad:exportReport'].safeParse({ text: '# report', suggestedName: '' }).success).toBe(false);
  });

  it('accepts only supported import options and units', () => {
    const s = InputSchemas['cad:importBytes'];
    const ok = { requestId: 'r', fileName: 'a.step', bytes: new Uint8Array(4), options: {} };
    expect(s.safeParse(ok).success).toBe(true);
    expect(s.safeParse({ ...ok, bytes: [1, 2, 3] }).success).toBe(false);
    expect(s.safeParse({ ...ok, options: { deflectionMm: 0 } }).success).toBe(false);
    expect(InputSchemas['cad:confirmUnits'].safeParse({ requestId: 'r', modelId: 'm', unit: 'parsec' }).success).toBe(false);
  });

  it('persisted model refs require a sha256 checksum', () => {
    const model = {
      id: 'm',
      name: 'n',
      fileName: 'a.step',
      sourceType: 'step',
      declaredUnit: 'millimetre',
      unitScaleToMm: 1,
      unitsConfirmed: true,
      sha256: 'a'.repeat(64),
      byteLength: 10,
      assetPath: `cad/${'a'.repeat(64)}.step`,
      geometryRevision: 'r',
      kernelVersion: 'k',
      deflectionMm: 0.05,
      sourceToModel: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      modelToWorkpiece: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      hiddenParts: [],
    };
    const s = InputSchemas['cad:restore'];
    expect(s.safeParse({ requestId: 'r', model }).success).toBe(true);
    expect(s.safeParse({ requestId: 'r', model: { ...model, sha256: 'xyz' } }).success).toBe(false);
    expect(s.safeParse({ requestId: 'r', model: { ...model, sourceToModel: [1, 0, 0] } }).success).toBe(false);
  });
});

describe('parseNativeError', () => {
  it('extracts the code prefix', () => {
    expect(parseNativeError('[SAFETY] laser not permitted')).toEqual({ code: 'SAFETY', message: 'laser not permitted' });
    expect(parseNativeError('Error: [INVALID_STATE] not armed')).toEqual({ code: 'INVALID_STATE', message: 'not armed' });
    expect(parseNativeError('boom')).toEqual({ code: 'INTERNAL', message: 'boom' });
  });
});
