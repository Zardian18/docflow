import {
  ApiErrorBody,
  Buyer,
  BuyerOption,
  ComponentChange,
  ComponentTables,
  Employee,
  Me,
  OrderDetail,
  OrderEvent,
  OrderSummary,
  paginated,
  PasswordLink,
  PersonOption,
  PingResponse,
  PresignResponse,
  SlotAssignment,
  WorkResponse,
  type BuyerUpsert,
  type Capability,
  type ChangePasswordRequest,
  type ComponentInput,
  type EmployeeCreate,
  type EmployeeListQuery,
  type EmployeeUpdate,
  type ListQuery,
  type LoginRequest,
  type OrderCreate,
  type OrderListQuery,
  type OrderSlotUpdate,
  type PresignRequest,
  type SetPasswordRequest,
  type Slot,
  type TaskActionRequest,
  type WorkQuery,
} from '@docflow/shared';
import { z } from 'zod';

const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Called on any 401 from an authenticated request (session expired or revoked). */
let onUnauthorized: (() => void) | undefined;
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

/**
 * Called on any 403 from a FORBIDDEN refusal. The usual cause is signing in as someone else
 * in another tab: every tab shares one session cookie, so this tab's page no longer matches
 * who the server sees. The handler re-checks who is signed in.
 */
let onForbidden: (() => void) | undefined;
export const setForbiddenHandler = (handler: () => void) => {
  onForbidden = handler;
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Don't trigger the global sign-out on 401 (login form, "who am I" probe). */
  quiet401?: boolean;
}

async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { method = 'GET', body, signal, quiet401 } = options;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 204 || res.status === 202) return undefined;
  const data: unknown = await res.json().catch(() => undefined);
  if (res.ok) return data;

  const parsed = ApiErrorBody.safeParse(data);
  const error = parsed.success
    ? new ApiError(res.status, parsed.data.error, parsed.data.message, parsed.data.details)
    : new ApiError(res.status, 'HTTP_ERROR', `The server returned an error (${res.status}).`);
  if (res.status === 401 && !quiet401) onUnauthorized?.();
  if (res.status === 403 && error.code === 'FORBIDDEN') onForbidden?.();
  throw error;
}

const get = <T extends z.ZodType>(schema: T, path: string, signal?: AbortSignal) =>
  request(path, { signal }).then((d) => schema.parse(d) as z.output<T>);

