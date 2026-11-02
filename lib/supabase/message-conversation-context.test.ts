import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type API = typeof import("./message-conversation-context");
type Context = import("./message-conversation-context").MessageConversationContext;
type Reply = { data: unknown; error: unknown };
const request = "10000000-0000-4000-8000-000000000001";
const offer = "20000000-0000-4000-8000-000000000002";
const other = "30000000-0000-4000-8000-000000000003";
const source = readFileSync(new URL("./message-conversation-context.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/chat/[requestId]/page.tsx", import.meta.url), "utf8");
function compile(value: string) {
  return ts.transpileModule(value, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
}
const compiled = compile(source);
function row(extra: Record<string, unknown> = {}) {
  return { request_id: request, offer_id: offer, car_brand: "Synthetic", car_model: "Model",
    city: "City", status: "open", images: [{ name: "Synthetic", url: "https://example.invalid/photo" }],
    request_type: "repair", target_workshop_id: null, ...extra };
}
function reply(value = row()): Reply { return { data: [{ request_data: value }], error: null }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(respond: () => Promise<Reply> = async () => reply()) {
  const calls: { name: string; args: unknown }[] = [];
  const callbacks = new Set<(event: string, session: { user: { id: string } } | null) => void>();
  const jobs = new Map<number, () => void>();
  let nextJob = 0;
  let subscriptions = 0;
  let unsubscribes = 0;
  const exports: Partial<API> = {};
  new Function("require", "exports", "setTimeout", "clearTimeout", compiled)(
    (name: string) => {
      assert.equal(name, "@/lib/supabase/client");
      return { supabase: {
        rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return respond(); },
        from: () => { throw new Error("Direct table fallback forbidden"); },
        auth: { onAuthStateChange: (callback: (event: string, session: { user: { id: string } } | null) => void) => {
          callbacks.add(callback); subscriptions++;
          return { data: { subscription: { unsubscribe() { callbacks.delete(callback); unsubscribes++; } } } };
        } },
      } };
    }, exports,
    (job: () => void) => { const id = ++nextJob; jobs.set(id, job); return id; },
    (id: number) => jobs.delete(id),
  );
  return { api: exports as API, calls, jobs,
    emit: (user: string | null, event = "INITIAL_SESSION") => {
      for (const callback of callbacks) callback(event, user === null ? null : { user: { id: user } });
    },
    runJobs: () => { const pending = [...jobs.values()]; jobs.clear(); pending.forEach(job => job()); },
    stats: () => ({ subscriptions, unsubscribes, active: callbacks.size }),
  };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

for (const category of ["Bodywork", "Mechanical", "Wheels", "Towing"]) {
  test(`${category}: common Chat projection preserves vehicle, photos, city and status`, async () => {
    const data = row({ car_model: category });
    const f = fixture(async () => reply(data));
    assert.deepEqual(await f.api.getMessageConversationContext(request, offer), data);
    assert.deepEqual(f.calls, [{ name: "get_message_conversation_context", args: { p_request_id: request, p_offer_id: offer } }]);
  });
}
test("direct_message uses null offer and validates target without client-side role authority", async () => {
  const value = row({ offer_id: null, request_type: "direct_message", target_workshop_id: other });
  const f = fixture(async () => reply(value));
  assert.deepEqual(await f.api.getMessageConversationContext(request, null), value);
  assert.equal((f.calls[0].args as { p_offer_id: unknown }).p_offer_id, null);
});
test("empty images and nullable request metadata for offer conversations", async () => {
  const value = row({ images: [], request_type: null });
  assert.deepEqual(await fixture(async () => reply(value)).api.getMessageConversationContext(request, offer), value);
});
test("only approved fields are projected, image metadata is not exposed", async () => {
  const value = row({ private_field: "not-for-context", images: [{ url: "https://example.invalid/a", path: "private" }] });
  const result = await fixture(async () => reply(value)).api.getMessageConversationContext(request, offer);
  assert.equal(result && "private_field" in result, false);
  assert.deepEqual(result?.images, [{ url: "https://example.invalid/a" }]);
});
test("draft has no RPC or additional auth observer", async () => {
  const f = fixture();
  assert.equal(await f.api.getMessageConversationContext("draft", null), null);
  f.api.observeMessageConversationContext("draft", null, () => assert.fail("Draft remains local"))();
  assert.equal(f.calls.length, 0); assert.equal(f.stats().subscriptions, 0);
});
for (const [label, data] of Object.entries({
  missing: null, notRows: {}, many: [{ request_data: row() }, { request_data: row() }],
  nullRow: [null], envelope: [{}], stringJson: [{ request_data: JSON.stringify(row()) }],
  arrayJson: [{ request_data: [] }], nullJson: [{ request_data: null }],
  wrongRequest: [{ request_data: row({ request_id: other }) }],
  wrongOffer: [{ request_data: row({ offer_id: other }) }],
  missingOffer: [{ request_data: row({ offer_id: undefined }) }],
  nullOffer: [{ request_data: row({ offer_id: null }) }],
  invalidBrand: [{ request_data: row({ car_brand: null }) }],
  missingCity: [{ request_data: row({ city: undefined }) }],
  invalidType: [{ request_data: row({ request_type: {} }) }],
  invalidTarget: [{ request_data: row({ target_workshop_id: "invalid" }) }],
  invalidImages: [{ request_data: row({ images: null }) }],
  invalidImage: [{ request_data: row({ images: [null] }) }],
  invalidUrl: [{ request_data: row({ images: [{ url: 123 }] }) }],
})) test(`${label}: invalid response rejected without fallback/retry`, async () => {
  const f = fixture(async () => ({ data, error: null }));
  await assert.rejects(f.api.getMessageConversationContext(request, offer), { message: "Contextul conversației nu este disponibil." });
  assert.equal(f.calls.length, 1);
});
for (const value of [row({ offer_id: null }), row({ offer_id: null, request_type: "direct_message" })]) {
  test("null offer cannot masquerade as an ordinary request or unaddressed direct message", async () => {
    await assert.rejects(fixture(async () => reply(value)).api.getMessageConversationContext(request, null));
  });
}
test("invalid request/offer input performs no RPC", async () => {
  const f = fixture();
  await assert.rejects(f.api.getMessageConversationContext("invalid", offer));
  await assert.rejects(f.api.getMessageConversationContext(request, ""));
  assert.equal(f.calls.length, 0);
});
test("absent/unauthorized request is neutral", async () => {
  const f = fixture(async () => ({ data: [], error: null }));
  assert.equal(await f.api.getMessageConversationContext(request, offer), null);
});
test("RPC denial wins even when a body is supplied, with no raw error exposed", async () => {
  const f = fixture(async () => ({ ...reply(), error: { code: "42501", message: "private error" } }));
  await assert.rejects(f.api.getMessageConversationContext(request, offer), { message: "Contextul conversației nu este disponibil." });
  assert.equal(f.calls.length, 1);
});
for (const user of ["customer", "workshop"]) test(`${user}: context relies on session + server RPC, not roleParam`, async () => {
  const f = fixture(); const values: (Context | null)[] = [];
  const stop = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit(user);
  assert.equal(f.calls.length, 0, "RPC must run outside auth callback");
  f.runJobs(); await flush();
  assert.equal(values.at(-1)?.request_id, request);
  stop(); assert.equal(f.stats().active, 0);
});
test("missing identity never loads context", () => {
  const f = fixture(); const values: (Context | null)[] = [];
  const stop = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit(null); f.runJobs();
  assert.deepEqual(values, [null, null]); assert.equal(f.calls.length, 0); stop();
});
test("session switch rejects a late result from the previous identity", async () => {
  const old = deferred<Reply>(); const current = deferred<Reply>(); let count = 0;
  const f = fixture(() => ++count === 1 ? old.promise : current.promise);
  const values: (Context | null)[] = [];
  const stop = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit("old"); f.runJobs(); f.emit("new", "SIGNED_IN"); f.runJobs();
  current.resolve(reply(row({ car_model: "New" }))); await flush();
  old.resolve(reply(row({ car_model: "Old" }))); await flush();
  assert.equal(values.at(-1)?.car_model, "New"); stop();
});
test("logout clears existing context and suppresses pending results", async () => {
  const pending = deferred<Reply>(); let count = 0;
  const f = fixture(async () => ++count === 1 ? reply() : pending.promise);
  const values: (Context | null)[] = [];
  const stop = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit("user"); f.runJobs(); await flush(); assert.ok(values.at(-1));
  f.emit("user", "TOKEN_REFRESHED"); f.runJobs(); f.emit(null, "SIGNED_OUT");
  pending.resolve(reply()); await flush(); assert.equal(values.at(-1), null); stop();
});
test("conversation switch with same request and another offer cannot receive old context", async () => {
  const pending = deferred<Reply>(); let count = 0;
  const f = fixture(async () => ++count === 1 ? pending.promise : reply(row({ offer_id: other })));
  const values: (Context | null)[] = [];
  const stopA = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit("user"); f.runJobs(); stopA();
  const stopB = f.api.observeMessageConversationContext(request, other, value => values.push(value));
  f.emit("user"); f.runJobs(); await flush();
  pending.resolve(reply()); await flush();
  assert.equal(values.at(-1)?.offer_id, other);
  stopB(); assert.deepEqual(f.stats(), { subscriptions: 2, unsubscribes: 2, active: 0 });
});
test("cleanup cancels scheduled work and ignores completion after unmount", async () => {
  const pending = deferred<Reply>(); const f = fixture(() => pending.promise);
  const values: (Context | null)[] = [];
  let stop = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit("user"); stop(); f.runJobs(); assert.equal(f.calls.length, 0);
  stop = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit("user"); f.runJobs(); stop(); const size = values.length;
  pending.resolve(reply()); await flush(); assert.equal(values.length, size);
});
test("transport or RPC failure stays neutral with no automatic retry", async () => {
  const f = fixture(async () => { throw new Error("Synthetic transport failure"); });
  const values: (Context | null)[] = [];
  const stop = f.api.observeMessageConversationContext(request, offer, value => values.push(value));
  f.emit("user"); f.runJobs(); await flush(); f.runJobs();
  assert.equal(values.at(-1), null); assert.equal(f.calls.length, 1); stop();
});
test("superseded scheduled session does not launch a stale RPC", async () => {
  const f = fixture(); const stop = f.api.observeMessageConversationContext(request, offer, () => {});
  f.emit("old"); f.emit("new", "SIGNED_IN"); f.runJobs(); await flush();
  assert.equal(f.calls.length, 1); stop();
});
test("page effect scopes updates and exposes observer cleanup", () => {
  const start = page.indexOf('  useEffect(() => {\n    return observeMessageConversationContext');
  const effect = page.slice(start, page.indexOf('\n\n', start));
  assert.match(effect, /\[requestId, offerId\]/);
  const cleanup = () => {};
  let returned: unknown;
  let state: unknown;
  new Function('useEffect', 'observeMessageConversationContext', 'setRequestContext', 'requestId', 'offerId', effect)(
    (fn: () => unknown) => { returned = fn(); },
    (r: string, o: string, publish: (v: unknown) => void) => {
      assert.equal(r, request); assert.equal(o, offer); publish(null); return cleanup;
    }, (value: unknown) => { state = value; }, request, offer,
  );
  assert.strictEqual(returned, cleanup);
  assert.deepEqual(state, { requestId: request, offerId: offer, data: null });
});
test("render hides previous conversation before effect runs; draft remains local", () => {
  const start = page.indexOf('  const requestData =');
  const expression = page.slice(start, page.indexOf(';', start) + 1);
  const render = new Function('isDirectDraft', 'directWorkshopId', 'requestContext', 'requestId', 'offerId', expression+'\nreturn requestData;');
  const cached = { requestId: request, offerId: offer, data: row() };
  assert.equal(render(false, null, cached, other, offer), null);
  assert.equal(render(false, null, cached, request, other), null);
  assert.deepEqual(render(false, null, cached, request, offer), row());
  assert.deepEqual(render(true, other, cached, 'draft', null), {
    car_brand: 'Mesaj direct', car_model: 'Service', city: '-', status: 'open', images: [],
    request_type: 'direct_message', target_workshop_id: other,
  });
});
test("context is isolated from message subscriptions, reads and draft creation", () => {
  assert.doesNotMatch(source, /\.from\(|\.channel\(|service_role|console\./);
  assert.doesNotMatch(page, /const loadRequest =|void loadRequest\(/);
  const beforeDraftMutation = page.split('const resolveMessageRequest')[0];
  assert.doesNotMatch(beforeDraftMutation, /\.from\("repair_requests"\)/);
  assert.match(page, /messageOfferId === offerId/);
  assert.match(page, /getConversationPeerKey\(requestId, offerId\)/);
  assert.match(page, /filter: `request_id=eq\.\$\{requestId\}`/);
  assert.match(page, /offer_id: isDirectDraft \? null : offerId/);
  assert.match(page, /setMessages\(\[\]\);\s*setMessagesLoading\(false\);\s*void getUser\(\)/);
});
