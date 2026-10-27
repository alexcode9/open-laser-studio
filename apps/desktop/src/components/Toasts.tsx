import { cn } from '@ols/ui';
import { X } from 'lucide-react';

import { useView } from '@/stores/view';

export function Toasts() {
  const toasts = useView((s) => s.toasts);
  const dismiss = useView((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-50 flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-lg',
            t.tone === 'error' && 'border-red-500/50 bg-red-950/90 text-red-100',
            t.tone === 'warn' && 'border-amber-500/50 bg-amber-950/90 text-amber-100',
            t.tone === 'info' && 'border-border bg-popover text-popover-foreground',
          )}
        >
          <span className="flex-1 break-words">{t.message}</span>
          <button type="button" className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
