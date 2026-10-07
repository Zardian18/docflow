import {
  ApiErrorBody,
  ApproverOption,
  CfoInfo,
  Company,
  CompanyOption,
  DecisionHistoryItem,
  DecisionResult,
  FileLink,
  Employee,
  Me,
  paginated,
  PasswordLink,
  PendingApprovalsResponse,
  PingResponse,
  PresignResponse,
  Role,
  WorkflowDetail,
  WorkflowSummary,
  type ChangePasswordRequest,
  type CompanyUpsert,
  type DecisionRequest,
  type EmployeeCreate,
  type EmployeeUpdate,
  type ListQuery,
  type LoginRequest,
  type RoleCreate,
  type RoleUpdate,
  type PresignRequest,
  type SetPasswordRequest,
  type WorkflowCreate,
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

function listParams(query: Partial<ListQuery>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
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

  roles: {
    list: (query: Partial<ListQuery>, signal?: AbortSignal) =>
      get(paginated(Role), `/v1/roles?${listParams(query)}`, signal),
    create: (body: RoleCreate) =>
      request('/v1/roles', { method: 'POST', body }).then((d) => Role.parse(d)),
    remove: (id: string) => request(`/v1/roles/${id}`, { method: 'DELETE' }),
    update: (id: string, body: RoleUpdate) =>
      request(`/v1/roles/${id}`, { method: 'PUT', body }).then((d) => Role.parse(d)),
  },

  employees: {
    list: (query: Partial<ListQuery>, signal?: AbortSignal) =>
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
    approverSearch: (q: string, signal?: AbortSignal) =>
      get(
        ApproverOption.array(),
        `/v1/employees/approver-search?q=${encodeURIComponent(q)}`,
        signal,
      ),
    cfo: (signal?: AbortSignal) => get(CfoInfo, '/v1/employees/cfo', signal),
  },

  companies: {
    list: (query: Partial<ListQuery>, signal?: AbortSignal) =>
      get(paginated(Company), `/v1/companies?${listParams(query)}`, signal),
    get: (id: string, signal?: AbortSignal) => get(Company, `/v1/companies/${id}`, signal),
    create: (body: CompanyUpsert) =>
      request('/v1/companies', { method: 'POST', body }).then((d) => Company.parse(d)),
    remove: (id: string) => request(`/v1/companies/${id}`, { method: 'DELETE' }),
    update: (id: string, body: CompanyUpsert) =>
      request(`/v1/companies/${id}`, { method: 'PUT', body }).then((d) => Company.parse(d)),
  },
  lookups: {
    companies: (q: string, signal?: AbortSignal) =>
      get(
        z.object({ companies: CompanyOption.array(), cfo: CfoInfo.shape.cfo }),
        `/v1/companies/search?q=${encodeURIComponent(q)}`,
        signal,
      ),
  },

  uploads: {
    presign: (body: PresignRequest) =>
      request('/v1/uploads/presign', { method: 'POST', body }).then((d) =>
        PresignResponse.parse(d),
      ),
  },

  workflows: {
    create: (body: WorkflowCreate) =>
      request('/v1/workflows', { method: 'POST', body }).then((d) =>
        z.object({ id: z.uuid() }).parse(d),
      ),
    mine: (query: { page?: number; pageSize?: number }, signal?: AbortSignal) =>
      get(paginated(WorkflowSummary), `/v1/workflows/mine?${listParams(query)}`, signal),
    get: (id: string, signal?: AbortSignal) => get(WorkflowDetail, `/v1/workflows/${id}`, signal),
    /** view: open a PDF in the browser; download: save it. */
    fileLink: (id: string, mode: 'view' | 'download' = 'download') =>
      get(FileLink, `/v1/workflows/${id}/file?mode=${mode}`),
    decide: (id: string, body: DecisionRequest) =>
      request(`/v1/workflows/${id}/decision`, { method: 'POST', body }).then((d) =>
        DecisionResult.parse(d),
      ),
  },

  approvals: {
    pending: (signal?: AbortSignal) =>
      get(PendingApprovalsResponse, '/v1/approvals/pending', signal),
    history: (query: { page?: number; pageSize?: number }, signal?: AbortSignal) =>
      get(paginated(DecisionHistoryItem), `/v1/approvals/history?${listParams(query)}`, signal),
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
