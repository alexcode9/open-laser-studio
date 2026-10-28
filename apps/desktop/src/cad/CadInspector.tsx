import type { CadMeasureRequest, CadModelData, DisplayUnit, MeasurementQuality } from '@ols/shared-types';
import { Badge, Button, Field, NumberField, Section, Select, Tooltip } from '@ols/ui';
import { Cylinder, FileDown, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { clearCadSection, clearMeasurements, deleteMeasurement, detachCadWorkpiece, exportCadReport, measure, measureSelectionArea } from '@/lib/cad';
import { useCad } from '@/stores/cad';
import { useProject } from '@/stores/project';

import { QUALITY_HELP, QUALITY_LABEL, QUALITY_TONE, formatArea, formatDir, formatLength, formatVec, formatVolume, measurementText } from './format';
import { type CadPick, pickToReference } from './picking';
import { cadOf, cylinderForFace, rankCylinders } from './workpiece';

export function QualityBadge({ q }: { q: MeasurementQuality }) {
  return (
    <Tooltip content={QUALITY_HELP[q]}>
      <Badge tone={QUALITY_TONE[q]} data-testid={`quality-${q}`}>
        {QUALITY_LABEL[q]}
      </Badge>
    </Tooltip>
  );
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[minmax(84px,38%)_1fr] items-baseline gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono break-all" data-testid={testId}>
        {children}
      </span>
    </div>
  );
}

function useUnits(): { unit: DisplayUnit; precision: number } {
  const unit = useProject((s) => s.project?.cad?.displayUnit ?? 'mm');
  const precision = useProject((s) => s.project?.cad?.displayPrecision ?? 3);
  return { unit, precision };
}

