import type { DesignObject, Project } from '@ols/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';

import { IDENTITY } from '@/lib/shapes';

import { selectedObjects, useProject } from './project';

const layer = {
  id: 'L1',
  name: 'Layer 1',
  color: '#f97316',
  visible: true,
  locked: false,
  output: true,
  settings: {
    mode: 'line',
    source: 'blue',
    speedMmS: 100,
    powerPct: 20,
    passes: 1,
    hatchSpacingMm: 0.1,
    hatchAngleDeg: 0,
    crosshatch: false,
    fillOutline: false,
    linesPerMm: 10,
    dither: 'floydSteinberg',
    threshold: 128,
    invert: false,
    bidirectional: true,
    overscanMm: 2,
  },
} as const;

const project = (): Project =>
  ({
    schemaVersion: 1,
    name: 'test',
    mode: 'cylinder',
    document: { layers: [structuredClone(layer)], objects: [] },
    workpiece: { diameterMm: 70, lengthMm: 150, angularZeroDeg: 0, axialZeroMm: 0, rotationSign: 1 },
    cylinder: { strategy: 'indexed', sectionWidthMm: 10, maxFocusErrorMm: 0.3, sectionOverlapMm: 0.2, angularWindowMm: 0, helicalPitchMm: 1 },
    machine: {} as Project['machine'],
    assets: {},
  }) as Project;

const rect = (id: string, x = 0): DesignObject => ({
  id,
  name: id,
  layerId: 'L1',
  visible: true,
  locked: false,
  transform: { ...IDENTITY, x },
  shape: { kind: 'rect', width: 10, height: 10 },
});

const s = () => useProject.getState();
const objects = () => s().project!.document.objects;

beforeEach(() => s().load(project(), null));

describe('project store history', () => {
  it('undo/redo restores documents and drops stale selection', () => {
    s().addObjects([rect('a')]);
    expect(objects()).toHaveLength(1);
    expect(s().selection).toEqual(['a']);
    expect(s().dirty).toBe(true);
    s().undo();
    expect(objects()).toHaveLength(0);
    expect(s().selection).toEqual([]);
    s().redo();
    expect(objects()).toHaveLength(1);
    s().redo(); // nothing left to redo
    expect(objects()).toHaveLength(1);
  });

  it('coalesces edits with the same key into one undo step', () => {
    s().addObjects([rect('a')]);
    s().nudgeSelection(1, 0);
    s().nudgeSelection(1, 0);
    s().nudgeSelection(1, 0);
    expect(objects()[0]!.transform.x).toBe(3);
    s().undo();
    expect(objects()[0]!.transform.x).toBe(0);
  });

  it('a new edit clears the redo stack', () => {
    s().addObjects([rect('a')]);
    s().undo();
    s().addObjects([rect('b')]);
    s().redo();
    expect(objects().map((o) => o.id)).toEqual(['b']);
  });

  it('locked objects survive delete and nudge', () => {
    s().addObjects([rect('a'), { ...rect('b', 50), locked: true }]);
    s().select(['a', 'b']);
    s().nudgeSelection(5, 0);
    expect(objects().map((o) => o.transform.x)).toEqual([5, 50]);
    s().deleteSelection();
    expect(objects().map((o) => o.id)).toEqual(['b']);
  });

  it('additive selection toggles', () => {
    s().addObjects([rect('a'), rect('b')]);
    s().select(['a']);
    s().select(['b'], true);
    expect(selectedObjects(s()).map((o) => o.id)).toEqual(['a', 'b']);
    s().select(['a'], true);
    expect(s().selection).toEqual(['b']);
  });

  it('layers in use cannot be removed; the last layer cannot be removed', () => {
    s().addObjects([rect('a')]);
    s().removeLayer('L1');
    expect(s().project!.document.layers).toHaveLength(1);
    s().addLayer();
    const added = s().project!.document.layers[1]!;
    expect(s().activeLayerId).toBe(added.id);
    s().removeLayer(added.id);
    expect(s().project!.document.layers).toHaveLength(1);
  });

  it('setMode is a no-op when unchanged (no history entry)', () => {
    s().setMode('cylinder');
    expect(s().past).toHaveLength(0);
    s().setMode('flat');
    expect(s().past).toHaveLength(1);
  });
});
