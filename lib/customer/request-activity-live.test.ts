import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error TS5097: source extension for offline Node tests.
import { createCustomerActivityLive, isCustomerActivityInvalidation } from "./request-activity-live.ts";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const reads: { owner: string; signal: AbortSignal; resolve(rows: string[]): void; reject(error: Error): void }[] = [];
  const states: { rows: string[]; loading: boolean; error: boolean }[] = [];
  const connections: { owner: string; stopped: boolean; events: { invalidate(): void; status(v: string): void } }[] = [];
  const live = createCustomerActivityLive<string>({
    read: (owner, signal) => new Promise((resolve, reject) => { reads.push({ owner, signal, resolve, reject }); }),
    publish: (rows, loading, error) => states.push({ rows, loading, error }),
    connect: (owner, events) => { const c = { owner, stopped: false, events }; connections.push(c); return () => { c.stopped = true; }; },
  });
  return { live, reads, states, connections };
}
test("strict constant invalidation payload; never accept local order/counters", () => {
  assert.equal(isCustomerActivityInvalidation({ v: 1 }), true);
  for (const p of [null, [], { v: 2 }, { v: 1, order: [] }, { v: "1" }]) assert.equal(isCustomerActivityInvalidation(p), false);
});
test("initial read and SUBSCRIBED close the read/subscription gap", async () => {
  const f = fixture(); f.live.session("a:token", "a"); await tick();
  f.connections[0].events.status("SUBSCRIBED"); f.reads[0].resolve(["old"]); await tick();
  assert.ok(!f.states.some(s => s.rows.includes("old")));
  f.reads[1].resolve(["new", "old"]); await tick();
  assert.deepEqual(f.states.at(-1)?.rows, ["new", "old"]); f.live.dispose();
});
test("concurrent invalidations coalesce and late snapshots cannot overwrite newer activity", async () => {
  const f = fixture(); f.live.session("a", "a"); await tick();
  for (let i = 0; i < 10; i++) f.connections[0].events.invalidate();
  f.reads[0].resolve(["stale"]); await tick(); assert.equal(f.reads.length, 2);
  f.reads[1].resolve(["latest"]); await tick(); assert.deepEqual(f.states.at(-1)?.rows, ["latest"]); f.live.dispose();
});
test("account/token change clears context, aborts old reads and ignores old channel callbacks", async () => {
  const f = fixture(); f.live.session("a:1", "a"); await tick();
  f.live.session("b:1", "b"); await tick();
  assert.equal(f.reads[0].signal.aborted, true); assert.equal(f.connections[0].stopped, true);
  f.connections[0].events.invalidate(); f.reads[0].resolve(["private-a"]); f.reads[1].resolve(["b"]); await tick();
  assert.ok(!f.states.some(s => s.rows.includes("private-a"))); assert.deepEqual(f.states.at(-1)?.rows, ["b"]);
  f.live.session("b:2", "b"); await tick(); assert.deepEqual(f.states.at(-1)?.rows, []);
  f.reads[2].resolve(["fresh-b"]); await tick(); f.live.dispose();
});
test("signout/unmount suppress all late work without reconnecting", async () => {
  const f = fixture(); f.live.session("a", "a"); await tick(); f.live.session(null, null);
  f.reads[0].resolve(["a"]); await tick(); assert.deepEqual(f.states.at(-1)?.rows, []);
  f.live.dispose(); const n = f.states.length; f.connections[0].events.status("CLOSED"); f.live.foreground(); await tick();
  assert.equal(f.states.length, n); assert.equal(f.connections.length, 1);
});
test("CLOSED creates a fresh channel once; foreground recovers a further closure without polling", async () => {
  const f = fixture(); f.live.session("a", "a"); await tick(); f.reads[0].resolve([]); await tick();
  f.connections[0].events.status("CLOSED"); f.connections[0].events.status("SUBSCRIBED"); await tick();
  assert.equal(f.connections[0].stopped, true); assert.equal(f.connections.length, 2);
  f.connections[1].events.status("CLOSED"); await tick(); assert.equal(f.connections.length, 2);
  f.live.foreground(); await tick(); assert.equal(f.connections.length, 3);
  for (const r of f.reads) r.resolve([]); await tick(); f.live.dispose();
});
test("two devices and refresh obtain server ordering independently after invalidation", async () => {
  const devices = [fixture(), fixture()];
  for (const f of devices) { f.live.session("a", "a"); await tick(); f.reads[0].resolve(["old", "edited"]); }
  await tick();
  for (const f of devices) { f.connections[0].events.invalidate(); await tick(); f.reads[1].resolve(["edited", "old"]); }
  await tick();
  for (const f of devices) { assert.deepEqual(f.states.at(-1)?.rows, ["edited", "old"]); f.live.foreground(); await tick(); f.reads[2].resolve(["edited", "old"]); await tick(); f.live.dispose(); }
});
test("RPC error never publishes fabricated success or optimistic reorder", async () => {
  const f = fixture(); f.live.session("a", "a"); await tick(); f.reads[0].resolve(["old", "other"]); await tick();
  f.live.invalidate(); await tick(); f.reads[1].reject(new Error("42501")); await tick();
  assert.deepEqual(f.states.at(-1), { rows: [], loading: false, error: true }); f.live.dispose();
});
