import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type { OfferReadObservation } from "../offer-read-version";
import type { NotificationSnapshot, ReadContext } from "../notification-read-receipts";

type Hook = typeof import("./useVisibleNotificationRead").useVisibleNotificationRead;
const user = "10000000-0000-4000-8000-000000000001";
const context: ReadContext = { requestId: "10000000-0000-4000-8000-000000000002", offerId: "10000000-0000-4000-8000-000000000003" };
const observed = { userId: user, role: "customer" as const, offerId: context.offerId!, version: "1" };
const note = "10000000-0000-4000-8000-000000000004";
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const values: unknown[] = [], effects: (() => void | (() => void))[] = [];
  let cursor = 0, captures = 0, offerMarks = 0, notificationMarks = 0;
  let auth!: (event: string, session: { user: { id: string } } | null) => void;
  const events: string[] = [];
  const listeners = new Map<string, () => void>();
  const waits: { notification?: Promise<void>; offer?: Promise<void>; unavailable?: boolean } = {};
  const offerCalls: { observation: OfferReadObservation; signal?: AbortSignal }[] = [];
  const state = { search: "", visibility: "visible", notificationConfirmed: true, offerConfirmed: true, fail: false };
  const snapshot: NotificationSnapshot = { userId: user, role: "customer", rows: [
    { id: note, type: "offer_received", request_id: context.requestId, offer_id: context.offerId!, appointment_id: null },
  ] };
  const observers: FakeObserver[] = [];
  class FakeObserver {
    disconnected = false;
    callback: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void;
    constructor(callback: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    show() { if (!this.disconnected) this.callback([{ isIntersecting: true, intersectionRatio: 1 }]); }
  }
  const hookModule: Record<string, unknown> = {};
  const api = {
    captureNotificationSnapshot: async () => { captures++; return snapshot; },
    displayedNotificationIds: (s: NotificationSnapshot, c: ReadContext) => s.rows.filter(row => row.request_id === c.requestId && row.offer_id === c.offerId).map(row => row.id),
    confirmNotificationRead: async (_s: NotificationSnapshot, ids: string[]) => {
      notificationMarks++; await waits.notification; if (state.fail) throw new Error("offline denied");
      return state.notificationConfirmed ? ids : [];
    },
    confirmOfferRead: async (_role: string, _user: string, observations: OfferReadObservation[], options: { signal?: AbortSignal; isCurrent: () => boolean }) => {
      offerMarks++; offerCalls.push({ observation: observations[0], signal: options.signal });
      await waits.offer;
      if (!options.isCurrent() || options.signal?.aborted) throw new Error("cancelled");
      if (waits.unavailable) throw new Error("OFFER_READ_UNAVAILABLE");
      return { changed: 0, confirmedIds: state.offerConfirmed ? [context.offerId] : [] };
    },
  };
  const effectState = new Map<number, { deps: unknown[]; cleanup?: void | (() => void) }>();
  const react = {
    useRef: (initial: unknown) => { const n = cursor++; return values[n] ??= { current: initial }; },
    useState: (initial: unknown) => { const n = cursor++; if (!(n in values)) values[n] = initial; return [values[n], (v: unknown) => { values[n] = v; }]; },
    useEffect: (fn: () => void | (() => void), deps: unknown[] = []) => {
      const n = cursor++; const previous = effectState.get(n);
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) effects.push(() => {
        previous?.cleanup?.(); effectState.set(n, { deps, cleanup: fn() });
      });
    },
    useCallback: (fn: unknown) => fn,
  };
  const js = ts.transpileModule(readFileSync(new URL("./useVisibleNotificationRead.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", "document", "window", "globalThis", "IntersectionObserver", js)((name: string) => {
    if (name === "react") return react;
    if (name === "@/lib/notification-read-receipts") return api;
    if (name === "@/lib/supabase/client") return { supabase: { auth: { onAuthStateChange: (fn: typeof auth) => { auth = fn; return { data: { subscription: { unsubscribe() {} } } }; } } } };
    throw new Error(name);
  }, hookModule, { get visibilityState() { return state.visibility; }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) }, { location: { get search() { return state.search; } }, dispatchEvent: (event: Event) => events.push(event.type) },
  { IntersectionObserver: FakeObserver }, FakeObserver);
  const hook = hookModule.useVisibleNotificationRead as Hook;
  let activeRole: "customer" | "workshop" = "customer";
  const render = () => { cursor = 0; const value = hook(activeRole, ["offer_received"]); effects.splice(0).forEach(fn => fn()); return value; };
  let current = render();
  const element = { isConnected: true } as HTMLElement;
  return { state, waits, offerCalls, events, observers, element, snapshot, listeners,
    current: () => current,
    render: (role?: "customer" | "workshop") => { if (role) activeRole = role; current = render(); return current; },
    auth: (id: string | null) => auth("SIGNED_IN", id ? { user: { id } } : null),
    unmount: () => effectState.forEach(effect => effect.cleanup?.()),
    counts: () => ({ captures, offerMarks, notificationMarks }),
  };
}
async function loaded(f: ReturnType<typeof fixture>) {
  await f.current().capture(user);
  f.current().complete(user);
  f.render();
}
test("loading alone never marks; authorized context must complete and become visible", async () => {
  const f = fixture(); await f.current().capture(user); f.render();
  f.current().observe(context, observed)(f.element);
  assert.equal(f.observers.length, 0);
  f.current().complete(user); f.render();
  f.current().observe(context, observed)(f.element);
  assert.equal(f.counts().notificationMarks, 0);
  f.observers[0].show(); await settle();
  assert.deepEqual(f.events, ["notifications-read-updated", "offers-read-updated"]);
});
test("hidden page cannot acknowledge, visible observation can", async () => {
  const f = fixture(); await loaded(f); f.state.visibility = "hidden";
  f.current().observe(context, observed)(f.element); f.observers[0].show(); await settle();
  assert.equal(f.counts().notificationMarks, 0);
  f.state.visibility = "visible"; f.listeners.get("visibilitychange")?.(); await settle();
  assert.equal(f.counts().notificationMarks, 1);
});
test("same card, repeated observer callbacks and rerenders do not duplicate writes", async () => {
  const f = fixture(); await loaded(f);
  f.current().observe(context, observed)(f.element); f.observers[0].show(); f.observers[0].show(); await settle();
  f.render().observe(context, observed)(f.element);
  assert.deepEqual(f.counts(), { captures: 1, offerMarks: 1, notificationMarks: 1 });
});
test("Realtime reload does not capture later notifications into current observation batch", async () => {
  const f = fixture(); await loaded(f);
  await f.current().capture(user); f.current().complete(user);
  assert.equal(f.counts().captures, 1);
});
test("different work item cannot acknowledge the snapshot's notification", async () => {
  const f = fixture(); await loaded(f);
  f.current().observe({ requestId: "other", offerId: "other" }, observed)(f.element); f.observers[0].show(); await settle();
  assert.deepEqual(f.events, []); assert.equal(f.counts().offerMarks, 0);
});
test("zero persistent rows does not optimistically clear badge", async () => {
  const f = fixture(); await loaded(f); f.state.notificationConfirmed = false; f.state.offerConfirmed = false;
  f.current().observe(context, observed)(f.element); f.observers[0].show(); await settle();
  assert.deepEqual(f.events, []);
});
test("failure produces no notification receipt and no retry on duplicate observation", async () => {
  const f = fixture(); await loaded(f); f.state.fail = true;
  f.current().observe(context)(f.element); f.observers[0].show(); await settle(); f.observers[0].show();
  assert.equal(f.counts().notificationMarks, 1); assert.deepEqual(f.events, []);
});
for (const terminate of ["logout", "other-account", "unmount", "detached"] as const) test(`${terminate}: stale observer cannot mark`, async () => {
  const f = fixture(); await loaded(f); f.current().observe(context, observed)(f.element);
  if (terminate === "logout") f.auth(null);
  if (terminate === "other-account") f.auth("another-user");
  if (terminate === "unmount") f.unmount();
  if (terminate === "detached") Object.assign(f.element, { isConnected: false });
  f.observers[0].show(); await settle(); assert.equal(f.counts().notificationMarks, 0);
});
test("observer cleanup disconnects", async () => {
  const f = fixture(); await loaded(f); const cleanup = f.current().observe(context)(f.element);
  cleanup?.(); f.observers[0].show(); await settle(); assert.equal(f.counts().notificationMarks, 0);
});
test("a focused notification cannot mark a neighbouring visible card", async () => {
  const f = fixture(); await loaded(f); f.state.search = `?focusOffer=another-offer`;
  f.current().observe(context, observed)(f.element);
  assert.equal(f.observers.length, 0); assert.equal(f.counts().notificationMarks, 0);
});
test("effect cleanup followed by a new observation session captures a fresh batch", async () => {
  const f = fixture(); await loaded(f); f.unmount();
  await f.current().capture(user); f.current().complete(user); f.render();
  assert.equal(f.counts().captures, 2);
});

