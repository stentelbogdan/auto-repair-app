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

export type PhotoMonitorState = {
  data: PhotoOverview | null;
  loading: boolean;
  stale: boolean;
  error: "session" | "authorization" | "unavailable" | null;
};
export const initialPhotoState: PhotoMonitorState = { data: null, loading: true, stale: false, error: null };

export function createPhotoMonitor(deps: {
  read: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  publish: (state: PhotoMonitorState) => void;
}) {
  let state = initialPhotoState;
  let active = true;
  let generation = 0;
  let session: string | null = null;
  const publish = (next: PhotoMonitorState) => { state = next; if (active) deps.publish(next); };
  async function refresh() {
    if (!active || !session) return;
    const ticket = ++generation;
    publish({ ...state, loading: true, error: null });
    try {
      const result = await deps.read();
      if (!active || ticket !== generation) return;
      if (result.error?.code === "42501" || result.error?.code === "PGRST301" || result.error?.code === "PGRST303") {
        publish({ data: null, loading: false, stale: false, error: "authorization" });
        return;
      }
      if (result.error) throw new Error("RPC_FAILED");
      publish({ data: parsePhotoOverview(result.data), loading: false, stale: false, error: null });
    } catch {
      if (active && ticket === generation) publish({ ...state, loading: false, stale: !!state.data, error: "unavailable" });
    }
  }
  return {
    refresh,
    sessionChanged(key: string | null) {
      if (!active || (key !== null && key === session)) return;
      session = key;
      ++generation;
      publish({ data: null, loading: !!key, stale: false, error: key ? null : "session" });
      // Do not call Supabase asynchronously inside its auth-change callback.
      const ticket = generation;
      if (key) queueMicrotask(() => { if (active && ticket === generation) void refresh(); });
    },
    markStale() { if (active && state.data) publish({ ...state, stale: true }); },
    dispose() { active = false; session = null; ++generation; },
  };
}
