import type { WorkshopDiscoveryCounts } from "./workshop-discovery";

export const WORKSHOP_DISCOVERY_TOPIC = "workshop:discovery:v1";

export function isWorkshopDiscoveryInvalidation(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !("v" in payload) || payload.v !== 1) return false;
  const keys = Object.keys(payload);
  if (keys.length === 1) return keys[0] === "v";
  // realtime.send adds a random message UUID, not a request/customer identifier.
  // Accept only this managed metadata field; counts still come from the RPC.
  return keys.length === 2 && keys.includes("id") && "id" in payload
    && typeof payload.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.id);
}

// One reader per mounted, authenticated Service dashboard. No polling and no
// optimistic count: a burst is coalesced, with one trailing read if it races RPC.
export function createWorkshopDiscoveryRefresh(deps: {
  read(signal: AbortSignal): Promise<WorkshopDiscoveryCounts>;
  publish(counts: WorkshopDiscoveryCounts | null, error: boolean): void;
  delayMs?: number;
}) {
  let disposed = false;
  let revision = 0;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const schedule = () => {
    if (disposed || running || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void run(); }, deps.delayMs ?? 200);
  };
  const run = async () => {
    if (disposed || running || !pending) return;
    pending = false;
    running = true;
    const observed = revision;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 12_000);
    try {
      const counts = await deps.read(controller.signal);
      if (controller.signal.aborted) throw new Error("DISCOVERY_READ_ABORTED");
      if (!disposed && observed === revision) deps.publish(counts, false);
    } catch {
      if (!disposed && observed === revision) deps.publish(null, true);
    } finally {
      clearTimeout(timeout);
      running = false;
      controller = undefined;
      if (pending) schedule();
    }
  };
  return {
    invalidate() {
      if (disposed) return;
      revision += 1;
      pending = true;
      schedule();
    },
    dispose() {
      disposed = true;
      revision += 1;
      if (timer !== undefined) clearTimeout(timer);
      controller?.abort();
    },
  };
}
