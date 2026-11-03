import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Reply = { data: unknown; error: unknown };
type Batch = typeof import("./workshop-offer-requests").loadWorkshopOfferRequests;
const owner = "20000000-0000-4000-8000-000000000001";
const requestId = (i = 1) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const offerId = (i = 1) => `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function detail(id = requestId(), category = "bodywork") {
  return { id, car_brand: "Synthetic", car_model: "Model", car_year: "2020", city: "City",
    license_plate: "TEST", damage_type: null, service_type: category, service_details: [],
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null,
    route_distance_meters: null, route_duration_seconds: null, route_paths: null,
    towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null,
    description: "Synthetic description", images: [{ url: "https://example.invalid/photo", thumbUrl: "https://example.invalid/thumb" }],
    status: "open", request_type: "repair", target_workshop_id: null, accepted_offer_id: null,
    created_at: "2026-11-01T10:00:00Z" };
}
function offer(i = 1, extra: Record<string, unknown> = {}) {
  return { id: offerId(i), request_id: requestId(i), workshop_user_id: owner, workshop_name: "Service",
    price: "150", days: "2 zile", message: "Synthetic message", status: "pending", created_at: "2026-11-01T10:00:00Z",
    read_state_version: "9007199254740993", available_date: "2099-11-02", available_time: "10:00", repair_appointments: [], ...extra };
}
function compile(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}
function moduleAt(path: string, requireMock: (name: string) => unknown) {
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compile(path))(requireMock, exports);
  return exports;
}
function fixture(read: (id: string) => Promise<Reply> = async id => ({ data: [{ request_data: detail(id) }], error: null })) {
  const calls: string[] = [];
  const reader = moduleAt("./workshop-request-detail.ts", name => {
    assert.equal(name, "@/lib/supabase/client");
    return { supabase: { rpc: async (name: string, args: { p_request_id: string }) => {
      assert.equal(name, "get_workshop_repair_request_detail"); calls.push(args.p_request_id); return read(args.p_request_id);
    } } };
  });
  const batchModule = moduleAt("./workshop-offer-requests.ts", name => {
    assert.equal(name, "./workshop-request-detail"); return reader;
  });
  return { batch: batchModule.loadWorkshopOfferRequests as Batch, batchModule, calls };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("batch deduplicates request IDs and preserves real detail fields", async () => {
  const f = fixture(); const data = await f.batch([requestId(), requestId(), ""]);
  assert.deepEqual(f.calls, [requestId()]); assert.deepEqual(data.get(requestId()), detail());
});
test("absent, denied, invalid and transport errors are isolated per request", async () => {
  const replies: Reply[] = [{ data: [], error: null }, { data: null, error: { code: "42501" } },
    { data: [{ request_data: detail(requestId(99)) }], error: null }];
  const f = fixture(async id => {
    const index = Number(id.slice(-2));
    if (index === 4) throw new Error("offline error");
    return replies[index - 1] ?? { data: [{ request_data: detail(id) }], error: null };
  });
  const data = await f.batch([1, 2, 3, 4, 5].map(requestId));
  for (const i of [1, 2, 3, 4]) assert.equal(data.get(requestId(i)), null);
  assert.deepEqual(data.get(requestId(5)), detail(requestId(5))); assert.equal(f.calls.length, 5);
});
test("at most four RPCs run at once; completion order cannot mix IDs", async () => {
  const waits = new Map<string, ReturnType<typeof deferred<Reply>>>();
  const f = fixture(id => { const d = deferred<Reply>(); waits.set(id, d); return d.promise; });
  const pending = f.batch([1, 2, 3, 4, 5, 6].map(requestId));
  assert.equal(waits.size, 4);
  for (const i of [4, 2, 5, 1, 6, 3]) {
    waits.get(requestId(i))!.resolve({ data: [{ request_data: detail(requestId(i)) }], error: null }); await settle();
  }
  const data = await pending;
  for (let i = 1; i <= 6; i++) assert.equal(data.get(requestId(i))?.id, requestId(i));
});
test("new refresh rechecks authorization; no persistent positive or negative cache", async () => {
  let allowed = true;
  const f = fixture(async id => ({ data: allowed ? [{ request_data: detail(id) }] : [], error: null }));
  assert.ok((await f.batch([requestId()])).get(requestId())); allowed = false;
  assert.equal((await f.batch([requestId()])).get(requestId()), null); assert.equal(f.calls.length, 2);
});
test("cancelled batch starts no additional requests", async () => {
  let cancelled = false; const d = deferred<Reply>(); const f = fixture(() => d.promise);
  const pending = f.batch([1, 2, 3, 4, 5, 6].map(requestId), () => cancelled);
  cancelled = true; d.resolve({ data: [], error: null }); await pending;
  assert.equal(f.calls.length, 4);
});

type Element = { type: unknown; props: Record<string, unknown> };
function nodes(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const n = tree as Element; return [n, ...nodes(n.props.children)];
}
function find(tree: unknown, type: string) {
  const node = nodes(tree).find(n => n.type === type); assert.ok(node, `Missing ${type}`); return node;
}
function call(node: Element, prop: string, ...args: unknown[]) {
  return (node.props[prop] as (...args: unknown[]) => unknown)(...args);
}
function text(tree: unknown): string {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree && typeof tree === "object" && "props" in tree) return text((tree as Element).props.children);
  return "";
}
type PageOptions = {
  offers?: ReturnType<typeof offer>[]; focus?: ReturnType<typeof offer>;
  read?: (id: string) => Promise<Reply>; offersRead?: () => Promise<Reply>;
  user?: boolean; workshop?: boolean; versionMissing?: boolean;
};
function pageFixture(options: PageOptions = {}) {
  const f = fixture(options.read);
  const state: unknown[] = [], effects: (() => unknown)[] = [], navigation: string[] = [], notifications: unknown[] = [];
  const selects: string[] = [], filters: [string, unknown][] = [], events: (() => void)[] = [], names: string[][] = [];
  let cursor = 0, offerReads = 0, removed = 0;
  const query = { select: (s: string) => { assert.ok(!/repair_requests\s*\(/.test(s)); selects.push(s); return query; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
    order: () => ({ overrideTypes: async () => { offerReads++; if (options.versionMissing && selects.at(-1)?.includes("read_state_version")) return { data: null, error: { code: "42703", message: "read_state_version absent" } }; return options.offersRead ? options.offersRead() : { data: options.offers ?? [offer(1, options.versionMissing ? { read_state_version: undefined } : {})], error: null }; } }),
    maybeSingle: () => ({ overrideTypes: async () => ({ data: options.focus ?? null, error: null }) }) };
  const channel = { on: (_kind: string, _filter: unknown, callback: () => void) => { events.push(callback); return channel; },
    subscribe: () => channel };
  const router = { push: (url: string) => navigation.push(url), replace: (url: string) => navigation.push(url) };
  const serviceTypes = moduleAt("../repair-requests/service-types.ts", () => { throw new Error("Unexpected dependency"); });
  const requireMock = (name: string): unknown => {
    if (name === "@/lib/offer-read-version") return moduleAt("../offer-read-version.ts", () => { throw new Error("Unexpected dependency"); });
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Element["props"]) => ({ type, props }), jsxs: (type: unknown, props: Element["props"]) => ({ type, props }) };
    if (name === "react") return { useState: (initial: unknown) => { const i = cursor++; if (!(i in state)) state[i] = initial;
      return [state[i], (v: unknown) => { state[i] = v; }]; }, useEffect: (fn: () => unknown) => effects.push(fn), useMemo: (fn: () => unknown) => fn() };
    if (name === "next/navigation") return { useRouter: () => router };
    if (name === "@/lib/supabase/client") return { supabase: {
      auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: owner } }, error: null }) },
      from: (table: string) => { assert.equal(table, "repair_offers", "No direct request SELECT or write"); return query; },
      channel: () => channel, removeChannel: async () => { removed++; },
    } };
    if (name === "@/lib/supabase/profiles") return { getOwnProfile: async () => ({ data: { role: options.workshop === false ? ["customer"] : ["workshop"] }, error: null }) };
    if (name === "@/lib/supabase/workshop-offer-requests") return f.batchModule;
    if (name === "@/lib/supabase/repair-offers") return { finalizeWorkshopCustomerProposal: () => { throw new Error("No finalization in read tests"); } };
    if (name === "@/lib/supabase/workshop-client-names") return { getWorkshopRequestClientNames: async (ids: string[]) => { names.push(ids); return new Map(ids.map(id => [id, "Client sintetic"])); } };
    if (name === "@/lib/supabase/repair-request-metrics") return { getWorkshopRequestMetrics: async (ids: string[]) => new Map(ids.map(id => [id, { viewCount: 3, offerCount: 2 }])) };
    if (name === "@/lib/repair-requests/service-types") return serviceTypes;
    if (name === "@/lib/hooks/useNotificationFocus") return { useNotificationFocus: () => {} };
    if (name === "@/lib/hooks/useVisibleNotificationRead") return { useVisibleNotificationRead: () => ({ capture: async () => {}, complete: () => {}, observe: () => () => {} }) };
    if (name === "@/lib/notifications") return { markNotificationsAsRead: async (arg: unknown) => notifications.push(arg), WORKSHOP_OFFER_REJECTED_NOTIFICATION_TYPE: "rejected", WORKSHOP_REQUEST_CLOSED_NOTIFICATION_TYPE: "closed" };
    if (name === "@/lib/car-damage") return { getAffectedPartLabels: () => [], getDamageTypeLabels: () => [] };
    if (name === "@/lib/displayLabels") return { getDamageTypeLabel: () => "", getRequestTypeBadgeLabel: (v: string) => v };
    if (name === "@/lib/mechanical/mechanical-service-details") return { getMechanicalServiceDetailGroups: () => [] };
    if (name === "@/lib/wheels/wheels-display") return { getWheelsDisplaySummary: () => ({ synthetic: true }) };
    if (name === "@/lib/towing/towing-display") return { getTowingDisplaySummary: () => ({ synthetic: true }) };
    if (name.startsWith("@/app/components/")) return { default: name.split("/").at(-1) };
    throw new Error(`Unexpected offline import ${name}`);
  };
  const exports: { default?: () => unknown } = {};
  new Function("require", "exports", "window", "localStorage", "console", compile("../../app/workshops/my-offers/page.tsx"))(
    requireMock, exports, { location: { search: options.focus ? `?focusOffer=${options.focus.id}` : "" } }, { setItem: () => {} }, { error: () => {} },
  );
  function render() { cursor = 0; effects.length = 0; return exports.default!(); }
  let cleanup: () => void;
  async function mount() { render(); effects[0](); cleanup = effects[1]() as () => void; await settle(); return render(); }
  return { ...f, state, render, mount, navigation, notifications, selects, filters, names, events,
    cleanup: () => cleanup(), offerReads: () => offerReads, removed: () => removed };
}

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) test(`${category}: real details, own offer/appointment read, counts and routes restored`, async () => {
  const data = detail(requestId(), category);
  const f = pageFixture({ read: async () => ({ data: [{ request_data: data }], error: null }) }); const tree = await f.mount();
  const card = find(tree, "CarHeader");
  for (const [prop, value] of Object.entries({ brand: data.car_brand, model: data.car_model, year: data.car_year, plate: data.license_plate, city: data.city, images: data.images })) assert.deepEqual(card.props[prop], value);
  assert.deepEqual(find(tree, "RequestCategoryFilter").props.counts, { all: 1, bodywork: category === "bodywork" ? 1 : 0, mechanical: category === "mechanical" ? 1 : 0, wheels: category === "wheels" ? 1 : 0, towing: category === "towing" ? 1 : 0 });
  assert.equal(find(tree, "RepairRequestMetrics").props.viewCount, 3);
  assert.equal(find(tree, "RequestClientName").props.name, "Client sintetic");
  const actions = find(tree, "AppointmentActions"); call(actions, "onChat"); call(actions, "onChangeDate");
  assert.deepEqual(f.navigation, [`/chat/${requestId()}?offerId=${offerId()}`, `/customer/schedule-damage/${requestId()}?offerId=${offerId()}&from=workshop`]);
  assert.ok(f.selects.every(s => s.includes("repair_appointments (") && !s.includes("repair_requests")));
  assert.ok(f.filters.some(([k, v]) => k === "workshop_user_id" && v === owner));
  call(find(tree, "RequestCategoryFilter"), "onChange", category); assert.ok(find(f.render(), "CarHeader"));
  call(find(tree, "RequestCategoryFilter"), "onChange", category === "wheels" ? "towing" : "wheels");
  assert.ok(text(f.render()).includes("Nu ai oferte pentru această categorie"));
});
for (const failure of ["absent", "denied", "invalid", "transport"]) test(`${failure}: partial error retains own offer, hides invented details/actions and category`, async () => {
  const f = pageFixture({ offers: [offer(), offer(2)], read: async id => {
    if (id === requestId(2)) return { data: [{ request_data: detail(id, "wheels") }], error: null };
    if (failure === "transport") throw new Error("offline");
    return failure === "absent" ? { data: [], error: null } : failure === "denied" ? { data: null, error: { code: "42501" } }
      : { data: [{ request_data: detail(requestId(99)) }], error: null };
  } });
  const tree = await f.mount();
  assert.equal(nodes(tree).filter(n => n.type === "article").length, 2);
  assert.equal(nodes(tree).filter(n => n.type === "CarHeader").length, 1);
  assert.equal(nodes(tree).filter(n => n.type === "AppointmentActions").length, 1);
  assert.ok(text(tree).includes("Detaliile cererii nu sunt disponibile"));
  assert.deepEqual(find(tree, "RequestCategoryFilter").props.counts, { all: 2, bodywork: 0, mechanical: 0, wheels: 1, towing: 0 });
  assert.deepEqual(f.names, [[requestId(2)]]); assert.deepEqual(f.navigation, []);
});
test("rejected notification uses same reader, reuses list result and preserves own-offer filter", async () => {
  const f = pageFixture({ offers: [offer(1, { status: "rejected" })], focus: offer(1, { status: "rejected" }) });
  const tree = await f.mount(); assert.deepEqual(f.calls, [requestId()]); assert.ok(find(tree, "CarHeader"));
  assert.ok(f.filters.some(([k, v]) => k === "status" && v === "rejected"));
  assert.equal(f.notifications.length, 0, "loading a rejected offer does not acknowledge it before display"); assert.equal(nodes(tree).filter(n => n.type === "AppointmentActions").length, 0);
  assert.equal(find(tree, "OfferSummaryCard").props.statusText, "Ofertă refuzată");
});
test("focused offer missing from main list is hydrated by its real request ID", async () => {
  const f = pageFixture({ offers: [], focus: offer(2, { status: "rejected" }) }); const tree = await f.mount();
  assert.deepEqual(f.calls, [requestId(2)]); assert.ok(find(tree, "CarHeader"));
});
test("multiple own offers sharing a request cause one detail RPC and one metadata ID", async () => {
  const f = pageFixture({ offers: [offer(), offer(2, { request_id: requestId() })] });
  const tree = await f.mount(); assert.deepEqual(f.calls, [requestId()]);
  assert.deepEqual(f.names, [[requestId()]]);
  assert.equal(nodes(tree).filter(n => n.type === "CarHeader").length, 2);
});
test("inaccessible focused offer stays neutral without unsafe navigation", async () => {
  const f = pageFixture({ offers: [], focus: offer(2, { status: "rejected" }), read: async () => ({ data: [], error: null }) });
  const tree = await f.mount(); assert.ok(text(tree).includes("Detaliile cererii nu sunt disponibile"));
  assert.equal(nodes(tree).filter(n => ["CarHeader", "AppointmentActions"].includes(String(n.type))).length, 0);
});
test("existing pending/accepted/confirmed status filtering and proposed date display remain intact", async () => {
  const f = pageFixture({ offers: [offer(1, { status: "accepted" }), offer(2, { repair_appointments: [{ status: "confirmed" }] }),
    offer(3, { repair_appointments: [{ status: "customer_proposed", proposed_date: "2099-12-01", proposed_time: "12:00", handover_method: "workshop_pickup" }] })] });
  const tree = await f.mount(); assert.equal(nodes(tree).filter(n => n.type === "article").length, 1);
  const summary = find(tree, "OfferSummaryCard"); assert.equal(summary.props.appointmentDate, "2099-12-01");
  assert.equal(summary.props.appointmentTime, "12:00"); assert.equal(find(tree, "AppointmentActions").props.showConfirm, true);
});
test("burst refreshes serialize, coalesce and finish with latest request data", async () => {
  let count = 0; const wait = deferred<Reply>();
  const f = pageFixture({ read: async id => { count++; return count === 2 ? wait.promise : { data: [{ request_data: { ...detail(id), car_model: `v${count}` } }], error: null }; } });
  await f.mount(); f.events[0](); await settle(); f.events[1](); f.events[2](); await settle();
  assert.equal(count, 2); assert.equal(f.offerReads(), 2);
  wait.resolve({ data: [{ request_data: { ...detail(), car_model: "old" } }], error: null }); await settle();
  assert.equal(count, 3); assert.equal(f.offerReads(), 3); assert.equal(find(f.render(), "CarHeader").props.model, "v3");
  f.cleanup(); assert.equal(f.removed(), 1);
});
test("late response after unmount cannot change state or navigate", async () => {
  const wait = deferred<Reply>(); const f = pageFixture({ read: () => wait.promise }); await f.mount();
  f.cleanup(); const snapshot = [...f.state]; wait.resolve({ data: [{ request_data: detail() }], error: null }); await settle();
  assert.deepEqual(f.state, snapshot); assert.deepEqual(f.navigation, []); assert.equal(f.events.length, 0);
});
test("refresh query failure is handled; no unhandled rejection or invented empty success", async () => {
  let count = 0;
  const f = pageFixture({ offersRead: async () => ++count === 1 ? { data: [offer()], error: null } : { data: null, error: { code: "42501" } } });
  await f.mount(); f.events[0](); await settle(); assert.ok(text(f.render()).includes("Nu am putut încărca ofertele"));
});
test("refresh that loses request access removes previously visible details and actions", async () => {
  let allowed = true;
  const f = pageFixture({ read: async id => ({ data: allowed ? [{ request_data: detail(id) }] : [], error: null }) });
  await f.mount(); assert.ok(find(f.render(), "AppointmentActions"));
  allowed = false; f.events[0](); await settle(); const tree = f.render();
  assert.equal(nodes(tree).filter(n => ["CarHeader", "AppointmentActions"].includes(String(n.type))).length, 0);
  assert.ok(text(tree).includes("Detaliile cererii nu sunt disponibile"));
  assert.equal(find(tree, "OfferSummaryCard").props.price, "150");
});
for (const guard of ["user", "workshop"] as const) test(`${guard} authorization guard prevents all request reads`, async () => {
  const f = pageFixture({ [guard]: false }); await f.mount(); assert.deepEqual(f.calls, []);
  assert.equal(f.offerReads(), 0); assert.deepEqual(f.navigation, [guard === "user" ? "/login" : "/"]);
});

test("missing version column preserves own Service offers, details and navigation before SQL", async () => {
  const f = pageFixture({ versionMissing: true }); const tree = await f.mount();
  assert.equal(f.offerReads(), 2);
  assert.ok(f.selects[0].includes("read_state_version::text"));
  assert.ok(!f.selects[1].includes("read_state_version"));
  assert.ok(find(tree, "CarHeader"));
  call(find(tree, "AppointmentActions"), "onChat");
  assert.deepEqual(f.navigation, [`/chat/${requestId()}?offerId=${offerId()}`]);
});
