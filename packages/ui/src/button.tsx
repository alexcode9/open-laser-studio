import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from './cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/75',
        outline: 'border border-border bg-transparent hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/85',
        estop: 'bg-red-600 text-white font-bold uppercase tracking-wide hover:bg-red-500 shadow-[0_0_0_2px_rgba(250,204,21,0.9)]',
      },
      size: {
        default: 'h-7 px-3',
        sm: 'h-6 px-2',
        lg: 'h-9 px-4 text-sm',
        icon: 'size-7',
        iconSm: 'size-6',
      },
      active: { true: 'bg-accent text-accent-foreground ring-1 ring-primary/60', false: '' },
    },
    defaultVariants: { variant: 'ghost', size: 'default', active: false },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, active, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size, active }), className)} {...props} />;
}
