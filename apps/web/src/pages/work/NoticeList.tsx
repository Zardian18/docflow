import type { Notice } from '@docflow/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Receipt } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { waitedFor } from '@/lib/labels';

/**
 * "Shared with you" on My Work (D29): private messages someone tagged this person in, and
 * payment proofs for approvers. Nothing to do but read; each stays until marked read.
 */
export function NoticeList({ notices }: { notices: Notice[] }) {
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationFn: (id: string) => api.notices.read(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work'] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (notices.length === 0) {
    return (
      <EmptyState title="Nothing shared with you">
        Private messages you’re tagged in, and payment proofs for approvers, show up here.
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Shared with you">
      {notices.map((n) => (
        <li key={n.id} className="bg-card flex flex-col gap-2 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                {n.kind === 'PRIVATE_MESSAGE' ? (
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <Receipt className="size-3.5 shrink-0" aria-hidden />
                )}
                {n.kind === 'PRIVATE_MESSAGE'
                  ? `${n.actorName ?? 'Someone'} shared a private message with you`
                  : `${n.actorName ?? 'Accounts'} uploaded a payment proof`}
              </p>
              <Link
                to={`/orders/${n.orderId}${n.taskId ? `#task-${n.taskId}` : ''}`}
                className="text-primary text-[13px] hover:underline"
              >
                {n.orderRef} · {n.buyerName} · {n.title}
              </Link>
            </div>
            <span className="text-muted-foreground text-xs" title={formatDateTime(n.at)}>
              {waitedFor(n.at)} ago
            </span>
          </div>
          {n.comment && <p className="text-[13px] whitespace-pre-wrap">“{n.comment}”</p>}
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={read.isPending && read.variables === n.id}
              onClick={() => read.mutate(n.id)}
            >
              <Check aria-hidden /> Mark as read
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
