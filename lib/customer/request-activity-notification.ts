// Server transport. Imported only by the server deletion route; no env/network at import.
const TEST_URL = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const TEST_REF = "bstjobvvxxfqqwyjoimx";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result = { status: string; detached: boolean | "unknown"; physicalDeletionConfirmed: boolean };

/** One authenticated owner lookup and one private invalidation, only AFTER the
 * trusted deletion boundary. Independent of Admin flags/tickets/deduplication. */
export function createCustomerActivityInvalidation(deps: {
  env: Record<string, string | undefined>; fetch: typeof fetch; timeoutMs?: number;
}) {
  return async (accessToken: string, result: Result): Promise<"accepted" | "unavailable" | "skipped"> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const env = deps.env;
      if (typeof window !== "undefined" || result.status !== "deleted" || result.detached !== true || result.physicalDeletionConfirmed !== true ||
        env.VERCEL_ENV !== "preview" || env.SUPABASE_URL !== TEST_URL || env.NEXT_PUBLIC_SUPABASE_URL !== TEST_URL ||
        env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF !== TEST_REF || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY ||
        !accessToken || accessToken === env.SUPABASE_SERVICE_ROLE_KEY || accessToken === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return "skipped";
      const work = async (): Promise<"accepted" | "unavailable"> => {
        const auth = await deps.fetch(`${TEST_URL}/auth/v1/user`, {
          redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${accessToken}` },
        });
        if (!auth.ok || !auth.body) { void auth.body?.cancel().catch(() => {}); return "unavailable"; }
        const reader = auth.body.getReader();
        const cancel = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener("abort", cancel, { once: true });
        let text = "", bytes = 0;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        try {
          if (controller.signal.aborted) throw new Error("ABORTED");
          while (true) {
            const part = await reader.read(); if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 32768) throw new Error("AUTH_BODY_LIMIT");
            text += decoder.decode(part.value, { stream: true });
          }
          text += decoder.decode();
        } finally { controller.signal.removeEventListener("abort", cancel); cancel(); }
        const user: unknown = JSON.parse(text);
        if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !UUID.test(user.id)) return "unavailable";
        controller.signal.throwIfAborted();
        const response = await deps.fetch(`${TEST_URL}/realtime/v1/api/broadcast`, {
          method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ topic: `customer:request-activity:v1:${user.id}`, event: "invalidate", payload: { v: 1 }, private: true }] }),
        });
        void response.body?.cancel().catch(() => {});
        return response.status === 202 ? "accepted" : "unavailable";
      };
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("ACTIVITY_NOTIFICATION_TIMEOUT")); }, Math.max(1, Math.min(deps.timeoutMs ?? 2500, 5000)));
      })]);
    } catch { return "unavailable"; }
    finally { clearTimeout(timer); controller.abort(); }
  };
}
