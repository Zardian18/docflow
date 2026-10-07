import type { CompanyOption } from '@docflow/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Search } from 'lucide-react';
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
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Type-ahead over Active companies, matching the start of the name or the code (URS §5.2).
 * Styled like the search field in screen 04, with the icon on the leading side.
 */
export function CompanyPicker({
  id,
  value,
  onPick,
  invalid,
}: {
  id: string;
  value: CompanyOption | null;
  onPick: (company: CompanyOption) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 200);
  const results = useQuery({
    queryKey: ['company-search', debounced],
    queryFn: ({ signal }) => api.lookups.companies(debounced, signal),
    enabled: open,
    staleTime: 30_000,
  });
  const companies = results.data?.companies ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn(
            'bg-card border-input flex h-10 w-full items-center gap-2.5 rounded-lg border px-3 text-left text-sm transition-colors',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
            invalid && 'border-destructive',
          )}
        >
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
          {value ? (
            <span className="min-w-0 flex-1 truncate">
              {value.name}
              {value.code && <span className="text-muted-foreground"> · {value.code}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground min-w-0 flex-1 truncate">
              Search by name or code, e.g. “MIC”
            </span>
          )}
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-[min(20rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Company name or code" />
          <CommandList>
            {results.isPending ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">Searching…</p>
            ) : (
              <CommandEmpty>
                {debounced
                  ? 'No active company starts with that name or code.'
                  : 'No active companies yet.'}
              </CommandEmpty>
            )}
            {companies.length > 0 && (
              <CommandGroup heading="Companies">
                {companies.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => {
                      onPick(c);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.code && <span className="text-muted-foreground text-xs">{c.code}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