test("missing displayed version disables offer receipt but preserves distinct notification", async () => {
  const f = fixture(); await loaded(f);
  f.current().observe(context, null)(f.element); f.observers[0].show(); await settle();
  assert.equal(f.counts().offerMarks, 0); assert.equal(f.counts().notificationMarks, 1);
  assert.equal(f.render().offerReadUnavailable, true);
});
test("missing overload surfaces unavailable without retry", async () => {
  const f = fixture(); await loaded(f); f.waits.unavailable = true;
  f.current().observe(context, observed)(f.element); f.observers[0].show(); await settle();
  assert.equal(f.render().offerReadUnavailable, true); assert.equal(f.counts().offerMarks, 1);
  f.current().observe(context, observed)(f.element); assert.equal(f.observers.length, 1);
  assert.ok(!f.events.includes("offers-read-updated"));
});
test("new rendered generation needs its own visibility callback; refetch alone cannot acknowledge", async () => {
  const f = fixture(); await loaded(f);
  const cleanup = f.current().observe(context, observed)(f.element); f.observers[0].show(); await settle(); cleanup?.();
  f.render().observe(context, { ...observed, version: "9007199254740993" })(f.element);
  assert.equal(f.counts().offerMarks, 1);
  f.observers[1].show(); await settle();
  assert.equal(f.counts().offerMarks, 2);
  assert.deepEqual(f.offerCalls.map(call => call.observation.version), ["1", "9007199254740993"]);
  assert.equal(f.counts().notificationMarks, 1);
});
test("stale result cannot substitute new version or retry automatically", async () => {
  const f = fixture(); await loaded(f); f.state.offerConfirmed = false;
  f.current().observe(context, observed)(f.element); f.observers[0].show(); await settle();
  f.render().observe(context, observed)(f.element);
  assert.equal(f.counts().offerMarks, 1); assert.ok(!f.events.includes("offers-read-updated"));
});
for (const reason of ["cleanup", "account", "role", "unmount"] as const) test(`${reason}: pending observation cancelled before offer RPC`, async () => {
  const f = fixture(); await loaded(f); let finish!: () => void;
  f.waits.notification = new Promise<void>(resolve => { finish = resolve; });
  const cleanup = f.current().observe(context, observed)(f.element); f.observers[0].show();
  if (reason === "cleanup") cleanup?.();
  if (reason === "account") f.auth("another-account");
  if (reason === "role") f.render("workshop");
  if (reason === "unmount") f.unmount();
  finish(); await settle(); assert.equal(f.counts().offerMarks, 0);
});
test("in-flight receipt is aborted on unmount and cannot dispatch badge success", async () => {
  const f = fixture(); await loaded(f); let finish!: () => void;
  f.waits.offer = new Promise<void>(resolve => { finish = resolve; });
  f.current().observe(context, observed)(f.element); f.observers[0].show(); await settle();
  f.unmount(); assert.equal(f.offerCalls[0].signal?.aborted, true);
  finish(); await settle(); assert.ok(!f.events.includes("offers-read-updated"));
});
test("same account different role cannot consume an observation captured for the other role", async () => {
  const f = fixture(); await loaded(f);
  f.current().observe(context, { ...observed, role: "workshop" })(f.element); f.observers[0].show(); await settle();
  assert.equal(f.counts().offerMarks, 0);
});

test("new observation after capability becomes available clears unavailable state", async () => {
  const f = fixture(); await loaded(f);
  const cleanup = f.current().observe(context, null)(f.element); f.observers[0].show(); await settle();
  assert.equal(f.render().offerReadUnavailable, true); cleanup?.();
  f.current().observe(context, observed)(f.element); f.observers[1].show(); await settle();
  assert.equal(f.render().offerReadUnavailable, false);
  assert.equal(f.counts().offerMarks, 1);
});
