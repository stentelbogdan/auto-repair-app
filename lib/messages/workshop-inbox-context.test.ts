import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = ts.createSourceFile("MessagesInbox.tsx", read("../../app/components/MessagesInbox.tsx"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loader: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "loadConversations" &&
    node.initializer && ts.isCallExpression(node.initializer)) loader = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(loader);
const functions = source.statements.filter(ts.isFunctionDeclaration)
  .filter(node => node.name?.text !== "MessagesInbox").map(node => node.getText(source)).join("\n");
function compile(value: string) {
  return ts.transpileModule(value, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
}
const loaderCode = compile(`${functions}\nreturn (${loader.getText(source)});`);
const readerCode = compile(read("../supabase/message-conversation-context.ts"));
const formatStatus: (status: string) => string = new Function(compile(`${functions}\nreturn formatStatus;`))();
const requestId = "10000000-0000-4000-8000-000000000001";
const offerId = "20000000-0000-4000-8000-000000000001";
const secondOfferId = "20000000-0000-4000-8000-000000000002";
const serviceId = "30000000-0000-4000-8000-000000000001";
const customerId = "40000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
type Reply = { data: unknown; error: unknown };
type Conversation = {
  requestId: string; offerId: string | null; title: string; city: string; status: string;
  image: string; peerName: string; lastMessage: string; lastMessageTime: string; unreadCount: number;
};
function context(extra: Row = {}) {
  return { request_id: requestId, offer_id: offerId, car_brand: "Synthetic", car_model: "Model",
    city: "City", status: "in_progress", images: [{ url: "https://example.invalid/photo" }],
    request_type: "repair", target_workshop_id: null, ...extra };
}
const reply = (value = context()): Reply => ({ data: [{ request_data: value }], error: null });
function offer(id = offerId) {
  return { id, request_id: requestId, workshop_user_id: serviceId, workshop_name: "Service",
    status: "accepted", created_at: "2026-11-01T10:00:00Z" };
}
function message(extra: Row = {}) {
  return { id: "message-1", request_id: requestId, offer_id: offerId, sender_id: customerId,
    sender_role: "customer", message: "2", images: [], read_at: null,
    created_at: "2026-11-02T10:00:00Z", ...extra };
}
function fixture(options: {
  role?: "customer" | "workshop"; authenticated?: boolean;
  respond?: (args: { p_request_id: string; p_offer_id: string }) => Promise<Reply>;
  offers?: Row[]; requests?: Row[]; messages?: Row[]; inboxStates?: Row[];
} = {}) {
  const role = options.role ?? "workshop";
  const userId = role === "workshop" ? serviceId : customerId;
  const offers = options.offers ?? [offer()];
  const tables: Record<string, Row[]> = { repair_offers: offers, repair_requests: options.requests ?? [],
    messages: options.messages ?? [message()], conversation_inbox_states: options.inboxStates ?? [] };
  const queries: { table: string; filters: [string, unknown][] }[] = [];
  const calls: { name: string; args: { p_request_id: string; p_offer_id: string } }[] = [];
  const published: Conversation[][] = [], navigation: string[] = [];
  const generation = { current: 0 }, session = { current: 0 };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: userId } } }) },
    rpc: async (name: string, args: { p_request_id: string; p_offer_id: string }) => {
      calls.push({ name, args });
      assert.equal(name, "get_message_conversation_context");
      return options.respond ? options.respond(args) : reply();
    },
    from: (table: string) => {
      const query = { table, filters: [] as [string, unknown][] };
      queries.push(query);
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { query.filters.push([column, value]); return builder; },
        in: (column: string, value: unknown[]) => { query.filters.push([column, value]); return builder; },
        order: () => builder,
        then: (resolve: (result: Reply) => unknown) => Promise.resolve(resolve({ error: null,
          data: tables[table].filter(row => query.filters.every(([key, value]) =>
            Array.isArray(value) ? value.includes(row[key]) : row[key] === value)),
        })),
      };
      return builder;
    },
  };
  const reader: Partial<typeof import("../supabase/message-conversation-context")> = {};
  new Function("require", "exports", readerCode)(() => ({ supabase }), reader);
  const environment = {
    role, supabase, getMessageConversationContext: reader.getMessageConversationContext,
    loadConversationsGenerationRef: generation, loadConversationsSessionRef: session,
    invalidateLoadConversationsGeneration: () => ++generation.current,
    realtimeInsertVersionRef: { current: 0 }, currentUserIdRef: { current: "" },
    uiAppliedThisMountRef: { current: new Map() }, lastRealtimeConversationKeyRef: { current: null },
    logPerf: () => {}, console: { error: () => {} }, setLoading: () => {}, setRealtimeUserId: () => {},
    router: { push: (url: string) => navigation.push(url) },
    setConversations: (rows: Conversation[]) => published.push(rows),
    getConversationPeerKey: (request: string, offer: string | null) => `${request}::${offer ?? "direct"}`,
    loadConversationPeers: async () => new Map<string, { peerDisplayName: string }>([
      ...offers.map(row => [`${row.request_id}::${row.id}`, { peerDisplayName: "Existing peer name" }] as const),
      [`${requestId}::direct`, { peerDisplayName: "Direct peer" }] as const,
    ]),
    applyPendingInboxMutations: (rows: Conversation[]) => ({ nextConversations: rows,
      uiAppliedMutations: [], dbConfirmedMutations: [] }),
  };
  const load: (showLoader?: boolean) => Promise<void> = new Function(...Object.keys(environment), loaderCode)(...Object.values(environment));
  return { load, calls, queries, published, navigation, session,
    cards: () => published.at(-1) ?? [] };
}

