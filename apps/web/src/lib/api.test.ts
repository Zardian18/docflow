import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchPing } from './api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchPing', () => {
  it('parses a valid response and sends credentials', async () => {
    const fetchMock = stubFetch(200, {
      message: 'pong',
      dbTime: '2026-10-05T10:00:00.000Z',
      roleCount: 4,
    });
    await expect(fetchPing()).resolves.toMatchObject({ roleCount: 4 });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/ping$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('throws ApiError on a non-2xx status', async () => {
    stubFetch(503, {});
    await expect(fetchPing()).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects a response that does not match the shared schema', async () => {
    stubFetch(200, { message: 'pong' });
    await expect(fetchPing()).rejects.toThrow();
  });
});
