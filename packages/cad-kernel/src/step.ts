import type { CadPartNode, Mat4 } from '@ols/shared-types';

import { type OC, progress, withVirtualFile } from './occt';

export interface LocatedPart {
  name: string;
  path: string;
  /** Shape with its full assembly location applied (model coordinates). */
  shape: OC;
  worldTransform: Mat4;
}

export interface StepReadResult {
  declaredUnit: string;
  tree: CadPartNode[];
  parts: LocatedPart[];
  warnings: string[];
}

/** gp_Trsf -> column-major Mat4. */
export function trsfToMat4(t: OC): Mat4 {
  const m: Mat4 = new Array(16).fill(0);
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 4; c++) m[(c - 1) * 4 + (r - 1)] = t.Value(r, c);
  m[15] = 1;
  return m;
}

function labelName(oc: OC, label: OC, fallback: string): string {
  try {
    const h = new oc.Handle_TDF_Attribute_1();
    if (label.FindAttribute_1(oc.TDataStd_Name.GetID(), h)) {
      const s = new oc.TCollection_AsciiString_13(h.get().Get(), 63).ToCString() as string;
      if (s.trim()) return s.trim();
    }
  } catch {
    // Name attributes are optional.
  }
  return fallback;
}

export function newXcafDocument(oc: OC): OC {
  const app = oc.XCAFApp_Application.GetApplication().get();
  const doc = new oc.Handle_TDocStd_Document_1();
  app.NewDocument_2(new oc.TCollection_ExtendedString_2('MDTV-XCAF', true), doc);
  return doc;
}

/**
 * Read a STEP file through XDE. OCCT converts coordinates to millimetres
 * (`xstep.cascade.unit = MM`); the unit declared in the file is reported separately.
 * The file only exists in the kernel's in-memory FS, so external references cannot resolve.
 */
export function readStep(oc: OC, bytes: Uint8Array, onStage: (stage: 'reading' | 'transferring') => void): StepReadResult {
  const warnings: string[] = [];
  oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
  oc.Interface_Static.SetIVal('read.step.ideas', 0);
  const reader = new oc.STEPCAFControl_Reader_1();
  reader.SetNameMode(true);
  reader.SetColorMode(false);
  reader.SetLayerMode(false);
  reader.SetPropsMode(false);
  reader.SetGDTMode(false);
  reader.SetMatMode(false);
  reader.SetViewMode(false);
  onStage('reading');
  const status = withVirtualFile(oc, 'model.step', bytes, (p) => reader.ReadFile(p));
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    throw Object.assign(new Error('the file is not a readable STEP file'), { code: 'PARSE' });
  }
  const units = new oc.TColStd_SequenceOfAsciiString_1();
  reader.Reader().FileUnits(units, new oc.TColStd_SequenceOfAsciiString_1(), new oc.TColStd_SequenceOfAsciiString_1());
  const declared = new Set<string>();
  for (let i = 1; i <= units.Length(); i++) declared.add(String(units.Value(i).ToCString()));
  if (declared.size > 1) warnings.push(`File declares several length units (${[...declared].join(', ')}); OCCT converted each to mm.`);
  const declaredUnit = declared.size > 0 ? [...declared].join(', ') : 'unspecified';
  if (declared.size === 0) warnings.push('File declares no length unit; values were read as millimetres.');

  onStage('transferring');
  const doc = newXcafDocument(oc);
  if (!reader.Transfer_1(doc, progress(oc))) throw Object.assign(new Error('STEP transfer produced no shapes'), { code: 'PARSE' });
  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.get().Main()).get();
  const free = new oc.TDF_LabelSequence_1();
  tool.GetFreeShapes(free);

  const parts: LocatedPart[] = [];
  const walk = (label: OC, parentLoc: OC, path: string, fallback: string, depth: number): CadPartNode | null => {
    if (depth > 64) {
      warnings.push('Assembly nesting deeper than 64 levels was truncated.');
      return null;
    }
    const ST = oc.XCAFDoc_ShapeTool;
    let name = labelName(oc, label, fallback);
    let loc = new oc.TopLoc_Location_1();
    let def = label;
    if (ST.IsReference(label)) {
      loc = ST.GetLocation(label);
      def = new oc.TDF_Label();
      ST.GetReferredShape(label, def);
      if (name === fallback) name = labelName(oc, def, fallback);
    }
    const located = parentLoc.Multiplied(loc);
    const node: CadPartNode = { id: path, name, kind: 'part', transform: trsfToMat4(loc.Transformation()), children: [] };
    if (ST.IsAssembly(def)) {
      node.kind = 'assembly';
      const comps = new oc.TDF_LabelSequence_1();
      ST.GetComponents(def, comps, false);
      for (let i = 1; i <= comps.Length(); i++) {
        const child = walk(comps.Value(i), located, `${path}/${i - 1}`, `${name} ${i}`, depth + 1);
        if (child) node.children.push(child);
      }
      return node;
    }
    const shape = ST.GetShape_2(def);
    if (shape.IsNull()) return null;
    if (!new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE).More()) {
      warnings.push(`"${name}" has no geometry in this file (external references are not followed).`);
    }
    node.partIndex = parts.length;
    parts.push({ name, path, shape: shape.Moved(located, false), worldTransform: trsfToMat4(located.Transformation()) });
    return node;
  };
  const tree: CadPartNode[] = [];
  for (let i = 1; i <= free.Length(); i++) {
    const n = walk(free.Value(i), new oc.TopLoc_Location_1(), String(i - 1), `Part ${i}`, 0);
    if (n) tree.push(n);
  }
  if (parts.length === 0) throw Object.assign(new Error('the STEP file contains no geometry'), { code: 'PARSE' });
  return { declaredUnit, tree, parts, warnings };
}
