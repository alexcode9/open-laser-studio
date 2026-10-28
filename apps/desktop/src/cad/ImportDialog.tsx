import { type SourceLengthUnit, UNIT_TO_MM } from '@ols/shared-types';
import { Button, Dialog, cn } from '@ols/ui';
import { useEffect, useState } from 'react';

import { cancelCadImport, confirmCadUnits } from '@/lib/cad';
import { useCad } from '@/stores/cad';

const STAGE_LABEL: Record<string, string> = {
  reading: 'Reading file',
  transferring: 'Translating geometry',
  meshing: 'Tessellating',
  analyzing: 'Analysing topology',
  features: 'Detecting features',
  done: 'Finishing',
};

const UNITS: [SourceLengthUnit, string][] = [
  ['mm', 'Millimetres'],
  ['cm', 'Centimetres'],
  ['m', 'Metres'],
  ['in', 'Inches'],
  ['ft', 'Feet'],
  ['um', 'Micrometres'],
];

function ProgressDialog() {
  const job = useCad((s) => s.job);
  // The native file dialog is still open until the first progress event names the file.
  const visible = !!job && (job.fraction > 0 || job.fileName !== 'CAD model');
  return (
    <Dialog
      open={visible}
      onOpenChange={() => undefined}
      modalLocked
      title={`Importing ${job?.fileName ?? ''}`}
      description="The file is processed in an isolated worker; the rest of the app stays responsive."
      footer={
        <Button variant="outline" data-testid="cad-import-cancel" onClick={() => void cancelCadImport()}>
          Cancel
        </Button>
      }
    >
      <div className="space-y-1.5" data-testid="cad-import-progress">
        <div className="text-xs text-muted-foreground">{job ? (STAGE_LABEL[job.stage] ?? job.stage) : ''}…</div>
        <div className="h-1.5 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((job?.fraction ?? 0) * 100)}%` }} />
        </div>
      </div>
    </Dialog>
  );
}

function UnitDialog() {
  const modelId = useCad((s) => s.unitPrompt);
  const model = useCad((s) => (s.unitPrompt ? s.models[s.unitPrompt] : undefined));
  const busy = useCad((s) => !!s.job);
  const [unit, setUnit] = useState<SourceLengthUnit>('mm');
  useEffect(() => {
    if (model) setUnit((UNITS.find(([u]) => u === model.declaredUnit)?.[0] ?? 'mm') as SourceLengthUnit);
  }, [model]);
  if (!model) return null;
  const raw = model.bounds.size.map((v) => v / model.unitScaleToMm);
  const preview = (u: SourceLengthUnit) => raw.map((v) => (v * UNIT_TO_MM[u]).toPrecision(4)).join(' × ');
  return (
    <Dialog
      open={!!modelId && !busy}
      onOpenChange={(o) => !o && useCad.getState().setUnitPrompt(null)}
      title="Confirm model units"
      description={`${model.fileName} is a mesh file without unit information. Choose the unit it was exported in; measurements depend on it.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => useCad.getState().setUnitPrompt(null)}>
            Decide later
          </Button>
          <Button data-testid="cad-units-confirm" onClick={() => void confirmCadUnits(model.modelId, unit)}>
            Use {unit}
          </Button>
        </>
      }
    >
      <div className="grid gap-1" role="radiogroup" aria-label="Source unit">
        {UNITS.map(([u, label]) => (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={unit === u}
            data-testid={`cad-unit-${u}`}
            onClick={() => setUnit(u)}
            className={cn('flex items-center justify-between rounded border px-2 py-1 text-left text-xs', unit === u ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/50')}
          >
            <span>{label}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{preview(u)} mm</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export function ImportDialog() {
  return (
    <>
      <ProgressDialog />
      <UnitDialog />
    </>
  );
}
