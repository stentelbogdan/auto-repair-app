import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Hook = typeof import("./useTowingTrackingNotificationRead").useTowingTrackingNotificationRead;
const context = { requestId: "fictional-request", offerId: "fictional-offer", appointmentId: "fictional-appointment", ownerId: "fictional-owner", enabled: true };
function fixture(input = context) {
  let user: string | null = context.ownerId;
  let cleanup: (() => void) | undefined;
  let event: (payload: { new: Record<string, unknown> }) => void = () => {};
  let subscribed: (status: string) => void = () => {};
  let releaseAuth: (() => void) | undefined;
  const calls: unknown[][] = [];
  const listeners = new Map<string, () => void>();
  const channel = {
    on: (_event: string, filter: unknown, callback: typeof event) => { calls.push(["filter", filter]); event = callback; return channel; },
    subscribe: (callback: typeof subscribed) => { subscribed = callback; return channel; },
  };
  const state = { visibility: "visible", delayAuth: false };
  const supabase = {
    auth: { getUser: async () => {
      if (state.delayAuth) await new Promise<void>(resolve => { releaseAuth = resolve; });
      return { data: { user: user ? { id: user } : null }, error: null };
    } },
    channel: () => channel,
    removeChannel: async () => { calls.push(["remove"]); },
  };
  const receipts = {
    capture: async (...args: unknown[]) => { calls.push(["capture", ...args]); },
    complete: (...args: unknown[]) => { calls.push(["complete", ...args]); },
    observe: (...args: unknown[]) => { calls.push(["observe", ...args]); return () => {}; },
  };
  const hookExports = {} as { useTowingTrackingNotificationRead: Hook };
  const source = ts.transpileModule(readFileSync(new URL("./useTowingTrackingNotificationRead.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const surface = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name), get visibilityState() { return state.visibility; } };
  new Function("require", "exports", "document", "window", source)((name: string) => {
    if (name === "react") return { useEffect: (fn: () => (() => void) | undefined) => { cleanup = fn(); }, useMemo: (fn: () => unknown) => fn() };
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "@/lib/notifications") return { TOWING_TRACKING_STARTED_NOTIFICATION_TYPE: "towing_tracking_started" };
    if (name === "@/lib/hooks/useVisibleNotificationRead") return { useVisibleNotificationRead: (role: string, types: string[]) => {
      assert.equal(role, "customer"); assert.deepEqual(types, ["towing_tracking_started"]); return receipts;
    } };
    throw new Error(name);
  }, hookExports, surface, surface);
  const ref = hookExports.useTowingTrackingNotificationRead(input);
  return { calls, state, listeners, ref, event, subscribed,
    cleanup: () => cleanup?.(), setUser: (value: string | null) => { user = value; }, releaseAuth: () => releaseAuth?.() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = { type: "towing_tracking_started", recipient_role: "customer", request_id: context.requestId, offer_id: context.offerId, appointment_id: context.appointmentId };

test("detail observes exact loaded tuple, captures owner, refreshes on subscribe and matching insert", async () => {
  const f = fixture(); await flush();
  assert.deepEqual(f.calls.find(call => call[0] === "observe"), ["observe", { requestId: context.requestId, offerId: context.offerId, appointmentId: context.appointmentId }]);
  assert.deepEqual(f.calls.filter(call => call[0] === "capture"), [["capture", context.ownerId, true]]);
  f.subscribed("SUBSCRIBED"); await flush(); f.event({ new: row }); await flush();
  assert.equal(f.calls.filter(call => call[0] === "complete").length, 3);
  f.cleanup(); assert.equal(f.listeners.size, 0);
});
test("other type, role, request, offer and appointment cannot renew tracking receipts", async () => {
  const f = fixture(); await flush();
  for (const key of ["type", "recipient_role", "request_id", "offer_id", "appointment_id"]) f.event({ new: { ...row, [key]: "other" } });
  await flush(); assert.equal(f.calls.filter(call => call[0] === "capture").length, 1);
});
for (const user of [null, "another-user"]) test(`session ${user ?? "missing"} cannot capture owner receipt`, async () => {
  const f = fixture(); await flush(); f.calls.length = 0; f.setUser(user);
  f.event({ new: row }); await flush(); assert.equal(f.calls.length, 0);
});
test("disabled or incomplete tracking context creates no subscription or receipt", () => {
  for (const input of [{ ...context, enabled: false }, { ...context, offerId: "" }, { ...context, appointmentId: "" }, { ...context, ownerId: "" }]) {
    const f = fixture(input); assert.equal(f.ref, undefined); assert.deepEqual(f.calls, []);
  }
});
test("late auth result after unmount cannot capture/complete", async () => {
  const f = fixture(); await flush(); f.calls.length = 0; f.state.delayAuth = true;
  f.event({ new: row }); f.cleanup(); f.releaseAuth(); await flush();
  assert.deepEqual(f.calls, [["remove"]]);
});
test("focus/reconnection recover a missed event; hidden page cannot renew observations", async () => {
  const f = fixture(); await flush(); f.calls.length = 0;
  f.state.visibility = "hidden"; f.listeners.get("visibilitychange")?.(); await flush(); assert.equal(f.calls.length, 0);
  f.state.visibility = "visible"; f.listeners.get("focus")?.(); await flush();
  assert.equal(f.calls.filter(call => call[0] === "capture").length, 1);
  // The shared visibility hook (separately tested) decides when it may mark read.
});
