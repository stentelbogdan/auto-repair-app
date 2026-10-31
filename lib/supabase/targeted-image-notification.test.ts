import assert from "node:assert/strict";
import { test, mock, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error TS5097: offline Node tests.
import { createDeletedPhotoInvalidation } from "../admin/photo-notification.ts";

const url = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const ticket = "44444444-4444-4444-8444-444444444444";
const env = { VERCEL_ENV: "preview", SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "bstjobvvxxfqqwyjoimx",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-secret",
  ADMIN_PHOTO_NOTIFICATION_ENABLED: "true", ADMIN_PHOTO_SQL_CONTRACT: "4g-v1", ADMIN_PHOTO_DELETION_SQL_CONTRACT: "deletion-v1" };
const oldEnv = { ...process.env }, oldFetch = globalThis.fetch;
const deleted = { operationId, status: "deleted", detached: true, physicalDeletionConfirmed: true };
let result: Record<string, unknown> = deleted;
let adapterThrows = false;
const events: string[] = [];
mock.module(new URL("./targeted-repair-image-deletion.ts", import.meta.url).href, {
  namedExports: { deleteTargetedRepairImage: async () => {
    events.push("adapter");
    if (adapterThrows) throw new Error("private error");
    return result;
  } },
});
// @ts-expect-error TS5097: offline Node tests.
const { handleTargetedImageDeletionRequest: handle } = await import("./targeted-repair-image-deletion-route.ts");
beforeEach(() => {
  Object.assign(process.env, env); events.length = 0; result = deleted; adapterThrows = false;
  globalThis.fetch = async () => { throw new Error("Real network prohibited"); };
});
after(() => { process.env = oldEnv; globalThis.fetch = oldFetch; mock.restoreAll(); });
function req() {
  return new Request("https://app.invalid/api/repair-requests/images/delete", {
    method: "POST", headers: { Authorization: "Bearer synthetic-user", "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, operationId, image: { path: `${actor}/photo.jpg` } }),
  });
}
function transport(options: { prepare?: string; confirm?: string; fail?: string; authExpired?: boolean; dedup?: boolean } = {}) {
  let sent = 0, consumed = false, authCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const target = String(input);
    assert.ok(target.startsWith(url + "/")); assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    if (target.endsWith("/auth/v1/user")) {
      events.push("auth"); authCalls++;
      assert.equal(headers.get("authorization"), "Bearer synthetic-user");
      return options.authExpired && authCalls > 1 ? new Response(null, { status: 401 }) : Response.json({ id: actor });
    }
    assert.equal(headers.get("authorization"), "Bearer synthetic-secret");
    if (target.endsWith("/admin_photo_deletion_notification_gate")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.p_actor, actor); assert.equal(body.p_request_id, requestId);
      events.push(body.p_action);
      if (options.fail === body.p_action) throw new Error("private gate error");
      if (body.p_action === "prepare") {
        assert.equal(body.p_operation_id, operationId); assert.equal(body.p_ticket, null);
        return Response.json({ version: "deletion-v1", status: options.prepare ?? "prepared", ...(options.prepare ? {} : { ticket }) });
      }
      assert.equal(body.p_operation_id, operationId); assert.equal(body.p_ticket, ticket);
      const status = options.confirm ?? (options.dedup && consumed ? "suppressed" : "claimed");
      consumed = true;
      return Response.json({ version: "deletion-v1", status });
    }
    assert.equal(target, url + "/realtime/v1/api/broadcast"); events.push("emit"); sent++;
    assert.deepEqual(JSON.parse(String(init?.body)), { messages: [{ topic: "admin:photo-overview:v1", event: "invalidate", payload: { v: 1 }, private: true }] });
    if (options.fail === "emit") throw new Error("private secret transport error");
    return new Response(null, { status: 202 });
  };
  return { fetch: fetcher, sends: () => sent };
}
async function fingerprint(response: Response) {
  return { status: response.status, headers: [...response.headers], body: await response.text() };
}
const pending: Array<() => Promise<void>> = [];
function schedule(task: () => Promise<void>) { pending.push(task); }
beforeEach(() => { pending.length = 0; });

