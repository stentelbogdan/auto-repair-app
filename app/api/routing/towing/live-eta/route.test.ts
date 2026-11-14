import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const requestId = "10000000-0000-4000-8000-000000000001";
const workshopId = "20000000-0000-4000-8000-000000000002";
const offerId = "30000000-0000-4000-8000-000000000003";
const appointmentId = "40000000-0000-4000-8000-000000000004";
const context = { id: requestId, service_type: "towing", accepted_offer_id: offerId, pickup_lat: 47, pickup_lng: 27 };
const acceptedOffer = { id: offerId, request_id: requestId, workshop_user_id: workshopId, status: "accepted" };
const location = { request_id: requestId, appointment_id: appointmentId, workshop_id: workshopId,
  latitude: 46, longitude: 26, phase: "to_pickup", is_active: true,
  live_distance_to_pickup_meters: null, live_duration_to_pickup_seconds: null, live_eta_calculated_at: null,
  live_eta_origin_latitude: null, live_eta_origin_longitude: null };
type Reply = { data: unknown; error: null | { code: string; message?: string } };
type Options = {
  request?: Reply; progress?: Reply; offer?: Reply; location?: Reply; appointment?: Reply;
  auth?: boolean; updateError?: boolean; routeStatus?: string;
  env?: Record<string, string | undefined>;
};
const ok = (data: unknown): Reply => ({ data, error: null });
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

function fixture(options: Options = {}) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const routeCalls: unknown[] = [];
  let clientCount = 0;
  const client = {
    auth: { getUser: async (token: string) => {
      assert.equal(token, "synthetic-session");
      return { data: { user: options.auth === false ? null : { id: workshopId } }, error: null };
    } },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "get_workshop_repair_request_detail") return options.request ?? ok([{ request_data: context }]);
      if (name === "get_workshop_latest_work_progress") return options.progress ?? ok([{ request_id: requestId, status: "Dispatch" }]);
      assert.equal(name, "update_towing_live_eta");
      return { data: null, error: options.updateError ? { code: "42501" } : null };
    },
    from: (table: string) => {
      assert.ok(["repair_offers", "towing_live_locations", "repair_appointments"].includes(table), `Unauthorized direct read: ${table}`);
      const read = { table, filters: [] as [string, unknown][] }; reads.push(read);
      let projection = "";
      const query = {
        select: (fields: string) => { projection = fields; return query; },
        eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query; },
        maybeSingle: async () => table === "repair_offers" ? options.offer ?? ok(acceptedOffer)
          : table === "repair_appointments" ? options.appointment ?? ok({ id: appointmentId })
          : projection === "live_eta_calculated_at" ? ok({ live_eta_calculated_at: "2026-11-08T12:00:00Z" })
          : options.location ?? ok(location),
      };
      return query;
    },
  };
  // Execute the real handler with closed dependencies: no SDK or network import.
  const boundary: Record<string, unknown> = {};
  new Function("exports", compile(readFileSync(new URL("../../../../../lib/supabase/project-boundary.ts", import.meta.url), "utf8")))(boundary);
  const exported: { POST?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", "process", compile(source))((name: string) => {
    if (name === "@supabase/supabase-js") return { createClient: (url: string, key: string, config: unknown) => {
      clientCount += 1;
      assert.equal(url, "https://bstjobvvxxfqqwyjoimx.supabase.co");
      assert.equal(key, "synthetic-anon");
      assert.deepEqual(config, { auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: "Bearer synthetic-session" } } });
      return client;
    } };
    if (name === "@/lib/supabase/project-boundary") return boundary;
    if (name === "@/lib/towing/geoapify-routing") return { getGeoapifyRoute: async (input: unknown) => {
      routeCalls.push(input); return { status: options.routeStatus ?? "ok", distanceMeters: 1000, durationSeconds: 120 };
    } };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exported, { env: { NEXT_PUBLIC_SUPABASE_URL: "https://bstjobvvxxfqqwyjoimx.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", VERCEL_ENV: "preview",
    NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "bstjobvvxxfqqwyjoimx", ...options.env } });
  return { rpcCalls, reads, routeCalls, clientCount: () => clientCount,
    call: (id: unknown = requestId, token: string | null = "synthetic-session") => exported.POST!(new Request("https://preview.invalid/api/routing/towing/live-eta", {
      method: "POST", headers: { "Content-Type": "application/json", ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ requestId: id }),
    })) };
}

