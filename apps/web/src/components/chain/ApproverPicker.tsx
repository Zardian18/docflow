import type { ApproverOption } from '@docflow/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useDebounced } from '@/components/ListControls';
import { Button } from '@/components/ui/button';
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

/**
 * Type-ahead over employees with the Approver permission only (invariant 11), matching the
 * start of the name. Already-chosen people are hidden so nobody is added twice.
 */
export function ApproverPicker({
  exclude,
  onPick,
  children,
  variant = 'outline',
  className,
}: {
  exclude: Set<string>;
  onPick: (approver: ApproverOption) => void;
  children: ReactNode;
  variant?: 'outline' | 'ghost';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 200);
  const results = useQuery({
    queryKey: ['approver-search', debounced],
    queryFn: ({ signal }) => api.employees.approverSearch(debounced, signal),
    enabled: open,
    staleTime: 30_000,
  });
  const options = (results.data ?? []).filter((o) => !exclude.has(o.id));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant={variant} size="sm" className={className}>
          <Plus aria-hidden />
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Search approvers by name" />
          <CommandList>
            {results.isPending ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">Searching…</p>
            ) : (
              <CommandEmpty>
                {debounced ? 'No approvers start with that name.' : 'No more approvers to add.'}
              </CommandEmpty>
            )}
            {options.length > 0 && (
              <CommandGroup heading="Approvers">
                {options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.id}
                    onSelect={() => {
                      onPick(o);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{o.name}</span>
                      <span className="text-muted-foreground truncate text-xs">{o.email}</span>
                    </span>
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