/** Query string from a filter object; empty and undefined values are left out. */
function listParams(query: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const api = {
  ping: (signal?: AbortSignal) => get(PingResponse, '/v1/ping', signal),

  auth: {
    me: (signal?: AbortSignal) =>
      request('/v1/auth/me', { signal, quiet401: true }).then((d) => Me.parse(d)),
    login: (body: LoginRequest) =>
      request('/v1/auth/login', { method: 'POST', body, quiet401: true }).then((d) => Me.parse(d)),
    logout: () => request('/v1/auth/logout', { method: 'POST', body: {} }),
    changePassword: (body: ChangePasswordRequest) =>
      request('/v1/auth/change-password', { method: 'POST', body }),
    setPassword: (body: SetPasswordRequest) =>
      request('/v1/auth/set-password', { method: 'POST', body }),
    forgotPassword: (email: string) =>
      request('/v1/auth/forgot-password', { method: 'POST', body: { email } }),
  },

  employees: {
    list: (query: Partial<EmployeeListQuery>, signal?: AbortSignal) =>
      get(paginated(Employee), `/v1/employees?${listParams(query)}`, signal),
    create: (body: EmployeeCreate) =>
      request('/v1/employees', { method: 'POST', body }).then((d) => Employee.parse(d)),
    remove: (id: string) => request(`/v1/employees/${id}`, { method: 'DELETE' }),
    update: (id: string, body: EmployeeUpdate) =>
      request(`/v1/employees/${id}`, { method: 'PUT', body }).then((d) => Employee.parse(d)),
    passwordLink: (id: string) =>
      request(`/v1/employees/${id}/password-link`, { method: 'POST', body: {} }).then((d) =>
        PasswordLink.parse(d),
      ),
  },

  buyers: {
    list: (query: Partial<ListQuery>, signal?: AbortSignal) =>
      get(paginated(Buyer), `/v1/buyers?${listParams(query)}`, signal),
    get: (id: string, signal?: AbortSignal) => get(Buyer, `/v1/buyers/${id}`, signal),
    create: (body: BuyerUpsert) =>
      request('/v1/buyers', { method: 'POST', body }).then((d) => Buyer.parse(d)),
    update: (id: string, body: BuyerUpsert) =>
      request(`/v1/buyers/${id}`, { method: 'PUT', body }).then((d) => Buyer.parse(d)),
    remove: (id: string) => request(`/v1/buyers/${id}`, { method: 'DELETE' }),
  },

  lookups: {
    people: (capability: Capability, q: string, signal?: AbortSignal) =>
      get(PersonOption.array(), `/v1/lookups/people?${listParams({ capability, q })}`, signal),
    buyerSlots: (id: string, signal?: AbortSignal) =>
      get(SlotAssignment.array(), `/v1/lookups/buyers/${id}/slots`, signal),
    buyers: (q: string, signal?: AbortSignal) =>
      get(BuyerOption.array(), `/v1/lookups/buyers?${listParams({ q })}`, signal),
  },

  orders: {
    create: (body: OrderCreate) =>
      request('/v1/orders', { method: 'POST', body }).then((d) =>
        z.object({ id: z.uuid() }).parse(d),
      ),
    list: (query: OrderListQuery, signal?: AbortSignal) =>
      get(paginated(OrderSummary), `/v1/orders?${listParams(query)}`, signal),
    get: (id: string, signal?: AbortSignal) => get(OrderDetail, `/v1/orders/${id}`, signal),
    timeline: (id: string, signal?: AbortSignal) =>
      get(OrderEvent.array(), `/v1/orders/${id}/timeline`, signal),
    cancel: (id: string, reason: string) =>
      request(`/v1/orders/${id}/cancel`, { method: 'POST', body: { reason } }),
    replacePerson: (
      id: string,
      body: { slot: Slot; fromEmployeeId: string; toEmployeeId: string; reason: string },
    ) => request(`/v1/orders/${id}/replace-person`, { method: 'POST', body }),
    rename: (id: string, ref: string) =>
      request(`/v1/orders/${id}/ref`, { method: 'PUT', body: { ref } }),
    updateSlot: (id: string, slot: Slot, body: OrderSlotUpdate) =>
      request(`/v1/orders/${id}/slots/${slot}`, { method: 'PUT', body }),
    components: (id: string, signal?: AbortSignal) =>
      get(ComponentTables, `/v1/orders/${id}/components`, signal),
  },

  tasks: {
    act: (taskId: string, body: TaskActionRequest) =>
      request(`/v1/tasks/${taskId}/actions`, { method: 'POST', body }),
  },

  components: {
    add: (orderId: string, productId: string, body: ComponentInput) =>
      request(`/v1/orders/${orderId}/products/${productId}/components`, { method: 'POST', body }),
    update: (id: string, body: ComponentInput) =>
      request(`/v1/components/${id}`, { method: 'PUT', body }),
    remove: (id: string, comment?: string) =>
      request(`/v1/components/${id}?${listParams({ comment })}`, { method: 'DELETE' }),
    history: (id: string, signal?: AbortSignal) =>
      get(ComponentChange.array(), `/v1/components/${id}/history`, signal),
  },

  documents: {
    /** view: open a PDF or image in the browser; download: save it. */
    fileLink: (id: string, mode: 'view' | 'download' = 'download') =>
      get(
        z.object({ url: z.url(), expiresAt: z.string() }),
        `/v1/documents/${id}/file?mode=${mode}`,
      ),
  },

  work: (query: WorkQuery, signal?: AbortSignal) =>
    get(WorkResponse, `/v1/work?${listParams(query)}`, signal),

  uploads: {
    presign: (body: PresignRequest) =>
      request('/v1/uploads/presign', { method: 'POST', body }).then((d) =>
        PresignResponse.parse(d),
      ),
  },
};

/**
 * PUTs a file straight to storage with the presigned URL (bytes never pass through the
 * API). XHR rather than fetch, because only XHR reports upload progress.
 */
export function uploadToStorage(
  file: File,
  target: PresignResponse,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, 'UPLOAD_FAILED', 'The upload was refused. Try again.'));
    xhr.onerror = () =>
      reject(
        new ApiError(0, 'UPLOAD_FAILED', 'The upload failed. Check your connection and try again.'),
      );
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/** A message safe to show the user for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION') return 'Some fields are invalid. Check the form and try again.';
    return err.message;
  }
  return 'Something went wrong. Try again.';
}