test("verified deleted: prepare before detach, confirm only in after-response task; exact HTTP unchanged", async () => {
  const t = transport(); globalThis.fetch = t.fetch;
  const response = await handle(req(), schedule);
  assert.deepEqual(events, ["auth", "prepare", "adapter"]); assert.equal(pending.length, 1);
  const observed = await fingerprint(response);
  assert.deepEqual(JSON.parse(observed.body), deleted);
  await pending[0](); await pending[0]();
  assert.deepEqual(events, ["auth", "prepare", "adapter", "auth", "confirm", "emit"]); assert.equal(t.sends(), 1);
  delete process.env.ADMIN_PHOTO_NOTIFICATION_ENABLED;
  assert.deepEqual(await fingerprint(await handle(req(), schedule)), observed);
});
for (const status of ["retained", "already_completed_unverified", "recovery_required", "conflict", "forbidden", "unauthenticated"]) {
  test(`${status}: confirmed detachment is not physical deletion; response unchanged, no task`, async () => {
    result = { operationId, status, detached: true, physicalDeletionConfirmed: false };
    const t = transport(); globalThis.fetch = t.fetch;
    const observed = await fingerprint(await handle(req(), schedule));
    assert.equal(pending.length, 0); assert.equal(t.sends(), 0); assert.ok(!events.includes("confirm"));
    delete process.env.ADMIN_PHOTO_NOTIFICATION_ENABLED;
    assert.deepEqual(await fingerprint(await handle(req(), schedule)), observed);
  });
}
for (const invalid of [{ ...deleted, detached: false }, { ...deleted, physicalDeletionConfirmed: false }, { ...deleted, operationId: actor }]) {
  test("contradictory adapter proof never schedules invalidation", async () => {
    result = invalid; globalThis.fetch = transport().fetch;
    assert.equal((await handle(req(), schedule)).status, 503); assert.equal(pending.length, 0);
  });
}
test("adapter throw after possible mutation: no invented proof or notification", async () => {
  adapterThrows = true; globalThis.fetch = transport().fetch;
  assert.equal((await handle(req(), schedule)).status, 503); assert.equal(pending.length, 0);
});
for (const options of [{ prepare: "throttled" }, { prepare: "ineligible" }, { fail: "prepare" },
  { confirm: "ineligible" }, { confirm: "suppressed" }, { confirm: "throttled" }, { fail: "confirm" },
  { fail: "emit" }, { authExpired: true }]) {
  test(`notification isolation ${JSON.stringify(options)}`, async () => {
    const t = transport(options); globalThis.fetch = t.fetch;
    const observed = await fingerprint(await handle(req(), schedule));
    for (const task of pending) await task();
    assert.deepEqual(JSON.parse(observed.body), deleted);
    assert.equal(t.sends(), options.fail === "emit" ? 1 : 0);
    delete process.env.ADMIN_PHOTO_NOTIFICATION_ENABLED;
    assert.deepEqual(await fingerprint(await handle(req(), schedule)), observed);
  });
}
test("failed scheduler preserves deleted; no fallback, retry or Broadcast", async () => {
  const t = transport(); globalThis.fetch = t.fetch;
  const response = await handle(req(), () => { throw new Error("scheduler unavailable"); });
  assert.deepEqual(await response.json(), deleted); assert.equal(t.sends(), 0);
});
test("duplicate concurrent deletions: independent route calls, atomic gate suppresses duplicate evidence (mock)", async () => {
  const t = transport({ dedup: true }); globalThis.fetch = t.fetch;
  const responses = await Promise.all([handle(req(), schedule), handle(req(), schedule)]);
  for (const response of responses) assert.deepEqual(await response.json(), deleted);
  await Promise.all(pending.map(task => task())); assert.equal(t.sends(), 1);
});
for (const phase of ["prepare", "confirm", "emit"]) {
  test(`${phase} timeout is finite, contained and never retried`, async () => {
    const t = transport(); let stuck = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const action = String(input).endsWith("/admin_photo_deletion_notification_gate") ? JSON.parse(String(init?.body)).p_action
        : String(input).endsWith("/api/broadcast") ? "emit" : "auth";
      if (action === phase) { stuck++; return new Promise(() => {}); }
      return t.fetch(input, init);
    };
    const prepared = await createDeletedPhotoInvalidation({ env, fetch: fetcher, timeoutMs: 5 })(requestId, operationId, "synthetic-user");
    if (phase === "prepare") assert.equal(prepared, null);
    else { assert.ok(prepared); await prepared.confirm(); await prepared.confirm(); }
    assert.equal(stuck, 1);
  });
}
test("production/disabled/mismatched project cannot prepare or send", async () => {
  for (const patch of [{ VERCEL_ENV: "production" }, { ADMIN_PHOTO_NOTIFICATION_ENABLED: "false" },
    { SUPABASE_URL: "https://forbidden.invalid" }, { ADMIN_PHOTO_SQL_CONTRACT: undefined }, { ADMIN_PHOTO_DELETION_SQL_CONTRACT: undefined }, { ADMIN_PHOTO_DELETION_SQL_CONTRACT: "4g-v1" }]) {
    let calls = 0;
    assert.equal(await createDeletedPhotoInvalidation({ env: { ...env, ...patch }, fetch: async () => { calls++; throw new Error(); } })(requestId, operationId, "synthetic-user"), null);
    assert.equal(calls, 0);
  }
});
test("actual API uses after only for POST; no new browser credentials or notification logging", () => {
  const source = readFileSync(new URL("../../app/api/repair-requests/images/delete/route.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ after \} from "next\/server"/);
  assert.match(source, /handleTargetedImageDeletionRequest\(request, after\)/);
  const notificationSource = readFileSync(new URL("../admin/photo-notification.ts", import.meta.url), "utf8");
  assert.doesNotMatch(notificationSource, /console\./);
});
