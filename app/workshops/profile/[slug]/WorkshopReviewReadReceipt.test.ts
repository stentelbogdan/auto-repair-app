import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("./WorkshopReviewReadReceipt.tsx");
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), reviewType = "customer_review_submitted";
const card = (n: number) => ({ reviewId: id(n + 10), requestId: id(n + 20), offerId: id(n + 30), children: "Rendered review" });
const note = (n: number, extra: Record<string, unknown> = {}) => ({ id: id(n + 40), type: reviewType,
  recipient_id: owner, recipient_role: "workshop", request_id: card(n).requestId,
  offer_id: card(n).offerId, appointment_id: null, read_at: null as string | null, ...extra });
type Row = ReturnType<typeof note>;
type Node = { type: unknown; key?: string; props: Record<string, unknown> };
type Scope = { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: void | (() => void) }> };
type Card = ReturnType<typeof card>;

// Execute the actual boundary, visibility hook and persistent-receipt helper.
// Only React/browser lifecycle and the Supabase transport are simulated.
function fixture() {
  const rows: Row[] = [note(1), note(2)];
  const state = { user: owner as string | null, workshopId: owner, loading: false,
    roles: ["workshop"], profileId: owner, profileError: false, snapshotError: false,
    writeError: false, readbackError: false, noWrite: false, visibility: "visible",
    beforeWrite: undefined as (() => void) | undefined,
    profileWait: undefined as Promise<void> | undefined };
  const calls: { action: string; filters: [string, unknown][] }[] = [];
  const events: string[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const authListeners = new Set<(event: string, session: unknown) => void>();
  const observers: Observer[] = [];
  const context = { current: null as unknown, Provider: Symbol("Provider") };
  let profileReads = 0, scope: Scope, cursor = 0;
  const pendingEffects: (() => void)[] = [];
  let root: { key: string; scope: Scope } | undefined;
  const mounted = new Map<string, { scope: Scope; node?: Node; ref?: unknown; cleanup?: void | (() => void); element: HTMLElement }>();
  let cards: Card[] = [card(1), card(2)];
  const createScope = (): Scope => ({ values: [], effects: new Map() });
  const dispose = (s: Scope) => s.effects.forEach(effect => effect.cleanup?.());
  const equal = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const n = cursor++, previous = scope.values[n] as { deps: unknown[]; value: unknown } | undefined;
    if (!previous || !equal(previous.deps, deps)) scope.values[n] = { deps, value: fn() };
    return (scope.values[n] as { value: unknown }).value;
  };
  const react = {
    createContext: () => context, useContext: () => context.current,
    useMemo: memo, useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
    useRef: (initial: unknown) => scope.values[cursor++] ??= { current: initial },
    useState: (initial: unknown) => {
      const s = scope, n = cursor++; if (!(n in s.values)) s.values[n] = initial;
      return [s.values[n], (v: unknown) => { s.values[n] = v; }];
    },
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
      const s = scope, n = cursor++, previous = s.effects.get(n);
      if (!previous || !equal(previous.deps, deps)) pendingEffects.push(() => {
        previous?.cleanup?.(); s.effects.set(n, { deps, cleanup: fn() });
      });
    },
  };
  class Observer {
    disconnected = false;
    element?: HTMLElement;
    callback: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void;
    constructor(callback: Observer["callback"]) { this.callback = callback; observers.push(this); }
    observe(element: HTMLElement) { this.element = element; }
    disconnect() { this.disconnected = true; }
    show() { if (!this.disconnected) this.callback([{ isIntersecting: true, intersectionRatio: 1 }]); }
  }
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: state.user ? { id: state.user } : null }, error: null }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.add(fn); return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } };
      },
    },
    from: (table: string) => {
      assert.equal(table, "notifications", "no review/offer/job write or refetch");
      let action = "select", patch: { read_at?: string } = {};
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        update: (value: typeof patch) => { action = "update"; patch = value; assert.deepEqual(Object.keys(value), ["read_at"]); return query; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        in: (key: string, value: unknown[]) => { filters.push([key, value]); return query; },
        then: (done: (v: unknown) => void) => {
          calls.push({ action, filters });
          if (action === "update") state.beforeWrite?.();
          const selected = rows.filter(row => filters.every(([k, v]) => Array.isArray(v) ? v.includes(row[k as keyof Row]) : row[k as keyof Row] === v));
          const readback = filters.some(([k]) => k === "id");
          const error = action === "update" ? state.writeError : readback ? state.readbackError : state.snapshotError;
          if (!error && action === "update" && !state.noWrite) selected.forEach(row => Object.assign(row, patch));
          done({ data: error ? null : selected.map(row => ({ ...row })), error: error ? { code: "42501" } : null });
        },
      };
      return query;
    },
  };
  const modules: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx: (type: unknown, props: Node["props"], key?: string) => ({ type, props, key }), Fragment: Symbol("Fragment") },
    "@/lib/supabase/client": { supabase },
    "@/lib/auth-provider": { useAuth: () => ({ user: state.user ? { id: state.user } : null, loading: state.loading }) },
    "@/lib/supabase/profiles": { getOwnProfile: async () => {
      profileReads++; await state.profileWait;
      return { data: { id: state.profileId, role: state.roles }, error: state.profileError ? {} : null };
    } },
    "@/lib/notifications": { CUSTOMER_REVIEW_SUBMITTED_NOTIFICATION_TYPE: reviewType },
    "@/lib/offer-read-version": { offerReadVersion: () => { throw new Error("review must not acknowledge offers"); } },
  };
  const load = (text: string) => {
    const exports: Record<string, unknown> = {};
    new Function("require", "exports", "document", "window", "globalThis", "IntersectionObserver", compile(text))(
      (name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports,
      { get visibilityState() { return state.visibility; },
        addEventListener: (name: string, fn: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
        removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn) },
      { location: { search: "" }, dispatchEvent: (e: Event) => events.push(e.type) }, { IntersectionObserver: Observer }, Observer);
    return exports;
  };
  modules["@/lib/notification-read-receipts"] = load(read("../../../../lib/notification-read-receipts.ts"));
  modules["@/lib/hooks/useVisibleNotificationRead"] = load(read("../../../../lib/hooks/useVisibleNotificationRead.ts"));
  const api = load(source) as Record<string, (props: Record<string, unknown>) => Node>;
  const render = () => {
    const boundary = api.WorkshopReviewReadBoundary({ workshopId: state.workshopId, children: "reviews" });
    if (typeof boundary.type === "function") {
      if (!root || root.key !== boundary.key) { if (root) dispose(root.scope); root = { key: boundary.key!, scope: createScope() }; }
      scope = root.scope; cursor = 0;
      context.current = boundary.type(boundary.props).props.value;
    } else { if (root) dispose(root.scope); root = undefined; context.current = null; }
    for (const review of cards) {
      if (!mounted.has(review.reviewId)) mounted.set(review.reviewId, { scope: createScope(), element: { isConnected: true } as HTMLElement });
      const m = mounted.get(review.reviewId)!;
      scope = m.scope; cursor = 0;
      m.node = api.WorkshopReviewReadCard(review);
      if (m.node.props.ref !== m.ref) {
        m.cleanup?.(); m.ref = m.node.props.ref;
        m.cleanup = typeof m.ref === "function" ? m.ref(m.element) : undefined;
      }
    }
    pendingEffects.splice(0).forEach(fn => fn());
  };
  const settle = async () => { for (let n = 0; n < 3; n++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  const unmount = () => { if (root) dispose(root.scope); root = undefined; mounted.forEach(m => { m.cleanup?.(); dispose(m.scope); }); };
  return { rows, calls, state, events, observers, render, settle, unmount,
    profileReads: () => profileReads, writes: () => calls.filter(c => c.action === "update"),
    count: () => rows.filter(r => r.recipient_id === owner && r.recipient_role === "workshop" && r.type === reviewType && r.read_at === null).length,
    show: (n: number) => { const element = mounted.get(card(n).reviewId)!.element; observers.filter(o => o.element === element).forEach(o => o.show()); },
    foreground: () => listeners.get("visibilitychange")?.forEach(fn => fn()),
    auth: (user: string | null) => { state.user = user; authListeners.forEach(fn => fn("SIGNED_IN", user ? { user: { id: user } } : null)); render(); },
    cards: (value: Card[]) => { cards = value; },
  };
}

test("two actual visible reviews persistently consume exactly 2 → 1 → 0; loading/click alone does not", async () => {
  const f = fixture(); f.render(); await f.settle();
  assert.equal(f.count(), 2); assert.equal(f.writes().length, 0); assert.equal(f.profileReads(), 1);
  f.show(1); await f.settle(); assert.equal(f.count(), 1); assert.equal(f.rows[1].read_at, null);
  f.show(2); await f.settle(); assert.equal(f.count(), 0);
  assert.deepEqual(f.events, ["notifications-read-updated", "notifications-read-updated"]);
  assert.deepEqual(f.writes().map(c => c.filters.find(([k]) => k === "id")![1]), [[note(1).id], [note(2).id]]);
});

for (const viewer of ["anonymous", "other-workshop", "loading", "customer-only", "wrong-profile", "profile-error"] as const) {
  test(`${viewer}: public reviews do not acknowledge Service notifications`, async () => {
    const f = fixture();
    if (viewer === "anonymous") f.state.user = null;
    if (viewer === "other-workshop") f.state.user = id(90);
    if (viewer === "loading") f.state.loading = true;
    if (viewer === "customer-only") f.state.roles = ["customer"];
    if (viewer === "wrong-profile") f.state.profileId = id(90);
    if (viewer === "profile-error") f.state.profileError = true;
    f.render(); await f.settle(); f.show(1); await f.settle();
    assert.equal(f.writes().length, 0); assert.equal(f.count(), 2);
  });
}

test("only review events for the displayed exact request/offer and workshop role are consumed", async () => {
  const f = fixture(); f.state.roles = ["customer", "workshop"];
  f.rows.push(note(3, { request_id: card(1).requestId, offer_id: id(99) }),
    note(4, { request_id: card(1).requestId, offer_id: card(1).offerId, type: "customer_confirmed_appointment" }),
    note(5, { request_id: card(1).requestId, offer_id: card(1).offerId, recipient_role: "customer" }));
  f.render(); await f.settle(); f.show(1); await f.settle();
  assert.ok(f.rows[0].read_at); assert.ok(f.rows.slice(1).every(r => r.read_at === null));
  assert.ok(f.writes()[0].filters.some(([k, v]) => k === "recipient_role" && v === "workshop"));
  assert.ok(f.writes()[0].filters.some(([k, v]) => k === "recipient_id" && v === owner));
});

test("a new event arriving while a review is viewed is outside the captured batch", async () => {
  const f = fixture(); f.render(); await f.settle();
  f.state.beforeWrite = () => { f.rows.push(note(3, { request_id: card(1).requestId, offer_id: card(1).offerId })); };
  f.show(1); await f.settle(); f.show(1); await f.settle();
  assert.equal(f.rows.at(-1)!.read_at, null); assert.equal(f.writes().length, 1);
});

test("background page does not acknowledge until the review becomes visible in foreground", async () => {
  const f = fixture(); f.state.visibility = "hidden"; f.render(); await f.settle();
  f.show(1); await f.settle(); assert.equal(f.writes().length, 0);
  f.state.visibility = "visible"; f.foreground(); await f.settle(); assert.equal(f.writes().length, 1);
});

for (const fault of ["snapshotError", "writeError", "readbackError", "noWrite"] as const) {
  test(`${fault}: no false badge-success event`, async () => {
    const f = fixture(); f.state[fault] = true; f.render(); await f.settle(); f.show(1); await f.settle();
    assert.deepEqual(f.events, []);
    if (fault !== "readbackError") assert.equal(f.count(), 2);
  });
}

test("gallery rerenders and duplicate visibility callbacks retain the same receipt", async () => {
  const f = fixture(); f.render(); await f.settle(); const count = f.observers.length;
  f.render(); f.render(); assert.equal(f.observers.length, count);
  f.show(1); f.show(1); await f.settle(); assert.equal(f.writes().length, 1);
});

for (const action of ["logout", "account", "unmount"] as const) {
  test(`${action}: obsolete visibility callbacks cannot acknowledge`, async () => {
    const f = fixture(); f.render(); await f.settle();
    if (action === "unmount") f.unmount(); else f.auth(action === "logout" ? null : id(90));
    f.show(1); assert.equal(f.writes().length, 0);
  });
}

test("late profile result after unmount cannot start a notification capture", async () => {
  const f = fixture(); let finish!: () => void;
  f.state.profileWait = new Promise<void>(resolve => { finish = resolve; });
  f.render(); f.unmount(); finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 0);
});

test("already read on another device / refresh stays read; zero changed rows is confirmed by readback", async () => {
  const f = fixture(); f.render(); await f.settle();
  f.rows[0].read_at = "2026-11-08T12:00:00Z"; f.show(1); await f.settle();
  assert.equal(f.count(), 1); assert.deepEqual(f.events, ["notifications-read-updated"]);
  f.unmount();
  const next = fixture(); next.rows.splice(0, next.rows.length, ...f.rows);
  next.render(); await next.settle(); next.show(1); await next.settle();
  assert.equal(next.writes().length, 0); assert.equal(next.count(), 1);
});

test("public page binds exact rendered review relationships and retains images; navbar only recalculates", () => {
  const page = read("./page.tsx"), nav = read("../../../components/AppNavbar.tsx");
  assert.match(page, /request_id, offer_id, images/);
  assert.match(page, /WorkshopReviewReadBoundary workshopId=\{workshop.id\}/);
  for (const prop of ["reviewId={review.id}", "requestId={review.request_id}", "offerId={review.offer_id}"]) assert.ok(page.includes(prop));
  assert.ok(page.includes("<ReviewImagesGallery images={review.images}"));
  assert.match(nav, /handleNotificationsReadUpdated = \(\) => \{\s*notificationsScheduler.schedule\(\)/);
  assert.doesNotMatch(source, /\.update\(|\.rpc\(|\.channel\(|markNotificationsAsRead|set\w+UnreadCount/);
});
