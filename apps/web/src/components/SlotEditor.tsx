import { SLOT_INFO, type Gate, type Slot } from '@docflow/shared';
import { X } from 'lucide-react';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import type { SlotValue } from '@/lib/slots';

const GROUPS: Array<{ title: string; slots: Slot[] }> = [
  { title: 'Order', slots: ['MARKETING', 'CREATOR'] },
  { title: 'PI approval', slots: ['PI_APPROVER', 'PI_HEAD'] },
  { title: 'Payment check', slots: ['PAY_APPROVER', 'PAY_HEAD'] },
  { title: 'BoL approval', slots: ['BOL_APPROVER', 'BOL_HEAD'] },
];

/**
 * The named people on an order or a buyer (D24, D27): one person for Marketing and Creator,
 * one or more for each approval slot, with ALL or ANY when there are several. `only` limits
 * it to some slots (Marketing changing one stage of an order).
 */
export function SlotEditor({
  value,
  onChange,
  showGates,
  problems,
  only,
}: {
  value: SlotValue[];
  onChange: (next: SlotValue[]) => void;
  showGates: boolean;
  problems: Partial<Record<Slot, string>>;
  only?: Slot[];
}) {
  const set = (slot: Slot, patch: Partial<SlotValue>) =>
    onChange(value.map((v) => (v.slot === slot ? { ...v, ...patch } : v)));
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.filter((g) => !only || g.slots.some((s) => only.includes(s))).map((group) => (
        <fieldset key={group.title} className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">{group.title}</legend>
          {group.slots
            .filter((s) => !only || only.includes(s))
            .map((slot) => {
              const info = SLOT_INFO[slot];
              const v = value.find((x) => x.slot === slot)!;
              const problem = problems[slot];
              const pick = (
                <AsyncCombobox
                  label={info.multiple ? 'Add' : info.label}
                  anyLabel={info.multiple ? 'Choose a person' : 'Nobody yet'}
                  placeholder="Search by name"
                  queryKey={`people-${info.capability}`}
                  value={
                    !info.multiple && v.people[0]
                      ? { id: v.people[0].id, label: v.people[0].name }
                      : null
                  }
                  search={async (q, signal) =>
                    (await api.lookups.people(info.capability, q, signal)).map((p) => ({
                      id: p.id,
                      label: p.name,
                      hint: p.email,
                    }))
                  }
                  onChange={(o) => {
                    if (!o) return info.multiple ? undefined : set(slot, { people: [] });
                    const person = { id: o.id, name: o.label, email: o.hint ?? '' };
                    if (!info.multiple) set(slot, { people: [person] });
                    else if (!v.people.some((p) => p.id === o.id))
                      set(slot, { people: [...v.people, person] });
                  }}
                />
              );
              return (
                <div
                  key={slot}
                  className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start"
                >
                  <span className="text-muted-foreground pt-2 text-[13px]">{info.label}</span>
                  <div className="flex min-w-0 flex-col gap-2">
                    {info.multiple && v.people.length > 0 && (
                      <ul
                        className="flex flex-wrap gap-1.5"
                        aria-label={`${info.label}: chosen people`}
                      >
                        {v.people.map((p) => (
                          <li
                            key={p.id}
                            className="bg-primary-soft text-primary inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-[13px]"
                          >
                            {p.name}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-5 rounded-full"
                              aria-label={`Remove ${p.name}`}
                              onClick={() =>
                                set(slot, { people: v.people.filter((x) => x.id !== p.id) })
                              }
                            >
                              <X className="size-3" aria-hidden />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="min-w-0 flex-1">{pick}</div>
                      {showGates && info.hasGate && (
                        <Select
                          value={v.gate ?? 'ALL'}
                          onValueChange={(g) => set(slot, { gate: g as Gate })}
                        >
                          <SelectTrigger
                            className="bg-card h-9 w-full sm:w-52"
                            aria-label={`${info.label}: who must approve`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All of them must approve</SelectItem>
                            <SelectItem value="ANY">Any one of them is enough</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {problem && <p className="text-destructive text-xs">{problem}</p>}
                  </div>
                </div>
              );
            })}
        </fieldset>
      ))}
    </div>
  );
}
