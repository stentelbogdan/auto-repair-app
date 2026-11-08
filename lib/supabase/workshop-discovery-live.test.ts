import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
// @ts-expect-error TS5097: local Node test runner.
import { createWorkshopDiscoveryRefresh, isWorkshopDiscoveryInvalidation } from "./workshop-discovery-live.ts";
import type { WorkshopDiscoveryCounts } from "./workshop-discovery";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const zero = { bodywork: 0, mechanical: 0, wheels: 0, towing: 0 };
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const reads: { signal: AbortSignal; resolve(value: WorkshopDiscoveryCounts): void; reject(e: Error): void }[] = [];
  const states: { counts: WorkshopDiscoveryCounts | null; error: boolean }[] = [];
  const live = createWorkshopDiscoveryRefresh({
    read: signal => new Promise((resolve, reject) => reads.push({ signal, resolve, reject })),
    publish: (counts, error) => states.push({ counts, error }),
  });
  t.after(() => live.dispose());
  return { live, reads, states, flush: async () => { t.mock.timers.tick(200); await tick(); } };
}

test("constant payload accepts no identifiers, category or local count", () => {
  assert.equal(isWorkshopDiscoveryInvalidation({ v: 1 }), true);
  for (const value of [null, [], {}, { v: "1" }, { v: 2 }, { v: 1, request_id: "x" }, { v: 1, count: 4 }]) {
    assert.equal(isWorkshopDiscoveryInvalidation(value), false);
  }
});
test("managed technical UUID is accepted and only invalidates the authorized count reader", async t => {
  const f = fixture(t);
  const payload = { v: 1, id: "b8a9a472-5057-4c4e-a380-b6d7279c2a12" };
  const accepted = isWorkshopDiscoveryInvalidation(payload);
  if (accepted) f.live.invalidate();
  await f.flush();
  assert.equal(accepted, true);
  assert.equal(f.reads.length, 1);
  assert.equal(f.states.length, 0, "UUID is not a number or acknowledgement to render");
  f.reads[0].resolve({ ...zero, mechanical: 2 }); await tick();
  assert.equal(f.states.at(-1)?.counts?.mechanical, 2);
});
test("managed metadata must be a UUID v4 and cannot carry extra business data", () => {
  const id = "b8a9a472-5057-4c4e-a380-b6d7279c2a12";
  for (const value of [null, undefined, 42, "", "request-id", "00000000-0000-0000-0000-000000000000"]) {
    assert.equal(isWorkshopDiscoveryInvalidation({ v: 1, id: value }), false);
  }
  for (const extra of [{ request_id: id }, { customer_id: id }, { count: 1 }, { location: [1,2] }]) {
    assert.equal(isWorkshopDiscoveryInvalidation({ v: 1, id, ...extra }), false);
  }
  assert.equal(isWorkshopDiscoveryInvalidation({ v: 1, id: id.toUpperCase() }), true);
});
for (const category of ["bodywork", "mechanical", "wheels", "towing"] as const) {
  test(`${category}: new eligible request / closure use RPC snapshot, never local increment`, async t => {
    const f = fixture(t); f.live.invalidate(); await f.flush(); f.reads[0].resolve(zero); await tick();
    f.live.invalidate(); await f.flush(); assert.deepEqual(f.states.at(-1)?.counts, zero);
    f.reads[1].resolve({ ...zero, [category]: 1 }); await tick();
    assert.equal(f.states.at(-1)?.counts?.[category], 1);
    f.live.invalidate(); await f.flush(); f.reads[2].resolve(zero); await tick();
    assert.equal(f.states.at(-1)?.counts?.[category], 0);
  });
}
test("burst before a read and duplicate events during it coalesce into one trailing read", async t => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) f.live.invalidate();
  await f.flush(); assert.equal(f.reads.length, 1);
  for (let i = 0; i < 25; i++) f.live.invalidate();
  await f.flush(); assert.equal(f.reads.length, 1);
  f.reads[0].resolve({ ...zero, mechanical: 8 }); await tick();
  assert.equal(f.states.length, 0, "late snapshot invalidated by a newer event");
  await f.flush(); f.reads[1].resolve({ ...zero, mechanical: 1 }); await tick();
  assert.equal(f.states.at(-1)?.counts?.mechanical, 1);
  await f.flush(); assert.equal(f.reads.length, 2, "no polling");
});
test("failure/refusal is unavailable, not zero; reconnect can recover", async t => {
  const f = fixture(t); f.live.invalidate(); await f.flush(); f.reads[0].reject(new Error("42501")); await tick();
  assert.deepEqual(f.states.at(-1), { counts: null, error: true });
  f.live.invalidate(); await f.flush(); f.reads[1].resolve(zero); await tick();
  assert.deepEqual(f.states.at(-1), { counts: zero, error: false });
});
test("unmount/account change aborts pending request and ignores its response or further events", async t => {
  const f = fixture(t); f.live.invalidate(); await f.flush(); f.live.dispose();
  assert.equal(f.reads[0].signal.aborted, true);
  f.reads[0].resolve({ ...zero, bodywork: 9 }); f.live.invalidate(); await tick(); await f.flush();
  assert.equal(f.states.length, 0); assert.equal(f.reads.length, 1);
});
test("disposing before debounce prevents the network call", async t => {
  const f = fixture(t); f.live.invalidate(); f.live.dispose(); await f.flush(); assert.equal(f.reads.length, 0);
});
test("request timeout aborts transport and a later result cannot be published as success", async t => {
  const f = fixture(t); f.live.invalidate(); await f.flush(); t.mock.timers.tick(12_000);
  assert.equal(f.reads[0].signal.aborted, true); f.reads[0].resolve(zero); await tick();
  assert.deepEqual(f.states.at(-1), { counts: null, error: true });
});
test("two devices, foreground and SUBSCRIBED each reconcile their authorized server snapshot", async t => {
  const f = fixture(t);
  const otherStates: WorkshopDiscoveryCounts[] = [];
  const other = createWorkshopDiscoveryRefresh({ read: async () => ({ ...zero, wheels: 2 }),
    publish: c => { if (c) otherStates.push(c); } });
  t.after(() => other.dispose());
  f.live.invalidate(); other.invalidate(); await f.flush(); f.reads[0].resolve({ ...zero, wheels: 2 }); await tick();
  assert.deepEqual(f.states.at(-1)?.counts, otherStates.at(-1));
  for (let i = 0; i < 2; i++) { f.live.invalidate(); other.invalidate(); await f.flush(); f.reads[i+1].resolve({ ...zero, wheels: 2 }); await tick(); }
  assert.equal(f.reads.length, 3); assert.equal(otherStates.length, 3);
});

