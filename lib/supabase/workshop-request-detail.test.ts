import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type ReadDetail = typeof import("./workshop-request-detail").getWorkshopRequestDetail;
const id = "10000000-0000-4000-8000-000000000001";
const owner = "20000000-0000-4000-8000-000000000002";
const source = readFileSync(new URL("./workshop-request-detail.ts", import.meta.url), "utf8");
function compile(value: string) {
  return ts.transpileModule(value, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}
const compiled = compile(source);
function row(extra: Record<string, unknown> = {}) {
  return { id, car_brand: "Synthetic", car_model: "Model", car_year: "2020", city: "City",
    license_plate: null, damage_type: "", service_details: [], service_type: "bodywork",
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null,
    route_distance_meters: null, route_duration_seconds: null, route_paths: null,
    towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null,
    description: null, images: [], status: "open", request_type: "repair",
    target_workshop_id: null, accepted_offer_id: null, created_at: "2026-11-01T10:00:00Z", ...extra };
}
type Reply = { data: unknown; error: unknown };
function fixture(reply: () => Promise<Reply> = async () => ({ data: [{ request_data: row() }], error: null })) {
  const calls: { name: string; args: unknown }[] = [];
  const exports: { getWorkshopRequestDetail?: ReadDetail } = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.equal(name, "@/lib/supabase/client");
    return { supabase: { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args }); return reply();
    }, from: () => { throw new Error("No direct table access/fallback allowed"); } } };
  }, exports);
  return { read: exports.getWorkshopRequestDetail!, calls };
}

const categoryDetails = {
  bodywork: { version: 1, selectedServices: [], carDamage: { parts: ["hood"], damages: [] }, options: [] },
  mechanical: { version: 2, kind: "mechanical", selections: [] },
  wheels: { version: 2, kind: "wheels", selections: [], wheelSize: { known: false }, partsSupply: { tire: null, rim: null } },
  towing: { version: 1, kind: "towing", pickup: { address: "Synthetic pickup", city: "City" },
    destination: { address: "Synthetic destination", city: "City" }, reason: "breakdown",
    vehicleCondition: { starts: false, canBePushed: true, wheels: "free" } },
};
for (const [category, details] of Object.entries(categoryDetails)) test(`${category}: RPC preserves category metadata, photos and route fields`, async () => {
  const value = row({ service_type: category, service_details: details,
    images: [{ name: "synthetic", url: "https://example.invalid/photo", path: "synthetic/path", fingerprint: "synthetic" }],
    pickup_lat: 44, pickup_lng: 26, destination_lat: 45, destination_lng: 27,
    route_paths: [[[44, 26], [45, 27]]], route_distance_meters: 1000, route_duration_seconds: 120,
    towing_schedule_type: "scheduled", towing_requested_at: "2026-11-02T10:00:00Z", towing_requested_timezone: "Europe/Berlin" });
  const f = fixture(async () => ({ data: [{ request_data: value }], error: null }));
  assert.strictEqual(await f.read(id), value);
  assert.deepEqual(f.calls, [{ name: "get_workshop_repair_request_detail", args: { p_request_id: id } }]);
});
test("nullable optional fields and empty collections remain unchanged", async () => {
  const value = row({ service_type: null, service_details: null, request_type: null });
  const f = fixture(async () => ({ data: [{ request_data: value }], error: null }));
  assert.deepEqual(await f.read(id), value);
});
test("legacy and unknown structured metadata are not normalized by the reader", async () => {
  for (const service_details of [["legacy"], { version: 1, kind: "mechanical", category: "engine", symptomIds: [] },
    { version: 99, futureField: { nested: true } }]) {
    const value = row({ service_details });
    const f = fixture(async () => ({ data: [{ request_data: value }], error: null }));
    assert.strictEqual(await f.read(id), value);
  }
});
test("zero rows means neutral absence; only server decides eligibility", async () => {
  const f = fixture(async () => ({ data: [], error: null }));
  assert.equal(await f.read(id), null); assert.equal(f.calls.length, 1);
});
test("closed request returned by authorized RPC remains readable", async () => {
  const f = fixture(async () => ({ data: [{ request_data: row({ status: "closed" }) }], error: null }));
  assert.equal((await f.read(id))?.status, "closed");
});
for (const [label, data] of Object.entries({
  null: null, object: { request_data: row() }, string: "[]", multiple: [{ request_data: row() }, { request_data: row() }],
  nullRow: [null], missingEnvelope: [{}], stringJson: [{ request_data: JSON.stringify(row()) }],
  arrayJson: [{ request_data: [] }], nullJson: [{ request_data: null }],
  wrongId: [{ request_data: row({ id: owner }) }],
  missingField: [{ request_data: row({ car_brand: undefined }) }],
  badNumber: [{ request_data: row({ pickup_lat: "44" }) }],
  nonFinite: [{ request_data: row({ pickup_lat: Number.NaN }) }],
  badDescription: [{ request_data: row({ description: {} }) }],
  badDetails: [{ request_data: row({ service_details: "invalid" }) }],
  badRoute: [{ request_data: row({ route_paths: {} }) }],
  badImages: [{ request_data: row({ images: {} }) }],
  badImageField: [{ request_data: row({ images: [{ url: 42 }] }) }],
})) test(`${label}: controlled invalid-response error without fallback/retry`, async () => {
  const f = fixture(async () => ({ data, error: null }));
  await assert.rejects(f.read(id), { message: "Răspuns invalid la încărcarea cererii Service." });
  assert.equal(f.calls.length, 1);
});
for (const code of ["42501", "PGRST202", "57014"]) test(`RPC error ${code} preserved even if data is supplied`, async () => {
  const error = { code, message: "Synthetic error" };
  const f = fixture(async () => ({ data: [{ request_data: row() }], error }));
  await assert.rejects(f.read(id), caught => caught === error); assert.equal(f.calls.length, 1);
});
test("transport failure has no retry or SELECT fallback", async () => {
  const error = new Error("Synthetic transport error");
  const f = fixture(async () => { throw error; });
  await assert.rejects(f.read(id), caught => caught === error); assert.equal(f.calls.length, 1);
});

