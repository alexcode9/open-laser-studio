import { Badge, Button, Dialog, Field, NumberField, Switch, cn } from '@ols/ui';
import { useEffect, useMemo, useState } from 'react';

import { applyCadWorkpiece } from '@/lib/cad';
import { useCad } from '@/stores/cad';
import { useProject } from '@/stores/project';
import { useView } from '@/stores/view';

import { formatDir, formatLength } from './format';
import { cylinderForFace, rankCylinders } from './workpiece';

export function UseAsWorkpieceDialog() {
  const open = useCad((s) => s.workpieceDialog);
  const model = useCad((s) => (s.activeModelId ? s.models[s.activeModelId] : undefined));
  const selection = useCad((s) => s.selection);
  const binding = useProject((s) => s.project?.cad?.activeWorkpiece ?? null);
  const current = useProject((s) => s.project?.workpiece);
  const ranked = useMemo(() => (model ? rankCylinders(model) : []), [model]);
  const [cylinderId, setCylinderId] = useState<string | null>(null);
  const [seam, setSeam] = useState(0);
  const [reversed, setReversed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Initial choice: the bound cylinder, then the cylinder under the selected face, then the best ranked one.
  useEffect(() => {
    if (!open || !model) return;
    const fromBinding = binding?.modelId === model.modelId ? binding : null;
    const sel = selection.find((p) => p.modelId === model.modelId && p.kind === 'face');
    const fromSel = sel ? cylinderForFace(model, sel.index) : null;
    const usable = (id: string | undefined) => ranked.find((r) => r.feature.id === id && r.usable)?.feature.id;
    setCylinderId(usable(fromBinding?.cylinderId) ?? usable(fromSel?.id) ?? ranked.find((r) => r.usable)?.feature.id ?? null);
    setSeam(fromBinding?.seamAngleDeg ?? 0);
    setReversed(fromBinding?.reversed ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model]);

  useEffect(() => {
    if (open && model && cylinderId) useCad.getState().setPreview({ modelId: model.modelId, cylinderId });
  }, [open, model, cylinderId]);

  if (!model) return null;
  const chosen = ranked.find((r) => r.feature.id === cylinderId);
  const close = () => useCad.getState().setWorkpieceDialog(false);
  const apply = async () => {
    if (!chosen) return;
    setBusy(true);
    const ok = await applyCadWorkpiece(model.modelId, chosen.feature.id, seam, reversed);
    setBusy(false);
    if (ok) {
      close();
      useView.getState().setWorkspace('design');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Use CAD model as workpiece"
      description="Choose the cylindrical surface that sits in the rotary chuck. The model is aligned so this axis becomes the rotary axis."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button data-testid="cad-workpiece-apply" disabled={!chosen?.usable || busy} onClick={() => void apply()}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="max-h-56 space-y-1 overflow-auto" role="radiogroup" aria-label="Cylinder">
          {ranked.length === 0 && <p className="text-xs text-muted-foreground">No cylindrical features were detected in this model.</p>}
          {ranked.map((r, i) => (
            <button
              key={r.feature.id}
              type="button"
              role="radio"
              aria-checked={cylinderId === r.feature.id}
              disabled={!r.usable}
              data-testid="cad-workpiece-option"
              onClick={() => setCylinderId(r.feature.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50',
                cylinderId === r.feature.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/50',
              )}
            >
              <span className="font-mono">
                Ø {formatLength(r.feature.diameterMm, 'mm', 3)} × {formatLength(r.feature.lengthMm, 'mm', 3)}
              </span>
              <span className="flex-1 truncate text-[11px] text-muted-foreground">axis {formatDir(r.feature.axisDirection)}</span>
              {i === 0 && r.usable && <Badge tone="ok">suggested</Badge>}
              {r.problem && <Badge tone="warn">{r.problem}</Badge>}
            </button>
          ))}
        </div>
        {chosen?.reason && <p className="text-[11px] text-muted-foreground">{chosen.reason}</p>}
        <Field label="Seam angle">
          <NumberField aria-label="Seam angle" value={seam} unit="°" min={-360} max={360} step={15} precision={2} onCommit={setSeam} />
        </Field>
        <Field label="Reverse axis">
          <Switch aria-label="Reverse axis" checked={reversed} onCheckedChange={setReversed} />
        </Field>
        {chosen && current && (
          <div className="rounded border border-border bg-muted/30 p-2 text-[11px]">
            <div className="mb-1 font-semibold">Changes</div>
            <div className="font-mono">
              Workpiece Ø {current.diameterMm.toFixed(3)} → {chosen.feature.diameterMm.toFixed(3)} mm
            </div>
            <div className="font-mono">
              Length {current.lengthMm.toFixed(3)} → {chosen.feature.lengthMm.toFixed(3)} mm
            </div>
            <div className="mt-1 text-muted-foreground">Mode switches to cylinder. Machine calibration, angular zero and axial zero are not changed.</div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