for (const category of ["Bodywork", "Mechanical", "Wheels", "Towing"]) {
  test(`${category}: Service card restores authorized vehicle, preview, city and current request status`, async () => {
    const f = fixture({ respond: async () => reply(context({ car_model: category })) });
    await f.load();
    assert.deepEqual(f.cards(), [{ requestId, offerId, title: `Synthetic ${category}`, city: "City",
      status: "in_progress", image: "https://example.invalid/photo", peerName: "Existing peer name",
      lastMessage: "2", lastMessageTime: "2026-11-02T10:00:00Z", unreadCount: 1 }]);
    assert.deepEqual(f.calls, [{ name: "get_message_conversation_context", args: { p_request_id: requestId, p_offer_id: offerId } }]);
    assert.deepEqual(f.queries.filter(query => query.table === "repair_requests").map(query => query.filters),
      [[["request_type", "direct_message"], ["target_workshop_id", serviceId]]]);
    assert.equal(formatStatus(f.cards()[0].status), "În lucru");
  });
}
test("Client keeps its owner-filtered request query and existing presentation", async () => {
  const f = fixture({ role: "customer", requests: [{ ...context(), id: requestId, user_id: customerId }] });
  await f.load();
  assert.equal(f.calls.length, 0);
  assert.equal(f.cards()[0].title, "Synthetic Model");
  assert.ok(f.queries.some(query => query.table === "repair_requests" &&
    query.filters.some(([key]) => key === "id") && query.filters.some(([key, value]) => key === "user_id" && value === customerId)));
});
for (const [name, result] of [
  ["absent or unauthorized", { data: [], error: null }],
  ["RPC refusal", { data: null, error: { code: "42501" } }],
  ["invalid payload", { data: [{ request_data: {} }], error: null }],
  ["wrong offer", reply(context({ offer_id: secondOfferId }))],
] as [string, Reply][]) {
  test(`${name}: neutral context, no direct fallback or loss of conversation`, async () => {
    const f = fixture({ respond: async () => result });
    await f.load();
    assert.equal(f.cards().length, 1);
    assert.equal(f.cards()[0].image, "");
    assert.equal(f.cards()[0].title, "Conversație ofertă");
    assert.equal(formatStatus(f.cards()[0].status), "Context indisponibil");
    assert.equal(f.cards()[0].peerName, "Existing peer name");
    assert.equal(f.cards()[0].unreadCount, 1);
    assert.equal(f.queries.filter(query => query.table === "repair_requests").length, 1);
  });
}
test("same request, different offers: denied context cannot borrow another conversation's authorization", async () => {
  const f = fixture({ offers: [offer(), offer(secondOfferId)],
    messages: [message(), message({ id: "message-2", offer_id: secondOfferId })],
    respond: async args => args.p_offer_id === offerId ? reply() : { data: [], error: null } });
  await f.load();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.cards().map(card => [card.offerId, card.title, card.unreadCount]),
    [[offerId, "Synthetic Model", 1], [secondOfferId, "Conversație ofertă", 1]]);
});
test("direct_message discovery and presentation remain separate", async () => {
  const f = fixture({ offers: [], requests: [{ ...context(), id: requestId, request_type: "direct_message", target_workshop_id: serviceId }],
    messages: [message({ offer_id: null })] });
  await f.load();
  assert.equal(f.calls.length, 0);
  assert.equal(f.cards()[0].offerId, null);
  assert.equal(f.cards()[0].title, "Direct peer");
  assert.equal(f.cards()[0].city, "Conversație directă");
});
test("empty/history dataUrl images retain the existing preview rules", async () => {
  for (const images of [[], [{ dataUrl: "data:image/png;base64,c3ludGhldGlj" }]]) {
    const f = fixture({ respond: async () => reply(context({ images })) });
    await f.load();
    assert.equal(f.cards()[0].image, images[0]?.dataUrl ?? "");
  }
});
test("hidden conversations, system messages and already-read messages keep existing semantics", async () => {
  const f = fixture({ offers: [offer(), offer(secondOfferId)],
    messages: [message({ sender_role: "system", message: "hidden system" }),
      message({ read_at: "2026-11-03T10:00:00Z" }), message({ offer_id: secondOfferId })],
    inboxStates: [{ user_id: serviceId, request_id: requestId, offer_id: secondOfferId, hidden_at: "2026-11-03T10:00:00Z" }],
    respond: async args => reply(context({ offer_id: args.p_offer_id })) });
  await f.load();
  assert.equal(f.cards().length, 1);
  assert.equal(f.cards()[0].unreadCount, 0);
  assert.equal(f.cards()[0].lastMessage, "2");
});
test("silent refetch refreshes the real request status without changing message ordering", async () => {
  let status = "in_progress";
  const f = fixture({ respond: async () => reply(context({ status })) });
  await f.load();
  status = "completed";
  await f.load(false);
  assert.equal(formatStatus(f.cards()[0].status), "Finalizată");
  assert.equal(f.cards()[0].lastMessageTime, "2026-11-02T10:00:00Z");
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
test("late context after session invalidation/unmount cannot publish", async () => {
  const pending = deferred<Reply>(), started = deferred<void>();
  const f = fixture({ respond: () => { started.resolve(); return pending.promise; } });
  const loading = f.load();
  await started.promise;
  f.session.current++;
  pending.resolve(reply());
  await loading;
  assert.equal(f.published.length, 0);
});
test("overlapping refetches cannot replace newer context with a late response", async () => {
  const pending = deferred<Reply>(), started = deferred<void>();
  let count = 0;
  const f = fixture({ respond: () => {
    if (++count === 1) { started.resolve(); return pending.promise; }
    return Promise.resolve(reply(context({ status: "completed" })));
  } });
  const old = f.load();
  await started.promise;
  await f.load(false);
  pending.resolve(reply());
  await old;
  assert.equal(f.published.length, 1);
  assert.equal(f.cards()[0].status, "completed");
});
test("no session means login without context/table queries", async () => {
  const f = fixture({ authenticated: false });
  await f.load();
  assert.deepEqual(f.navigation, ["/login"]);
  assert.equal(f.calls.length + f.queries.length, 0);
});
