import assert from "node:assert/strict";
import { test, mock, after } from "node:test";
const owner = "10000000-0000-4000-8000-000000000001";
const operationId = "20000000-0000-4000-8000-000000000001";
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
let result = { operationId, status: "deleted", detached: true, physicalDeletionConfirmed: true };
mock.module(new URL("../supabase/targeted-repair-image-deletion.ts", import.meta.url).href, {
  namedExports: { deleteTargetedRepairImage: async () => result },
});
// @ts-expect-error TS5097: offline test source import.
const { handleTargetedImageDeletionRequest: handle } = await import("../supabase/targeted-repair-image-deletion-route.ts");
after(() => { process.env = originalEnv; globalThis.fetch = originalFetch; mock.restoreAll(); });
function setup() {
  process.env.VERCEL_ENV = "preview";
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bstjobvvxxfqqwyjoimx.supabase.co";
  process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF = "bstjobvvxxfqqwyjoimx";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service";
  delete process.env.ADMIN_PHOTO_NOTIFICATION_ENABLED;
  result = { operationId, status: "deleted", detached: true, physicalDeletionConfirmed: true };
}
function request() {
  return new Request("https://preview.invalid/api/repair-requests/images/delete", { method: "POST",
    headers: { Authorization: "Bearer synthetic-user", "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: owner, operationId, image: { path: `${owner}/synthetic.jpg` } }) });
}
test("after() receives one task only after strict completion; response is unchanged even when send fails", async () => {
  setup(); const tasks: (() => Promise<void>)[] = []; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("private failure"); };
  const response = await handle(request(), task => tasks.push(task));
  assert.equal(calls, 0); assert.equal(tasks.length, 1);
  const before = await response.clone().text();
  assert.deepEqual(JSON.parse(before), result); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await tasks[0](); assert.equal(calls, 1); assert.equal(await response.text(), before);
});
test("successful private send derives recipient from verified Auth, never request body", async () => {
  setup(); const tasks: (() => Promise<void>)[] = []; const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: owner });
    assert.equal(JSON.parse(String(init?.body)).messages[0].topic, `customer:request-activity:v1:${owner}`);
    return new Response(null, { status: 202 });
  };
  const response = await handle(request(), task => tasks.push(task));
  await tasks[0](); assert.equal(calls.length, 2); assert.equal(response.status, 200);
});
for (const status of ["retained", "already_completed_unverified", "recovery_required", "forbidden"]) test(`${status}: no owner invalidation scheduled`, async () => {
  setup(); result = { ...result, status, physicalDeletionConfirmed: false };
  const tasks: unknown[] = []; await handle(request(), task => tasks.push(task)); assert.equal(tasks.length, 0);
});
test("scheduler failure cannot change deletion success", async () => {
  setup(); const response = await handle(request(), () => { throw new Error("after unavailable"); });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), result);
});
