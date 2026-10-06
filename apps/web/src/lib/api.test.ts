import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage, setUnauthorizedHandler } from './api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client', () => {
  it('sends credentials and JSON, and parses the response', async () => {
    const fetchMock = stubFetch(200, {
      id: '6f1a8d2e-3b4c-4d5e-8f90-123456789abc',
      name: 'A. Mehta',
      email: 'a@t.co',
      employeeCode: null,
      roleName: 'Admin',
      permission: 'ADMIN',
    });
    await expect(api.auth.login({ email: 'a@t.co', password: 'x' })).resolves.toMatchObject({
      permission: 'ADMIN',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/auth\/login$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('turns error bodies into ApiError with code, message and details', async () => {
    stubFetch(409, { error: 'CFO_EXISTS', message: 'V. Malhotra is already the active CFO.' });
    const err = await api.roles.create({ name: 'x', permission: 'CFO' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'CFO_EXISTS' });
    expect(errorMessage(err)).toBe('V. Malhotra is already the active CFO.');
  });

  it('calls the sign-out handler on 401, except for quiet requests', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubFetch(401, { error: 'UNAUTHORIZED', message: 'Please sign in' });
    await api.auth.me().catch(() => {});
    expect(handler).not.toHaveBeenCalled();
    await api.roles.list({}).catch(() => {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it('reports network failures in plain words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = await api.ping().catch((e) => e);
    expect(errorMessage(err)).toMatch(/could not reach the server/i);
  });
});
