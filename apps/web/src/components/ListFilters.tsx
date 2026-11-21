import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Choice } from '@/lib/list-filters';

const ANY = 'any';
const trigger =
  'bg-card h-9 w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate';

export function ChoiceSelect({
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

export function DateField({
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
