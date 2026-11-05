import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), request = id(2);
const compile = (s: string) => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
type Row = Record<string, unknown>; // synthetic database rows only
function fixture(category = "bodywork") {
  const tables: Record<string, Row[]> = {
    repair_requests: [{ id: request, user_id: user, status: "open", service_type: category, accepted_offer_id: null }],
    repair_offers: [3, 4, 5].map((n) => ({ id: id(n), request_id: request, status: "pending", customer_read_at: null, read_state_version: "1", created_at: `2026-11-05T12:00:0${n}.000000Z` })),
    notifications: [],
  };
  const calls: { table: string; filters: unknown[] }[] = [], rpcCalls: unknown[] = [];
  const state = { user, deny: false, noWrite: false, beforeRpc: undefined as (() => void) | undefined, afterRead: undefined as (() => void) | undefined };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }) },
    rpc: async (name: string, args: { p_offer_ids: string[]; p_expected_versions: string[] }) => {
      rpcCalls.push({ name, args }); state.beforeRpc?.(); let changed = 0;
      if (!state.noWrite) for (const row of tables.repair_offers) {
        const i = args.p_offer_ids.indexOf(String(row.id));
        if (i >= 0 && row.customer_read_at === null && row.read_state_version === args.p_expected_versions[i]) {
          row.customer_read_at = "2026-11-05T13:00:00Z"; row.read_state_version = String(BigInt(String(row.read_state_version)) + BigInt(1)); changed++;
        }
      }
      return { data: changed, error: null };
    },
    from: (table: string) => {
      const filters: [string, string, unknown][] = [], orders: string[] = [];
      let single = false;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(["eq", key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push(["eq", key, value]); return query; },
        in: (key: string, value: unknown) => { filters.push(["in", key, value]); return query; },
        order: (key: string) => { orders.push(key); return query; }, limit: () => query,
        overrideTypes: () => query, maybeSingle: () => { single = true; return query; },
        then: (resolve: (v: unknown) => void) => {
          calls.push({ table, filters });
          let rows = tables[table].filter(row => filters.every(([op, k, v]) => k === "repair_requests.user_id" ? v === user : op === "in" ? (v as unknown[]).includes(row[k]) : row[k] === v));
          rows = [...rows].sort((a, b) => { for (const k of orders) { const d = String(b[k]).localeCompare(String(a[k])); if (d) return d; } return 0; });
          state.afterRead?.();
          resolve({ data: single ? rows[0] ?? null : rows.map(row => ({ ...row })), error: state.deny ? { code: "42501" } : null });
        },
      }; return query;
    },
  };
  const versions: Record<string, unknown> = {}, receipts: Record<string, unknown> = {}, navigation: Record<string, unknown> = {};
  new Function("exports", compile(read("./offer-read-version.ts")))(versions);
  new Function("require", "exports", compile(read("./notification-read-receipts.ts")))((name: string) => name.includes("offer-read-version") ? versions : { supabase }, receipts);
  new Function("require", "exports", compile(read("./customer-offer-badge-navigation.ts")))((name: string) => name.includes("appointment-navigation")
    ? { getAppointmentProposalDestination: async (n: Row, role: string, owner: string) => { assert.equal(role, "customer"); assert.equal(owner, user); return `/offers?focusOffer=${n.offer_id}`; } }
    : { supabase }, navigation);
  const observation = (row: Row) => ({ userId: user, role: "customer" as const, offerId: String(row.id), version: String(row.read_state_version) });
  return { tables, state, calls, rpcCalls, observation,
    destination: () => (navigation.getCustomerOfferBadgeDestination as typeof import("./customer-offer-badge-navigation").getCustomerOfferBadgeDestination)(user),
    confirm: (rows: ReturnType<typeof observation>[]) => (receipts.confirmOfferRead as typeof import("./notification-read-receipts").confirmOfferRead)("customer", user, rows),
    unread: () => tables.repair_offers.filter(row => row.customer_read_at === null).length };
}
for (const category of ["bodywork", "mechanical", "wheels", "towing"]) test(`${category}: 3 → 2 → 1 → 0; three offers of the same request remain separate`, async () => {
  const f = fixture(category); const counts = [f.unread()];
  for (const n of [5, 4, 3]) {
    const url = await f.destination(); assert.ok(url.includes(`focusOffer=${id(n)}`)); assert.ok(url.includes(`category=${category}`));
    assert.ok(url.includes(`focusRequest=${request}`));
    const row = f.tables.repair_offers.find(row => row.id === id(n))!;
    const before = { ...row }; const result = await f.confirm([f.observation(row)]);
    assert.deepEqual(result.confirmedIds, [id(n)]); counts.push(f.unread());
    assert.equal(row.status, before.status); assert.equal(row.created_at, before.created_at);
    assert.equal(f.tables.repair_requests[0].status, "open");
  }
  assert.deepEqual(counts, [3, 2, 1, 0]); assert.equal(await f.destination(), "/offers");
  assert.equal(f.rpcCalls.length, 3);
});
test("latest timestamp wins across proposal notifications and new offers, not proposal priority", async () => {
  const f = fixture();
  const note = { id: id(8), type: "workshop_proposed_appointment", recipient_id: user, recipient_role: "customer", read_at: null, offer_id: id(3), created_at: "2026-11-05T12:00:05.000001Z" };
  f.tables.notifications.push(note);
  assert.equal(await f.destination(), `/offers?focusOffer=${id(3)}`);
  note.created_at = "2026-11-05T12:00:04.999999Z";
  assert.ok((await f.destination()).includes(`focusOffer=${id(5)}`));
  assert.equal(f.rpcCalls.length, 0); assert.equal(note.read_at, null);
});
test("equal timestamps have deterministic offer-ID ordering; no receipt during navigation", async () => {
  const f = fixture(); f.tables.repair_offers.forEach(row => { row.created_at = "2026-11-05T12:00:00Z"; });
  assert.ok((await f.destination()).includes(`focusOffer=${id(5)}`)); assert.equal(f.rpcCalls.length, 0);
});
test("new version during viewing stays unread; zero and partial counts require per-ID readback", async () => {
  const f = fixture(); const observations = f.tables.repair_offers.map(f.observation);
  f.state.beforeRpc = () => { f.tables.repair_offers[2].read_state_version = "2"; };
  const result = await f.confirm(observations);
  assert.deepEqual(result.confirmedIds, [id(3), id(4)]); assert.deepEqual(result.staleIds, [id(5)]);
  assert.equal(f.unread(), 1); assert.ok((await f.destination()).includes(`focusOffer=${id(5)}`));
  f.state.beforeRpc = undefined;
  assert.deepEqual((await f.confirm([observations[2]])).confirmedIds, []);
  assert.equal(f.unread(), 1);
});
test("two devices confirm the same observed version, then a new version reactivates badge", async () => {
  const f = fixture(); const row = f.tables.repair_offers[2]; const a = f.observation(row), b = f.observation(row);
  assert.deepEqual((await f.confirm([a])).confirmedIds, [row.id]);
  assert.deepEqual((await f.confirm([b])).confirmedIds, [row.id]);
  row.customer_read_at = null; row.read_state_version = "3";
  assert.deepEqual((await f.confirm([b])).confirmedIds, []); assert.equal(f.unread(), 3);
  assert.ok((await f.destination()).includes(`focusOffer=${row.id}`));
});
test("dual-role notifications are isolated and unauthorized reads never navigate", async () => {
  const f = fixture(); f.tables.notifications.push({ type: "workshop_proposed_appointment", recipient_id: user, recipient_role: "workshop", read_at: null, created_at: "2027-01-01", offer_id: id(3) });
  assert.ok((await f.destination()).includes(`focusOffer=${id(5)}`));
  f.state.deny = true; await assert.rejects(f.destination()); assert.equal(f.rpcCalls.length, 0);
});
test("session changes while loading cannot return a destination", async () => {
  const f = fixture(); f.state.afterRead = () => { f.state.user = id(20); };
  await assert.rejects(f.destination(), /SESSION_CHANGED/);
});
test("accepted winning offer uses its existing job context, never an invisible pending-offer card", async () => {
  const f = fixture(); f.tables.repair_requests[0].status = "matched"; f.tables.repair_requests[0].accepted_offer_id = id(5);
  f.tables.repair_offers[2].status = "accepted";
  assert.ok((await f.destination()).startsWith('/customer/my-jobs?tab=scheduled&'));
});
