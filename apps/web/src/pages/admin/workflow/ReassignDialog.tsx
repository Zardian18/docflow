import type { WorkflowStep } from '@docflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRoundCog } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { AsyncCombobox, type ComboOption } from '@/components/AsyncCombobox';
import { FormError } from '@/components/forms';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';

/**
 * Admin hands an undecided step to someone else (decisions.md D9): an approver who left or
 * is away, or the CFO step after the CFO was replaced. The server re-checks every rule.
 */
export function ReassignButton({ workflowId, step }: { workflowId: string; step: WorkflowStep }) {
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<ComboOption | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  const cfo = useQuery({
    queryKey: ['cfo'],
    queryFn: ({ signal }) => api.employees.cfo(signal),
    enabled: open && step.isCfo,
  });

  const save = useMutation({
    mutationFn: () =>
      api.admin.reassign(workflowId, step.id, { employeeId: person!.id, reason: reason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'detail', workflowId] });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`Step reassigned to ${person!.label}`);
      setOpen(false);
    },
  });

  const reset = () => {
    setPerson(null);
    setReason('');
    setTried(false);
    save.reset();
  };
  const missing = !person
    ? 'Choose who takes over this step.'
    : !reason.trim()
      ? 'Give a reason.'
      : undefined;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-primary h-7 shrink-0 px-2"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        aria-label={`Reassign ${step.isCfo ? 'the CFO step' : `${step.name}’s step`}`}
      >
        <UserRoundCog aria-hidden />
        <span className="hidden sm:inline">Reassign</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Reassign {step.isCfo ? 'the CFO step' : `${step.name}’s step`}
            </DialogTitle>
            <DialogDescription>
              {step.isCfo
                ? 'Use this after the CFO has been replaced: the step moves to the current active CFO.'
                : 'Hand this step to another approver, for example when someone has left or is away. The change and your reason are recorded in the activity log.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <FormError
              message={save.error ? errorMessage(save.error) : tried ? missing : undefined}
            />
            {step.isCfo ? (
              <div className="text-sm">
                <p className="text-muted-foreground mb-2 text-[13px]">New CFO</p>
                {cfo.data?.cfo ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={person?.id === cfo.data.cfo.id}
                      onChange={() =>
                        setPerson({ id: cfo.data!.cfo!.id, label: cfo.data!.cfo!.name })
                      }
                    />
                    {cfo.data.cfo.name}
                    {cfo.data.cfo.id === step.employeeId && (
                      <span className="text-muted-foreground"> (already this step’s CFO)</span>
                    )}
                  </label>
                ) : (
                  <p className="text-muted-foreground">
                    {cfo.isPending ? 'Loading…' : 'There is no active CFO.'}
                  </p>
                )}
              </div>
            ) : (
              <AsyncCombobox
                label="New approver"
                anyLabel="Choose someone"
                placeholder="Search approvers by name"
                queryKey="reassign-approvers"
                value={person}
                search={async (q, signal) =>
                  (await api.employees.approverSearch(q, signal))
                    .filter((a) => a.id !== step.employeeId)
                    .map((a) => ({ id: a.id, label: a.name, hint: a.email }))
                }
                onChange={setPerson}
              />
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId} className="text-muted-foreground text-[13px] font-normal">
                Reason (kept in the activity log)
              </Label>
              <Textarea
                id={reasonId}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setTried(true);
                if (!missing) save.mutate();
              }}
              disabled={save.isPending}
            >
              {save.isPending ? 'Reassigning…' : 'Reassign step'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
