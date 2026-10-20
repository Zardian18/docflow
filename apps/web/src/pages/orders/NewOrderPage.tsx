import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { FormError } from '@/components/forms';
import { PageBody, PageHeader } from '@/components/PageHeader';
import { SlotEditor } from '@/components/SlotEditor';
import { emptySlots, slotValueProblems, type SlotValue } from '@/lib/slots';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, errorMessage } from '@/lib/api';

/**
 * Marketing starts an order (Q2): the buyer and its chain, copied from the buyer's default
 * and changeable for this order only, people and ALL/ANY both (Q61, D27). The CBM step opens
 * for the Creator.
 */
export function NewOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [buyer, setBuyer] = useState<{ id: string; label: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [slots, setSlots] = useState<SlotValue[]>(emptySlots());
  const [attempted, setAttempted] = useState(false);

  // The buyer's default chain fills the slots when a buyer is chosen
  const buyerSlots = useQuery({
    queryKey: ['buyer-slots', buyer?.id],
    enabled: Boolean(buyer),
    queryFn: ({ signal }) => api.lookups.buyerSlots(buyer!.id, signal),
  });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (buyer && buyerSlots.data && loadedFor !== buyer.id) {
    setLoadedFor(buyer.id);
    setSlots(buyerSlots.data.map((s) => ({ slot: s.slot, people: s.people, gate: s.gate })));
  }

  const create = useMutation({
    mutationFn: () =>
      api.orders.create({
        buyerId: buyer!.id,
        notes,
        // Every filled slot is sent, with its ALL/ANY; empty ones fall back to the buyer's
        slots: slots
          .filter((s) => s.people.length > 0)
          .map((s) => ({ slot: s.slot, employeeIds: s.people.map((p) => p.id), gate: s.gate })),
      }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['work'] });
      toast.success('Order created. The CBM step is now with the Creator.');
      navigate(`/orders/${id}`);
    },
  });
  const serverProblems =
    create.error instanceof ApiError && create.error.code === 'INVALID_SLOTS'
      ? ((create.error.details as { slots?: Record<string, string> })?.slots ?? {})
      : {};
  const problems = { ...slotValueProblems(slots, false), ...serverProblems };

  return (
    <>
      <PageHeader
        title="New Order"
        description="Start an export order: the buyer and who works on it"
      />
      <PageBody>
        <form
          noValidate
          className="flex max-w-3xl flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            setAttempted(true);
            if (buyer) create.mutate();
          }}
        >
          <FormError message={create.error ? errorMessage(create.error) : undefined} />
          <section
            className="bg-card flex flex-col gap-4 rounded-xl border p-4 sm:p-5"
            aria-labelledby="order-basics"
          >
            <h2 id="order-basics" className="text-sm font-semibold">
              Buyer
            </h2>
            <div className="flex flex-col gap-1.5 sm:max-w-sm">
              <AsyncCombobox
                label="Buyer"
                anyLabel="Choose a buyer"
                placeholder="Search buyers"
                queryKey="new-order-buyers"
                value={buyer}
                search={async (q, signal) =>
                  (await api.lookups.buyers(q, signal)).map((b) => ({
                    id: b.id,
                    label: b.name,
                    hint: [b.code, b.country].filter(Boolean).join(' · ') || undefined,
                  }))
                }
                onChange={(o) => {
                  setBuyer(o ? { id: o.id, label: o.label } : null);
                  setSlots(emptySlots());
                  setLoadedFor(null);
                }}
              />
              {attempted && !buyer && <p className="text-destructive text-xs">Choose a buyer</p>}
              <p className="text-muted-foreground text-xs">
                Missing?{' '}
                <Link to="/admin/buyers/new" className="text-primary hover:underline">
                  Add it in Buyers
                </Link>
                .
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="order-notes"
                className="text-muted-foreground text-[13px] font-normal"
              >
                The buyer’s requirements (optional)
              </Label>
              <Textarea
                id="order-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
              />
            </div>
          </section>

          <section
            className="bg-card flex flex-col gap-4 rounded-xl border p-4 sm:p-5"
            aria-labelledby="order-people"
          >
            <div>
              <h2 id="order-people" className="text-sm font-semibold">
                Chain for this order
              </h2>
              <p className="text-muted-foreground mt-1 text-[13px]">
                Filled in from the buyer’s default chain. Add or remove approvers and choose whether
                all of them must approve or any one is enough; this changes this order only. If
                nobody is named as Marketing, you are.
              </p>
            </div>
            <SlotEditor value={slots} onChange={setSlots} showGates problems={problems} />
          </section>

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create order'}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </PageBody>
    </>
  );
}
