import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { useDebounced } from '@/components/ListControls';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboOption {
  id: string;
  label: string;
  hint?: string;
}

/**
 * A filter picker that searches the server as you type. "Any" clears the filter.
 * Used for the dashboard's Company and Created By filters.
 */
export function AsyncCombobox({
  label,
  anyLabel,
  value,
  queryKey,
  search,
  onChange,
  placeholder,
}: {
  label: string;
  anyLabel: string;
  value: { id: string; label: string } | null;
  queryKey: string;
  search: (q: string, signal: AbortSignal) => Promise<ComboOption[]>;
  onChange: (option: ComboOption | null) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 200);
  const results = useQuery({
    queryKey: [queryKey, debounced],
    queryFn: ({ signal }) => search(debounced, signal),
    enabled: open,
    staleTime: 30_000,
  });

  const pick = (option: ComboOption | null) => {
    onChange(option);
    setOpen(false);
    setQ('');
  };

  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), !o && setQ(''))}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={`${label}: ${value?.label ?? anyLabel}`}
          className={cn(
            'bg-card border-input flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-sm',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
          )}
        >
          <span className="text-muted-foreground shrink-0">{label}:</span>
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
            {value?.label ?? anyLabel}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder={placeholder} />
          <CommandList>
            <CommandGroup>
              <CommandItem value="__any" onSelect={() => pick(null)}>
                <Check className={cn('size-4', value ? 'opacity-0' : 'opacity-100')} aria-hidden />
                {anyLabel}
              </CommandItem>
              {(results.data ?? []).map((o) => (
                <CommandItem key={o.id} value={o.id} onSelect={() => pick(o)}>
                  <Check
                    className={cn('size-4', value?.id === o.id ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-muted-foreground text-xs">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
            {results.isPending ? (
              <p className="text-muted-foreground px-3 py-4 text-center text-sm">Searching…</p>
            ) : (
              <CommandEmpty>Nothing matches.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
