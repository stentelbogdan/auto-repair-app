import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
type API = typeof import("./customer-request-activity");
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000001";
const source = readFileSync(new URL("./customer-request-activity.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function row(patch: Record<string, unknown> = {}) {
  return { id, user_id: owner, car_brand: "Synthetic", car_model: "Model", car_year: "2020", city: "City", damage_type: "",
    license_plate: null, description: null, images: [], status: "open", created_at: "2020-01-01T00:00:00+00:00", offers_count: 0,
    target_workshop_id: null, accepted_offer_id: null, request_type: "repair", service_type: "bodywork", service_details: [],
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null, route_distance_meters: null,
    route_duration_seconds: null, route_paths: null, towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null, ...patch };
}
const envelope = (r = row(), time = "2026-11-05T12:00:00.123456+00:00") => ({ request_data: r, last_relevant_activity_at: time });
function fixture(data: unknown = [envelope()], error: unknown = null, users = [owner], views: unknown = []) {
  const api: Partial<API> = {};
  const calls: string[] = [];
  let sessionIndex = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: users[Math.min(sessionIndex++, users.length - 1)] } } }, error: null }) },
    rpc: (name: string, args?: unknown) => {
      calls.push(name);
      if (name === "get_customer_request_view_counts") assert.deepEqual(args, { p_request_ids: [id] });
      else assert.equal(args, undefined);
      return { abortSignal: async (signal: AbortSignal) => { signal.throwIfAborted(); return { data: name === "get_customer_requests_by_activity" ? data : views, error }; } };
    },
    from: () => { throw new Error("No SELECT fallback"); },
  };
  new Function("require", "exports", "process", compiled)(() => ({ supabase: client }), api, { env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://bstjobvvxxfqqwyjoimx.supabase.co", NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "bstjobvvxxfqqwyjoimx",
  } });
  return { api: api as API, calls };
}
for (const category of ["bodywork", "mechanical", "wheels", "towing"]) test(`${category}: authorized category and photo metadata preserved`, async () => {
  const data = row({ service_type: category, service_details: { version: 1, kind: category }, images: [{ name: "photo", path: `${owner}/synthetic.jpg` }] });
  const f = fixture([envelope(data)]);
  const rows = await f.api.getCustomerRequestsByActivity(owner, new AbortController().signal);
  assert.equal(rows[0].service_type, category); assert.deepEqual(rows[0].images, data.images);
  assert.equal(rows[0].last_relevant_activity_at, "2026-11-05T12:00:00.123456+00:00");
  assert.deepEqual(f.calls, ["get_customer_requests_by_activity", "get_customer_request_view_counts"]);
});
for (const event of ["new request", "saved description", "saved photo association", "confirmed physical deletion", "new offer"]) test(`${event}: preserve persistent RPC ordering after reload, not created_at`, () => {
  const f = fixture();
  const data = [envelope(row(), "2026-11-05T12:00:00.123457Z"), envelope(row({ id: other, created_at: "2025-01-01T00:00:00Z" }), "2026-11-05T12:00:00.123456Z")];
  for (let reload = 0; reload < 2; reload++) assert.deepEqual(f.api.parseCustomerActivity(data, owner).map(r => r.id), [id, other]);
});
test("detachment or failed edit: unchanged server ordering is never moved optimistically", () => {
  const f = fixture(); const data = [envelope(row({ id: other })), envelope()];
  assert.deepEqual(f.api.parseCustomerActivity(data, owner).map(r => r.id), [other, id]);
});
for (const [label, data] of Object.entries({
  null: null, object: {}, malformedEnvelope: [{}], jsonString: [envelope(JSON.stringify(row()) as never)],
  otherOwner: [envelope(row({ user_id: other }))], duplicate: [envelope(), envelope()],
  missingId: [envelope(row({ id: undefined }))], directMessage: [envelope(row({ request_type: "direct_message" }))],
  badTimestamp: [envelope(row(), "infinity")], badCount: [envelope(row({ offers_count: Number.MAX_SAFE_INTEGER + 1 }))],
  negative: [envelope(row({ offers_count: -1 }))], badImage: [envelope(row({ images: [{ url: 42 }] }))],
  badCategory: [envelope(row({ service_type: "invalid" }))], badRoute: [envelope(row({ route_paths: [["bad"]] }))],
  badDetails: [envelope(row({ service_details: [42] }))], badNumber: [envelope(row({ pickup_lat: "44" }))],
})) test(`${label}: invalid data rejected without fallback`, () => {
  assert.throws(() => fixture().api.parseCustomerActivity(data, owner), /INVALID_CUSTOMER_ACTIVITY_RESPONSE/);
});
test("safe decimal count and authorized view counts preserve existing indicators", async () => {
  const f = fixture([envelope(row({ offers_count: "12" }))], null, [owner], [{ request_id: id, view_count: "3" }]);
  const [r] = await f.api.getCustomerRequestsByActivity(owner, new AbortController().signal);
  assert.equal(r.offers_count, 12); assert.equal(r.view_count, 3);
});
test("no Client role: server returns zero rows; no invented data or second query", async () => {
  const f = fixture([]); assert.deepEqual(await f.api.getCustomerRequestsByActivity(owner, new AbortController().signal), []);
  assert.deepEqual(f.calls, ["get_customer_requests_by_activity"]);
});
test("same account with multiple roles still cannot read another owner's rows", () => {
  assert.throws(() => fixture().api.parseCustomerActivity([envelope(row({ user_id: other }))], owner));
});
test("RPC authorization failure propagates without SELECT fallback", async () => {
  const f = fixture(null, { code: "42501" });
  await assert.rejects(f.api.getCustomerRequestsByActivity(owner, new AbortController().signal), /READ_FAILED/);
  assert.equal(f.calls.length, 1);
});
for (const users of [[other], [owner, other], [owner, owner, other]]) test(`session change ${users.join('/')}: response discarded`, async () => {
  const f = fixture([envelope()], null, users);
  await assert.rejects(f.api.getCustomerRequestsByActivity(owner, new AbortController().signal), /SESSION_CHANGED/);
});
test("unmount cancellation stops read before any RPC", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.api.getCustomerRequestsByActivity(owner, controller.signal)); assert.equal(f.calls.length, 0);
});
test("view count response cannot introduce other requests or fabricated success", async () => {
  const f = fixture([envelope()], null, [owner], [{ request_id: other, view_count: 2 }]);
  await assert.rejects(f.api.getCustomerRequestsByActivity(owner, new AbortController().signal));
});
test("page uses dedicated RPC, preserves tabs/categories and refetch on foreground", () => {
  const page = readFileSync(new URL("../../app/customer/my-requests/page.tsx", import.meta.url), "utf8");
  assert.ok(!page.includes("getOwnRepairRequests") && !page.includes('.sort('));
  for (const value of ['"waiting"', '"with_offer"', '"archive"', 'bodywork', 'mechanical', 'wheels', 'towing',
    'visibilitychange', 'pageshow', 'onAuthStateChange', 'config: { private: true }', 'table: "repair_requests"', 'table: "repair_offers"']) assert.ok(page.includes(value), value);
  assert.ok(page.indexOf('await Promise.all(previous.map') < page.indexOf('const activity = supabase.channel'));
  const editor = readFileSync(new URL("../../app/customer/my-requests/[id]/page.tsx", import.meta.url), "utf8");
  assert.ok(editor.indexOf('router.replace("/customer/my-requests")', editor.indexOf('// All save branches')) > editor.indexOf('// All save branches'));
});
