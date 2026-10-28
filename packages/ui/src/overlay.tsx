import { AlertDialog as AD, Dialog as DialogPrimitive, Tabs as TabsPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from './button';
import { cn } from './cn';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

/** Explicit confirmation for safety-relevant actions (arming, resets). */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, confirmDisabled, onConfirm, children }: ConfirmDialogProps) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AD.Content className="fixed top-1/2 left-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl">
          <AD.Title className="text-sm font-semibold">{title}</AD.Title>
          <AD.Description asChild>
            <div className="mt-2 text-xs text-muted-foreground">{description}</div>
          </AD.Description>
          {children && <div className="mt-3">{children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <AD.Cancel asChild>
              <Button variant="outline">Cancel</Button>
            </AD.Cancel>
            <AD.Action asChild>
              <Button variant={destructive ? 'destructive' : 'default'} disabled={confirmDisabled} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AD.Action>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Block closing via Escape / outside click (e.g. while work is in progress). */
  modalLocked?: boolean;
}

/** General-purpose modal dialog. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className, modalLocked }: DialogProps) {
  const block = (e: Event) => {
    if (modalLocked) e.preventDefault();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl',
            className,
          )}
        >
          <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description asChild>
              <div className="mt-2 text-xs text-muted-foreground">{description}</div>
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          {children && <div className="mt-3">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex h-8 shrink-0 items-center gap-0.5 border-b border-border px-1', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('min-h-0 flex-1 overflow-auto outline-none data-[state=inactive]:hidden', className)} {...props} />;
}
