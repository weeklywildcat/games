/**
 * Admin API client. The session lives in an HttpOnly cookie; every
 * state-changing request also carries the per-session CSRF token.
 */

let csrf: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setCsrf(token: string | null) {
  csrf = token;
}

export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET" && csrf) headers.set("x-csrf-token", csrf);
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new AdminApiError(0, "Can't reach the Wildcat Games server. Check the network connection.", "network", {});
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (res.status === 401 && body.code === "unauthenticated") onUnauthenticated?.();
  if (!res.ok) throw new AdminApiError(res.status, String(body.error ?? res.statusText), String(body.code ?? "error"), body);
  return body as T;
}

export const get = <T>(path: string) => adminFetch<T>(path);
export const post = <T>(path: string, body?: unknown) => adminFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) => adminFetch<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = <T>(path: string, body?: unknown) => adminFetch<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) });
export const postForm = <T>(path: string, form: FormData) => adminFetch<T>(path, { method: "POST", body: form });