test("winning Service uses both authorized RPCs with its own bearer session, then the unchanged ETA update", async () => {
  const f = fixture(); const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "updated", distanceMeters: 1000, durationSeconds: 120, calculatedAt: "2026-11-08T12:00:00Z" });
  assert.equal(f.clientCount(), 1);
  assert.deepEqual(f.rpcCalls, [
    { name: "get_workshop_repair_request_detail", args: { p_request_id: requestId } },
    { name: "get_workshop_latest_work_progress", args: { p_request_id: requestId } },
    { name: "update_towing_live_eta", args: { p_request_id: requestId, p_distance_to_pickup_meters: 1000,
      p_duration_to_pickup_seconds: 120, p_origin_latitude: 46, p_origin_longitude: 26 } },
  ]);
  assert.deepEqual(f.routeCalls, [{ originLat: 46, originLng: 26, destinationLat: 47, destinationLng: 27, requirePaths: false }]);
  assert.deepEqual(f.reads[0].filters, [["id", offerId], ["request_id", requestId], ["status", "accepted"]]);
  assert.deepEqual(f.reads.find(read => read.table === "repair_appointments")?.filters,
    [["id", appointmentId], ["request_id", requestId], ["offer_id", offerId], ["workshop_id", workshopId], ["status", "confirmed"]]);
});

for (const [label, options, status] of [
  ["missing session", { auth: false }, 401],
  ["no accessible request", { request: ok([]) }, 404],
  ["request denied", { request: { data: null, error: { code: "42501", message: "private" } } }, 403],
  ["request RPC missing", { request: { data: null, error: { code: "PGRST202" } } }, 500],
  ["non-towing request", { request: ok([{ request_data: { ...context, service_type: "bodywork" } }]) }, 404],
  ["missing pickup", { request: ok([{ request_data: { ...context, pickup_lat: null } }]) }, 422],
  ["no accepted offer ID", { request: ok([{ request_data: { ...context, accepted_offer_id: null } }]) }, 422],
  ["no own accepted offer", { offer: ok(null) }, 403],
  ["another workshop", { offer: ok({ ...acceptedOffer, workshop_user_id: requestId }) }, 403],
  ["wrong offer", { offer: ok({ ...acceptedOffer, id: requestId }) }, 403],
  ["offer on another request", { offer: ok({ ...acceptedOffer, request_id: offerId }) }, 403],
  ["offer not accepted", { offer: ok({ ...acceptedOffer, status: "pending" }) }, 403],
  ["progress denied", { progress: { data: null, error: { code: "42501", message: "private" } } }, 403],
  ["progress RPC missing", { progress: { data: null, error: { code: "PGRST202" } } }, 500],
  ["authorized empty progress", { progress: ok([]) }, 409],
  ["non-Dispatch progress", { progress: ok([{ request_id: requestId, status: "Ready" }]) }, 409],
  ["missing live location", { location: ok(null) }, 409],
  ["inactive location", { location: ok({ ...location, is_active: false }) }, 409],
  ["location owned by another Service", { location: ok({ ...location, workshop_id: requestId }) }, 409],
  ["no confirmed appointment", { appointment: ok(null) }, 409],
] as [string, Options, number][]) test(`${label}: no routing or ETA write, explicit error`, async () => {
  const f = fixture(options), response = await f.call(); assert.equal(response.status, status);
  assert.deepEqual(f.routeCalls, []); assert.ok(!f.rpcCalls.some(call => call.name === "update_towing_live_eta"));
  const body = await response.json(); assert.equal(typeof body.error, "string"); assert.ok(!JSON.stringify(body).includes("private"));
});

for (const [label, data] of Object.entries({ null: null, object: {}, missingWrapper: [{}],
  otherRequest: [{ request_data: { ...context, id: offerId } }], duplicate: [{ request_data: context }, { request_data: context }],
})) test(`malformed context ${label} cannot reach ETA calculation`, async () => {
  const f = fixture({ request: ok(data) }); assert.equal((await f.call()).status, 500); assert.deepEqual(f.routeCalls, []);
});
for (const [label, data] of Object.entries({ null: null, object: {}, missingRequest: [{ status: "Dispatch" }],
  otherRequest: [{ request_id: offerId, status: "Dispatch" }], badStatus: [{ request_id: requestId, status: {} }],
  duplicate: [{ request_id: requestId, status: "Dispatch" }, { request_id: requestId, status: "Dispatch" }],
})) test(`malformed progress ${label} cannot reach ETA calculation`, async () => {
  const f = fixture({ progress: ok(data) }); assert.equal((await f.call()).status, 500); assert.deepEqual(f.routeCalls, []);
});
test("missing bearer and invalid identifier stop before any Supabase client", async () => {
  const f = fixture(); assert.equal((await f.call(requestId, null)).status, 401);
  for (const id of ["", "draft", null, 1]) assert.equal((await f.call(id)).status, 400);
  assert.equal(f.clientCount(), 0);
});
for (const [age, reason] of [[1000, "fresh"], [45000, "not_moved_enough"]] as const)
  test(`existing throttle ${reason} still skips routing and updates`, async () => {
    const f = fixture({ location: ok({ ...location, live_distance_to_pickup_meters: 1000,
      live_duration_to_pickup_seconds: 120, live_eta_calculated_at: new Date(Date.now() - age).toISOString(),
      live_eta_origin_latitude: 46, live_eta_origin_longitude: 26 }) });
    const response = await f.call(); assert.equal(response.status, 200); assert.equal((await response.json()).reason, reason);
    assert.deepEqual(f.routeCalls, []); assert.equal(f.rpcCalls.length, 2);
  });
