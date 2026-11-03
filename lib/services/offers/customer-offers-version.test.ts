import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type API = typeof import("./customer-offers.service");
const user = "10000000-0000-4000-8000-000000000001", request = "10000000-0000-4000-8000-000000000002", offer = "10000000-0000-4000-8000-000000000003";
function compile(path: string, requireMock: (name: string) => unknown) {
  const out: Record<string, unknown> = {};
  new Function("require", "exports", ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(requireMock, out);
  return out;
}
function fixture(category: string, installed = true) {
  const calls: { table: string; projection: string; filters: [string, unknown][] }[] = [];
  const row = { id: offer, request_id: request, workshop_user_id: user, workshop_name: "Service", price: "150", days: "2", message: "Displayed message",
    created_at: "2026-11-03T12:00:00Z", status: "pending", customer_read_at: null, available_date: null, available_time: null, read_state_version: "9007199254740993" };
  const state = { installed, denied: false };
  const supabase = { from: (table: string) => {
    let projection = ""; const filters: [string, unknown][] = [];
    const query = {
      select: (value: string) => { projection = value; return query; },
      in: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      order: () => query, overrideTypes: () => query,
      then: (resolve: (value: unknown) => void) => {
        calls.push({ table, projection, filters });
        if (table !== "repair_offers") return resolve({ data: [], error: null });
        if (state.denied) return resolve({ data: null, error: { code: "42501", message: "denied" } });
        if (!state.installed && projection.includes("read_state_version")) return resolve({ data: null, error: { code: "42703", message: "read_state_version absent" } });
        resolve({ data: [{ ...row, read_state_version: state.installed ? row.read_state_version : undefined }], error: null });
      },
    }; return query;
  } };
  const versions = compile("../../offer-read-version.ts", () => { throw new Error("No dependency"); });
  const api = compile("./customer-offers.service.ts", name => {
    if (name === "@/lib/offer-read-version") return versions;
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "@/lib/supabase/repair-requests") return { getOwnRepairRequests: async (id: string) => {
      assert.equal(id, user); return [{ id: request, user_id: user, status: "open", service_type: category, car_brand: "Vehicle", car_model: "Model", car_year: "2020", description: "Details", images: [] }];
    } };
    if (name === "@/lib/supabase/profiles") return { getPublicWorkshopSummaries: async () => ({ data: [], error: null }) };
    throw new Error(name);
  }) as API;
  return { api, state, row, calls };
}
for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  test(`${category}: displayed data and exact observed version come from same authorized query`, async () => {
    const f = fixture(category); const result = await f.api.loadCustomerOffers(user);
    assert.equal(result.items[0].request.serviceType, category);
    assert.equal(result.items[0].offer.message, "Displayed message");
    assert.equal(result.items[0].offer.readObservation?.version, "9007199254740993");
    assert.equal(result.items[0].offer.readObservation?.userId, user);
    assert.equal(result.items[0].offer.readObservation?.role, "customer");
    f.row.read_state_version = "9007199254740994"; f.row.message = "New message";
    assert.equal(result.items[0].offer.readObservation?.version, "9007199254740993");
    const reload = await f.api.loadCustomerOffers(user);
    assert.equal(reload.items[0].offer.message, "New message");
    assert.equal(reload.items[0].offer.readObservation?.version, "9007199254740994");
    assert.ok(f.calls.filter(call => call.table === "repair_offers").every(call => call.projection.includes("read_state_version::text")));
  });
}
test("before SQL list works, remains unread and no receipt can be created; next refresh detects installation", async () => {
  const f = fixture("bodywork", false);
  const before = await f.api.loadCustomerOffers(user);
  assert.equal(before.items.length, 1); assert.equal(before.items[0].offer.price, "150");
  assert.equal(before.items[0].offer.readObservation, null); assert.equal(before.markedOffersAsRead, false);
  const reads = f.calls.filter(call => call.table === "repair_offers");
  assert.equal(reads.length, 2); assert.deepEqual(reads[0].filters, reads[1].filters);
  assert.ok(!reads[1].projection.includes("read_state_version"));
  f.state.installed = true;
  assert.equal((await f.api.loadCustomerOffers(user)).items[0].offer.readObservation?.version, "9007199254740993");
});
test("authorization failure is propagated without compatibility retry", async () => {
  const f = fixture("bodywork"); f.state.denied = true;
  await assert.rejects(f.api.loadCustomerOffers(user));
  assert.equal(f.calls.length, 1);
});
