import type { CadModelData, CadModelRef, CadPartNode } from '@ols/shared-types';
import { Badge, Button, Tooltip, cn } from '@ols/ui';
import { AlertTriangle, Box, ChevronDown, ChevronRight, CircleDot, Cylinder, Eye, EyeOff, Focus, Loader2, Maximize, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { importCadDialog, removeCadModel } from '@/lib/cad';
import { useCad } from '@/stores/cad';
import { useProject } from '@/stores/project';

import { formatLength } from './format';
import { cadOf } from './workpiece';

function setHidden(modelId: string, part: number, hidden: boolean): void {
  useProject.getState().apply(
    (p) => {
      const c = cadOf(p);
      return {
        ...p,
        cad: {
          ...c,
          models: c.models.map((m) =>
            m.id === modelId ? { ...m, hiddenParts: hidden ? [...new Set([...m.hiddenParts, part])].sort((a, b) => a - b) : m.hiddenParts.filter((x) => x !== part) } : m,
          ),
        },
      };
    },
    `cad-hide-${modelId}`,
  );
}

function PartRow({ node, modelRef, depth, isolatable }: { node: CadPartNode; modelRef: CadModelRef; depth: number; isolatable: boolean }) {
  const [open, setOpen] = useState(depth < 2);
  const leaf = node.partIndex !== undefined;
  const hidden = leaf && modelRef.hiddenParts.includes(node.partIndex!);
  const isolated = useCad((s) => s.isolated);
  const isIsolated = leaf && isolated?.modelId === modelRef.id && isolated.partIndex === node.partIndex;
  return (
    <>
      <div className="flex h-6 items-center gap-1 pr-1 text-[11px] hover:bg-accent/50" style={{ paddingLeft: 6 + depth * 12 }}>
        {node.children.length > 0 ? (
          <button type="button" className="text-muted-foreground" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <Box className="size-3 shrink-0 text-muted-foreground" />
        <span className={cn('flex-1 truncate', hidden && 'text-muted-foreground line-through', isIsolated && 'font-medium text-cyan-200')} title={node.name}>
          {node.name}
        </span>
        {leaf && isolatable && (
          <button
            type="button"
            aria-label={isIsolated ? `Show all parts` : `Isolate ${node.name}`}
            data-testid="cad-isolate-part"
            className={cn('text-muted-foreground hover:text-foreground', isIsolated && 'text-cyan-300')}
            onClick={() => useCad.getState().setIsolated(isIsolated ? null : { modelId: modelRef.id, partIndex: node.partIndex! })}
          >
            <Focus className="size-3" />
          </button>
        )}
        {leaf && (
          <button type="button" aria-label={hidden ? `Show ${node.name}` : `Hide ${node.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => setHidden(modelRef.id, node.partIndex!, !hidden)}>
            {hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          </button>
        )}
      </div>
      {open && node.children.map((c) => <PartRow key={c.id} node={c} modelRef={modelRef} depth={depth + 1} isolatable={isolatable} />)}
    </>
  );
}

function selectFaces(model: CadModelData, faces: number[]): void {
  const st = useCad.getState();
  st.setTool('select');
  st.select(null);
  for (const f of faces) {
    const info = model.faces[f];
    if (info) st.select({ modelId: model.modelId, kind: 'face', index: f, point: info.centroid, face: f }, true);
  }
}

function Features({ model }: { model: CadModelData }) {
  const unit = useProject((s) => s.project?.cad?.displayUnit ?? 'mm');
  const { cylinders, circles } = model.features;
  const holes = circles.filter((c) => c.kind !== 'circular-edge');
  if (cylinders.length === 0 && holes.length === 0) return null;
  return (
    <div className="mt-1 border-t border-border/60 pt-1">
      <div className="px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Features</div>
      {cylinders.map((c) => (
        <button
          key={c.id}
          type="button"
          data-testid="cad-feature-cylinder"
          className="flex h-6 w-full items-center gap-1.5 px-2 text-left text-[11px] hover:bg-accent/50"
          onClick={() => selectFaces(model, c.faceIndices)}
          title={`${c.faceIndices.length} face(s) · ${c.quality}`}
        >
          <Cylinder className="size-3 shrink-0 text-cyan-300" />
          <span className="flex-1 truncate font-mono">
            Ø{formatLength(c.diameterMm, unit, 3)} × {formatLength(c.lengthMm, unit, 2)}
          </span>
          <span className="text-[10px] text-muted-foreground">{c.inner === true ? 'bore' : c.inner === false ? 'outer' : '—'}</span>
        </button>
      ))}
      {holes.map((h) => (
        <button key={h.id} type="button" className="flex h-6 w-full items-center gap-1.5 px-2 text-left text-[11px] hover:bg-accent/50" onClick={() => selectFaces(model, h.faceIndices)}>
          <CircleDot className="size-3 shrink-0 text-amber-300" />
          <span className="flex-1 truncate font-mono">
            {h.kind} Ø{formatLength(h.diameterMm, unit, 3)}
          </span>
          {h.through !== undefined && <span className="text-[10px] text-muted-foreground">{h.through ? 'through' : 'blind'}</span>}
        </button>
      ))}
    </div>
  );
}

const NO_MODELS: CadModelRef[] = [];

export function ModelTree() {
  const refs = useProject((s) => s.project?.cad?.models ?? NO_MODELS);
  const models = useCad((s) => s.models);
  const status = useCad((s) => s.status);
  const activeId = useCad((s) => s.activeModelId);
  const isolated = useCad((s) => s.isolated);
  return (
    <div className="flex h-full flex-col bg-card" data-testid="cad-model-tree">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Models</span>
        <div className="flex items-center gap-0.5">
          {isolated && (
            <Tooltip content="Show all parts">
              <Button size="iconSm" aria-label="Show all parts" data-testid="cad-show-all" onClick={() => useCad.getState().setIsolated(null)}>
                <Eye />
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Import CAD model (STEP, STL, 3MF)">
            <Button size="iconSm" aria-label="Import CAD model" onClick={() => void importCadDialog()}>
              <Plus />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {refs.length === 0 && <p className="px-3 py-4 text-[11px] text-muted-foreground">No CAD models. Import a STEP, STL or 3MF file, or drop it on the viewer.</p>}
        {refs.map((ref) => {
          const data = models[ref.id];
          const st = status[ref.id];
          return (
            <div key={ref.id} className={cn('mb-1', activeId === ref.id && 'bg-accent/30')}>
              <div className="flex h-7 items-center gap-1 px-2" onClick={() => useCad.getState().setActive(ref.id)}>
                {st?.state === 'loading' ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : st && st.state !== 'ready' ? (
                  <Tooltip content={st.message}>
                    <AlertTriangle className="size-3.5 text-amber-400" />
                  </Tooltip>
                ) : (
                  <Box className="size-3.5 text-sky-300" />
                )}
                <span className="flex-1 truncate text-xs font-medium" title={ref.fileName}>
                  {ref.name}
                </span>
                <Badge tone={ref.sourceType === 'step' ? 'ok' : 'warn'}>{ref.sourceType}</Badge>
                {!ref.unitsConfirmed && (
                  <Tooltip content="Units not confirmed">
                    <Badge tone="warn">units?</Badge>
                  </Tooltip>
                )}
                <Tooltip content="Fit view">
                  <Button
                    size="iconSm"
                    aria-label={`Fit ${ref.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      useCad.getState().setActive(ref.id);
                      useCad.getState().requestView('fit');
                    }}
                  >
                    <Maximize />
                  </Button>
                </Tooltip>
                <Tooltip content="Remove from project">
                  <Button
                    size="iconSm"
                    aria-label={`Remove ${ref.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeCadModel(ref.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </Tooltip>
              </div>
              {data && data.tree.map((n) => <PartRow key={n.id} node={n} modelRef={ref} depth={1} isolatable={data.parts.length > 1} />)}
              {data && <Features model={data} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
