import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Create = typeof import("./repair-offers").createRepairOffer;
type Input = Parameters<Create>[0];
type Result = { data: unknown; error: unknown };
const offerId = "a0000000-0000-4000-8000-000000000001";
const input: Input = {
  requestId: "b0000000-0000-4000-8000-000000000002",
  workshopUserId: "c0000000-0000-4000-8000-000000000003",
  price: "450", days: "2 zile", message: "Mesaj sintetic", workshopName: "Service sintetic",
  availableDate: "2026-11-10", availableTime: "10:30",
};
const source = readFileSync(new URL("./repair-offers.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const versionApi: Record<string, unknown> = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../offer-read-version.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(versionApi);

function fixture(reply: () => Promise<Result> = async () => ({ data: offerId, error: null })) {
  const calls: { name: string; args: unknown }[] = [];
  let tableCalls = 0;
  const supabase = {
    rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return reply(); },
    from: () => { tableCalls++; throw new Error("Direct table access is forbidden in creation"); },
  };
  const exported: { createRepairOffer?: Create } = {};
  // Load the actual module with only an offline client. No SDK/network import.
  new Function("require", "exports", js)((name: string) => {
    if (name === "@/lib/offer-read-version") return versionApi;
    assert.equal(name, "@/lib/supabase/client");
    return { supabase };
  }, exported);
  return { create: exported.createRepairOffer!, calls, tableCalls: () => tableCalls };
}

function readFixture(error: { code: string; message: string } | null = null) {
  const selections: string[] = [], owners: unknown[] = [];
  const row = { id: offerId, request_id: input.requestId, status: "accepted", read_state_version: "9007199254740993" };
  const supabase = { from: (table: string) => {
    let projection = "";
    const query = {
      select: (value: string) => { projection = value; if (table === "repair_offers") selections.push(value); return query; },
      eq: (column: string, value: unknown) => { assert.equal(column, "user_id"); owners.push(value); return query; },
      in: (column: string, values: string[]) => { assert.equal(column, "request_id"); assert.deepEqual(values, [input.requestId]); return query; },
      order: () => query,
      overrideTypes: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === "repair_requests"
        ? { data: [{ id: input.requestId }], error: null }
        : error && projection.includes("::text") ? { data: null, error }
        : { data: [projection.includes("::text") ? row : { ...row, read_state_version: undefined }], error: null }).then(resolve),
    }; return query;
  } };
  const api: Record<string, unknown> = {};
  new Function("require", "exports", js)((name: string) => name === "@/lib/offer-read-version" ? versionApi : { supabase }, api);
  return { selections, owners, load: api.getOffersForCustomerRequests as typeof import("./repair-offers").getOffersForCustomerRequests };
}

test("accepted customer job offers load an exact bigint version in the same authorized query", async () => {
  const f = readFixture(); const rows = await f.load("synthetic-owner", true);
  assert.deepEqual(f.selections, ["*,read_state_version::text"]);
  assert.deepEqual(f.owners, ["synthetic-owner"]);
  assert.equal(rows[0].status, "accepted");
  assert.equal(rows[0].read_state_version, "9007199254740993");
});
test("other callers retain their existing offer projection", async () => {
  const f = readFixture(); await f.load("synthetic-owner");
  assert.deepEqual(f.selections, ["*"]);
});
test("missing version column preserves job loading but cannot produce a read observation", async () => {
  const f = readFixture({ code: "42703", message: "column read_state_version does not exist" });
  const rows = await f.load("synthetic-owner", true);
  assert.deepEqual(f.selections, ["*,read_state_version::text", "*"]);
  const observe = versionApi.offerReadObservation as typeof import("../offer-read-version").offerReadObservation;
  assert.equal(observe(input.workshopUserId, "customer", offerId, rows[0].read_state_version), null);
});
test("denied versioned job query has no fallback or receipt", async () => {
  const error = { code: "42501", message: "denied" }; const f = readFixture(error);
  await assert.rejects(f.load("synthetic-owner", true), value => value === error);
  assert.deepEqual(f.selections, ["*,read_state_version::text"]);
});

test("one atomic RPC maps all fields and returns UUID without subsequent SELECT", async () => {
  const f = fixture();
  assert.equal(await f.create(input), offerId);
  assert.deepEqual(f.calls, [{ name: "create_repair_offer_with_appointment", args: {
    p_request_id: input.requestId, p_price: input.price, p_days: input.days,
    p_message: input.message, p_workshop_name: input.workshopName,
    p_available_date: input.availableDate, p_available_time: input.availableTime,
    p_handover_method: "customer_dropoff", p_pickup_address: null,
  } }]);
  assert.equal(f.tableCalls(), 0);
});

