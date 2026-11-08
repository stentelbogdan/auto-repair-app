import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const page = readFileSync(new URL("../../app/workshops/dashboard/page.tsx", import.meta.url), "utf8");
const owner = "20000000-0000-4000-8000-000000000001";
const requestId = (i: number) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
type Reply = { data: unknown; error: unknown };
function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}
function moduleAt(path: string, requireMock: (name: string) => unknown) {
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compile(readFileSync(new URL(path, import.meta.url), "utf8")))(requireMock, exports);
  return exports;
}
function detail(id: string, status: string, category: string) {
  return { id, status, service_type: category, car_brand: "Test", car_model: "Model", car_year: "2025", city: "City",
    license_plate: null, damage_type: null, description: null, request_type: "repair", target_workshop_id: null,
    accepted_offer_id: null, towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null,
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null, route_distance_meters: null,
    route_duration_seconds: null, service_details: null, route_paths: null, images: [], created_at: "2026-11-07T00:00:00Z" };
}
function fixture(statuses = ["in_progress", "in_progress", "in_progress", "completed"], category = "bodywork") {
  const rows = new Map(statuses.map((status, i) => [requestId(i), detail(requestId(i), status, category)]));
  const replies: Record<string, Reply> = {
    repair_offers: { data: [...rows.keys()].map(request_id => ({ request_id })), error: null },
    repair_appointments: { data: [...rows.keys()].map(request_id => ({ request_id, status: "confirmed" })), error: null },
  };
  const filters: unknown[][] = [], calls: string[] = [];
  let rpcOverride: Reply | undefined;
  const supabase = {
    from(table: string) {
      assert.ok(Object.hasOwn(replies, table), `Unauthorized source: ${table}`);
      const query = { select(projection: string) { assert.ok(!projection.includes("repair_requests")); return query; },
        eq(key: string, value: unknown) { filters.push([table, key, value]); return query; },
        in(key: string, value: unknown) { filters.push([table, key, value]); return query; },
        order: () => query,
        then: (resolve: (value: Reply) => unknown) => Promise.resolve(replies[table]).then(resolve) };
      return query;
    },
    async rpc(name: string, args: { p_request_id: string }) {
      assert.equal(name, "get_workshop_repair_request_detail"); calls.push(args.p_request_id);
      return rpcOverride ?? { data: [{ request_data: rows.get(args.p_request_id) }], error: null };
    },
  };
  const reader = moduleAt("./workshop-request-detail.ts", () => ({ supabase }));
  const batch = moduleAt("./workshop-offer-requests.ts", () => reader);
  const helper = moduleAt("./workshop-active-jobs.ts", name => name === "./client" ? { supabase } : batch);
  return { count: () => (helper.fetchWorkshopActiveJobsCount as (id: string) => Promise<number>)(owner),
    rows, replies, calls, filters, rpcReply: (reply: Reply) => { rpcOverride = reply; } };
}

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  test(`${category}: three in progress plus one completed returns 3 through authorized RPC`, async () => {
    const f = fixture(undefined, category); assert.equal(await f.count(), 3);
    assert.ok(f.filters.some(row => row[0] === "repair_offers" && row[1] === "workshop_user_id" && row[2] === owner));
    assert.ok(f.filters.some(row => row[0] === "repair_offers" && row[1] === "status" && row[2] === "accepted"));
    assert.ok(f.filters.some(row => row[0] === "repair_appointments" && row[1] === "workshop_id" && row[2] === owner));
  });
}
test("scheduled confirmed + in progress; completed and closed never count", async () => {
  const f = fixture(["matched", "in_progress", "completed", "closed"]); assert.equal(await f.count(), 2);
});
test("latest appointment controls scheduled tab; pending/declined/missing do not count", async () => {
  for (const status of ["workshop_proposed", "customer_proposed", "declined", "cancelled"]) {
    const f = fixture(["matched"]);
    f.replies.repair_appointments.data = [{ request_id: requestId(0), status }, { request_id: requestId(0), status: "confirmed" }];
    assert.equal(await f.count(), 0);
    f.replies.repair_appointments.data = []; assert.equal(await f.count(), 0);
  }
});
test("status refresh is recalculated, including completed back to in progress", async () => {
  const f = fixture(["matched"]); assert.equal(await f.count(), 1);
  const row = f.rows.get(requestId(0))!;
  row.status = "in_progress"; assert.equal(await f.count(), 1);
  row.status = "completed"; assert.equal(await f.count(), 0);
  row.status = "in_progress"; assert.equal(await f.count(), 1);
});
test("empty offers returns real zero without any context read", async () => {
  const f = fixture([]); assert.equal(await f.count(), 0); assert.deepEqual(f.calls, []);
});
test("same request cannot inflate the active works count", async () => {
  const f = fixture(["in_progress"]);
  f.replies.repair_offers.data = [{ request_id: requestId(0) }, { request_id: requestId(0) }];
  assert.equal(await f.count(), 1); assert.deepEqual(f.calls, [requestId(0)]);
});
for (const table of ["repair_offers", "repair_appointments"]) {
  test(`${table}: permission error is not zero`, async () => {
    const f = fixture(); f.replies[table] = { data: null, error: { code: "42501" } };
    await assert.rejects(f.count());
  });
  test(`${table}: malformed result is not zero`, async () => {
    const f = fixture(); f.replies[table] = { data: null, error: null };
    await assert.rejects(f.count());
  });
}
for (const [name, reply] of Object.entries({ absent: { data: [], error: null }, denied: { data: null, error: { code: "42501" } },
  invalid: { data: [{ request_data: { id: requestId(9) } }], error: null } })) {
  test(`${name} request context fails the count without fallback`, async () => {
    const f = fixture(); f.rpcReply(reply); await assert.rejects(f.count(), /UNAVAILABLE/);
  });
}