function rpcFixture(reply: { data: unknown; error: unknown }) {
  let abortedWith: AbortSignal | undefined;
  const supabase = { rpc(name: string, args: unknown) {
    assert.equal(name, "get_workshop_discovery_counts");
    assert.deepEqual(args, { p_radius_override_mode: "default", p_radius_override_km: null });
    const query = { abortSignal: (signal: AbortSignal) => { abortedWith = signal; return query; },
      then: (resolve: (value: typeof reply) => unknown) => Promise.resolve(reply).then(resolve) };
    return query;
  } };
  const source = readFileSync(new URL("./workshop-discovery.ts", import.meta.url), "utf8");
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)
    (() => ({ supabase }), exports);
  return { read: exports.fetchWorkshopDiscoveryCounts as (signal?: AbortSignal) => Promise<WorkshopDiscoveryCounts>, signal: () => abortedWith };
}
const rows = Object.keys(zero).map(service_type => ({ service_type, request_count: "0" }));
test("authorized RPC reader accepts four categories, exact bigint text and optional cancellation", async () => {
  const f = rpcFixture({ data: rows.map(row => ({ ...row, request_count: "3" })), error: null });
  const signal = new AbortController().signal;
  assert.deepEqual(await f.read(signal), { bodywork: 3, mechanical: 3, wheels: 3, towing: 3 });
  assert.equal(f.signal(), signal);
});
for (const [label, data] of Object.entries({ absent: null, incomplete: [], duplicate: [...rows.slice(0,3),rows[0]],
  nullCount: rows.map(r => ({ ...r, request_count: null })), empty: rows.map(r => ({ ...r, request_count: "" })),
  fractional: rows.map(r => ({ ...r, request_count: 0.5 })), unsafe: rows.map(r => ({ ...r, request_count: "9007199254740993" })) })) {
  test(`malformed ${label} RPC response is not a successful zero`, async () => {
    await assert.rejects(rpcFixture({ data, error: null }).read());
  });
}
test("RPC denial cannot fall back to repair_requests SELECT", async () => {
  await assert.rejects(rpcFixture({ data: rows, error: new Error("42501") }).read());
});