// Execute each actual page with isolated React hooks and mocked dependencies.
// No DOM, SDK, network, view-count write or Realtime connection is loaded.
const detailPage = "../../app/workshops/[id]/page.tsx";
const offerPage = "../../app/workshops/[id]/offer/page.tsx";
function pageFixture(path: string, options: {
  read?: ReadDetail; user?: boolean; workshop?: boolean; existingOffer?: boolean;
} = {}) {
  const states: unknown[] = [], effects: (() => unknown)[] = [], navigation: string[] = [], events: string[] = [];
  const filters: [string, unknown][] = [];
  let stateIndex = 0, update: (() => void) | undefined, subscribed: ((status: string) => void) | undefined;
  const f = fixture();
  const read = options.read ?? f.read;
  const channel = {
    on: (_event: string, _filter: unknown, callback: () => void) => { update = callback; return channel; },
    subscribe: (callback: (status: string) => void) => { subscribed = callback; return channel; },
  };
  const query = {
    select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
    limit: () => query, maybeSingle: async () => ({ data: options.existingOffer ? { id: owner } : null, error: null }),
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: owner } } }) },
    from: (table: string) => { assert.equal(table, "repair_offers"); events.push("own-offer"); return query; },
    channel: () => channel, removeChannel: async () => { events.push("cleanup"); },
  };
  const storage = { setItem: () => {}, getItem: () => null, removeItem: () => { events.push("remove-availability"); } };
  const exports: { default?: () => unknown } = {};
  const requireMock = (name: string): unknown => {
    if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    if (name === "react") return {
      useState: (initial: unknown) => { const index = stateIndex++; states[index] = initial;
        return [initial, (value: unknown) => { states[index] = value; }]; },
      useEffect: (effect: () => unknown) => { effects.push(effect); },
      useEffectEvent: (callback: unknown) => callback,
    };
    if (name === "next/navigation") return { useRouter: () => ({ push: (url: string) => navigation.push(url) }),
      useParams: () => ({ id }), useSearchParams: () => ({ get: () => null }) };
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "@/lib/supabase/profiles") return { getOwnProfile: async () => ({ data: {
      profile: { role: [] }, role: options.workshop === false ? ["customer"] : ["workshop"],
    } }) };
    if (name === "@/lib/supabase/workshop-request-detail") return {
      getWorkshopRequestDetail: async (requestId: string) => { events.push("detail"); return read(requestId); },
    };
    if (name === "@/lib/supabase/repair-request-views") return { recordWorkshopRequestView: async () => { events.push("view"); } };
    if (name === "@/lib/supabase/workshop-client-names") return { getWorkshopRequestClientNames: async () => new Map() };
    if (name === "@/lib/supabase/repair-request-metrics") return { getWorkshopRequestMetrics: async () => new Map() };
    // Render-only components/helpers are not invoked while the initial render is loading.
    if (name.startsWith("@/app/components/") || ["@/lib/car-damage", "@/lib/displayLabels",
      "@/lib/mechanical/mechanical-service-details", "@/lib/towing/towing-display", "@/lib/towing/towing-service-details",
      "@/lib/wheels/wheels-display", "@/lib/supabase/repair-offers"].includes(name)) return {};
    throw new Error(`Unexpected offline import: ${name}`);
  };
  new Function("require", "exports", "sessionStorage", "localStorage", "process",
    compile(readFileSync(new URL(path, import.meta.url), "utf8")))(requireMock, exports, storage, storage, { env: { NODE_ENV: "test" } });
  exports.default!();
  return { states, effects, navigation, events, filters, calls: f.calls,
    update: () => update!(), subscribe: (status: string) => subscribed!(status) };
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); }

