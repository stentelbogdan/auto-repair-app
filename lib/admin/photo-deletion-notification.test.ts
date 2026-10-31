import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error TS5097: offline Node tests.
import { createDeletedPhotoInvalidation, parsePhotoNotification } from "./photo-notification.ts";

const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const opA = "33333333-3333-4333-8333-333333333331";
const opB = "33333333-3333-4333-8333-333333333332";
const url = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const env = { VERCEL_ENV: "preview", SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "bstjobvvxxfqqwyjoimx",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-secret",
  ADMIN_PHOTO_NOTIFICATION_ENABLED: "true", ADMIN_PHOTO_SQL_CONTRACT: "4g-v1",
  ADMIN_PHOTO_DELETION_SQL_CONTRACT: "deletion-v1" };
type Completion = { owner: string; request: string; registryOwner: string; authorized: boolean;
  state: string; deletedAt: number | null; rowVersion: number; bucket: string; path: string };
type Ticket = { operation: string; issued: number; expires: number; consumed: boolean };

/** Offline reference model ONLY. SQL body equivalence/security are checked separately;
 * real PostgreSQL locks, privileges and two-session races are not proven by this mock. */
function fixture() {
  let now = 100, nextTicket = 0, sends = 0;
  const requestXmin = "unchanged-after-both-detachments";
  const rows = new Map<string, Completion>();
  const tickets = new Map<string, Ticket>();
  const evidence = new Set<string>();
  const statuses: string[] = [];
  const gate = (input: { p_action: string; p_actor: string; p_request_id: string; p_operation_id: string; p_ticket: string }) => {
    assert.equal(input.p_actor, actor); assert.equal(input.p_request_id, requestId);
    const reply = (status: string) => { statuses.push(status); return Response.json({ version: "deletion-v1", status }); };
    if (input.p_action === "prepare") {
      const ticket = `44444444-4444-4444-8444-${String(++nextTicket).padStart(12, "0")}`;
      tickets.set(ticket, { operation: input.p_operation_id, issued: ++now, expires: now + 900, consumed: false });
      return Response.json({ version: "deletion-v1", status: "prepared", ticket });
    }
    const ticket = tickets.get(input.p_ticket);
    if (!ticket || ticket.expires <= now || ticket.operation !== input.p_operation_id) return reply("ineligible");
    if (ticket.consumed) return reply("suppressed");
    const row = rows.get(ticket.operation);
    if (!row || row.owner !== actor || row.registryOwner !== actor || row.request !== requestId || !row.authorized
      || row.bucket !== "repair-images" || row.state !== "deleted" || row.deletedAt === null
      || row.deletedAt <= ticket.issued || row.deletedAt > now || row.rowVersion <= 0) return reply("ineligible");
    const key = JSON.stringify([row.bucket, row.path, row.deletedAt, row.rowVersion]);
    ticket.consumed = true;
    if (evidence.has(key)) return reply("suppressed");
    evidence.add(key); return reply("claimed");
  };
  const fetcher: typeof fetch = async (target, init) => {
    assert.equal(init?.redirect, "manual"); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    if (String(target) === url + "/auth/v1/user") return Response.json({ id: actor });
    if (String(target) === url + "/rest/v1/rpc/admin_photo_deletion_notification_gate") {
      // Synchronous critical section models the per-actor budget lock; no actual DB.
      return gate(JSON.parse(String(init?.body)));
    }
    assert.equal(String(target), url + "/realtime/v1/api/broadcast");
    assert.deepEqual(JSON.parse(String(init?.body)), { messages: [{ topic: "admin:photo-overview:v1", event: "invalidate", payload: { v: 1 }, private: true }] });
    sends++; return new Response(null, { status: 202 });
  };
  const prepare = createDeletedPhotoInvalidation({ env, fetch: fetcher });
  return { prepare: (operation: string) => prepare(requestId, operation, "synthetic-user"), rows, tickets, statuses,
    requestXmin, sends: () => sends, expire: () => { now += 901; },
    complete(operation: string, patch: Partial<Completion> = {}) {
      rows.set(operation, { owner: actor, request: requestId, registryOwner: actor, authorized: true,
        state: "deleted", deletedAt: ++now, rowVersion: 11, bucket: "repair-images", path: operation === opA ? "synthetic-a" : "synthetic-b", ...patch });
    } };
}

