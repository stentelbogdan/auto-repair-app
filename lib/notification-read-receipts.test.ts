import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type API = typeof import("./notification-read-receipts");
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), request = id(2), offer = id(3), appointment = id(4);
const timestamp = "2026-11-03T12:00:00Z";
type Row = Record<string, unknown>;
const notification = (n: number, extra: Row = {}) => ({ id: id(n), type: "workshop_proposed_appointment", recipient_id: user,
  recipient_role: "customer", request_id: request, offer_id: offer, appointment_id: appointment, read_at: null, ...extra });
const observed = (role: "customer" | "workshop" = "customer", version = "1", offerId = offer) => ({ userId: user, role, offerId, version });
const source = readFileSync(new URL("./notification-read-receipts.ts", import.meta.url), "utf8");
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const rows: Row[] = [notification(5)];
  const offers: Row[] = [{ id: offer, customer_read_at: null, workshop_read_at: null, workshop_user_id: user, read_state_version: "1" }];
  const calls: { table: string; action: string; filters: [string, string, unknown][] }[] = [];
  const rpcCalls: { name: string; args: { p_offer_ids: string[]; p_expected_versions: string[] } }[] = [];
  const state: { user: string | null; rpcValue: unknown; rpcError: unknown; readError: boolean; writeError: boolean; noWrite: boolean; beforeWrite?: () => void; afterRpc?: () => void } = {
    user, rpcValue: 1, rpcError: null, readError: false, writeError: false, noWrite: false,
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null }, error: null }) },
    rpc: (name: string, args: { p_offer_ids: string[]; p_expected_versions: string[] }) => {
      const execute = async () => {
      rpcCalls.push({ name, args });
      if (!state.rpcError && !state.noWrite) for (const row of offers) if (args.p_offer_ids.includes(String(row.id)) && args.p_expected_versions[args.p_offer_ids.indexOf(String(row.id))] === row.read_state_version) {
        row[name.includes("customer") ? "customer_read_at" : "workshop_read_at"] = timestamp;
        row.read_state_version = String(BigInt(String(row.read_state_version)) + BigInt(1));
      }
      state.afterRpc?.();
      return { data: state.rpcValue, error: state.rpcError };
      };
      const call = { abortSignal: (signal: AbortSignal) => { assert.ok(signal instanceof AbortSignal); return call; }, then: (resolve: (value: unknown) => void) => execute().then(resolve) };
      return call;
    },
    from: (table: string) => {
      const filters: [string, string, unknown][] = [];
      let action = "select"; let patch: Row = {};
      const query = {
        select: () => query,
        overrideTypes: () => query,
        abortSignal: () => query,
        update: (value: Row) => { action = "update"; patch = value; return query; },
        eq: (column: string, value: unknown) => { filters.push(["eq", column, value]); return query; },
        is: (column: string, value: unknown) => { filters.push(["is", column, value]); return query; },
        in: (column: string, value: unknown) => { filters.push(["in", column, value]); return query; },
        then: (resolve: (value: unknown) => void) => {
          calls.push({ table, action, filters });
          if (action === "update") state.beforeWrite?.();
          const error = action === "update" ? state.writeError : state.readError;
          const selected = (table === "notifications" ? rows : offers).filter(row => filters.every(([op, key, value]) => {
            if (key === "repair_requests.user_id") return value === user;
            return op === "in" ? (value as unknown[]).includes(row[key]) : row[key] === value;
          }));
          if (!error && action === "update" && !state.noWrite) for (const row of selected) Object.assign(row, patch);
          resolve({ data: error ? null : selected.map(row => ({ ...row })), error: error ? { code: "42501" } : null });
        },
      };
      return query;
    },
  };
  const versions: Record<string, unknown> = {};
  new Function("exports", compile(readFileSync(new URL("./offer-read-version.ts", import.meta.url), "utf8")))(versions);
  const api: Record<string, unknown> = {};
  new Function("require", "exports", compile(source))((name: string) => {
    if (name === "@/lib/offer-read-version") return versions;
    assert.equal(name, "@/lib/supabase/client"); return { supabase };
  }, api);
  return { api: api as API, rows, offers, calls, rpcCalls, state };
}
for (const value of [0, 1, "0", "1", "2", 2]) test(`bigint ${JSON.stringify(value)} validated`, () => {
  assert.equal(fixture().api.readCount(value, 2), Number(value));
});
for (const value of [null, undefined, true, {}, [], "", "01", "1.0", "-1", "9007199254740993", 1.5, -1, 3, Infinity, NaN]) {
  test(`invalid bigint ${String(value)} rejected`, () => assert.throws(() => fixture().api.readCount(value, 2)));
}
test("select exact displayed context; other request/offer/appointment and type remain unseen", async () => {
  const f = fixture(); f.rows.push(notification(6, { request_id: id(20) }), notification(7, { offer_id: id(21) }),
    notification(8, { appointment_id: id(22) }), notification(9, { type: "message" }));
  const snapshot = await f.api.captureNotificationSnapshot(user, "customer");
  assert.deepEqual(f.api.displayedNotificationIds(snapshot, { requestId: request, offerId: offer, appointmentId: appointment }, ["workshop_proposed_appointment"]), [id(5)]);
});
test("notification arriving during acknowledgment is not in immutable snapshot or UPDATE IDs", async () => {
  const f = fixture(); const snapshot = await f.api.captureNotificationSnapshot(user, "customer");
  f.state.beforeWrite = () => f.rows.push(notification(6));
  assert.deepEqual(await f.api.confirmNotificationRead(snapshot, [id(5)]), [id(5)]);
  assert.equal(f.rows[1].read_at, null);
  assert.equal(snapshot.rows.length, 1);
  const write = f.calls.find(call => call.action === "update")!;
  assert.ok(write.filters.some(([op, col, ids]) => op === "in" && col === "id" && JSON.stringify(ids) === JSON.stringify([id(5)])));
  assert.ok(write.filters.some(([, col, value]) => col === "recipient_role" && value === "customer"));
  assert.ok(write.filters.some(([, col, value]) => col === "recipient_id" && value === user));
});
test("dual-role account keeps workshop notification unread when reading customer context", async () => {
  const f = fixture(); f.rows.push(notification(6, { recipient_role: "workshop" }));
  const snap = await f.api.captureNotificationSnapshot(user, "customer");
  assert.equal(snap.rows.length, 1);
  await f.api.confirmNotificationRead(snap, [id(5)]);
  assert.equal(f.rows[1].read_at, null);
  await assert.rejects(f.api.confirmNotificationRead(snap, [id(6)]), /UNOBSERVED/);
});
test("two devices/read twice: zero updated rows can still be persistently read", async () => {
  const f = fixture(); const a = await f.api.captureNotificationSnapshot(user, "customer");
  const b = await f.api.captureNotificationSnapshot(user, "customer");
  assert.deepEqual(await f.api.confirmNotificationRead(a, [id(5)]), [id(5)]);
  assert.deepEqual(await f.api.confirmNotificationRead(b, [id(5)]), [id(5)]);
  assert.equal((await f.api.captureNotificationSnapshot(user, "customer")).rows.length, 0);
  f.rows.push(notification(6));
  assert.deepEqual((await f.api.captureNotificationSnapshot(user, "customer")).rows.map(row => row.id), [id(6)]);
});
test("zero rows/denied update does not become false success", async () => {
  const f = fixture(); const snapshot = await f.api.captureNotificationSnapshot(user, "customer");
  f.state.noWrite = true;
  assert.deepEqual(await f.api.confirmNotificationRead(snapshot, [id(5)]), []);
  f.state.writeError = true;
  await assert.rejects(f.api.confirmNotificationRead(snapshot, [id(5)]), /DENIED/);
});
test("missing row and failed readback never count as read", async () => {
  const f = fixture(); const snapshot = await f.api.captureNotificationSnapshot(user, "customer");
  f.rows.length = 0;
  assert.deepEqual(await f.api.confirmNotificationRead(snapshot, [id(5)]), []);
  f.state.readError = true;
  await assert.rejects(f.api.confirmNotificationRead(snapshot, [id(5)]), /UNCONFIRMED/);
});
for (const role of ["customer", "workshop"] as const) {
  test(`${role}: versioned RPC receives paired deduplicated observations, then authorized persistent readback`, async () => {
    const f = fixture();
    const fn = role === "customer" ? f.api.markCustomerRepairOffersRead : f.api.markWorkshopRepairOffersRead;
    assert.deepEqual(await fn(user, [observed(role), observed(role)]), { changed: 1, confirmedIds: [offer], staleIds: [] });
    assert.equal(f.rpcCalls[0].name, `mark_${role}_repair_offers_read`);
    assert.deepEqual(f.rpcCalls[0].args, { p_offer_ids: [offer], p_expected_versions: ["1"] });
    assert.ok(f.calls.every(call => call.action === "select"));
    assert.ok(f.calls[0].filters.some(([, col, value]) => col === (role === "workshop" ? "workshop_user_id" : "repair_requests.user_id") && value === user));
  });
  test(`${role}: bigint zero requires readback; 0 is neither failure nor success`, async () => {
    const f = fixture(); f.state.rpcValue = "0"; f.state.noWrite = true;
    assert.deepEqual(await f.api.confirmOfferRead(role, user, [observed(role)]), { changed: 0, confirmedIds: [], staleIds: [offer] });
    f.offers[0][`${role}_read_at`] = timestamp;
    assert.deepEqual(await f.api.confirmOfferRead(role, user, [observed(role)]), { changed: 0, confirmedIds: [offer], staleIds: [] });
  });
}
test("RPC error, invalid count and readback error stop without retry", async () => {
  for (const fault of ["rpcError", "rpcValue", "readError"] as const) {
    const f = fixture();
    if (fault === "rpcError") f.state.rpcError = { code: "42501" };
    if (fault === "rpcValue") f.state.rpcValue = "invalid";
    if (fault === "readError") f.state.readError = true;
    await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()]));
    assert.equal(f.rpcCalls.length, 1);
  }
});
test("session switch during RPC cannot produce a receipt for the next user", async () => {
  const f = fixture(); f.state.afterRpc = () => { f.state.user = id(99); };
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()]), /SESSION_CHANGED/);
  assert.equal(f.calls.length, 0);
});
test("missing identity cannot write; invalid IDs cannot invoke RPC", async () => {
  const f = fixture(); f.state.user = null;
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()]));
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed("customer", "1", "invalid")]));
  assert.equal(f.rpcCalls.length, 0);
});
test("new version before RPC remains unread, with no replacement of the observed version", async () => {
  const f = fixture(); f.offers[0].read_state_version = "2"; f.state.rpcValue = 0;
  assert.deepEqual(await f.api.confirmOfferRead("workshop", user, [observed("workshop")]), { changed: 0, confirmedIds: [], staleIds: [offer] });
  assert.equal(f.offers[0].workshop_read_at, null);
  assert.deepEqual(f.rpcCalls[0].args, { p_offer_ids: [offer], p_expected_versions: ["1"] });
});
for (const notificationId of [42, "9007199254740993"]) test(`notification PK ${notificationId} is retained exactly without precision loss`, async () => {
  const f = fixture(); f.rows[0].id = notificationId;
  const snapshot = await f.api.captureNotificationSnapshot(user, "customer");
  assert.deepEqual(await f.api.confirmNotificationRead(snapshot, [notificationId]), [notificationId]);
});
test("unsafe numeric notification ID fails closed before writing", async () => {
  const f = fixture(); f.rows[0].id = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(f.api.captureNotificationSnapshot(user, "customer"), /INVALID_READ_SNAPSHOT/);
  assert.ok(f.calls.every(call => call.action === "select"));
});

