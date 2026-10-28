import { PanelGroup, ResizablePanel, ResizeHandle, TooltipProvider } from '@ols/ui';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CadWorkspace } from './cad/CadWorkspace';
import { ImportDialog } from './cad/ImportDialog';
import { UseAsWorkpieceDialog } from './cad/UseAsWorkpieceDialog';
import { BottomPanel } from './components/BottomPanel';
import { RightPanel } from './components/RightPanel';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { ToolRail } from './components/ToolRail';
import { TopBar } from './components/TopBar';
import { DesignCanvas } from './editor/DesignCanvas';
import { useShortcuts } from './lib/shortcuts';
import { call, errorMessage } from './lib/ipc';
import { CylinderView } from './preview/CylinderView';
import { useMachine } from './stores/machine';
import { startPlaybackLoop } from './stores/playback';
import { useProject } from './stores/project';
import { useSettings } from './stores/settings';
import { useView } from './stores/view';

let booted: Promise<void> | null = null;

async function boot(): Promise<void> {
  await useSettings.getState().load();
  if (useSettings.getState().info?.nativeError) return;
  useProject.getState().load(await call('project:sample'), null);
  await useMachine.getState().init();
  startPlaybackLoop();
}

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const nativeError = useSettings((s) => s.info?.nativeError ?? null);
  const workspace = useView((s) => s.workspace);
  useShortcuts();

  useEffect(() => {
    booted ??= boot();
    booted.then(() => setReady(true)).catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (error || nativeError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-lg rounded-lg border border-red-500/40 bg-red-500/10 p-6">
          <div className="mb-2 flex items-center gap-2 font-semibold text-red-300">
            <AlertTriangle className="size-4" /> Open Laser Studio could not start
          </div>
          <p className="text-xs whitespace-pre-wrap text-muted-foreground">{nativeError ?? error}</p>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col" data-testid="app-root">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <ToolRail />
          <PanelGroup orientation="horizontal" id="main">
            <ResizablePanel id="center" defaultSize="76%" minSize="40%">
              <PanelGroup orientation="vertical" id="center-split">
                <ResizablePanel id="views" defaultSize="68%" minSize="25%">
                  {workspace === 'cad' ? (
                    <CadWorkspace />
                  ) : (
                    <PanelGroup orientation="horizontal" id="views-split">
                      <ResizablePanel id="design" defaultSize="55%" minSize="20%">
                        <DesignCanvas />
                      </ResizablePanel>
                      <ResizeHandle />
                      <ResizablePanel id="preview3d" defaultSize="45%" minSize="15%">
                        <CylinderView />
                      </ResizablePanel>
                    </PanelGroup>
                  )}
                </ResizablePanel>
                <ResizeHandle />
                <ResizablePanel id="bottom" defaultSize="32%" minSize={120}>
                  <BottomPanel />
                </ResizablePanel>
              </PanelGroup>
            </ResizablePanel>
            <ResizeHandle />
            <ResizablePanel id="right" defaultSize="24%" minSize={260} maxSize={560}>
              <RightPanel />
            </ResizablePanel>
          </PanelGroup>
        </div>
        <StatusBar />
        <ImportDialog />
        <UseAsWorkpieceDialog />
        <Toasts />
      </div>
    </TooltipProvider>
  );
}
