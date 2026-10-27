import { Label as LabelPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';

import { cn } from './cn';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-input bg-input/30 px-2 text-xs tabular-nums outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-[11px] text-muted-foreground select-none', className)} {...props} />;
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3 rounded-full bg-foreground shadow transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-7 w-full rounded-md border border-input bg-input/30 px-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-popover',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export interface NumberFieldProps {
  value: number;
  onCommit: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * Numeric input that commits on Enter/blur, validates range, and supports arrow-key nudging
 * (Shift = x10). Invalid text reverts to the last committed value.
 */
export function NumberField({ value, onCommit, unit, min, max, step = 1, precision = 3, disabled, className, ...rest }: NumberFieldProps) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(precision))) : '');
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(v)) {
      setText(fmt(value));
      return;
    }
    const c = clamp(v);
    setText(fmt(c));
    if (c !== value) onCommit(c);
  };
  return (
    <div className={cn('relative flex items-center', className)}>
      <Input
        {...rest}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        className={unit ? 'pr-7' : undefined}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          commit(e.currentTarget.value);
        }}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          else if (e.key === 'Escape') setText(fmt(value));
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const c = clamp(Number((value + d).toFixed(precision)));
            onCommit(c);
          }
        }}
      />
      {unit && <span className="pointer-events-none absolute right-2 text-[10px] text-muted-foreground">{unit}</span>}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[minmax(72px,40%)_1fr] items-center gap-2', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Badge({ className, tone = 'default', ...props }: ComponentProps<'span'> & { tone?: 'default' | 'sim' | 'warn' | 'danger' | 'ok' | 'muted' }) {
  const tones = {
    default: 'bg-secondary text-secondary-foreground',
    sim: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40',
    warn: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40',
    danger: 'bg-red-500/20 text-red-300 ring-1 ring-red-500/50',
    ok: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40',
    muted: 'bg-muted text-muted-foreground',
  } as const;
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', tones[tone], className)}
      {...props}
    />
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn(vertical ? 'mx-1 h-5 w-px' : 'my-2 h-px w-full', 'shrink-0 bg-border', className)} />;
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b border-border px-3 py-2.5', className)}>
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {actions}
      </header>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}
