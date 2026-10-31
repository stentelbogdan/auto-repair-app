// PostgreSQL bigint may arrive as a JSON number or decimal string. Never round it.
export type PhotoOverview = {
  valid_photo_associations: string;
  total_photo_associations: string | null;
  associations_complete: boolean;
  unclassifiable_entries: string;
  storage_objects_count: string;
  unfinished_targeted_operations: string;
  expired_delete_claims: string;
  observed_at: string;
};

function count(value: unknown): string {
  const text = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value) : value;
  if (typeof text !== "string" || !/^(0|[1-9]\d{0,18})$/.test(text)
    || BigInt(text) > BigInt("9223372036854775807")) throw new Error("INVALID_COUNT");
  return text;
}

export function parsePhotoOverview(value: unknown): PhotoOverview {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RESULT");
  const r = value as Record<string, unknown>;
  if (typeof r.associations_complete !== "boolean" || typeof r.observed_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(r.observed_at)
    || !Number.isFinite(Date.parse(r.observed_at))) throw new Error("INVALID_RESULT");
  const result: PhotoOverview = {
    valid_photo_associations: count(r.valid_photo_associations),
    total_photo_associations: r.total_photo_associations === null ? null : count(r.total_photo_associations),
    associations_complete: r.associations_complete,
    unclassifiable_entries: count(r.unclassifiable_entries),
    storage_objects_count: count(r.storage_objects_count),
    unfinished_targeted_operations: count(r.unfinished_targeted_operations),
    expired_delete_claims: count(r.expired_delete_claims),
    observed_at: r.observed_at,
  };
  if (result.associations_complete
    ? result.unclassifiable_entries !== "0" || result.total_photo_associations !== result.valid_photo_associations
    : result.unclassifiable_entries === "0" || result.total_photo_associations !== null) throw new Error("INVALID_COMPLETENESS");
  return result;
}

export function formatPhotoCount(value: string): string {
  return BigInt(value).toLocaleString("ro-RO");
}

export function isPhotoMonitorTestUrl(url: string | undefined): boolean {
  return url === "https://bstjobvvxxfqqwyjoimx.supabase.co"
    || url === "https://bstjobvvxxfqqwyjoimx.supabase.co/";
}

export const PHOTO_TOPIC = "admin:photo-overview:v1";
export const PHOTO_EVENT = "invalidate";
export type PhotoConnection = "disabled" | "connecting" | "subscribed" | "reconnecting" | "signed_out" | "denied";
export type PhotoMonitorState = {
  data: PhotoOverview | null;
  loading: boolean;
  stale: boolean;
  error: "session" | "authorization" | "unavailable" | null;
  connection: PhotoConnection;
};
export const initialPhotoState: PhotoMonitorState = { data: null, loading: true, stale: false, error: null, connection: "disabled" };

export function isPhotoInvalidation(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as { v?: unknown }).v === 1;
}

