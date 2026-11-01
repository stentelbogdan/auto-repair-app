import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual pages and RPC reader with isolated hooks/JSX and no SDK,
// DOM, network, view writes or Realtime subscriptions.
const calendarPath = "../../app/customer/schedule-damage/[id]/page.tsx";
const formPath = "../../app/workshops/[id]/page.tsx";
const id = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const offerId = "30000000-0000-4000-8000-000000000003";
const key = `availability-${id}`;
const date = "2099-11-02";
const message = "Mesaj sintetic pentru ofertă";
const towing = { version: 1, kind: "towing", pickup: { address: "Adresă sintetică", city: "City" },
  destination: { address: "Destinație sintetică", city: "City" }, reason: "breakdown",
  vehicleCondition: { starts: false, canBePushed: true, wheels: "free" } };
function row(category = "bodywork") {
  return { id, car_brand: "Synthetic", car_model: "Model", car_year: "2020", city: "City",
    license_plate: null, damage_type: null, service_type: category,
    service_details: category === "towing" ? towing : [],
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null,
    route_distance_meters: null, route_duration_seconds: null, route_paths: null,
    towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null,
    description: null, images: [], status: "open", request_type: "repair",
    target_workshop_id: null, accepted_offer_id: null, created_at: "2026-11-01T10:00:00Z" };
}
const offer = { id: offerId, request_id: id, workshop_user_id: userId, status: "accepted" };
type Element = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}
function find(tree: unknown, predicate: (node: Element) => boolean): Element {
  const result = nodes(tree).find(predicate);
  assert.ok(result, "Expected control rendered");
  return result;
}
function invoke(node: Element, name: string, ...args: unknown[]) {
  const fn = node.props[name];
  assert.equal(typeof fn, "function");
  return (fn as (...args: unknown[]) => unknown)(...args);
}
function evaluate(path: string, requireMock: (name: string) => unknown) {
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return { code, exports, requireMock };
}
function pureModule(path: string) {
  const m = evaluate(path, name => { throw new Error(`Unexpected import ${name}`); });
  new Function("require", "exports", m.code)(m.requireMock, m.exports);
  return m.exports;
}
const towingGuard = pureModule("../towing/towing-service-details.ts");
const towingSchedule = pureModule("../towing/towing-schedule-display.ts");
type Options = {
  category?: string; mode?: "workshop" | "customer"; user?: boolean;
  reply?: { data: unknown; error: unknown }; reject?: boolean; ownMissing?: boolean;
  occupied?: boolean; slotError?: boolean; initial?: boolean; existingOffer?: boolean;
  storage?: Map<string, string>; detail?: Record<string, unknown>;
};
function fixture(path = calendarPath, options: Options = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const states: unknown[] = [], refs: { current: unknown }[] = [];
  const effects: (() => unknown)[] = [], navigation: string[] = [], alerts: string[] = [];
  const calls: { name: string; args: unknown }[] = [], ownReads: string[] = [], tables: string[] = [];
  const filters: [string, unknown][] = [];
  let cursor = 0, refCursor = 0, currentTable = "";
  const value = options.detail ?? row(options.category);
  const query = { select: () => query, eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
    limit: () => query, maybeSingle: async () => ({
      data: options.existingOffer && currentTable === "repair_offers" ? offer : null, error: null,
    }) };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: userId } } }) },
    from: (table: string) => {
      currentTable = table;
      tables.push(table);
      assert.ok(["repair_offers", "repair_appointments"].includes(table), "No direct request SELECT or fallback");
      return query; // No write methods: accidental INSERT/UPDATE/DELETE fails.
    },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "get_workshop_repair_request_detail") {
        if (options.reject) throw new Error("Synthetic transport failure");
        return options.reply ?? { data: [{ request_data: value }], error: null };
      }
      assert.equal(name, "get_workshop_booked_slots", "No offer/appointment creation RPC allowed");
      return { data: options.occupied ? [{ slot_time: "10:00" }] : [],
        error: options.slotError ? { code: "42501" } : null };
    },
  };
  const reader = evaluate("./workshop-request-detail.ts", name => {
    assert.equal(name, "@/lib/supabase/client"); return { supabase };
  });
  new Function("require", "exports", reader.code)(reader.requireMock, reader.exports);
  const requireMock = (name: string): unknown => {
    if (name === "react/jsx-runtime") return {
      jsx: (type: unknown, props: Element["props"]) => ({ type, props }),
      jsxs: (type: unknown, props: Element["props"]) => ({ type, props }),
    };
    if (name === "react") return {
      useState: (initial: unknown) => { const i = cursor++; if (!(i in states)) states[i] = initial;
        return [states[i], (v: unknown) => { states[i] = v; }]; },
      useRef: (initial: unknown) => { const i = refCursor++; return refs[i] ??= { current: initial }; },
      useMemo: (fn: () => unknown) => fn(), useEffectEvent: (fn: unknown) => fn,
      useEffect: (effect: () => unknown) => { effects.push(effect); },
    };
    if (name === "next/navigation") return {
      useRouter: () => ({ push: (url: string) => navigation.push(url), replace: (url: string) => navigation.push(url) }),
      useParams: () => ({ id }), useSearchParams: () => ({ get: (key: string) =>
        key === "from" ? options.mode ?? "workshop" : key === "offerId" && options.existingOffer ? offerId
          : key === "mode" && options.initial !== false ? "initial-offer" : null }),
    };
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "@/lib/supabase/workshop-request-detail") return reader.exports;
    if (name === "@/lib/supabase/repair-requests") return {
      getOwnRepairRequests: async (owner: string) => { ownReads.push(owner); return options.ownMissing ? [] : [{ ...value, user_id: owner }]; },
    };
    if (name === "@/lib/supabase/repair-offers") return {
      getOffersForCustomerRequests: async (owner: string) => { ownReads.push(owner); return [offer]; },
      createRepairOffer: () => { throw new Error("Offer must not be created by calendar navigation"); },
    };
    if (name === "@/lib/towing/towing-service-details") return towingGuard;
    if (name === "@/lib/towing/towing-schedule-display") return towingSchedule;
    if (name === "@/app/components/AppointmentDateTimePicker") return {
      default: "DatePicker", toLocalDateValue: () => "2026-11-01",
      toLocalDateTime: (d: string, t: string) => new Date(`${d}T${t}:00`),
    };
    if (name === "@/lib/supabase/profiles") return { getOwnProfile: async () => ({ data: { role: ["workshop"] } }) };
    if (name === "@/lib/supabase/repair-request-views") return { recordWorkshopRequestView: async () => {} };
    if (name === "@/lib/supabase/workshop-client-names") return { getWorkshopRequestClientNames: async () => new Map() };
    if (name === "@/lib/supabase/repair-request-metrics") return { getWorkshopRequestMetrics: async () => new Map() };
    if (name === "@/lib/car-damage") return { getAffectedPartLabels: () => [], getDamageTypeLabels: () => [] };
    if (name === "@/lib/displayLabels") return { getRequestTypeBadgeLabel: () => "Synthetic" };
    if (name === "@/lib/mechanical/mechanical-service-details") return { getMechanicalServiceDetailGroups: () => [] };
    if (name === "@/lib/wheels/wheels-display") return { getWheelsDisplaySummary: () => undefined };
    if (name === "@/lib/towing/towing-display") return { getTowingDisplaySummary: () => undefined };
    if (name.startsWith("@/app/components/")) return { default: name.split("/").at(-1) };
    throw new Error(`Unexpected offline import: ${name}`);
  };
  const m = evaluate(path, requireMock);
  new Function("require", "exports", "sessionStorage", "localStorage", "alert", "console", "process", m.code)(
    requireMock, m.exports,
    { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, v: string) => storage.set(key, v), removeItem: (key: string) => storage.delete(key) },
    { setItem: () => {} }, (message: string) => alerts.push(message), { error: () => {}, log: () => {} }, { env: { NODE_ENV: "test" } },
  );
  function render() { cursor = 0; refCursor = 0; effects.length = 0; return (m.exports.default as () => unknown)(); }
  async function mount() { render(); effects[0](); await new Promise(resolve => setImmediate(resolve)); return render(); }
  return { render, mount, states, effects, navigation, alerts, calls, ownReads, tables, storage, filters };
}
function picker(tree: unknown) { return find(tree, n => n.type === "DatePicker"); }
function continueButton(tree: unknown) { return find(tree, n => n.props.children === "Continuă către ofertă"); }

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  test(`${category}: Service uses authorized RPC and keeps category-specific calendar`, async () => {
    const f = fixture(calendarPath, { category }); const tree = await f.mount();
    assert.deepEqual(f.calls, [{ name: "get_workshop_repair_request_detail", args: { p_request_id: id } }]);
    assert.deepEqual(f.states[0], row(category)); assert.deepEqual(f.tables, []); assert.deepEqual(f.ownReads, []);
    assert.equal(picker(tree).props.timeSelectionMode, category === "towing" ? "wheel" : "grid");
    assert.equal(f.states[8], category === "towing" ? "workshop_pickup" : "customer_dropoff");
  });
}
for (const label of ["absent", "inaccessible"]) test(`${label}: neutral absence, no fallback`, async () => {
  const f = fixture(calendarPath, { reply: { data: [], error: null } }); await f.mount();
  assert.deepEqual(f.alerts, ["Lucrarea nu a fost găsită."]);
  assert.deepEqual(f.navigation, ["/workshops"]); assert.equal(f.states[0], null);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.tables, []);
});
for (const label of ["permission denied", "invalid response", "transport"]) test(`${label}: error without SELECT fallback or retry`, async () => {
  const f = fixture(calendarPath, { reject: label === "transport", reply: label === "invalid response"
    ? { data: [{ request_data: { ...row(), id: userId } }], error: null }
    : { data: null, error: { code: "42501" } } });
  await f.mount(); assert.equal(f.states[0], null); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.alerts, ["Nu am putut încărca pagina de programare."]); assert.deepEqual(f.tables, []);
});
test("missing session redirects before any request lookup", async () => {
  const f = fixture(calendarPath, { user: false }); await f.mount();
  assert.deepEqual(f.navigation, ["/login"]); assert.deepEqual(f.calls, []);
});
test("Client keeps owner-scoped reads and never calls Service RPC", async () => {
  const f = fixture(calendarPath, { mode: "customer" }); await f.mount();
  assert.deepEqual(f.ownReads, [userId, userId]); assert.deepEqual(f.calls, []);
  assert.deepEqual(f.states[0], { ...row(), user_id: userId }); assert.deepEqual(f.states[1], offer);
});
test("Client cannot load a request absent from own results", async () => {
  const f = fixture(calendarPath, { mode: "customer", ownMissing: true }); await f.mount();
  assert.deepEqual(f.navigation, ["/offers"]); assert.equal(f.states[0], null); assert.deepEqual(f.tables, []);
});
test("Service existing-appointment mode retains missing-offer guard", async () => {
  // No offerId: request still goes through RPC, then existing neutral offer guard.
  const f = fixture(calendarPath, { initial: false }); await f.mount();
  assert.deepEqual(f.navigation, ["/workshops/my-offers"]); assert.equal(f.calls.length, 1);
});
test("Service existing-appointment lookup retains request and workshop ownership filters", async () => {
  const f = fixture(calendarPath, { initial: false, existingOffer: true }); await f.mount();
  assert.deepEqual(f.tables, ["repair_offers", "repair_appointments"]);
  assert.deepEqual(f.filters, [["id", offerId], ["request_id", id], ["workshop_user_id", userId],
    ["offer_id", offerId], ["request_id", id], ["workshop_id", userId]]);
  assert.deepEqual(f.states[1], offer); assert.deepEqual(f.navigation, []);
});

