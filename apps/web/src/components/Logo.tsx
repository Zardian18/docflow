import { FileCheck2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The blue tile from the designs, with a document-check glyph so it reads as a mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-primary text-primary-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
        className,
      )}
    >
      <FileCheck2 className="size-[58%]" strokeWidth={2.25} />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">DocFlow</span>
    </span>
  );
}
