import { Skeleton } from '@/components/ui/skeleton';

/** The count cards from screens 02, 06 and 09. */
export function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="bg-card rounded-xl border px-4 py-3.5 sm:px-5 sm:py-4">
      <p className="text-muted-foreground text-[13px]">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-1.5 h-7 w-12" />
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tabular-nums sm:text-[28px]">{value}</p>
      )}
    </div>
  );
}
