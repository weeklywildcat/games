import type { KioskCommand, KioskHeartbeat } from "@wildcat/shared";

/**
 * Live link to the board. The kiosk holds an SSE stream for commands and
 * config changes and posts a heartbeat so staff can see what it's showing.
 */

export interface KioskStatus extends KioskHeartbeat {
  at: number;
}

type Listener = (cmd: KioskCommand) => void;

export const HEARTBEAT_STALE_MS = 45_000;

export class KioskHub {
  private listeners = new Set<Listener>();
  private last: KioskStatus | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(cmd: KioskCommand) {
    for (const fn of this.listeners) {
      try {
        fn(cmd);
      } catch {
        // A broken stream is cleaned up by its own abort handler.
      }
    }
  }

  heartbeat(hb: KioskHeartbeat) {
    this.last = { ...hb, at: Date.now() };
  }

  get connections(): number {
    return this.listeners.size;
  }

  status(now = Date.now()) {
    const fresh = this.last !== null && now - this.last.at < HEARTBEAT_STALE_MS;
    return {
      online: fresh || this.listeners.size > 0,
      streams: this.listeners.size,
      lastHeartbeat: this.last ? new Date(this.last.at).toISOString() : null,
      screen: fresh ? this.last!.screen : null,
      game: fresh ? (this.last!.game ?? null) : null,
      clientVersion: this.last?.version ?? null,
      viewport: this.last?.viewport ?? null,
    };
  }
}
