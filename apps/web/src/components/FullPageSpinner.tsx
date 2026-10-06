import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

// The API sleeps after ~15 min idle on Render's free tier; the first request can take ~30 s
const SLOW_AFTER_MS = 4000;

export function FullPageSpinner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center"
      role="status"
    >
      <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
      <p className="text-muted-foreground text-sm">
        {slow
          ? 'Starting the server. This can take up to a minute after a quiet spell.'
          : 'Loading…'}
      </p>
    </div>
  );
}