for (const empty of [undefined, ""]) test(`optional date/time ${String(empty)} become SQL null`, async () => {
  const f = fixture();
  await f.create({ ...input, availableDate: empty, availableTime: empty });
  assert.equal((f.calls[0].args as Record<string, unknown>).p_available_date, null);
  assert.equal((f.calls[0].args as Record<string, unknown>).p_available_time, null);
});

for (const [method, address, expected] of [
  ["workshop_pickup", "  Adresă sintetică  ", "Adresă sintetică"],
  ["workshop_pickup", "   ", null],
  ["workshop_pickup", undefined, null],
  ["customer_dropoff", "Adresă ignorată", null],
  [undefined, "Adresă ignorată", null],
] as const) test(`handover ${method}, address ${JSON.stringify(address)}`, async () => {
  const f = fixture();
  await f.create({ ...input, handoverMethod: method, pickupAddress: address });
  const args = f.calls[0].args as Record<string, unknown>;
  assert.equal(args.p_handover_method, method || "customer_dropoff");
  assert.equal(args.p_pickup_address, expected);
});

test("caller workshop identity never becomes an RPC argument", async () => {
  const f = fixture();
  await f.create(input);
  await f.create({ ...input, workshopUserId: "different-untrusted-identity" });
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.ok(!JSON.stringify(f.calls).includes(input.workshopUserId));
});

test("Towing preserves transport duration and pickup address without category-specific conversion", async () => {
  const f = fixture();
  await f.create({ ...input, days: "1 oră 30 minute", handoverMethod: "workshop_pickup",
    pickupAddress: "  Adresă sintetică, Oraș sintetic  ", message: "" });
  const args = f.calls[0].args as Record<string, unknown>;
  assert.equal(args.p_days, "1 oră 30 minute");
  assert.equal(args.p_handover_method, "workshop_pickup");
  assert.equal(args.p_pickup_address, "Adresă sintetică, Oraș sintetic");
  assert.equal(args.p_message, "");
  assert.equal(f.calls.length, 1);
});

test("uppercase UUID is accepted and returned unchanged", async () => {
  const f = fixture(async () => ({ data: offerId.toUpperCase(), error: null }));
  assert.equal(await f.create(input), offerId.toUpperCase());
});

for (const value of [null, undefined, "", "not-a-uuid", ` ${offerId}`, `${offerId}\n`, [], { id: offerId }, 42]) {
  test(`invalid RPC result ${JSON.stringify(value)}: no success, retry or compensation`, async () => {
    const f = fixture(async () => ({ data: value, error: null }));
    await assert.rejects(f.create(input), /Verifică lista ofertelor/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.tableCalls(), 0);
  });
}

for (const code of ["42501", "23505", "23514", "55P03", "57014"]) test(`RPC error ${code} preserved without retry/DELETE`, async () => {
  const error = { code, message: "Synthetic database error", details: "synthetic" };
  const f = fixture(async () => ({ data: offerId, error }));
  await assert.rejects(f.create(input), caught => caught === error);
  assert.equal(f.calls.length, 1);
  assert.equal(f.tableCalls(), 0);
});

test("transport exception propagates unchanged without retry or compensation", async () => {
  const error = new Error("Synthetic transport failure");
  const f = fixture(async () => { throw error; });
  await assert.rejects(f.create(input), caught => caught === error);
  assert.equal(f.calls.length, 1);
  assert.equal(f.tableCalls(), 0);
});

test("caller cannot continue before atomic RPC resolves", async () => {
  let resolve!: (result: Result) => void;
  const f = fixture(() => new Promise(r => { resolve = r; }));
  let continued = false;
  const submitted = f.create(input).then(() => { continued = true; });
  await Promise.resolve();
  assert.equal(continued, false);
  resolve({ data: offerId, error: null });
  await submitted;
  assert.equal(continued, true);
});

test("concurrent calls keep their own results without shared state", async () => {
  const resolvers: ((result: Result) => void)[] = [];
  const f = fixture(() => new Promise(r => { resolvers.push(r); }));
  const a = f.create(input), b = f.create({ ...input, requestId: offerId });
  resolvers[1]({ data: input.requestId, error: null });
  resolvers[0]({ data: offerId, error: null });
  assert.deepEqual(await Promise.all([a, b]), [offerId, input.requestId]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.tableCalls(), 0);
});

for (const path of ["../../app/workshops/[id]/page.tsx", "../../app/workshops/[id]/offer/page.tsx"]) {
  test(`${path}: existing caller awaits success and does not consume an offer row`, () => {
    const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let count = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === "createRepairOffer") {
        count++;
        assert.ok(ts.isAwaitExpression(node.parent));
        assert.ok(ts.isExpressionStatement(node.parent.parent));
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.equal(count, 1);
  });
}
