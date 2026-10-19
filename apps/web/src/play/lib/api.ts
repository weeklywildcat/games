import type { GameId, PlayMode, SessionResult, StartSessionResponse } from "@wildcat/shared";

/**
 * Kiosk API client. Gameplay actions are numbered and retried with the same
 * number until the server answers, so a dropped connection or a server restart
 * never applies a move twice or loses one.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "error",
  ) {
    super(message);
  }
}

// --- Connectivity store ---------------------------------------------------------------

type Listener = () => void;
let online = true;
const listeners = new Set<Listener>();

function setOnline(value: boolean) {
  if (online === value) return;
  online = value;
  for (const l of listeners) l();
}

export const connectivity = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => online,
  markOnline: () => setOnline(true),
  markOffline: () => setOnline(false),
};

// --- Requests --------------------------------------------------------------------------

export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch (err) {
    connectivity.markOffline();
    throw new ApiError(0, "Can't reach the arcade server", "network");
  } finally {
    clearTimeout(timer);
  }
  connectivity.markOnline();
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, body.code);
  return body as T;
}

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries network failures (status 0) and 5xx with backoff; gives up on client errors. */
async function withRetry<T>(fn: () => Promise<T>, maxWaitMs = 120_000): Promise<T> {
  let delay = 400;
  const started = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const e = err as ApiError;
      const retryable = e.status === 0 || e.status >= 500;
      if (!retryable || Date.now() - started > maxWaitMs) throw err;
      await sleep(delay);
      delay = Math.min(delay * 1.7, 5000);
    }
  }
}

// --- Game sessions ---------------------------------------------------------------------

export class GameSession {
  readonly id: string;
  readonly start: StartSessionResponse;
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(start: StartSessionResponse) {
    this.start = start;
    this.id = start.sessionId;
  }

  static async begin(game: GameId, mode: Exclude<PlayMode, "preview">, visitId: string | null, options?: { timed?: boolean }) {
    const res = await withRetry(() => post<StartSessionResponse>("/api/play/sessions", { game, mode, visitId, options }), 20_000);
    return new GameSession(res);
  }

  static async preview(token: string) {
    const res = await post<StartSessionResponse>("/api/play/preview", { token });
    return new GameSession(res);
  }

  /** Sends an action after any in-flight ones, retrying with the same sequence number. */
  act<T>(type: string, payload?: unknown): Promise<T> {
    const run = async () => {
      if (this.closed) throw new ApiError(409, "Session closed", "closed");
      const seq = ++this.seq;
      return withRetry(() => post<T>(`/api/play/sessions/${this.id}/actions`, { seq, type, payload }));
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next as Promise<T>;
  }

  result() {
    return withRetry(() => api<SessionResult>(`/api/play/sessions/${this.id}/result`), 20_000);
  }

  claim(nickname: string) {
    return withRetry(() => post<{ ok: boolean; rank: number; nickname: string }>(`/api/play/sessions/${this.id}/claim`, { nickname }), 20_000);
  }

  /** Fire-and-forget: tell the server a reset or exit left this game unfinished. */
  abandon() {
    if (this.closed) return;
    this.closed = true;
    fetch(`/api/play/sessions/${this.id}/abandon`, { method: "POST", keepalive: true }).catch(() => undefined);
  }

  markClosed() {
    this.closed = true;
  }
}

export function sendEvent(type: string, game?: GameId | null) {
  fetch("/api/kiosk/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, game }),
    keepalive: true,
  }).catch(() => undefined);
}
