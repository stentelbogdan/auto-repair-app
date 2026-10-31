import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error TS5097: offline Node tests.
import { createUploadPhotoNotifications, createRequestPhotoNotifications, createEditedRequestPhotoNotifications } from "./photo-notification-client.ts";

const owner = "10000000-0000-4000-8000-000000000001";
const ticket = "20000000-0000-4000-8000-000000000002";
const path = `${owner}/reserved.jpg`;
const session = { user: { id: owner }, access_token: "synthetic-user-token" };
const config = { enabled: true, supabaseUrl: "https://bstjobvvxxfqqwyjoimx.supabase.co", projectRef: "bstjobvvxxfqqwyjoimx" };
const prepared = () => Response.json({ status: "prepared", ticket });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(responses: (Response | Error)[] = [prepared(), new Response(null, { status: 202 })]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let current: typeof session | null = session;
  const deps = {
    ...config,
    session: async () => current,
    fetch: (async (url, init) => {
      calls.push({ url: String(url), init: init! });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected call");
      if (response instanceof Error) throw response;
      return response;
    }) as typeof fetch,
  };
  return { deps, calls, change: (value: typeof current) => { current = value; } };
}

test("prepare/confirm use only fixed same-origin endpoint and session header, once", async () => {
  const f = fixture();
  const n = await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner);
  assert.ok(n);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { action: "prepare", kind: "upload", objectName: "reserved.jpg" });
  await Promise.all([n.confirm(), n.confirm()]);
  await n.confirm();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(String(f.calls[1].init.body)), { action: "confirm", ticket });
  for (const { url, init } of f.calls) {
    assert.equal(url, "/api/repair-requests/images/notify-change");
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "omit");
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${session.access_token}`);
    assert.ok(!url.includes(session.access_token)); assert.ok(!String(init.body).includes(session.access_token));
  }
});
for (const patch of [{ enabled: false }, { supabaseUrl: undefined }, { projectRef: "other" },
  { supabaseUrl: "https://ouoiykudvcoqbkybkqvs.supabase.co" }, { supabaseUrl: config.supabaseUrl + "@example.invalid" }]) {
  test(`disabled or non-TEST configuration: ${JSON.stringify(patch)}`, async () => {
    const f = fixture();
    const client = createUploadPhotoNotifications({ ...f.deps, ...patch, session: () => { throw new Error("must not read session"); } });
    assert.equal(await client.prepareUpload(path, owner), null); assert.equal(f.calls.length, 0);
  });
}
for (const value of ["../x.jpg", `${owner}/nested/x.jpg`, "other/x.jpg", `${owner}/x?secret=1`]) {
  test(`invalid reservation path never sent: ${value}`, async () => {
    const f = fixture(); assert.equal(await createUploadPhotoNotifications(f.deps).prepareUpload(value, owner), null);
    assert.equal(f.calls.length, 0);
  });
}
for (const status of [401, 403, 404, 429, 500, 503, 202, 302]) {
  test(`prepare HTTP ${status} skips notification without retry`, async () => {
    const f = fixture([new Response("sensitive body", { status })]);
    assert.equal(await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner), null);
    assert.equal(f.calls.length, 1);
  });
}
for (const value of [null, [], { status: "prepared", ticket: "invalid" }, { status: "prepared", ticket, extra: "private" }, { status: "suppressed" }]) {
  test(`invalid prepare response ${JSON.stringify(value)}`, async () => {
    const f = fixture([Response.json(value)]);
    assert.equal(await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner), null);
  });
}
test("malformed, oversized and throwing responses remain isolated", async () => {
  for (const response of [new Response("not json"), new Response("x".repeat(1025)), new Error("secret")]) {
    const f = fixture([response]);
    assert.equal(await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner), null);
  }
});
for (const [label, status] of [["accepted", 202], ["duplicate", 200], ["expired", 403], ["quota", 429], ["unavailable", 503], ["redirect", 302]] as const) {
  test(`confirm ${label} cannot fail upload and is never retried`, async () => {
    const f = fixture([prepared(), new Response("ignored raw body", { status })]);
    const n = await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner);
    await n!.confirm(); await n!.confirm(); assert.equal(f.calls.length, 2);
  });
}
test("confirmation transport errors are swallowed with no retry", async () => {
  const f = fixture([prepared(), new Error("sensitive transport failure")]);
  const n = await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner);
  await n!.confirm(); await n!.confirm(); assert.equal(f.calls.length, 2);
});
test("no session or wrong owner cannot prepare; account change cannot confirm", async () => {
  for (const current of [null, { ...session, user: { id: ticket } }]) {
    const f = fixture(); f.change(current);
    assert.equal(await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner), null);
    assert.equal(f.calls.length, 0);
    const g = fixture(); const n = await createUploadPhotoNotifications(g.deps).prepareUpload(path, owner);
    g.change(current); await n!.confirm(); g.change(session); await n!.confirm();
    assert.equal(g.calls.length, 1);
  }
});
test("fresh token for same owner is used for confirmation", async () => {
  const f = fixture(); const n = await createUploadPhotoNotifications(f.deps).prepareUpload(path, owner);
  f.change({ ...session, access_token: "refreshed-user-token" }); await n!.confirm();
  assert.equal(new Headers(f.calls[1].init.headers).get("Authorization"), "Bearer refreshed-user-token");
});
test("session deadline prevents late authentication from starting a request", async () => {
  const f = fixture(); let resolve!: (s: typeof session) => void;
  const client = createUploadPhotoNotifications({ ...f.deps, timeoutMs: 5, session: () => new Promise(r => { resolve = r; }) });
  assert.equal(await client.prepareUpload(path, owner), null);
  resolve(session); await tick(); assert.equal(f.calls.length, 0);
});
test("prepare timeout aborts even ignored-abort transport; late ticket never escapes", async () => {
  const f = fixture(); let resolve!: (r: Response) => void; let signal!: AbortSignal;
  const client = createUploadPhotoNotifications({ ...f.deps, timeoutMs: 5, fetch: async (_url, init) => {
    signal = init!.signal!; return new Promise(r => { resolve = r; });
  } });
  assert.equal(await client.prepareUpload(path, owner), null); assert.equal(signal.aborted, true);
  resolve(prepared()); await tick(); assert.equal(f.calls.length, 0);
});
test("stalled response body is cancelled at prepare deadline", async () => {
  let cancelled = false;
  const f = fixture([new Response(new ReadableStream({ cancel() { cancelled = true; } }))]);
  assert.equal(await createUploadPhotoNotifications({ ...f.deps, timeoutMs: 5 }).prepareUpload(path, owner), null);
  assert.equal(cancelled, true);
});
test("confirm timeout is finite, aborts and consumes the single attempt", async () => {
  const f = fixture(); let count = 0; let signal!: AbortSignal;
  const client = createUploadPhotoNotifications({ ...f.deps, timeoutMs: 5, fetch: async (_url, init) => {
    count++; if (count === 1) return prepared();
    signal = init!.signal!; return new Promise(() => {});
  } });
  const n = await client.prepareUpload(path, owner); await n!.confirm(); await n!.confirm();
  assert.equal(signal.aborted, true); assert.equal(count, 2);
});
test("two simultaneous operations retain separate tickets even when prepare replies reverse", async () => {
  const f = fixture(); const pending: ((r: Response) => void)[] = []; const confirmations: string[] = [];
  const client = createUploadPhotoNotifications({ ...f.deps, fetch: async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    if (body.action === "prepare") return new Promise(r => pending.push(r));
    confirmations.push(body.ticket); return new Response(null, { status: 202 });
  } });
  const a = client.prepareUpload(path, owner), b = client.prepareUpload(`${owner}/second.jpg`, owner);
  await tick(); pending[1](Response.json({ status: "prepared", ticket: owner })); pending[0](prepared());
  await Promise.all([(await a)!.confirm(), (await b)!.confirm()]);
  assert.deepEqual(confirmations.sort(), [ticket, owner].sort());
});
test("client helper has no logging, persistence, privileged configuration or direct Broadcast", () => {
  const code = readFileSync(new URL("./photo-notification-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /console\.|localStorage|sessionStorage|SERVICE_ROLE|api\/broadcast|\.rpc\(/);
});

test("creation uses request_images/null then returned request ID, with one confirm per ticket", async () => {
  const f = fixture(); const n = await createRequestPhotoNotifications(f.deps).prepareCreation(owner);
  assert.ok(n);
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { action: "prepare", kind: "request_images", requestId: null });
  await Promise.all([n.confirm(owner), n.confirm(ticket)]);
  await n.confirm(owner);
  assert.deepEqual(JSON.parse(String(f.calls[1].init.body)), { action: "confirm", ticket, requestId: owner });
  assert.equal(f.calls.length, 2);
});
for (const id of [null, undefined, {}, [], "bad", 42]) test(`invalid returned request ID: ${JSON.stringify(id)}`, async () => {
  const f = fixture(); const n = await createRequestPhotoNotifications(f.deps).prepareCreation(owner);
  await n!.confirm(id); await n!.confirm(owner);
  assert.equal(f.calls.length, 1);
});
test("creation respects disabled configuration, wrong session and owner changes", async () => {
  const f = fixture();
  assert.equal(await createRequestPhotoNotifications({ ...f.deps, enabled: false }).prepareCreation(owner), null);
  f.change(null); assert.equal(await createRequestPhotoNotifications(f.deps).prepareCreation(owner), null);
  f.change(session); const n = await createRequestPhotoNotifications(f.deps).prepareCreation(owner);
  f.change({ ...session, user: { id: ticket } }); await n!.confirm(owner);
  assert.equal(f.calls.length, 1);
});

for (const [label, before, next] of [
  ["addition", [], [{ path: "synthetic" }]],
  ["association removal", [{ path: "synthetic" }], []],
] as const) test(`existing request ${label}: bound ticket, no physical deletion claim`, async () => {
  const f = fixture();
  const n = await createEditedRequestPhotoNotifications(f.deps).prepareUpdate(owner, owner, [...before], [...next]);
  assert.ok(n); await Promise.all([n.confirm(), n.confirm()]);
  assert.deepEqual(f.calls.map(c => JSON.parse(String(c.init.body))), [
    { action: "prepare", kind: "request_images", requestId: owner },
    { action: "confirm", ticket, requestId: owner },
  ]);
  assert.ok(f.calls.every(c => c.init.method === "POST" && !String(c.init.body).includes("synthetic")));
});
test("unchanged lists, malformed ID and unclassifiable local comparison skip preparation", async () => {
  const f = fixture(); const n = createEditedRequestPhotoNotifications(f.deps);
  assert.equal(await n.prepareUpdate(owner, owner, [{ path: "a" }], [{ path: "a" }]), null);
  assert.equal(await n.prepareUpdate(owner, "bad", [], [{ path: "a" }]), null);
  const circular: unknown[] = []; circular.push(circular);
  assert.equal(await n.prepareUpdate(owner, owner, circular, []), null);
  assert.equal(f.calls.length, 0);
});
