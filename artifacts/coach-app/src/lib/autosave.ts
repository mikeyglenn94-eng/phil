// Thin wrapper around fetch that:
//  - returns "saved" on success,
//  - returns "queued" when the network is unreachable (and stores the request in IndexedDB),
//  - drains the queue when the browser comes back online.

import { enqueue, drain, count } from "./idb-queue";

export type AutosaveState = "saved" | "saving" | "queued";

type Listener = (state: AutosaveState, queueDepth: number) => void;
const listeners = new Set<Listener>();
let lastState: AutosaveState = "saved";
let lastDepth = 0;

function emit(state: AutosaveState, depth: number) {
  lastState = state;
  lastDepth = depth;
  for (const fn of listeners) {
    try { fn(state, depth); } catch { /* listener error */ }
  }
}

export function subscribeAutosaveState(fn: Listener): () => void {
  listeners.add(fn);
  // Hand the new subscriber the current state so the chip renders immediately.
  fn(lastState, lastDepth);
  return () => { listeners.delete(fn); };
}

export type AutosaveRequest = {
  url: string;
  method?: "POST" | "PUT" | "PATCH";
  body: unknown;
  /** Optional headers (auth etc.). Content-Type is added automatically. */
  headers?: Record<string, string>;
};

/**
 * Distinguish three outcomes:
 *  - { kind: "ok" }            → 2xx, persisted upstream
 *  - { kind: "network" }       → fetch threw (offline, DNS, TLS, abort): queue and retry on reconnect
 *  - { kind: "http", status }  → server responded non-2xx (auth, validation, 5xx):
 *                                 surface as a hard failure; do NOT queue, since replay would loop forever.
 */
type FetchOutcome = { kind: "ok" } | { kind: "network" } | { kind: "http"; status: number };

async function performFetch(req: AutosaveRequest): Promise<FetchOutcome> {
  try {
    const res = await fetch(req.url, {
      method: req.method ?? "POST",
      headers: { "Content-Type": "application/json", ...(req.headers ?? {}) },
      body: JSON.stringify(req.body),
      credentials: "include",
    });
    if (res.ok) return { kind: "ok" };
    return { kind: "http", status: res.status };
  } catch {
    return { kind: "network" };
  }
}

export async function autosaveSession(req: AutosaveRequest): Promise<AutosaveState> {
  emit("saving", lastDepth);

  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (online) {
    const outcome = await performFetch(req);
    if (outcome.kind === "ok") {
      // Opportunistically drain anything queued while offline.
      void drainQueueNow();
      const depth = await count();
      emit(depth > 0 ? "queued" : "saved", depth);
      return depth > 0 ? "queued" : "saved";
    }
    if (outcome.kind === "http") {
      // Server rejected the payload. Don't poison the offline queue with a
      // request the server will keep rejecting. Surface as a hard failure so
      // the chip flips back to "saved" (no pending writes) and the caller can
      // toast/log. We deliberately throw so handleSave's catch fires.
      const depth = await count();
      emit(depth > 0 ? "queued" : "saved", depth);
      throw new Error(`autosave http ${outcome.status}`);
    }
    // outcome.kind === "network" → fall through to enqueue.
  }

  // Offline OR true network failure → queue for retry on reconnect.
  await enqueue({
    url: req.url,
    method: req.method ?? "POST",
    body: req.body,
    enqueuedAt: Date.now(),
  });
  const depth = await count();
  emit("queued", depth);
  return "queued";
}

async function drainQueueNow(): Promise<void> {
  await drain(async (item) => {
    const outcome = await performFetch({ url: item.url, method: item.method, body: item.body });
    // Only retry on network errors; drop items the server has rejected so we
    // don't loop forever on permanently-bad payloads.
    if (outcome.kind === "network") throw new Error("network retry");
    // "ok" or "http" both consume the item (drain handler treats no-throw as success).
  });
  const depth = await count();
  emit(depth > 0 ? "queued" : "saved", depth);
}

// Wire the global online listener once. We re-drain on every reconnect.
let wired = false;
export function initAutosaveListener(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("online", () => { void drainQueueNow(); });
  // Initial drain in case the queue is non-empty from a previous session.
  void (async () => {
    const depth = await count();
    if (depth > 0) {
      emit("queued", depth);
      if (navigator.onLine) await drainQueueNow();
    }
  })();
}
