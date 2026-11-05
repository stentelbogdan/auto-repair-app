export const CUSTOMER_ACTIVITY_TOPIC = "customer:request-activity:v1:";
export function isCustomerActivityInvalidation(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 1 && (value as { v?: unknown }).v === 1;
}

/** Session-scoped coalescing and stale-response protection; no polling. */
export function createCustomerActivityLive<T>(deps: {
  read: (owner: string, signal: AbortSignal) => Promise<T[]>;
  publish: (rows: T[], loading: boolean, error: boolean) => void;
  connect: (owner: string, events: { invalidate(): void; status(value: string): void }) => () => void;
}) {
  let active = true, generation = 0, session: string | null | undefined;
  let stop: (() => void) | null = null;
  let abort: AbortController | null = null;
  let refresh: () => void = () => {};
  let reconnect: () => void = () => {};
  function leave() {
    generation++;
    abort?.abort(); abort = null;
    const old = stop; stop = null;
    try { old?.(); } catch { /* No stale subscription may publish. */ }
  }
  return {
    session(key: string | null, owner: string | null) {
      if (!active || key === session) return;
      leave(); session = key;
      refresh = () => {}; reconnect = () => {};
      deps.publish([], !!owner, false);
      if (!key || !owner) return;
      const ticket = generation;
      const current = () => active && ticket === generation;
      let pending = false, running = false, queued = false, revision = 0;
      let rows: T[] = [];
      let connection = 0, closed = false, recoveryUsed = false;
      async function drain() {
        if (running || !current()) return;
        running = true;
        try {
          while (pending && current()) {
            pending = false;
            const version = revision;
            const controller = new AbortController(); abort = controller;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let onAbort = () => {};
            try {
              const value = await Promise.race([deps.read(owner!, controller.signal), new Promise<never>((_, reject) => {
                onAbort = () => reject(new Error("ACTIVITY_READ_ABORTED"));
                controller.signal.addEventListener("abort", onAbort, { once: true });
                timer = setTimeout(() => controller.abort(), 15000);
              })]);
              if (current() && version === revision) { rows = value; deps.publish(rows, false, false); }
            } catch {
              if (current() && version === revision) { rows = []; deps.publish(rows, false, true); }
            } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort); controller.abort(); }
          }
        } finally { running = false; }
      }
      refresh = () => {
        if (!current()) return;
        pending = true; revision++;
        if (!queued) {
          queued = true;
          queueMicrotask(() => { queued = false; void drain(); });
        }
      };
      const invalidate = refresh;
      function join() {
        const attempt = ++connection;
        const live = () => current() && attempt === connection;
        try {
          stop = deps.connect(owner!, {
            invalidate: () => { if (live()) invalidate(); },
            status: value => {
              if (!live()) return;
              if (value === "SUBSCRIBED") { invalidate(); }
              if (value === "CLOSED") {
                closed = true;
                if (!recoveryUsed) {
                  recoveryUsed = true;
                  queueMicrotask(() => { if (live() && closed) reconnect(); });
                }
              }
            },
          });
        } catch { closed = true; }
      }
      reconnect = () => {
        if (!current() || !closed) return;
        connection++;
        const old = stop; stop = null;
        try { old?.(); } catch { /* Cleanup cannot grant access. */ }
        closed = false; join();
      };
      join(); invalidate();
    },
    foreground() { reconnect(); refresh(); },
    invalidate() { refresh(); },
    dispose() { active = false; leave(); refresh = () => {}; reconnect = () => {}; },
  };
}
