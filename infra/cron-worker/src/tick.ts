export interface TickEnv {
  API_TICK_URL: string;
  TICK_SECRET: string;
}

// Render's free tier can take ~30-60s to wake; give the request room
const TICK_TIMEOUT_MS = 90_000;

/** POST the API's retry tick. Throws on a non-2xx so the failed run shows in Workers logs. */
export async function callTick(env: TickEnv, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!env.TICK_SECRET) throw new Error('TICK_SECRET is not set');

  const res = await fetchImpl(env.API_TICK_URL, {
    method: 'POST',
    headers: { 'x-tick-secret': env.TICK_SECRET },
    signal: AbortSignal.timeout(TICK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`tick failed with HTTP ${res.status}`);
  return res.status;
}