test("form → calendar → form preserves €150, 2 days, message and selection without creating an offer", async () => {
  const storage = new Map<string, string>();
  const form = fixture(formPath, { storage }); await form.mount();
  let tree = form.render();
  invoke(find(tree, n => n.type === "input" && n.props.type === "number"), "onChange", { target: { value: "150" } });
  invoke(find(tree, n => n.type === "select"), "onChange", { target: { value: "2 zile" } });
  invoke(find(tree, n => n.type === "textarea"), "onChange", { target: { value: message } });
  tree = form.render(); invoke(find(tree, n => n.type === "AppointmentSummaryCard"), "onClick");
  assert.deepEqual(form.navigation, [`/customer/schedule-damage/${id}?from=workshop&mode=initial-offer`]);
  const calendar = fixture(calendarPath, { storage }); tree = await calendar.mount();
  invoke(picker(tree), "onDateChange", date); invoke(picker(tree), "onTimeChange", "10:00");
  await invoke(continueButton(calendar.render()), "onClick");
  assert.deepEqual(calendar.navigation, [`/workshops/${id}?date=${date}&time=10:00`]);
  assert.deepEqual(JSON.parse(storage.get(key)!), { date, time: "10:00", price: "150", days: "2 zile", message,
    handoverMethod: "customer_dropoff", pickupAddress: "" });
  assert.deepEqual(calendar.tables, []);
  assert.equal(calendar.calls.filter(c => c.name === "get_workshop_booked_slots").length, 1);
  const returned = fixture(formPath, { storage }); const returnedTree = await returned.mount();
  assert.equal(find(returnedTree, n => n.type === "input" && n.props.type === "number").props.value, "150");
  assert.equal(find(returnedTree, n => n.type === "select").props.value, "2 zile");
  assert.equal(find(returnedTree, n => n.type === "textarea").props.value, message);
  const summary = find(returnedTree, n => n.type === "AppointmentSummaryCard");
  assert.equal(summary.props.date, date); assert.equal(summary.props.time, "10:00");
});
for (const category of ["bodywork", "mechanical", "wheels", "towing"]) test(`${category}: selection only persists draft, never creates/reserves`, async () => {
  const storage = new Map([[key, JSON.stringify({ price: "150", days: "2 zile", message, date, time: "10:00" })]]);
  const f = fixture(calendarPath, { storage, category }); const tree = await f.mount();
  await invoke(continueButton(tree), "onClick");
  assert.equal(f.navigation.length, 1); assert.deepEqual(f.tables, []);
  const draft = JSON.parse(storage.get(key)!);
  assert.equal(draft.price, "150"); assert.equal(draft.days, "2 zile"); assert.equal(draft.message, message);
  assert.equal(draft.pickupAddress, category === "towing" ? "Adresă sintetică, City" : "");
});
for (const failure of ["occupied", "error"]) test(`slot ${failure}: no navigation or draft update`, async () => {
  const original = JSON.stringify({ price: "150", days: "2 zile", message, date, time: "10:00" });
  const f = fixture(calendarPath, { storage: new Map([[key, original]]), occupied: failure === "occupied", slotError: failure === "error" });
  const tree = await f.mount(); await invoke(continueButton(tree), "onClick");
  assert.deepEqual(f.navigation, []); assert.equal(f.storage.get(key), original); assert.equal(f.alerts.length, 1);
});
test("Towing requested time/timezone prefill is retained unless draft overrides it", async () => {
  const detail = { ...row("towing"), towing_schedule_type: "scheduled", towing_requested_at: `${date}T09:00:00Z`,
    towing_requested_timezone: "Europe/Berlin" };
  const f = fixture(calendarPath, { detail }); const tree = await f.mount();
  assert.equal(picker(tree).props.date, date); assert.equal(picker(tree).props.time, "10:00");
  const override = fixture(calendarPath, { detail, storage: new Map([[key, JSON.stringify({ date, time: "14:00" })]]) });
  assert.equal(picker(await override.mount()).props.time, "14:00");
});