const loadSource = page.slice(page.indexOf("  const loadStats ="), page.indexOf("  useEffect", page.indexOf("  const loadStats =")));
function dashboardFixture(count: () => Promise<number> = async () => 3) {
  const state = { stats: null as Record<string, number> | null, error: false };
  const statsLoadVersion = { current: 0 };
  let countReply = { count: 2 as number | null, error: null as unknown };
  const query = { select: () => query, eq: () => query, is: () => query,
    then: (resolve: (value: typeof countReply) => unknown) => Promise.resolve(countReply).then(resolve) };
  const dependencies = { useCallback: (fn: unknown) => fn, statsLoadVersion, supabase: { from: () => query },
    fetchWorkshopDiscoveryCounts: async () => ({ bodywork: 4, mechanical: 3, wheels: 2, towing: 1 }),
    fetchWorkshopActiveJobsCount: count,
    setStats: (stats: typeof state.stats) => { state.stats = stats; }, setStatsError: (value: boolean) => { state.error = value; } };
  const load = new Function(...Object.keys(dependencies), compile(loadSource) + "\nreturn loadStats;")(...Object.values(dependencies)) as (id: string) => Promise<void>;
  return { state, load: () => load(owner), version: statsLoadVersion, reply: (value: typeof countReply) => { countReply = value; } };
}
test("other counters retain pending offer and direct unread semantics independently of discovery", async () => {
  const f = dashboardFixture(); await f.load();
  assert.deepEqual(f.state.stats, { myOffers: 2, wonJobs: 3, directBodyworkUnread: 2, directMechanicalUnread: 2 });
});
for (const reply of [{ count: 0, error: { code: "42501" } }, { count: null, error: null }]) {
  test(`failed/missing count ${JSON.stringify(reply)} clears stale badges and shows error`, async () => {
    const f = dashboardFixture(); await f.load(); f.reply(reply); await f.load();
    assert.equal(f.state.stats, null); assert.equal(f.state.error, true);
    f.reply({ count: 0, error: null }); await f.load(); assert.equal(f.state.error, false); assert.equal(f.state.stats!.myOffers, 0);
  });
}
test("late previous refresh cannot replace the newest count", async () => {
  let resolve!: (count: number) => void, started!: () => void, calls = 0;
  const waiting = new Promise<void>(done => { started = done; });
  const f = dashboardFixture(() => ++calls === 1 ? new Promise(done => { resolve = done; started(); }) : Promise.resolve(2));
  const first = f.load(); await waiting; await f.load(); resolve(9); await first;
  assert.equal(f.state.stats!.wonJobs, 2);
});
test("session change or unmount invalidates pending counts", async () => {
  let resolve!: (count: number) => void, started!: () => void;
  const waiting = new Promise<void>(done => { started = done; });
  const f = dashboardFixture(() => new Promise(done => { resolve = done; started(); }));
  const pending = f.load(); await waiting; f.version.current += 1; resolve(3); await pending;
  assert.equal(f.state.stats, null); assert.equal(f.state.error, false);
});

test("Service numeric badges hide zero/unknown and keep existing positive styling", () => {
  const source = page.slice(page.indexOf("function DashboardCard("));
  const card = new Function("require", "exports", compile(source) + "\nreturn DashboardCard;")(require, {});
  const render = (value?: number, badge?: number) => renderToStaticMarkup(card({ icon: "🚗", title: "Test", description: "Test", value, badge }));
  for (const value of [0, undefined]) {
    assert.doesNotMatch(render(value, 0), /absolute right-4|bg-red-500/);
  }
  assert.match(render(3, 2), /bg-black[^>]*>3<\/div>/);
  assert.match(render(3, 2), /bg-red-500[^>]*>2<\/div>/);
});

