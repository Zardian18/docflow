import { cn } from '@/lib/utils';

export type PillTone = 'amber' | 'blue' | 'green' | 'red' | 'grey';

const toneClasses: Record<PillTone, string> = {
  amber: 'bg-status-amber-bg text-status-amber',
  blue: 'bg-status-blue-bg text-status-blue',
  green: 'bg-status-green-bg text-status-green',
  red: 'bg-status-red-bg text-status-red',
  grey: 'bg-status-grey-bg text-status-grey',
};

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ActivePill({ active }: { active: boolean }) {
  return <StatusPill tone={active ? 'green' : 'grey'}>{active ? 'Active' : 'Inactive'}</StatusPill>;
}
