import { PingResponse } from '@docflow/shared';

const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fetch JSON from the API with the session cookie included (cross-site until a domain exists). */
async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, { credentials: 'include', signal });
  if (!res.ok) throw new ApiError(`${path} failed with ${res.status}`, res.status);
  return res.json();
}

export async function fetchPing(signal?: AbortSignal): Promise<PingResponse> {
  return PingResponse.parse(await getJson('/v1/ping', signal));
}
