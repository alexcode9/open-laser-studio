// Deterministic CAD fixtures (docs/testing/CAD_FIXTURES.md). STEP output is normalised so the
// files are byte-stable: the header timestamp is fixed.

import { type OC, progress } from './occt';
import { newXcafDocument } from './step';
import { cube3mf } from './threemf';

const FIXED_TIMESTAMP = '2026-01-01T00:00:00';

function normalizeHeader(text: string): string {
  return text.replace(/'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d'/, `'${FIXED_TIMESTAMP}'`);
}

function readBack(oc: OC, path: string): string {
  const text = oc.FS.readFile(path, { encoding: 'utf8' }) as string;
  oc.FS.unlink(path);
  return normalizeHeader(text);
}

export type StepUnit = 'MM' | 'INCH';

export function writeStep(oc: OC, shape: OC, unit: StepUnit = 'MM'): string {
  oc.Interface_Static.SetCVal('write.step.unit', unit);
  try {
    const w = new oc.STEPControl_Writer_1();
    w.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress(oc));
    w.Write('/fixture.step');
    return readBack(oc, '/fixture.step');
  } finally {
    oc.Interface_Static.SetCVal('write.step.unit', 'MM');
  }
}

const P = (oc: OC, x: number, y: number, z: number) => new oc.gp_Pnt_3(x, y, z);
const D = (oc: OC, x: number, y: number, z: number) => new oc.gp_Dir_4(x, y, z);

export function cylinder(oc: OC, radius: number, height: number, origin: [number, number, number] = [0, 0, 0], dir: [number, number, number] = [0, 0, 1]): OC {
  return new oc.BRepPrimAPI_MakeCylinder_3(new oc.gp_Ax2_3(P(oc, ...origin), D(oc, ...dir)), radius, height).Shape();
}

export function steppedShaft(oc: OC): OC {
  const big = cylinder(oc, 15, 80);
  const small = cylinder(oc, 10, 50, [0, 0, 80]);
  const fuse = new oc.BRepAlgoAPI_Fuse_3(big, small, progress(oc));
  const unify = new oc.ShapeUpgrade_UnifySameDomain_2(fuse.Shape(), true, true, false);
  unify.Build();
  return unify.Shape();
}

export function plateWithHole(oc: OC): OC {
  const box = new oc.BRepPrimAPI_MakeBox_2(100, 60, 10).Shape();
  const hole = cylinder(oc, 6, 12, [50, 30, -1]);
  return new oc.BRepAlgoAPI_Cut_3(box, hole, progress(oc)).Shape();
}

/** Two-part assembly: Ø20×40 pin translated by +100 X, 20×30×5 plate rotated 90° about Z. */
export function assemblyStep(oc: OC): string {
  const doc = newXcafDocument(oc);
  const st = oc.XCAFDoc_DocumentTool.ShapeTool(doc.get().Main()).get();
  const name = (l: OC, s: string) => oc.TDataStd_Name.Set_1(l, new oc.TCollection_ExtendedString_2(s, true));
  const asm = st.NewShape();
  name(asm, 'Fixture assembly');
  const pin = st.AddShape(cylinder(oc, 10, 40), false, true);
  name(pin, 'Pin');
  const plate = st.AddShape(new oc.BRepPrimAPI_MakeBox_2(20, 30, 5).Shape(), false, true);
  name(plate, 'Plate');
  const t1 = new oc.gp_Trsf_1();
  t1.SetTranslation_1(new oc.gp_Vec_4(100, 0, 0));
  name(st.AddComponent_1(asm, pin, new oc.TopLoc_Location_2(t1)), 'Pin instance');
  const t2 = new oc.gp_Trsf_1();
  t2.SetRotation_1(new oc.gp_Ax1_2(P(oc, 0, 0, 0), D(oc, 0, 0, 1)), Math.PI / 2);
  name(st.AddComponent_1(asm, plate, new oc.TopLoc_Location_2(t2)), 'Plate instance');
  st.UpdateAssemblies();
  oc.Interface_Static.SetCVal('write.step.unit', 'MM');
  const w = new oc.STEPCAFControl_Writer_1();
  w.SetNameMode(true);
  // `multi` must be null: any string (even '') selects external-reference mode and omits the geometry.
  w.Transfer_1(doc, oc.STEPControl_StepModelType.STEPControl_AsIs, null, progress(oc));
  w.Write('/fixture-asm.step');
  return readBack(oc, '/fixture-asm.step');
}

