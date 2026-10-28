import { describe, expect, it } from 'vitest';

import { cube3mf, parse3mf, zipStore } from './threemf';

describe('3MF', () => {
  it('round-trips a stored ZIP and reads the cube in millimetres and inches', () => {
    const bytes = zipStore({ 'hello.txt': 'hi' });
    expect(bytes[0]).toBe(0x50);
    const mm = parse3mf(cube3mf(10, 'millimeter'));
    expect(mm.unitsConfirmed).toBe(true);
    expect(mm.unitScaleToMm).toBe(1);
    expect(mm.meshes).toHaveLength(1);
    expect(mm.meshes[0]!.triangles.length).toBe(12 * 9);
    const inch = parse3mf(cube3mf(10, 'inch'));
    expect(inch.unitScaleToMm).toBe(25.4);
    expect(inch.declaredUnit.toLowerCase()).toBe('inch');
  });
});
