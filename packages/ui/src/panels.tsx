import type { ComponentProps } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

import { cn } from './cn';

export { useDefaultLayout } from 'react-resizable-panels';

export function PanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return <Group className={cn('h-full w-full', className)} {...props} />;
}

export function ResizablePanel({ className, ...props }: ComponentProps<typeof Panel>) {
  return <Panel className={cn('min-h-0 min-w-0', className)} {...props} />;
}

export function ResizeHandle({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        'relative shrink-0 bg-border transition-colors outline-none data-[separator=hover]:bg-primary/60 data-[separator=active]:bg-primary aria-[orientation=horizontal]:h-px aria-[orientation=vertical]:w-px',
        "after:absolute after:inset-0 after:content-[''] aria-[orientation=horizontal]:after:-inset-y-1 aria-[orientation=vertical]:after:-inset-x-1",
        className,
      )}
      {...props}
    />
  );
}
