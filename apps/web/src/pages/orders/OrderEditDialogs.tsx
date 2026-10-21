import { OrderRef, SLOT_INFO, type OrderDetail, type Slot } from '@docflow/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/forms';
import { SlotEditor } from '@/components/SlotEditor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, errorMessage } from '@/lib/api';
import { slotValueProblems, type SlotValue } from '@/lib/slots';

function useRefreshOrder(orderId: string) {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [['order', orderId], ['order-timeline', orderId], ['orders'], ['work']]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

/** The Creator (or Marketing, Admin) changes the order number, e.g. to the PI's (D27) */
export function RenameOrderDialog({
  order,
  open,
  onOpenChange,
}: {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const id = useId();
  const [ref, setRef] = useState(order.ref);
  const [problem, setProblem] = useState<string>();
  const refresh = useRefreshOrder(order.id);
  const rename = useMutation({
    mutationFn: () => api.orders.rename(order.id, ref.trim()),
    onSuccess: () => {
      toast.success(`Order number changed to ${ref.trim()}`);
      refresh();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change the order number</DialogTitle>
          <DialogDescription>
            Use the PI number, so everyone finds the order by it. The change is kept in the history.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`${id}-form`}
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const checked = OrderRef.safeParse(ref);
            if (!checked.success) return setProblem(checked.error.issues[0]?.message);
            setProblem(undefined);
            rename.mutate();
          }}
        >
          <FormError message={problem ?? (rename.error ? errorMessage(rename.error) : undefined)} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-ref`} className="text-muted-foreground text-[13px] font-normal">
              Order number
            </Label>
            <Input
              id={`${id}-ref`}
              value={ref}
              maxLength={40}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={rename.isPending}>
            {rename.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Marketing changes one approval stage of this order (people, and ALL or ANY) before it
 * starts (D27). The buyer's default chain is not touched.
 */
export function ChangeSlotDialog({
  order,
  slot,
  onClose,
}: {
  order: OrderDetail;
  slot: Slot;
  onClose: () => void;
}) {
  const id = useId();
  const current = order.slots.find((s) => s.slot === slot)!;
  const [value, setValue] = useState<SlotValue[]>([
    {
      slot,
      people: current.people.map((p) => ({ ...p, email: '' })),
      gate: current.gate ?? 'ALL',
    },
  ]);
  const [reason, setReason] = useState('');
  const refresh = useRefreshOrder(order.id);
  const save = useMutation({
    mutationFn: () =>
      api.orders.updateSlot(order.id, slot, {
        employeeIds: value[0]!.people.map((p) => p.id),
        gate: value[0]!.gate ?? 'ALL',
        reason,
      }),
    onSuccess: () => {
      toast.success(`${SLOT_INFO[slot].label} changed for this order`);
      refresh();
      onClose();
    },
  });
  const serverProblems =
    save.error instanceof ApiError && save.error.code === 'INVALID_SLOTS'
      ? ((save.error.details as { slots?: Record<string, string> })?.slots ?? {})
      : {};
  const local = value[0]!.people.length === 0 ? { [slot]: 'Choose someone' } : {};
  const problems = {
    ...slotValueProblems(value, false),
    ...local,
    ...serverProblems,
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Change {SLOT_INFO[slot].label}</DialogTitle>
          <DialogDescription>
            For this order only. Add or remove people, and choose whether all of them must approve
            or any one is enough.
          </DialogDescription>
        </DialogHeader>
        <FormError
          message={
            save.error && !(save.error instanceof ApiError && save.error.code === 'INVALID_SLOTS')
              ? errorMessage(save.error)
              : undefined
          }
        />
        <SlotEditor
          value={value}
          onChange={(next) => setValue(next.filter((v) => v.slot === slot))}
          showGates
          problems={problems}
          only={[slot]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-reason`} className="text-muted-foreground text-[13px] font-normal">
            Why (optional, kept in the history)
          </Label>
          <Textarea
            id={`${id}-reason`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || Object.keys(local).length > 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save for this order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
