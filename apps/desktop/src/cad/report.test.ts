import type { CadMeasurement, CadModelRef, Project } from '@ols/shared-types';
import { describe, expect, it } from 'vitest';

import { measurementReport } from './report';
import { emptyCadWorkspace } from './workpiece';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const model = (patch: Partial<CadModelRef> = {}): CadModelRef => ({
  id: 'm',
  name: 'Shaft',
  fileName: 'shaft.step',
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
  sourceToModel: identity,
  modelToWorkpiece: identity,
  hiddenParts: [],
  ...patch,
});

const measurement = (patch: Partial<CadMeasurement> = {}): CadMeasurement => ({
  id: 'meas',
  kind: 'radius',
  value: 15,
  unit: 'mm',
  quality: 'analytical',
  references: [],
  tolerance: null,
  label: 'Cylinder radius',
  anchors: [],
  details: {},
  persistent: true,
  stale: false,
  ...patch,
});

describe('measurementReport', () => {
  it('lists models, measurements and the workpiece with quality notes', () => {
    const project = {
      name: 'Demo',
      cad: {
        ...emptyCadWorkspace(),
        models: [model()],
        measurements: [measurement(), measurement({ id: 'd', kind: 'distance', value: 150, label: 'Length', quality: 'computed' })],
        activeWorkpiece: {
          modelId: 'm',
          cylinderId: 'c',
          faces: [],
          diameterMm: 30,
          axialMinMm: 0,
          axialMaxMm: 150,
          axisOrigin: [0, 0, 0],
          axisDirection: [0, 0, 1],
          seamAngleDeg: 0,
          reversed: false,
          modelToWorkpiece: identity,
        },
      },
    } as unknown as Project;
    const text = measurementReport(project);
    expect(text).toContain('# CAD measurement report');
    expect(text).toContain('Project: Demo');
    expect(text).toContain('Shaft');
    expect(text).toContain('R 15.000 mm · Ø 30.000 mm');
    expect(text).toContain('(Exact)');
    expect(text).toContain('150.000 mm (Computed)');
    expect(text).toContain('Ø 30.000 mm');
    expect(text).toContain('ideal STEP geometry is not the manufactured part');
  });
});