test("Realtime/focus/reconnect refresh only the dashboard and unsubscribe on exit", async () => {
  const start = page.indexOf("  useEffect(() => {\n    if (!authorized");
  const source = page.slice(start, page.indexOf("  if (checkingAccess)", start));
  const handlers = new Map<string, () => Promise<void>>(), windowEvents = new Map<string, () => void>(), documentEvents = new Map<string, () => void>();
  let onSubscribe!: (status: string) => void, onAuth!: (event: string, session: { user: { id: string } } | null) => void;
  let cleanup!: () => void, loads = 0, removed = false, unsubscribed = false;
  let discoveryLoads = 0, disposed = false;
  let discoveryConnections = 0, signalRemovals = 0;
  let finishRemoval: (() => void) | undefined;
  let delayedRemoval = false;
  let broadcast!: (event: { payload: unknown }) => void, broadcastStatus!: (status: string) => void;
  const discoveryChannel = { state: "joined", on(_event: string, filter: { event: string }, handler: typeof broadcast) {
    assert.equal(filter.event, "invalidate"); broadcast = handler; return discoveryChannel;
  }, subscribe(handler: typeof broadcastStatus) { broadcastStatus = handler; return discoveryChannel; } };
  const version = { current: 0 };
  const channel = { on(_event: string, filter: { table: string }, handler: () => Promise<void>) { handlers.set(filter.table, handler); return channel; },
    subscribe(handler: typeof onSubscribe) { onSubscribe = handler; return channel; } };
  const dependencies = { useEffect: (fn: () => () => void) => { cleanup = fn(); }, authorized: true, currentWorkshopUserId: owner,
    loadStats: async (id: string) => { assert.equal(id, owner); loads += 1; }, statsLoadVersion: version,
    setStats: () => {}, setAuthorized: () => {}, router: { replace: () => {} },
    fetchWorkshopDiscoveryCounts: () => {}, setDiscoveryCounts: () => {}, setDiscoveryError: () => {}, setDiscoveryLiveError: () => {},
    discoveryRemoval: { current: Promise.resolve(true) },
    WORKSHOP_DISCOVERY_TOPIC: "workshop:discovery:v1", isWorkshopDiscoveryInvalidation: (p: { v: number }) => p?.v === 1,
    createWorkshopDiscoveryRefresh: () => ({ invalidate: () => { discoveryLoads += 1; }, dispose: () => { disposed = true; } }),
    supabase: { channel: (name: string, config: unknown) => {
      if (name === "workshop:discovery:v1") {
        discoveryConnections += 1; discoveryChannel.state = "joined";
        assert.deepEqual(config, { config: { private: true } }); return discoveryChannel;
      }
      return channel;
    }, removeChannel: async (c: unknown) => {
      removed = true;
      if (c === discoveryChannel) {
        signalRemovals += 1;
        if (delayedRemoval) await new Promise<void>(done => { finishRemoval = done; });
      }
      return "ok";
    }, auth: { onAuthStateChange: (fn: typeof onAuth) => {
      onAuth = fn; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
    } } },
    window: { addEventListener: (name: string, fn: () => void) => windowEvents.set(name, fn), removeEventListener: (name: string) => windowEvents.delete(name) },
    document: { visibilityState: "visible", addEventListener: (name: string, fn: () => void) => documentEvents.set(name, fn),
      removeEventListener: (name: string) => documentEvents.delete(name) } };
  new Function(...Object.keys(dependencies), compile(source))(...Object.values(dependencies));
  await new Promise<void>(done => setImmediate(done));
  assert.deepEqual([...handlers.keys()], ["repair_requests", "repair_offers", "repair_appointments", "work_progress_updates"]);
  for (const handler of handlers.values()) await handler();
  onSubscribe("SUBSCRIBED"); windowEvents.get("focus")!(); documentEvents.get("visibilitychange")!();
  assert.equal(loads, 7);
  const before = discoveryLoads;
  broadcast({ payload: { v: 1 } }); broadcastStatus("SUBSCRIBED");
  assert.equal(discoveryLoads, before + 2); assert.equal(loads, 7, "private signal only reloads discovery RPC");
  const oldBroadcast = broadcast;
  delayedRemoval = true; discoveryChannel.state = "closed";
  windowEvents.get("focus")!(); windowEvents.get("focus")!(); documentEvents.get("visibilitychange")!();
  assert.equal(signalRemovals, 1); assert.equal(discoveryConnections, 1, "no duplicate join before removal completes");
  finishRemoval!(); await new Promise<void>(done => setImmediate(done));
  assert.equal(discoveryConnections, 2);
  const reconnected = discoveryLoads; oldBroadcast({ payload: { v: 1 } });
  assert.equal(discoveryLoads, reconnected, "old connection events ignored after reconnect");
  delayedRemoval = false;
  const beforeLogout = loads;
  onAuth("SIGNED_OUT", null); await handlers.get("repair_offers")!(); assert.equal(loads, beforeLogout);
  assert.equal(disposed, true);
  const stopped = discoveryLoads; broadcast({ payload: { v: 1 } }); broadcastStatus("SUBSCRIBED");
  assert.equal(discoveryLoads, stopped);
  cleanup(); assert.equal(removed, true); assert.equal(unsubscribed, true);
  assert.equal(windowEvents.size, 0); assert.equal(documentEvents.size, 0); assert.ok(version.current > 0);
});
