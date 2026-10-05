import { describe, expect, it, vi } from 'vitest';
import { callTick } from './tick';

const env = { API_TICK_URL: 'https://api.example/internal/tick', TICK_SECRET: 's3cret' };

describe('callTick', () => {
  it('POSTs to the tick URL with the shared secret header', async () => {
    const fetchMock = vi.fn(async () => new Response('{"retried":0}', { status: 200 }));
    await expect(callTick(env, fetchMock)).resolves.toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      env.API_TICK_URL,
      expect.objectContaining({ method: 'POST', headers: { 'x-tick-secret': 's3cret' } }),
    );
  });

  it('throws on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(callTick(env, fetchMock)).rejects.toThrow(/401/);
  });

  it('refuses to run without a secret', async () => {
    const fetchMock = vi.fn();
    await expect(callTick({ ...env, TICK_SECRET: '' }, fetchMock)).rejects.toThrow(/TICK_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
