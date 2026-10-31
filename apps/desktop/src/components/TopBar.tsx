import { Badge, Button, Separator, Tooltip, cn } from '@ols/ui';
import { Box, Cylinder, FileDown, FilePlus2, FolderOpen, ImagePlus, OctagonX, PenTool, Radar, Redo2, Save, SaveAll, Square, Undo2, Upload } from 'lucide-react';

import { exportGcode, importImage, importSvg, newSampleProject, openProject, saveProject } from '@/lib/actions';
import { importCadDialog } from '@/lib/cad';
import { connectionLabel, useDevices } from '@/stores/devices';
import { useMachine } from '@/stores/machine';
import { useProject } from '@/stores/project';
import { useSettings } from '@/stores/settings';
import { useView } from '@/stores/view';

import { SafetyPill } from './SafetyPill';

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip content={label}>
      <Button size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function TopBar() {
  const name = useProject((s) => s.project?.name ?? '');
  const mode = useProject((s) => s.project?.mode ?? 'flat');
  const dirty = useProject((s) => s.dirty);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const setMode = useProject((s) => s.setMode);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const snapshot = useMachine((s) => s.snapshot);
  const command = useMachine((s) => s.command);
  const settings = useSettings((s) => s.settings);
  const workspace = useView((s) => s.workspace);
  const setWorkspace = useView((s) => s.setWorkspace);
  const machineHost = useProject((s) => s.project?.machine.host ?? '');
  const setDeviceOpen = useDevices((s) => s.setOpen);
  const lockMode = !!snapshot && ['ARMED', 'RUNNING', 'PAUSED', 'STOPPING'].includes(snapshot.safetyState);

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
      <div className="mr-2 flex items-center gap-2">
        <div className="size-5 rounded-sm bg-gradient-to-br from-orange-400 to-red-600" aria-hidden />
        <span className="text-xs font-semibold">Open Laser Studio</span>
        <span className="max-w-48 truncate text-xs text-muted-foreground" title={name}>
          {name}
          {dirty && <span className="ml-1 text-primary">●</span>}
        </span>
      </div>
      <IconButton label="New (sample project)" onClick={() => void newSampleProject()}>
        <FilePlus2 />
      </IconButton>
      <IconButton label="Open… (Ctrl+O)" onClick={() => void openProject()}>
        <FolderOpen />
      </IconButton>
      <IconButton label="Save (Ctrl+S)" onClick={() => void saveProject(false)}>
        <Save />
      </IconButton>
      <IconButton label="Save as… (Ctrl+Shift+S)" onClick={() => void saveProject(true)}>
        <SaveAll />
      </IconButton>
      <Separator vertical />
      <IconButton label="Import SVG (Ctrl+I)" onClick={() => void importSvg()}>
        <Upload />
      </IconButton>
      <IconButton label="Import image" onClick={() => void importImage()}>
        <ImagePlus />
      </IconButton>
      <IconButton label="Import CAD model (STEP, STL, 3MF)" onClick={() => void importCadDialog()}>
        <Box />
      </IconButton>
      <IconButton label="Export G-code (inspection only)" onClick={() => void exportGcode()}>
        <FileDown />
      </IconButton>
      <Separator vertical />
      <div className="flex items-center rounded-md border border-border p-0.5" role="radiogroup" aria-label="Workspace">
        {(
          [
            ['design', 'Design', PenTool],
            ['cad', 'CAD', Box],
          ] as const
        ).map(([w, label, Icon]) => (
          <Button
            key={w}
            size="sm"
            role="radio"
            aria-checked={workspace === w}
            data-testid={`workspace-${w}`}
            className={cn(workspace === w && 'bg-accent text-foreground')}
            onClick={() => setWorkspace(w)}
          >
            <Icon /> {label}
          </Button>
        ))}
      </div>
      <Separator vertical />
      <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>
      <Separator vertical />
      <div className="flex items-center rounded-md border border-border p-0.5" role="radiogroup" aria-label="Workspace mode">
        {(
          [
            ['flat', 'Flat', Square],
            ['cylinder', 'Cylinder', Cylinder],
          ] as const
        ).map(([m, label, Icon]) => (
          <Button
            key={m}
            size="sm"
            role="radio"
            aria-checked={mode === m}
            data-testid={`mode-${m}`}
            disabled={lockMode}
            className={cn(mode === m && 'bg-accent text-foreground')}
            onClick={() => setMode(m)}
          >
            <Icon /> {label}
          </Button>
        ))}
      </div>

      <div className="flex-1" />

      <Tooltip content="Find an xTool laser over Wi-Fi or USB (read-only). Jobs still run on the simulator.">
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2" data-testid="find-device" onClick={() => setDeviceOpen(true)}>
          <Radar />
          <span className="max-w-36 truncate text-[11px]">{connectionLabel(machineHost)}</span>
        </Button>
      </Tooltip>
      <Separator vertical />

      <div className="flex items-center gap-1.5">
        {snapshot?.simulated !== false && (
          <Tooltip content="All devices are simulated. Nothing is sent to real hardware.">
            <Badge tone="sim" data-testid="mode-badge">
              Simulation
            </Badge>
          </Tooltip>
        )}
        {settings.developerMode && <Badge tone="warn">Developer mode</Badge>}
        {!settings.simulationOnly && <Badge tone="danger">Hardware reads enabled</Badge>}
        {snapshot && <SafetyPill state={snapshot.safetyState} />}
        {snapshot?.laserOn && <Badge tone="danger">Laser on (sim)</Badge>}
      </div>
      <Separator vertical />
      <Tooltip content="Emergency stop (latching). Requires an explicit reset.">
        <Button variant="estop" size="default" className="h-8 px-4" data-testid="estop" onClick={() => void command({ cmd: 'estop' })} disabled={!snapshot}>
          <OctagonX /> E-Stop
        </Button>
      </Tooltip>
    </header>
  );
}
