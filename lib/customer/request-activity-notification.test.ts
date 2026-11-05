import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error TS5097: offline Node source import.
import { createCustomerActivityInvalidation } from "./request-activity-notification.ts";
const owner = "10000000-0000-4000-8000-000000000001";
const env = { VERCEL_ENV: "preview", SUPABASE_URL: "https://bstjobvvxxfqqwyjoimx.supabase.co",
  NEXT_PUBLIC_SUPABASE_URL: "https://bstjobvvxxfqqwyjoimx.supabase.co", NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "bstjobvvxxfqqwyjoimx",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" };
const deleted = { status: "deleted", detached: true, physicalDeletionConfirmed: true };
function fixture(responses: (Response | Error)[], config: Record<string, string | undefined> = env) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init }); const r = responses.shift();
    if (!r || r instanceof Error) throw r ?? new Error("Unexpected network"); return r;
  };
  return { calls, emit: createCustomerActivityInvalidation({ env: config, fetch: fetcher }) };
}
test("verified completion: authenticate owner, then send one constant private invalidation independently of Admin", async () => {
  const f = fixture([Response.json({ id: owner }), new Response(null, { status: 202 })]);
  assert.equal(await f.emit("synthetic-user-token", deleted), "accepted"); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, env.SUPABASE_URL + "/auth/v1/user");
  assert.equal(f.calls[1].url, env.SUPABASE_URL + "/realtime/v1/api/broadcast");
  assert.deepEqual(JSON.parse(String(f.calls[1].init?.body)), { messages: [{ topic: `customer:request-activity:v1:${owner}`, event: "invalidate", payload: { v: 1 }, private: true }] });
  for (const c of f.calls) {
    assert.equal(c.init?.redirect, "error"); assert.equal(c.init?.cache, "no-store"); assert.ok(c.init?.signal);
    assert.ok(!c.url.includes("synthetic-service") && !String(c.init?.body).includes("synthetic-service"));
  }
});
for (const status of ["retained", "already_completed_unverified", "recovery_required", "forbidden", "conflict"]) test(`${status}: no authentication or broadcast`, async () => {
  const f = fixture([]); assert.equal(await f.emit("user", { ...deleted, status }), "skipped"); assert.equal(f.calls.length, 0);
});
for (const patch of [{ detached: false }, { detached: "unknown" as const }, { physicalDeletionConfirmed: false }]) test(`incomplete strict triple ${JSON.stringify(patch)}: no send`, async () => {
  const f = fixture([]); assert.equal(await f.emit("user", { ...deleted, ...patch }), "skipped"); assert.equal(f.calls.length, 0);
});
for (const patch of [{ VERCEL_ENV: "production" }, { SUPABASE_URL: "https://example.invalid" },
  { NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid" }, { NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "wrong" },
  { SUPABASE_SERVICE_ROLE_KEY: undefined }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }]) test(`configuration guard ${JSON.stringify(patch)}`, async () => {
  const f = fixture([], { ...env, ...patch }); assert.equal(await f.emit("user", deleted), "skipped"); assert.equal(f.calls.length, 0);
});
for (const token of ["", env.SUPABASE_SERVICE_ROLE_KEY, env.NEXT_PUBLIC_SUPABASE_ANON_KEY]) test("no privileged/empty token as user identity: " + token, async () => {
  const f = fixture([]); assert.equal(await f.emit(token, deleted), "skipped"); assert.equal(f.calls.length, 0);
});
for (const [index, response] of [Response.json({ id: "bad" }), Response.json({}), new Response(null, { status: 401 }),
  new Response(null, { status: 302 }), new Response("invalid"), Response.json({ id: owner, large: "x".repeat(33000) })].entries()) test("Auth refusal or malformed identity never reaches Broadcast " + response.status + ":" + index, async () => {
  const f = fixture([response]); assert.equal(await f.emit("user", deleted), "unavailable"); assert.equal(f.calls.length, 1);
});
for (const status of [200, 302, 401, 403, 429, 500]) test(`broadcast HTTP ${status} is not acceptance; no retry`, async () => {
  const f = fixture([Response.json({ id: owner }), new Response(null, { status })]);
  assert.equal(await f.emit("user", deleted), "unavailable"); assert.equal(f.calls.length, 2);
});
test("ignored-abort timeout and transport errors remain bounded and sanitized", async () => {
  let calls = 0;
  const emit = createCustomerActivityInvalidation({ env, timeoutMs: 5, fetch: async () => { calls++; return new Promise(() => {}); } });
  assert.equal(await emit("user", deleted), "unavailable"); assert.equal(calls, 1);
  assert.equal(await fixture([new Error("private secret")]).emit("user", deleted), "unavailable");
});
