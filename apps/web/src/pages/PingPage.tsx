import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchPing } from '@/lib/api';

// Render's free tier sleeps after 15 min idle; a first request can take up to ~1 min
const SLOW_AFTER_MS = 4000;

export function PingPage() {
  const ping = useQuery({ queryKey: ['ping'], queryFn: ({ signal }) => fetchPing(signal) });
  const slow = useSlowFlag(ping.isFetching);

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>DocFlow</CardTitle>
          <CardDescription>Walking skeleton: web → API → database</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {ping.isPending && (
            <p className="text-muted-foreground">
              Contacting the API…
              {slow && ' The server may be waking up, which can take up to a minute.'}
            </p>
          )}

          {ping.isError && (
            <p className="text-destructive" role="alert">
              Could not reach the API: {ping.error.message}
            </p>
          )}

          {ping.isSuccess && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Response</dt>
              <dd className="font-medium">{ping.data.message}</dd>
              <dt className="text-muted-foreground">Database time</dt>
              <dd>{new Date(ping.data.dbTime).toLocaleString()}</dd>
              <dt className="text-muted-foreground">Roles in DB</dt>
              <dd>{ping.data.roleCount}</dd>
            </dl>
          )}

          <Button variant="outline" onClick={() => ping.refetch()} disabled={ping.isFetching}>
            {ping.isFetching ? 'Pinging…' : 'Ping again'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function useSlowFlag(active: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [active]);
  return slow;
}
