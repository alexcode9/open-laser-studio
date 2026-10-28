import { PanelGroup, ResizablePanel, ResizeHandle, cn } from '@ols/ui';
import { Upload } from 'lucide-react';
import { type DragEvent, useState } from 'react';

import { importCadFile } from '@/lib/cad';
import { toast } from '@/stores/view';

import { CadInspector } from './CadInspector';
import { CadViewer } from './CadViewer';
import { ModelTree } from './ModelTree';

const ACCEPTED = /\.(step|stp|stl|3mf)$/i;

export function CadWorkspace() {
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = [...e.dataTransfer.files][0];
    if (!file) return;
    if (!ACCEPTED.test(file.name)) {
      toast('warn', `${file.name}: only STEP (.step, .stp), STL and 3MF files can be imported.`);
      return;
    }
    void importCadFile(file);
  };
  return (
    <div
      className="relative h-full"
      data-testid="cad-workspace"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <PanelGroup orientation="horizontal" id="cad-split">
        <ResizablePanel id="cad-tree" defaultSize="20%" minSize={160}>
          <ModelTree />
        </ResizablePanel>
        <ResizeHandle />
        <ResizablePanel id="cad-viewer" defaultSize="54%" minSize="25%">
          <CadViewer />
        </ResizablePanel>
        <ResizeHandle />
        <ResizablePanel id="cad-inspector" defaultSize="26%" minSize={220}>
          <CadInspector />
        </ResizablePanel>
      </PanelGroup>
      <div
        className={cn(
          'pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/70 bg-primary/10 text-sm text-primary transition-opacity',
          dragging ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Upload className="mr-2 size-4" /> Drop a STEP, STL or 3MF file to import
      </div>
    </div>
  );
}