test("eligibility changed during calculation never reports an updated ETA", async () => {
  const f = fixture({ updateError: true }); const response = await f.call();
  assert.equal(response.status, 409); assert.equal((await response.json()).status, undefined);
});

const diagnosticEnv = { TOWING_ETA_DIAGNOSTIC: "1" };
const diagnosticCases: [string, Reply][] = [
  ["TRACKING_READ_ERROR", { data: { ...location, workshop_id: requestId, phase: "private-phase", is_active: false },
    error: { code: "private-database-code", message: `private SQL ${requestId} synthetic-session GPS 46,26` } }],
  ["TRACKING_ROW_NOT_VISIBLE", ok(null)],
  ["TRACKING_WORKSHOP_MISMATCH", ok({ ...location, workshop_id: requestId, phase: "private-phase", is_active: false })],
  ["TRACKING_PHASE_MISMATCH", ok({ ...location, phase: "private-phase", is_active: false })],
  ["TRACKING_NOT_ACTIVE", ok({ ...location, is_active: false })],
];
for (const [code, reply] of diagnosticCases) {
  test(`temporary diagnostic ${code}: only safe constant, original failure precedence, no subsequent work`, async () => {
    const f = fixture({ env: diagnosticEnv, location: reply });
    const response = await f.call();
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("cache-control"), "no-store");
    // Exact allowlist schema/value rules out all row values, IDs, GPS, JWTs,
    // database codes/messages, including arbitrary extra diagnostic fields.
    assert.deepEqual(await response.json(), { code });
    assert.deepEqual(f.routeCalls, []);
    assert.deepEqual(f.rpcCalls.map(call => call.name), [
      "get_workshop_repair_request_detail", "get_workshop_latest_work_progress",
    ]);
    assert.ok(!f.reads.some(read => read.table === "repair_appointments"));
    assert.deepEqual(f.reads.find(read => read.table === "towing_live_locations")?.filters,
      [["request_id", requestId]]);
  });
}
for (const env of [{}, { TOWING_ETA_DIAGNOSTIC: "0" }, { TOWING_ETA_DIAGNOSTIC: "true" },
  { ...diagnosticEnv, VERCEL_ENV: "development" }, { ...diagnosticEnv, VERCEL_ENV: undefined }]) {
  test(`temporary diagnostic disabled outside explicit Preview opt-in: ${JSON.stringify(env)}`, async () => {
    for (const [, reply] of diagnosticCases) {
      const response = await fixture({ env, location: reply }).call();
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "Trackingul live activ nu a fost găsit." });
    }
  });
}
for (const [label, options, status] of [
  ["invalid session", { auth: false }, 401],
  ["inaccessible request", { request: ok([]) }, 404],
  ["request denied", { request: { data: null, error: { code: "42501" } } }, 403],
  ["other Service", { offer: ok({ ...acceptedOffer, workshop_user_id: requestId }) }, 403],
  ["other request offer", { offer: ok({ ...acceptedOffer, request_id: offerId }) }, 403],
  ["progress denied", { progress: { data: null, error: { code: "42501" } } }, 403],
  ["not Dispatch", { progress: ok([{ request_id: requestId, status: "Ready" }]) }, 409],
] as [string, Options, number][]) {
  test(`temporary diagnostic cannot bypass ${label}`, async () => {
    const f = fixture({ ...options, env: diagnosticEnv, location: ok(null) });
    const response = await f.call();
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, undefined);
    assert.ok(!f.reads.some(read => read.table === "towing_live_locations"));
    assert.deepEqual(f.routeCalls, []);
  });
}
test("temporary diagnostic requires bearer and valid identifier", async () => {
  const f = fixture({ env: diagnosticEnv });
  for (const response of [await f.call(requestId, null), await f.call("invalid")]) {
    assert.equal((await response.json()).code, undefined);
  }
  assert.equal(f.clientCount(), 0);
});
for (const env of [
  { ...diagnosticEnv, VERCEL_ENV: "production" },
  { ...diagnosticEnv, NEXT_PUBLIC_SUPABASE_URL: "https://unapproved.invalid" },
  { ...diagnosticEnv, NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "wrong-project" },
]) {
  test(`temporary diagnostic preserves deployment boundary: ${JSON.stringify(env)}`, async () => {
    const f = fixture({ env }); const response = await f.call();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, undefined);
    assert.equal(f.clientCount(), 0);
  });
}
test("temporary diagnostic leaves valid tracking and ETA calculation unchanged", async () => {
  const f = fixture({ env: diagnosticEnv }); const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "updated", distanceMeters: 1000,
    durationSeconds: 120, calculatedAt: "2026-11-08T12:00:00Z" });
  assert.equal(f.routeCalls.length, 1);
  assert.equal(f.rpcCalls.at(-1)?.name, "update_towing_live_eta");
});