function ModelSummary({ m }: { m: CadModelData }) {
  const { unit, precision } = useUnits();
  const b = m.bounds;
  return (
    <Section title="Model" actions={<QualityBadge q={b.quality} />}>
      <Row label="File">{m.fileName}</Row>
      <Row label="Format">{m.exact ? `${m.sourceType.toUpperCase()} (exact B-Rep)` : `${m.sourceType.toUpperCase()} (mesh only)`}</Row>
      <Row label="Units">
        {m.declaredUnit} {m.unitScaleToMm !== 1 && `→ mm ×${m.unitScaleToMm}`}
        {!m.unitsConfirmed && (
          <Button size="sm" variant="outline" className="ml-2" onClick={() => useCad.getState().setUnitPrompt(m.modelId)}>
            Set units…
          </Button>
        )}
      </Row>
      <Row label="Size X × Y × Z" testId="cad-bounds-size">
        {b.size.map((v) => formatLength(v, unit, precision)).join(' × ')}
      </Row>
      {b.obb && <Row label="Oriented box">{b.obb.halfSizes.map((h) => formatLength(2 * h, unit, precision)).join(' × ')}</Row>}
      <Row label="Diagonal">{formatLength(b.diagonalMm, unit, precision)}</Row>
      {b.volumeMm3 !== null && <Row label="Volume">{formatVolume(b.volumeMm3, unit, precision)}</Row>}
      <Row label="Surface area">{formatArea(b.areaMm2, unit, precision)}</Row>
      <Row label="Topology">
        {m.stats.partCount} part(s) · {m.stats.solidCount} solid(s) · {m.stats.faceCount} faces · {m.stats.edgeCount} edges · {m.stats.vertexCount} vertices
      </Row>
      <Row label="Display mesh">
        {m.stats.triangleCount.toLocaleString()} triangles{m.exact && ` · deflection ${m.deflectionMm.toFixed(3)} mm`}
      </Row>
      <Row label="Validity">{m.validation.valid ? 'valid' : <span className="text-amber-300">{m.validation.messages.join('; ') || 'invalid geometry'}</span>}</Row>
      {m.features.axisCandidates[0] && (
        <Row label="Rotation axis" testId="cad-axis-candidate">
          {formatDir(m.features.axisCandidates[0].direction)} · {m.features.axisCandidates[0].reason}
        </Row>
      )}
      {m.warnings.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10.5px] text-amber-300">
          {m.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FaceProps({ m, index }: { m: CadModelData; index: number }) {
  const { unit, precision } = useUnits();
  const f = m.faces[index];
  if (!f) return null;
  const feature = cylinderForFace(m, index);
  const part = m.parts[f.partIndex];
  const usable = feature && rankCylinders(m).find((r) => r.feature.id === feature.id)?.usable;
  return (
    <Section title={`Face #${index}`} actions={<QualityBadge q={f.quality} />}>
      <Row label="Surface" testId="cad-prop-kind">
        {f.kind}
      </Row>
      {part && m.parts.length > 1 && <Row label="Part">{part.name}</Row>}
      <Row label="Area">{formatArea(f.areaMm2, unit, precision)}</Row>
      {f.plane && (
        <>
          <Row label="Normal">{formatDir(f.plane.normal)}</Row>
          <Row label="Point">{formatVec(f.plane.origin, unit, precision)}</Row>
        </>
      )}
      {f.cylinder && (
        <>
          <Row label="Diameter" testId="cad-prop-diameter">
            Ø {formatLength(f.cylinder.radiusMm * 2, unit, precision)}
          </Row>
          <Row label="Radius">{formatLength(f.cylinder.radiusMm, unit, precision)}</Row>
          <Row label="Axis direction" testId="cad-prop-axis">
            {formatDir(f.cylinder.axisDirection)}
          </Row>
          <Row label="Axis point">{formatVec(f.cylinder.axisOrigin, unit, precision)}</Row>
          <Row label="Axial length">{formatLength(f.cylinder.axialMaxMm - f.cylinder.axialMinMm, unit, precision)}</Row>
          <Row label="Angular span">{((f.cylinder.angularSpanRad * 180) / Math.PI).toFixed(2)}°</Row>
          <Row label="Side">{f.cylinder.inner === true ? 'inner (bore/hole)' : f.cylinder.inner === false ? 'outer (shaft/boss)' : 'not established'}</Row>
          {f.cylinder.residualMm != null && (
            <Row label="Fit residual" testId="cad-prop-residual">
              {formatLength(f.cylinder.residualMm, unit, precision)}
            </Row>
          )}
        </>
      )}
      {f.cone && (
        <>
          <Row label="Half angle">{((f.cone.semiAngleRad * 180) / Math.PI).toFixed(4)}°</Row>
          <Row label="Ref. radius">{formatLength(f.cone.refRadiusMm, unit, precision)}</Row>
          <Row label="Axis">{formatDir(f.cone.axisDirection)}</Row>
        </>
      )}
      {f.sphere && (
        <>
          <Row label="Diameter">Ø {formatLength(f.sphere.radiusMm * 2, unit, precision)}</Row>
          <Row label="Center">{formatVec(f.sphere.center, unit, precision)}</Row>
        </>
      )}
      {f.torus && (
        <>
          <Row label="Major radius">{formatLength(f.torus.majorRadiusMm, unit, precision)}</Row>
          <Row label="Minor radius">{formatLength(f.torus.minorRadiusMm, unit, precision)}</Row>
        </>
      )}
      {feature && feature.faceIndices.length > 1 && (
        <Row label="Cylinder feature">
          Ø {formatLength(feature.diameterMm, unit, precision)} × {formatLength(feature.lengthMm, unit, precision)} ({feature.faceIndices.length} faces)
        </Row>
      )}
      {feature && (
        <Button size="sm" variant="outline" className="mt-1" disabled={!usable} data-testid="cad-use-workpiece-face" onClick={() => useCad.getState().setWorkpieceDialog(true)}>
          <Cylinder /> Use as workpiece…
        </Button>
      )}
    </Section>
  );
}

function EdgeProps({ m, index }: { m: CadModelData; index: number }) {
  const { unit, precision } = useUnits();
  const e = m.edges[index];
  if (!e) return null;
  return (
    <Section title={`Edge #${index}`} actions={<QualityBadge q={e.quality} />}>
      <Row label="Curve">{e.kind}</Row>
      <Row label="Length" testId="cad-prop-length">
        {formatLength(e.lengthMm, unit, precision)}
        {e.lengthToleranceMm > 0 && ` ± ${e.lengthToleranceMm.toExponential(1)} mm`}
      </Row>
      {e.circle && (
        <>
          <Row label="Diameter">Ø {formatLength(e.circle.radiusMm * 2, unit, precision)}</Row>
          <Row label="Radius">{formatLength(e.circle.radiusMm, unit, precision)}</Row>
          <Row label="Center">{formatVec(e.circle.center, unit, precision)}</Row>
          <Row label="Normal">{formatDir(e.circle.normal)}</Row>
          <Row label="Arc">{((e.circle.angularSpanRad * 180) / Math.PI).toFixed(3)}°</Row>
        </>
      )}
      {e.line && <Row label="Direction">{formatDir(e.line.direction)}</Row>}
      <Row label="Faces">{e.faceIndices.join(', ') || '—'}</Row>
    </Section>
  );
}

function VertexProps({ m, index }: { m: CadModelData; index: number }) {
  const { unit, precision } = useUnits();
  const v = m.vertices[index];
  if (!v) return null;
  return (
    <Section title={`Vertex #${index}`} actions={<QualityBadge q="analytical" />}>
      <Row label="Position">{formatVec(v.position, unit, precision)}</Row>
    </Section>
  );
}

/** One-click measurements for the current selection. */
function QuickMeasure({ m, sel }: { m: CadModelData; sel: CadPick[] }) {
  const ref = (p: CadPick) => pickToReference(m, p);
  const actions: { label: string; req: CadMeasureRequest; testId: string }[] = [];
  const [a, b] = sel;
  if (sel.length === 1 && a) {
    const f = a.kind === 'face' ? m.faces[a.index] : null;
    const e = a.kind === 'edge' ? m.edges[a.index] : null;
    if ((f && (f.cylinder || f.sphere)) || e?.circle) actions.push({ label: 'Radius / diameter', req: { kind: 'radius', a: ref(a) }, testId: 'cad-quick-radius' });
    if (e) actions.push({ label: 'Edge length', req: { kind: 'length', a: ref(a) }, testId: 'cad-quick-length' });
    if (f) actions.push({ label: 'Area', req: { kind: 'area', refs: [ref(a)] }, testId: 'cad-quick-area' });
  }
  if (sel.length === 2 && a && b) {
    actions.push({ label: 'Distance', req: { kind: 'distance', a: ref(a), b: ref(b) }, testId: 'cad-quick-distance' });
    if (a.kind === 'face' && b.kind === 'face') actions.push({ label: 'Face to face', req: { kind: 'face-distance', a: ref(a), b: ref(b) }, testId: 'cad-quick-face-distance' });
    if (a.kind !== 'vertex' && b.kind !== 'vertex' && a.kind === b.kind) actions.push({ label: 'Angle', req: { kind: 'angle', a: ref(a), b: ref(b) }, testId: 'cad-quick-angle' });
  }
  const faces = sel.filter((p) => p.kind === 'face').length;
  if (actions.length === 0 && faces < 2) return null;
  return (
    <Section title="Measure selection">
      <div className="flex flex-wrap gap-1">
        {actions.map((x) => (
          <Button key={x.label} size="sm" variant="outline" data-testid={x.testId} onClick={() => void measure(m.modelId, x.req)}>
            {x.label}
          </Button>
        ))}
        {faces >= 2 && (
          <Button size="sm" variant="outline" onClick={() => void measureSelectionArea()}>
            Area of {faces} faces
          </Button>
        )}
      </div>
    </Section>
  );
}

function Measurements() {
  const list = useProject((s) => s.project?.cad?.measurements);
  const { unit, precision } = useUnits();
  if (!list || list.length === 0) return null;
  return (
    <Section
      title={`Measurements (${list.length})`}
      actions={
        <Button size="iconSm" aria-label="Clear measurements" onClick={clearMeasurements}>
          <Trash2 />
        </Button>
      }
    >
      {list.map((x) => (
        <div key={x.id} className="flex items-center gap-1.5 text-[11px]" data-testid="cad-measurement">
          <div className="min-w-0 flex-1">
            <div className="truncate text-muted-foreground">{x.label}</div>
            <div className="font-mono" data-testid="cad-measurement-value">
              {measurementText(x, unit, precision)}
              {x.tolerance !== null && x.tolerance > 0 && <span className="text-muted-foreground"> ±{x.tolerance.toExponential(0)}</span>}
            </div>
          </div>
          {x.stale && (
            <Tooltip content="The referenced geometry changed since this was measured.">
              <Badge tone="danger">stale</Badge>
            </Tooltip>
          )}
          <QualityBadge q={x.quality} />
          <Button size="iconSm" aria-label="Delete measurement" onClick={() => deleteMeasurement(x.id)}>
            <X />
          </Button>
        </div>
      ))}
    </Section>
  );
}

function SectionPanel() {
  const section = useCad((s) => s.section);
  const { unit, precision } = useUnits();
  if (!section) return null;
  return (
    <Section
      title="Section"
      actions={
        <Button size="iconSm" aria-label="Clear section" onClick={clearCadSection}>
          <X />
        </Button>
      }
    >
      <Row label="Length" testId="cad-section-length">
        {formatLength(section.result.lengthMm, unit, precision)}
      </Row>
      <Row label="Quality">
        <QualityBadge q={section.result.quality} />
      </Row>
      <Row label="Curves">{section.result.polylines.length}</Row>
    </Section>
  );
}

function DisplaySettings() {
  const { unit, precision } = useUnits();
  const set = (patch: { displayUnit?: DisplayUnit; displayPrecision?: number }) =>
    useProject.getState().apply((p) => ({ ...p, cad: { ...cadOf(p), ...patch } }), 'cad-display');
  return (
    <Section title="Display">
      <Field label="Units">
        <Select aria-label="Display units" value={unit} onChange={(e) => set({ displayUnit: e.currentTarget.value as DisplayUnit })}>
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="in">in</option>
        </Select>
      </Field>
      <Field label="Decimals">
        <NumberField value={precision} min={0} max={6} step={1} precision={0} onCommit={(v) => set({ displayPrecision: Math.round(v) })} />
      </Field>
      <Button size="sm" variant="outline" data-testid="cad-export-report" onClick={() => void exportCadReport()}>
        <FileDown /> Export report…
      </Button>
    </Section>
  );
}

function WorkpieceSection({ m }: { m: CadModelData }) {
  const binding = useProject((s) => s.project?.cad?.activeWorkpiece ?? null);
  const { unit, precision } = useUnits();
  const usable = rankCylinders(m).some((r) => r.usable);
  return (
    <Section title="Rotary workpiece">
      {binding && binding.modelId === m.modelId ? (
        <>
          <Row label="Bound cylinder" testId="cad-workpiece-binding">
            Ø {formatLength(binding.diameterMm, unit, precision)} × {formatLength(binding.axialMaxMm - binding.axialMinMm, unit, precision)}
          </Row>
          <Row label="Seam">
            {binding.seamAngleDeg.toFixed(2)}°{binding.reversed && ' · reversed'}
          </Row>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => useCad.getState().setWorkpieceDialog(true)}>
              Change…
            </Button>
            <Button size="sm" variant="ghost" onClick={detachCadWorkpiece}>
              Detach
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {usable ? 'Align a cylindrical surface to the rotary axis and set the cylinder workpiece from it.' : 'No outer full cylinder was found in this model.'}
          </p>
          <Button size="sm" variant="outline" disabled={!usable} data-testid="cad-use-workpiece" onClick={() => useCad.getState().setWorkpieceDialog(true)}>
            <Cylinder /> Use CAD model as workpiece…
          </Button>
        </>
      )}
    </Section>
  );
}

export function CadInspector() {
  const models = useCad((s) => s.models);
  const activeId = useCad((s) => s.activeModelId);
  const selection = useCad((s) => s.selection);
  const inProject = useProject((s) => s.project?.cad?.models.some((r) => r.id === activeId) ?? false);
  const m = activeId && inProject ? models[activeId] : undefined;
  const sel = m ? selection.filter((p) => p.modelId === m.modelId) : [];
  return (
    <div className="h-full overflow-auto bg-card" data-testid="cad-inspector">
      {!m && <p className="p-3 text-[11px] text-muted-foreground">Select or import a model to inspect it.</p>}
      {m && sel.length === 1 && sel[0]!.kind === 'face' && <FaceProps m={m} index={sel[0]!.index} />}
      {m && sel.length === 1 && sel[0]!.kind === 'edge' && <EdgeProps m={m} index={sel[0]!.index} />}
      {m && sel.length === 1 && sel[0]!.kind === 'vertex' && <VertexProps m={m} index={sel[0]!.index} />}
      {m && sel.length > 1 && (
        <Section title="Selection">
          <Row label="Selected">
            {sel.filter((p) => p.kind === 'face').length} face(s), {sel.filter((p) => p.kind === 'edge').length} edge(s), {sel.filter((p) => p.kind === 'vertex').length} vertex(es)
          </Row>
          {sel.every((p) => p.kind === 'face') && cylinderForFace(m, sel[0]!.index) && <FaceProps m={m} index={sel[0]!.index} />}
        </Section>
      )}
      {m && <QuickMeasure m={m} sel={sel} />}
      <SectionPanel />
      <Measurements />
      {m && sel.length === 0 && <ModelSummary m={m} />}
      {m && <WorkpieceSection m={m} />}
      <DisplaySettings />
    </div>
  );
}
