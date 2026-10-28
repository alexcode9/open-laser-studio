import type { CadMeasurement } from '@ols/shared-types';
import { describe, expect, it } from 'vitest';

import { formatArea, formatDir, formatLength, measurementText } from './format';

const measurement = (patch: Partial<CadMeasurement>): CadMeasurement => ({
  id: 'm',
  kind: 'distance',
  value: 0,
  unit: 'mm',
  quality: 'analytical',
  references: [],
  tolerance: null,
  label: '',
  anchors: [],
  details: {},
  persistent: true,
  stale: false,
  ...patch,
});

describe('CAD value formatting', () => {
  it('converts display units without changing stored millimetres', () => {
    expect(formatLength(25.4, 'in', 3)).toBe('1.000 in');
    expect(formatLength(15, 'cm', 2)).toBe('1.50 cm');
    expect(formatArea(100, 'cm', 1)).toBe('1.0 cm²');
    expect(formatLength(Number.NaN)).toBe('—');
  });

  it('shows radius with diameter and suppresses negative zero noise in directions', () => {
    expect(measurementText(measurement({ kind: 'radius', value: 15 }), 'mm', 3)).toBe('R 15.000 mm · Ø 30.000 mm');
    expect(measurementText(measurement({ kind: 'angle', value: 90, unit: 'deg' }), 'mm', 1)).toBe('90.0°');
    expect(formatDir([1e-12, -1e-13, 1])).toBe('(0.0000, 0.0000, 1.0000)');
  });
});
