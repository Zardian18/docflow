import type { CompanyFacet } from '@docflow/shared';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SearchField, useDebounced } from '@/components/ListControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Choice, ListFilterSpec, SortChoice, useListFilters } from '@/lib/list-filters';

const ANY = 'any';
const trigger =
  'bg-card h-9 w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate';

function ChoiceSelect({
  label,
  anyLabel,
  value,
  choices,
  onChange,
}: {
  label: string;
  anyLabel: string;
  value?: string;
  choices: readonly Choice[];
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
      <SelectTrigger className={trigger} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {choices.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value?: string;
  min?: string;
  max?: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="bg-card border-input flex h-9 min-w-0 items-center gap-2 rounded-lg border pl-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <Input
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-full min-w-0 border-0 px-1 shadow-none focus-visible:ring-0"
      />
    </label>
  );
}

/** The filter bar, with a total and "Clear filters" underneath. */
export function ListFilterBar({
  state,
  spec,
  companies,
  dates,
  total,
  noun,
}: {
  state: ReturnType<typeof useListFilters>;
  spec: ListFilterSpec;
  /** Every company in the person's list (from the API), for the Company filter */
  companies?: CompanyFacet[];
  /** Label for the date range, e.g. "Submitted", or none for no date filter */
  dates?: string;
  total?: number;
  noun: [one: string, many: string];
}) {
  const { filters, update } = state;
  const [q, setQ] = useState(filters.q ?? '');
  const debounced = useDebounced(q.trim(), 300);
  useEffect(() => {
    if ((filters.q ?? '') !== debounced) update({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [debounced]);

  const sortValue = `${filters.sort}:${filters.dir}`;
  return (
    <>
      <section aria-label="Filters" className="bg-card mb-4 rounded-xl border p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <SearchField
            label="Search documents"
            placeholder="Name, invoice no. or vendor"
            value={q}
            onChange={setQ}
          />
          {spec.statuses && (
            <ChoiceSelect
              label="Status"
              anyLabel="All statuses"
              value={filters.status}
              choices={spec.statuses}
              onChange={(status) => update({ status })}
            />
          )}
          {spec.decisions && (
            <ChoiceSelect
              label="Your decision"
              anyLabel="Any decision"
              value={filters.decision}
              choices={spec.decisions}
              onChange={(decision) => update({ decision })}
            />
          )}
          <ChoiceSelect
            label="Company"
            anyLabel="All companies"
            value={filters.companyId}
            choices={(companies ?? []).map((c) => ({ value: c.id, label: c.name }))}
            onChange={(companyId) => update({ companyId })}
          />
          {dates && (
            <>
              <DateField
                label={`${dates} from`}
                value={filters.from}
                max={filters.to}
                onChange={(from) => update({ from })}
              />
              <DateField
                label="To"
                value={filters.to}
                min={filters.from}
                onChange={(to) => update({ to })}
              />
            </>
          )}
          <Select
            value={sortValue}
            onValueChange={(v) => {
              const [sort, dir] = v.split(':') as [string, 'asc' | 'desc'];
              update({ sort, dir });
            }}
          >
            <SelectTrigger className={trigger} aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spec.sorts.flatMap((s) =>
                (['asc', 'desc'] as const).map((dir) => (
                  <SelectItem key={`${s.value}:${dir}`} value={`${s.value}:${dir}`}>
                    Sort: {s.label} {sortDirLabel(s, dir)}
                  </SelectItem>
                )),
              )}
            </SelectContent>
          </Select>
        </div>
      </section>
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground" aria-live="polite">
          {total === undefined ? '' : `${total} ${total === 1 ? noun[0] : noun[1]}`}
        </p>
        {state.active && (
          <Button variant="ghost" size="sm" onClick={state.clear}>
            <X aria-hidden /> Clear filters
          </Button>
        )}
      </div>
    </>
  );
}

function sortDirLabel(s: SortChoice, dir: 'asc' | 'desc') {
  if (s.kind === 'date') return dir === 'desc' ? '(newest first)' : '(oldest first)';
  if (s.kind === 'status') return dir === 'asc' ? '(in progress first)' : '(finished first)';
  return dir === 'asc' ? '(A–Z)' : '(Z–A)';
}