test("A/B same request xmin: A complete/read pending B/B complete, both claimed, both repeats suppressed", async () => {
  const f = fixture();
  const [a, b, repeatA, repeatB] = await Promise.all([f.prepare(opA), f.prepare(opB), f.prepare(opA), f.prepare(opB)]);
  assert.ok(a && b && repeatA && repeatB);
  const xmin = f.requestXmin;
  f.complete(opA); await a.confirm(); assert.equal(f.sends(), 1); assert.equal(f.rows.has(opB), false);
  f.complete(opB); await b.confirm(); assert.equal(f.sends(), 2); assert.equal(f.requestXmin, xmin);
  await Promise.all([repeatA.confirm(), repeatB.confirm()]);
  assert.deepEqual(f.statuses, ["claimed", "claimed", "suppressed", "suppressed"]);
  assert.equal(f.sends(), 2);
});
test("concurrent confirms of one completion: one claimed, one suppressed (model)", async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.prepare(opA), f.prepare(opA)]); assert.ok(a && b);
  f.complete(opA); await Promise.all([a.confirm(), b.confirm(), a.confirm()]);
  assert.deepEqual(f.statuses, ["claimed", "suppressed"]); assert.equal(f.sends(), 1);
});
test("concurrent independent completions: both claimed (model)", async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.prepare(opA), f.prepare(opB)]); assert.ok(a && b);
  f.complete(opA); f.complete(opB); await Promise.all([a.confirm(), b.confirm()]);
  assert.deepEqual(f.statuses, ["claimed", "claimed"]); assert.equal(f.sends(), 2);
});
test("different operation selectors for the same physical completion cannot duplicate evidence", async () => {
  const f = fixture(); const [a, b] = await Promise.all([f.prepare(opA), f.prepare(opB)]); assert.ok(a && b);
  f.complete(opA); f.rows.set(opB, { ...f.rows.get(opA)! });
  await Promise.all([a.confirm(), b.confirm()]); assert.equal(f.sends(), 1);
  assert.deepEqual(f.statuses, ["claimed", "suppressed"]);
});
for (const [name, patch] of Object.entries({ pending: { state: "delete_claimed", deletedAt: null },
  receiptOwner: { owner: opB }, registryOwner: { registryOwner: opB }, request: { request: opB },
  unauthorized: { authorized: false }, beforeTicket: { deletedAt: 1 }, future: { deletedAt: 99999 },
  missingTimestamp: { deletedAt: null }, invalidVersion: { rowVersion: 0 }, otherBucket: { bucket: "other" } })) {
  test(`${name}: no completion evidence, no emit`, async () => {
    const f = fixture(); const a = await f.prepare(opA); assert.ok(a); f.complete(opA, patch);
    await a.confirm(); assert.deepEqual(f.statuses, ["ineligible"]); assert.equal(f.sends(), 0);
  });
}
test("missing operation and expired ticket cannot be UUID-only proofs", async () => {
  const f = fixture(); const a = await f.prepare(opA); assert.ok(a); await a.confirm();
  const b = await f.prepare(opB); assert.ok(b); f.complete(opB); f.expire(); await b.confirm();
  assert.deepEqual(f.statuses, ["ineligible", "ineligible"]); assert.equal(f.sends(), 0);
});
test("browser notify-change parser never exposes deletion kind", () => {
  assert.equal(parsePhotoNotification({ action: "prepare", kind: "physical_deletion", requestId, operationId: opA }), null);
});
for (const bad of [{ version: "4g-v1", status: "claimed" }, { version: "deletion-v1", status: "claimed", path: "sensitive" },
  { version: "deletion-v1", status: "ineligible" }, null]) {
  test("invalid/mismatched gate response never emits", async () => {
    let sends = 0;
    const prepare = createDeletedPhotoInvalidation({ env, fetch: async (target, init) => {
      if (String(target).endsWith("/auth/v1/user")) return Response.json({ id: actor });
      if (String(target).endsWith("/admin_photo_deletion_notification_gate")) {
        return Response.json(JSON.parse(String(init?.body)).p_action === "prepare"
          ? { version: "deletion-v1", status: "prepared", ticket: opB } : bad);
      }
      sends++; throw new Error("Unexpected emit");
    } });
    const a = await prepare(requestId, opA, "synthetic-user"); assert.ok(a); await a.confirm(); assert.equal(sends, 0);
  });
}
test("flags revoked after prepare and changed authenticated identity prevent confirm", async () => {
  for (const scenario of ["flag", "identity"]) {
    const environment = { ...env }; let authCalls = 0, gateCalls = 0;
    const prepare = createDeletedPhotoInvalidation({ env: environment, fetch: async target => {
      if (String(target).endsWith("/auth/v1/user")) return Response.json({ id: ++authCalls === 1 ? actor : opB });
      assert.equal(++gateCalls, 1);
      return Response.json({ version: "deletion-v1", status: "prepared", ticket: opB });
    } });
    const a = await prepare(requestId, opA, "synthetic-user"); assert.ok(a);
    if (scenario === "flag") delete (environment as Partial<typeof env>).ADMIN_PHOTO_DELETION_SQL_CONTRACT;
    await a.confirm(); assert.equal(gateCalls, 1);
  }
});
