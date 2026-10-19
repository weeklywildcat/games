import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { ZodError } from "zod";
import type { AppContext } from "./context.ts";
import { ContentError } from "./content.ts";
import { GameError } from "./games/types.ts";
import { log, errorFields } from "./log.ts";
import { ipAllowed } from "./network.ts";
import type { AdminSession } from "./auth.ts";

export type Env = {
  Variables: {
    app: AppContext;
    admin: AdminSession;
    ip: string | undefined;
  };
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** The client address, from the socket (or X-Forwarded-For only when explicitly trusted). */
export function clientIp(c: Context<Env>, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // app.request() in tests has no socket; treat it as loopback.
    return process.env.NODE_ENV === "test" ? (c.req.header("x-test-ip") ?? "127.0.0.1") : undefined;
  }
}

export function requireNetwork(c: Context<Env>, networks: string[], what: string) {
  if (!ipAllowed(c.get("ip"), networks)) throw new HttpError(403, `${what} isn't available from this network`, "forbidden_network");
}

export async function readJson<T = Record<string, unknown>>(c: Context<Env>): Promise<T> {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== "object") throw new Error("not an object");
    return body as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body", "bad_json");
  }
}

export function errorResponse(err: unknown, c: Context<Env>) {
  if (err instanceof HttpError) return c.json({ error: err.message, code: err.code, ...err.extra }, err.status as 400);
  if (err instanceof GameError) return c.json({ error: err.message, code: err.code }, err.status as 400);
  if (err instanceof ContentError) return c.json({ error: err.message, code: "content", validation: err.validation }, err.status as 400);
  if (err instanceof ZodError) {
    return c.json({ error: "Some fields are invalid", code: "validation", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  }
  log.error("Unhandled request error", { path: c.req.path, method: c.req.method, ...errorFields(err) });
  return c.json({ error: "Something went wrong on the server", code: "internal" }, 500);
}