/** Faceted cylinder along +Z (closed: side quads plus cap fans). Coordinates in file units. */
export function cylinderTriangles(radius: number, height: number, segments: number): number[][] {
  const tris: number[][] = [];
  const ring = (z: number) => Array.from({ length: segments }, (_, i) => [radius * Math.cos((2 * Math.PI * i) / segments), radius * Math.sin((2 * Math.PI * i) / segments), z]);
  const lo = ring(0);
  const hi = ring(height);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    tris.push([...lo[i]!, ...lo[j]!, ...hi[j]!], [...lo[i]!, ...hi[j]!, ...hi[i]!]);
    tris.push([0, 0, 0, ...lo[j]!, ...lo[i]!], [0, 0, height, ...hi[i]!, ...hi[j]!]);
  }
  return tris;
}

export function binaryStl(tris: number[][], header = 'Open Laser Studio fixture'): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode(header.slice(0, 80)));
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, t[k]!, true);
  });
  return out;
}

export function asciiStl(tris: number[][], name = 'fixture'): string {
  const f = (v: number) => v.toExponential(6);
  const body = tris.map((t) => `  facet normal 0 0 0\n    outer loop\n${[0, 3, 6].map((k) => `      vertex ${f(t[k]!)} ${f(t[k + 1]!)} ${f(t[k + 2]!)}`).join('\n')}\n    endloop\n  endfacet`);
  return `solid ${name}\n${body.join('\n')}\nendsolid ${name}\n`;
}

export interface FixtureFile {
  name: string;
  contents: string | Uint8Array;
  description: string;
}

export function buildFixtures(oc: OC): FixtureFile[] {
  const lowRes = cylinderTriangles(15, 150, 16);
  return [
    { name: 'a-cylinder-30x150.step', contents: writeStep(oc, cylinder(oc, 15, 150)), description: 'Test A: Ø30 × 150 mm cylinder along +Z' },
    { name: 'b-stepped-shaft.step', contents: writeStep(oc, steppedShaft(oc)), description: 'Test B: Ø30 × 80 mm + Ø20 × 50 mm coaxial shaft along +Z' },
    { name: 'c-plate-with-hole.step', contents: writeStep(oc, plateWithHole(oc)), description: 'Test C: 100 × 60 × 10 mm plate, Ø12 mm through-hole at (50, 30)' },
    {
      name: 'd-rotated-cylinder.step',
      contents: writeStep(oc, cylinder(oc, 15, 150, [12, -7, 5], [1 / 3, 2 / 3, 2 / 3])),
      description: 'Test D: Ø30 × 150 mm cylinder, axis (1, 2, 2)/3 from (12, -7, 5)',
    },
    { name: 'e-cylinder-lowres.stl', contents: binaryStl(lowRes), description: 'Test E: 16-segment faceted Ø30 × 150 cylinder, binary STL (mm)' },
    { name: 'e-cylinder-lowres-ascii.stl', contents: asciiStl(lowRes, 'cylinder_lowres'), description: 'Test E: same mesh, ASCII STL' },
    { name: 'f-plate-mm.step', contents: writeStep(oc, plateWithHole(oc), 'MM'), description: 'Test F: Test C plate written in millimetres' },
    { name: 'f-plate-inch.step', contents: writeStep(oc, plateWithHole(oc), 'INCH'), description: 'Test F: Test C plate written in inches' },
    { name: 'g-assembly.step', contents: assemblyStep(oc), description: 'Test G: two-part assembly with translated and rotated instances' },
    { name: 'i-cube-10mm.3mf', contents: cube3mf(10, 'millimeter'), description: '3MF: 10 mm cube, unit millimetre' },
    { name: 'i-cube-10inch.3mf', contents: cube3mf(10, 'inch'), description: '3MF: 10 inch cube (254 mm after conversion)' },
  ];
}
