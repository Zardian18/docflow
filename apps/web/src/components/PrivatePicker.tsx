import { TEAM_LABEL, TEAMS, type PersonOption, type Team } from '@docflow/shared';
import { Lock, X } from 'lucide-react';
import { useId } from 'react';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export interface PrivateValue {
  people: PersonOption[];
  teams: Team[];
}

/**
 * "Make this private" (D29): when on, only the people and teams picked here see this action and
 * its comment, plus, always, the order's approvers and Head Approvers, whoever the step goes to,
 * the writer and Admin. Tagged people get a notice on My Work.
 */
export function PrivatePicker({
  value,
  onChange,
}: {
  value: PrivateValue | null;
  onChange: (v: PrivateValue | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <label className="flex items-center gap-2 text-[13px] font-medium">
        <input
          type="checkbox"
          className="accent-primary size-4"
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? { people: [], teams: [] } : null)}
        />
        <Lock className="size-3.5" aria-hidden />
        Make this private
      </label>
      {value && (
        <>
          <p className="text-muted-foreground text-xs">
            Only the people and teams you add here will see this, plus the order’s approvers and
            Head Approvers (always), whoever the step goes to, and Admin. Everyone you add gets a
            notice on My Work.
          </p>
          <AsyncCombobox
            label="Share with a person"
            anyLabel="Add a person"
            placeholder="Search by name"
            queryKey="private-people"
            value={null}
            search={async (q, signal) =>
              (await api.lookups.everyone(q, signal)).map((p) => ({
                id: p.id,
                label: p.name,
                hint: p.email,
              }))
            }
            onChange={(o) => {
              if (!o || value.people.some((p) => p.id === o.id)) return;
              onChange({
                ...value,
                people: [...value.people, { id: o.id, name: o.label, email: o.hint ?? '' }],
              });
            }}
          />
          {value.people.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Shared with">
              {value.people.map((p) => (
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
                      onChange({ ...value, people: value.people.filter((x) => x.id !== p.id) })
                    }
                  >
                    <X className="size-3" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
            <legend className="text-muted-foreground mb-1 text-xs">Share with a whole team</legend>
            {TEAMS.map((t) => (
              <label
                key={t}
                htmlFor={`${id}-${t}`}
                className="flex items-center gap-1.5 text-[13px]"
              >
                <input
                  id={`${id}-${t}`}
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={value.teams.includes(t)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      teams: e.target.checked
                        ? [...value.teams, t]
                        : value.teams.filter((x) => x !== t),
                    })
                  }
                />
                {TEAM_LABEL[t]}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </div>
  );
}