export function createPhotoMonitor(deps: {
  read: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  publish: (state: PhotoMonitorState) => void;
  connect?: (events: { message: (payload: unknown) => void; status: (status: string) => void }) => () => void;
}) {
  let state = initialPhotoState;
  let active = true, generation = 0, queued = false, pending = false;
  let session: string | null = null;
  let running: Promise<void> | null = null;
  let abort: AbortController | null = null;
  let disconnect: (() => void) | null = null;
  let channelGeneration = 0;
  let closedRecoveryUsed = false;
  const publish = (next: PhotoMonitorState) => { state = next; if (active) deps.publish(next); };
  function leave() {
    ++channelGeneration;
    try { disconnect?.(); } catch { /* Channel cleanup must not affect the snapshot. */ }
    disconnect = null;
  }
  function invalidate() {
    if (!active || !session || state.error === "authorization") return;
    pending = true;
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (active && session && pending) void drain(); });
  }
  function join() {
    if (!deps.connect || disconnect || !active || !session) return;
    const ticket = ++channelGeneration;
    const current = () => active && ticket === channelGeneration;
    publish({ ...state, connection: "connecting" });
    try {
      const cleanup = deps.connect({
        message: payload => { if (current() && isPhotoInvalidation(payload)) invalidate(); },
        status: status => {
          if (!current()) return;
          if (status === "SUBSCRIBED") {
            closedRecoveryUsed = false;
            publish({ ...state, connection: "subscribed" });
            invalidate(); // Also closes the initial read / subscribe race.
          } else if (status === "CLOSED") {
            // CLOSED is terminal in the SDK; it does not rejoin this channel.
            // Invalidate old callbacks/reads and let the connector serialize
            // teardown before a replacement, after a fresh authorized RPC.
            leave(); ++generation; pending = false; abort?.abort();
            publish({ ...state, connection: "reconnecting", stale: !!state.data });
            // Do not spin if the replacement also closes before SUBSCRIBED.
            if (!closedRecoveryUsed) { closedRecoveryUsed = true; invalidate(); }
          } else if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
            publish({ ...state, connection: "reconnecting", stale: !!state.data });
          }
        },
      });
      if (current()) disconnect = cleanup; else cleanup();
    } catch {
      publish({ ...state, connection: "reconnecting", stale: !!state.data });
    }
  }
  function drain(): Promise<void> {
    if (running) return running;
    if (!active || !session || !pending) return Promise.resolve();
    running = (async () => {
      while (active && session && pending) {
        pending = false;
        const ticket = generation;
        const controller = new AbortController(); abort = controller;
        publish({ ...state, loading: true, error: null });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cancelled = new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("READ_CANCELLED")), { once: true });
          timer = setTimeout(() => controller.abort(), 10000);
        });
        try {
          const result = await Promise.race([Promise.resolve(deps.read(controller.signal)), cancelled]);
          if (!active || ticket !== generation) continue;
          if (["42501", "PGRST301", "PGRST303"].includes(result.error?.code ?? "")) {
            pending = false; leave();
            publish({ data: null, loading: false, stale: false, error: "authorization", connection: "denied" });
            continue;
          }
          if (result.error) throw new Error("RPC_FAILED");
          publish({ ...state, data: parsePhotoOverview(result.data), loading: false,
            stale: pending || state.connection === "reconnecting", error: null });
          join(); // Subscribe only after the Admin RPC has authorized a read.
        } catch {
          if (active && ticket === generation) publish({ ...state, loading: false, stale: !!state.data, error: "unavailable" });
        } finally {
          clearTimeout(timer);
          if (abort === controller) abort = null;
        }
      }
    })().finally(() => {
      running = null;
      if (active && session && pending) void drain();
    });
    return running;
  }
  return {
    refresh() { if (!active || !session) return Promise.resolve(); closedRecoveryUsed = false; pending = true; return drain(); },
    invalidate,
    foreground() { closedRecoveryUsed = false; if (state.connection === "reconnecting") leave(); invalidate(); },
    sessionChanged(key: string | null) {
      if (!active || (key === session && !(key === null && state.loading))) return;
      session = key; closedRecoveryUsed = false; ++generation; leave(); abort?.abort();
      pending = !!key;
      publish({ data: null, loading: !!key, stale: false, error: key ? null : "session",
        connection: key ? "disabled" : "signed_out" });
      // Supabase calls must start outside onAuthStateChange's callback.
      if (key) invalidate();
    },
    markStale() { if (active && state.data) publish({ ...state, stale: true }); },
    dispose() { active = false; session = null; pending = false; ++generation; leave(); abort?.abort(); },
  };
}

// Supabase reuses an existing channel with the same topic. Serialize teardown
// before opening a replacement, including React StrictMode and token changes.
export function createPhotoBroadcastConnector<C>(deps: {
  open: (events: { message: (payload: unknown) => void; status: (status: string) => void }) => C;
  close: (channel: C) => Promise<unknown>;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  return (events: { message: (payload: unknown) => void; status: (status: string) => void }) => {
    let active = true;
    let channel: C | undefined;
    tail = tail.catch(() => {}).then(() => {
      if (!active) return;
      try { channel = deps.open({message: p => { if (active) events.message(p); }, status: s => { if (active) events.status(s); }}); }
      catch { if (active) events.status("CHANNEL_ERROR"); }
    });
    return () => {
      active = false;
      tail = tail.catch(() => {}).then(async () => { if (channel !== undefined) await deps.close(channel); }).catch(() => {});
    };
  };
}
