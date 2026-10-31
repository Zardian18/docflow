import { Lock } from 'lucide-react';

/** Marks a private message (D29) and who it was shared with */
export function PrivateBadge({ to }: { to: string[] }) {
  return (
    <span className="bg-status-grey-bg text-foreground ml-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 align-middle text-xs whitespace-normal">
      <Lock className="size-3 shrink-0" aria-hidden />
      <span>Private{to.length > 0 ? ` · shared with ${to.join(', ')}` : ''}</span>
    </span>
  );
}