test("large observed version arrives exactly in bigint[] and readback", async () => {
  const f = fixture(); const version = "9007199254740993"; f.offers[0].read_state_version = version;
  const result = await f.api.confirmOfferRead("customer", user, [observed("customer", version)]);
  assert.deepEqual(f.rpcCalls[0].args.p_expected_versions, [version]);
  assert.deepEqual(result.confirmedIds, [offer]);
  assert.equal(f.offers[0].read_state_version, "9007199254740994");
});
test("mixed batch preserves ID/version pairing and never assigns a partial count to stale IDs", async () => {
  const f = fixture(); const other = id(40);
  f.offers.push({ ...f.offers[0], id: other, read_state_version: "3" });
  const result = await f.api.confirmOfferRead("customer", user, [observed(), observed("customer", "2", other)]);
  assert.deepEqual(f.rpcCalls[0].args, { p_offer_ids: [offer, other], p_expected_versions: ["1", "2"] });
  assert.deepEqual(result, { changed: 1, confirmedIds: [offer], staleIds: [other] });
});
test("two devices: second observed generation can confirm existing persistent receipt with count zero", async () => {
  const f = fixture();
  await f.api.confirmOfferRead("customer", user, [observed()]);
  f.state.rpcValue = 0;
  const result = await f.api.confirmOfferRead("customer", user, [observed()]);
  assert.deepEqual(result.confirmedIds, [offer]);
  assert.equal(f.offers[0].read_state_version, "2");
});
test("new update after RPC stays unread; readback cannot trigger another write", async () => {
  const f = fixture();
  f.state.afterRpc = () => { f.offers[0].customer_read_at = null; f.offers[0].read_state_version = "3"; };
  assert.deepEqual((await f.api.confirmOfferRead("customer", user, [observed()])).staleIds, [offer]);
  assert.equal(f.rpcCalls.length, 1);
});
test("newer generation read by another device is not reported as this observation's receipt", async () => {
  const f = fixture(); f.state.noWrite = true; f.state.rpcValue = 0;
  f.offers[0].read_state_version = "4"; f.offers[0].customer_read_at = timestamp;
  assert.deepEqual((await f.api.confirmOfferRead("customer", user, [observed()])).confirmedIds, []);
});
test("dual-role same user: customer acknowledgement invalidates old workshop observation", async () => {
  const f = fixture(); await f.api.confirmOfferRead("customer", user, [observed()]);
  f.state.rpcValue = 0;
  assert.deepEqual((await f.api.confirmOfferRead("workshop", user, [observed("workshop")])).staleIds, [offer]);
  assert.equal(f.offers[0].workshop_read_at, null);
  await assert.rejects(f.api.confirmOfferRead("workshop", user, [observed()]), /INVALID_OFFER_OBSERVATION/);
});
for (const code of ["PGRST202", "42883"]) test(`${code}: missing overload disables receipts without legacy retry`, async () => {
  const f = fixture(); f.state.rpcError = { code };
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()]), /OFFER_READ_UNAVAILABLE/);
  assert.equal(f.rpcCalls.length, 1); assert.deepEqual(f.rpcCalls[0].args.p_expected_versions, ["1"]);
  assert.equal(f.calls.length, 0); assert.equal(f.offers[0].customer_read_at, null);
});
test("conflicting versions or wrong identity rejected before RPC", async () => {
  const f = fixture();
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed(), observed("customer", "2")]), /CONFLICTING/);
  await assert.rejects(f.api.confirmOfferRead("customer", user, [{ ...observed(), userId: id(99) }]), /INVALID/);
  assert.equal(f.rpcCalls.length, 0);
});
test("cancellation before dispatch and after dispatch never publishes a stale result", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()], { signal: controller.signal }), /CANCELLED/);
  assert.equal(f.rpcCalls.length, 0);
  let current = true;
  f.state.afterRpc = () => { current = false; };
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()], { isCurrent: () => current }), /CANCELLED/);
  assert.equal(f.calls.length, 0);
});
for (const value of [undefined, 9007199254740992, "9223372036854775808"]) test(`invalid readback version ${value} never confirms`, async () => {
  const f = fixture(); f.state.afterRpc = () => { f.offers[0].read_state_version = value; };
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()]), /INVALID_OFFER_READBACK_VERSION/);
});

test("invalidation during authentication stops before dispatch", async () => {
  const f = fixture(); let checks = 0;
  await assert.rejects(f.api.confirmOfferRead("customer", user, [observed()], { isCurrent: () => ++checks < 2 }), /CANCELLED/);
  assert.equal(f.rpcCalls.length, 0);
});
