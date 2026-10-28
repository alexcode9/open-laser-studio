import type { CadImportOptions, CadMeasureRequest, CadMeasurement, CadModelData, CadSection, Project, SourceLengthUnit, Vec3 } from '@ols/shared-types';

import type { CadPick } from '@/cad/picking';
import { pickToReference, referenceValid } from '@/cad/picking';
import { measurementReport } from '@/cad/report';
import { type WorkpieceChoice, alignParamsFor, applyWorkpiece, cadOf, clearWorkpiece, modelRefFor } from '@/cad/workpiece';
import { type CadTool, useCad } from '@/stores/cad';
import { useProject } from '@/stores/project';
import { toast, useView } from '@/stores/view';

import { IpcCallError, call, errorMessage, subscribe } from './ipc';

const newRequestId = () => `cad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let eventsReady = false;
function ensureEvents(): void {
  if (eventsReady) return;
  eventsReady = true;
  subscribe('cad:progress', (p) => {
    const job = useCad.getState().job;
    if (job && job.requestId === p.requestId) useCad.getState().setJob({ ...job, stage: p.stage, fraction: p.fraction });
  });
}

const editCad = (fn: (c: ReturnType<typeof cadOf>) => ReturnType<typeof cadOf>) => (p: Project): Project => ({ ...p, cad: fn(cadOf(p)) });

function afterImport(m: CadModelData): void {
  useCad.getState().setModel(m);
  useCad.getState().setActive(m.modelId);
  useProject.getState().apply(editCad((c) => ({ ...c, models: [...c.models, modelRefFor(m)] })));
  useView.getState().setWorkspace('cad');
  useCad.getState().requestView('fit');
  const summary = m.exact
    ? `${m.name}: ${m.stats.faceCount} faces, ${m.features.cylinders.length} cylinder(s) in ${(m.importMs / 1000).toFixed(1)} s`
    : `${m.name}: mesh with ${m.stats.triangleCount} triangles (measurements are mesh-derived)`;
  toast('info', summary);
  for (const w of m.warnings.slice(0, 2)) toast('warn', w);
  if (!m.unitsConfirmed) useCad.getState().setUnitPrompt(m.modelId);
}

async function runImport(fileName: string, run: (requestId: string) => Promise<CadModelData | null>): Promise<void> {
  ensureEvents();
  if (useCad.getState().job) {
    toast('warn', 'Another CAD import is in progress.');
    return;
  }
  const requestId = newRequestId();
  useCad.getState().setJob({ requestId, fileName, stage: 'reading', fraction: 0 });
  try {
    const m = await run(requestId);
    if (m) afterImport(m);
  } catch (e) {
    if (e instanceof IpcCallError && e.code === 'ABORTED') toast('info', 'CAD import cancelled.');
    else toast('error', `CAD import failed: ${errorMessage(e)}`);
  } finally {
    useCad.getState().setJob(null);
  }
}

export function importCadDialog(options: CadImportOptions = {}): Promise<void> {
  return runImport('CAD model', (requestId) => {
    // The file name is only known after the dialog closes; show it from the first progress event.
    return call('cad:importDialog', { requestId, options });
  });
}

export async function importCadFile(file: File, options: CadImportOptions = {}): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return runImport(file.name, (requestId) => call('cad:importBytes', { requestId, fileName: file.name, bytes, options }));
}

export async function cancelCadImport(): Promise<void> {
  const job = useCad.getState().job;
  if (!job) return;
  await call('cad:cancel', { requestId: job.requestId }).catch(() => undefined);
}

/** Re-analyse a mesh model with the unit the user confirmed. Existing measurements become stale. */
export async function confirmCadUnits(modelId: string, unit: SourceLengthUnit): Promise<void> {
  ensureEvents();
  const requestId = newRequestId();
  const name = useCad.getState().models[modelId]?.fileName ?? 'model';
  useCad.getState().setJob({ requestId, fileName: name, stage: 'analyzing', fraction: 0 });
  try {
    const m = await call('cad:confirmUnits', { requestId, modelId, unit });
    useCad.getState().setModel(m);
    useProject.getState().apply(
      editCad((c) => ({
        ...c,
        models: c.models.map((r) => (r.id === modelId ? { ...modelRefFor(m), hiddenParts: r.hiddenParts, modelToWorkpiece: r.modelToWorkpiece } : r)),
        measurements: c.measurements.map((x) => (x.references.some((r) => r.modelId === modelId) ? { ...x, stale: true } : x)),
      })),
    );
    useCad.getState().setUnitPrompt(null);
    useCad.getState().requestView('fit');
    toast('info', `Units set to ${unit}.`);
  } catch (e) {
    toast('error', `Could not apply units: ${errorMessage(e)}`);
  } finally {
    useCad.getState().setJob(null);
  }
}

export async function removeCadModel(modelId: string): Promise<void> {
  useProject.getState().apply((p) => {
    const c = cadOf(p);
    const cleared = c.activeWorkpiece?.modelId === modelId ? clearWorkpiece(p) : p;
    const cc = cadOf(cleared);
    return {
      ...cleared,
      cad: { ...cc, models: cc.models.filter((m) => m.id !== modelId), measurements: cc.measurements.filter((x) => !x.references.some((r) => r.modelId === modelId)) },
    };
  });
  // Runtime data is kept so undo can bring the model back.
  useCad.getState().select(null);
}

/** Load the CAD models of a freshly opened project from its embedded source files. */
export async function restoreCadModels(project: Project): Promise<void> {
  ensureEvents();
  const keep = new Set(cadOf(project).models.map((m) => m.id));
  for (const id of Object.keys(useCad.getState().models)) {
    if (!keep.has(id)) void call('cad:release', { modelId: id }).catch(() => undefined);
  }
  useCad.getState().reset();
  for (const ref of cadOf(project).models) {
    useCad.getState().setStatus(ref.id, { state: 'loading' });
    try {
      const r = await call('cad:restore', { requestId: newRequestId(), model: ref });
      if (!r.data) {
        useCad.getState().setStatus(ref.id, { state: 'missing', message: r.message ?? 'source file unavailable' });
        toast('warn', r.message ?? `CAD model "${ref.name}" could not be restored.`);
        continue;
      }
      const data = r.data;
      useCad.getState().setModel(data);
      if (r.status === 'changed') {
        toast('info', r.message ?? `"${ref.name}" was re-analysed.`);
        // Derived state only: mark measurements whose topology no longer matches. Not an undo step.
        const cur = useProject.getState().project;
        if (cur?.cad) {
          const measurements = cur.cad.measurements.map((x) =>
            x.references.some((rf) => rf.modelId === data.modelId && !referenceValid(data, rf)) ? { ...x, stale: true } : x,
          );
          useProject.setState({ project: { ...cur, cad: { ...cur.cad, measurements } } });
        }
      }
    } catch (e) {
      useCad.getState().setStatus(ref.id, { state: 'error', message: errorMessage(e) });
      toast('error', `CAD model "${ref.name}": ${errorMessage(e)}`);
    }
  }
}

export async function measure(modelId: string, request: CadMeasureRequest): Promise<CadMeasurement | null> {
  try {
    const m = await call('cad:measure', { modelId, request });
    useProject.getState().apply(editCad((c) => ({ ...c, measurements: [...c.measurements, m] })));
    return m;
  } catch (e) {
    toast('warn', `Measurement failed: ${errorMessage(e)}`);
    return null;
  }
}

export function deleteMeasurement(id: string): void {
  useProject.getState().apply(editCad((c) => ({ ...c, measurements: c.measurements.filter((m) => m.id !== id) })));
}

export function clearMeasurements(): void {
  useProject.getState().apply(editCad((c) => ({ ...c, measurements: [] })));
}

/** Picks required per tool, and which pick kinds each tool accepts. */
export const TOOL_INFO: Record<Exclude<CadTool, 'select'>, { picks: number; hint: string }> = {
  distance: { picks: 2, hint: 'Pick two points, vertices or edges' },
  length: { picks: 1, hint: 'Pick an edge' },
  radius: { picks: 1, hint: 'Pick a cylindrical/spherical face or a circular edge' },
  angle: { picks: 2, hint: 'Pick two straight edges or two planar faces' },
  'face-distance': { picks: 2, hint: 'Pick two faces' },
  area: { picks: 1, hint: 'Pick a face (use “Area of selection” for several)' },
  section: { picks: 1, hint: 'Pick a face to cut through (planar face, or through the pick on any face)' },
};

/** Feed a viewer pick into the active measurement tool. */
export async function toolPick(pick: CadPick): Promise<void> {
  const st = useCad.getState();
  const tool = st.tool;
  if (tool === 'select') return;
  const model = st.models[pick.modelId];
  if (!model) return;
  if ((tool === 'face-distance' || tool === 'area' || tool === 'section') && pick.kind !== 'face') return;
  if (tool === 'length' && pick.kind !== 'edge') return;
  const picks = st.addToolPick(pick);
  if (picks.length < TOOL_INFO[tool].picks) return;
  st.clearToolPicks();
  if (picks.some((p) => p.modelId !== pick.modelId)) {
    toast('warn', 'Measurements between different models are not supported.');
    return;
  }
  const ref = (p: CadPick, asPoint = false) => pickToReference(model, p, asPoint);
  const [a, b] = [picks[0]!, picks[1]];
  if (tool === 'section') {
    await sectionModel(model.modelId, sectionPlane(model, a));
    return;
  }
  let req: CadMeasureRequest;
  switch (tool) {
    case 'distance':
      req = { kind: 'distance', a: ref(a, true), b: ref(b!, true) };
      break;
    case 'length':
      req = { kind: 'length', a: ref(a) };
      break;
    case 'radius':
      req = { kind: 'radius', a: ref(a) };
      break;
    case 'angle':
      req = { kind: 'angle', a: ref(a), b: ref(b!) };
      break;
    case 'face-distance':
      req = { kind: 'face-distance', a: ref(a), b: ref(b!) };
      break;
    case 'area':
      req = { kind: 'area', refs: [ref(a)] };
      break;
    default:
      return;
  }
  await measure(model.modelId, req);
}

export async function measureSelectionArea(): Promise<void> {
  const { selection, models } = useCad.getState();
  const faces = selection.filter((p) => p.kind === 'face');
  const model = faces[0] && models[faces[0].modelId];
  if (!model) return;
  await measure(model.modelId, { kind: 'area', refs: faces.filter((f) => f.modelId === model.modelId).map((f) => pickToReference(model, f)) });
}

/** Align the selected cylinder to the rotary axis and populate the cylinder workpiece (one undo step). */
export async function applyCadWorkpiece(modelId: string, cylinderId: string, seamAngleDeg: number, reversed: boolean): Promise<boolean> {
  const model = useCad.getState().models[modelId];
  const cylinder = model?.features.cylinders.find((c) => c.id === cylinderId);
  if (!model || !cylinder) return false;
  try {
    const alignment = await call('cad:alignToRotary', alignParamsFor(cylinder, seamAngleDeg, reversed));
    const choice: WorkpieceChoice = { model, cylinder, seamAngleDeg, reversed, alignment };
    useProject.getState().apply((p) => applyWorkpiece(p, choice));
    toast('info', `Workpiece set from CAD: Ø${cylinder.diameterMm.toFixed(3)} × ${alignment.lengthMm.toFixed(3)} mm. Machine calibration was not changed.`);
    return true;
  } catch (e) {
    toast('error', `Could not use the model as workpiece: ${errorMessage(e)}`);
    return false;
  }
}

export function detachCadWorkpiece(): void {
  useProject.getState().apply(clearWorkpiece);
}

function sectionPlane(model: CadModelData, pick: CadPick): { origin: Vec3; normal: Vec3 } {
  const face = pick.kind === 'face' ? model.faces[pick.index] : undefined;
  if (face?.plane) return { origin: face.plane.origin, normal: face.plane.normal };
  if (face?.cylinder) return { origin: pick.point, normal: face.cylinder.axisDirection };
  return { origin: pick.point, normal: [0, 0, 1] };
}

export async function sectionModel(modelId: string, plane: { origin: Vec3; normal: Vec3 }): Promise<CadSection | null> {
  try {
    const result = await call('cad:section', { modelId, origin: plane.origin, normal: plane.normal });
    useCad.getState().setSection({ modelId, result });
    toast('info', `Section length ${result.lengthMm.toFixed(3)} mm (${result.quality}).`);
    return result;
  } catch (e) {
    toast('warn', `Section failed: ${errorMessage(e)}`);
    return null;
  }
}

export function clearCadSection(): void {
  useCad.getState().setSection(null);
}

export async function exportCadReport(): Promise<void> {
  const project = useProject.getState().project;
  if (!project) return;
  const text = measurementReport(project);
  const suggestedName = `${(project.name || 'cad').replace(/[^\w.-]+/g, '-')}-measurements.md`;
  try {
    const r = await call('cad:exportReport', { text, suggestedName });
    if (r) toast('info', `Report saved to ${r.path}`);
  } catch (e) {
    toast('error', `Could not export the report: ${errorMessage(e)}`);
  }
}