for (const path of [detailPage, offerPage]) {
  test(`${path}: initial load uses RPC then checks own offer`, async () => {
    const p = pageFixture(path, { existingOffer: true }); p.effects[0](); await settle();
    assert.deepEqual(p.calls, [{ name: "get_workshop_repair_request_detail", args: { p_request_id: id } }]);
    assert.deepEqual(p.states[0], row()); assert.deepEqual(p.navigation, []);
    assert.equal(p.states[8], true, "existing own offer still disables duplicate offering");
    assert.ok(p.events.indexOf("detail") < p.events.indexOf("own-offer"));
    assert.ok(p.filters.some(([key, value]) => key === "workshop_user_id" && value === owner));
    assert.ok(p.filters.some(([key, value]) => key === "request_id" && value === id));
  });
  for (const guard of ["user", "workshop"] as const) test(`${path}: ${guard} guard preserves navigation and prevents reading`, async () => {
    const p = pageFixture(path, { [guard]: false }); p.effects[0](); await settle();
    assert.deepEqual(p.navigation, [guard === "user" ? "/login" : "/"]);
    assert.deepEqual(p.events, []); assert.equal(p.calls.length, 0);
  });
  for (const mode of ["absent", "denied"] as const) test(`${path}: ${mode} remains neutral without auxiliary reads`, async () => {
    const p = pageFixture(path, { read: async () => { if (mode === "denied") throw { code: "42501" }; return null; } });
    p.effects[0](); await settle();
    assert.equal(p.states[0], null); assert.deepEqual(p.events, ["detail"]);
    assert.deepEqual(p.navigation, path === offerPage ? ["/workshops"] : []);
  });
}
test("offer page retains the closed-form guard for a matched request returned by RPC", async () => {
  const f = fixture(async () => ({ data: [{ request_data: row({ status: "matched" }) }], error: null }));
  const p = pageFixture(offerPage, { read: f.read }); p.effects[0](); await settle();
  assert.equal(p.states[7], true);
  assert.deepEqual(p.navigation, []);
});
test("detail page UPDATE and resubscription use the same RPC loader; cleanup is preserved", async () => {
  const p = pageFixture(detailPage); p.effects[0](); const cleanup = p.effects[1]() as () => void;
  await settle(); assert.equal(p.calls.length, 1);
  p.update(); await settle(); assert.equal(p.calls.length, 2);
  p.subscribe("SUBSCRIBED"); p.subscribe("SUBSCRIBED"); await settle(); assert.equal(p.calls.length, 3);
  cleanup(); assert.ok(p.events.includes("cleanup"));
});
test("silent no-access result clears the request without disclosing existence or doing auxiliary reads", async () => {
  let reads = 0;
  const value = await fixture().read(id);
  const p = pageFixture(detailPage, { read: async () => ++reads === 1 ? value : null });
  p.effects[0](); p.effects[1](); await settle(); assert.deepEqual(p.states[0], value);
  const ownReads = p.events.filter(e => e === "own-offer").length;
  p.update(); await settle(); assert.equal(p.states[0], null);
  assert.equal(p.events.filter(e => e === "own-offer").length, ownReads);
  assert.deepEqual(p.navigation, []);
});
