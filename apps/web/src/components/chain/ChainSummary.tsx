import { groupBySteps, type CompanyApprover } from '@docflow/shared';
import { ArrowRight } from 'lucide-react';
import { Fragment } from 'react';

/**
 * "1. R. Shah → 2. P. Kulkarni → CFO", as in screen 03. A parallel step reads
 * "2. A. Nair & D. Singh". Wraps cleanly on narrow screens.
 */
export function ChainSummary({ approvers }: { approvers: CompanyApprover[] }) {
  const steps = groupBySteps(approvers);
  return (
    <span className="text-muted-foreground flex max-w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {steps.map((group, i) => (
        <Fragment key={group[0]!.position}>
          <span className="min-w-0 break-words">
            {i + 1}. {group.map((a) => a.name).join(' & ')}
          </span>
          <ArrowRight className="size-3.5 shrink-0" aria-label="then" />
        </Fragment>
      ))}
      <span>CFO</span>
    </span>
  );
}
