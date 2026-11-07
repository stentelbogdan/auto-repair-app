import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../../app/workshops/in-workshop/[id]/status/page.tsx");
const requestId = "10000000-0000-4000-8000-000000000001";
const offerId = "20000000-0000-4000-8000-000000000002";
const workshopId = "30000000-0000-4000-8000-000000000003";
const appointmentId = "40000000-0000-4000-8000-000000000004";
type Reply = { data: unknown; error: unknown };
type Node = { type: unknown; props: Record<string, unknown> };
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

function detail(category = "bodywork") {
  return { id: requestId, car_brand: "Synthetic", car_model: "Model", car_year: "2025", city: "City",
    license_plate: null, damage_type: null, description: null, images: [], status: "in_progress",
    accepted_offer_id: offerId, service_type: category, service_details: null,
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null,
    route_distance_meters: null, route_duration_seconds: null, route_paths: null,
    towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null,
    request_type: "repair", target_workshop_id: null, created_at: "2026-11-01T10:00:00Z" };
}

function fixture(options: {
  category?: string; user?: boolean; authError?: unknown; progressError?: unknown;
  saveError?: unknown; saveResult?: Reply; status?: string | null;
  reply?: () => Promise<Reply>;
  progressReply?: (id: string) => Promise<Reply>;
} = {}) {
  const slots: unknown[] = [], effects: (() => () => void)[] = [], urls: string[] = [];
  const calls: { name: string; args: unknown }[] = [], writes: { table: string; data: unknown }[] = [];
  const queries: { table: string; filters: [string, unknown][] }[] = [];
  let cursor = 0, routeId = requestId;
  let storedStatus = options.status;
  const router = { push: (url: string) => urls.push(url) };
  const tracking = { markDisconnected() {}, stop: async () => true, state: "idle", error: null };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: workshopId } }, error: options.authError ?? null }) },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "save_work_progress_update") {
        if (options.saveResult) return options.saveResult;
        if (!options.saveError) storedStatus = (args as { p_status: string }).p_status;
        return { data: [{ id: routeId, status: storedStatus === "Ready" ? "completed" : "in_progress" }], error: options.saveError ?? null };
      }
      if (name === "get_workshop_latest_work_progress") {
        const id = (args as { p_request_id: string }).p_request_id;
        return options.progressReply ? options.progressReply(id) : {
          data: storedStatus ? [{ request_id: id, status: storedStatus }] : [], error: options.progressError ?? null,
        };
      }
      return options.reply ? options.reply() : { data: [{ request_data: detail(options.category) }], error: null };
    },
    from: (table: string) => {
      if (table === "work_progress_updates") throw new Error("Direct progress SELECT forbidden");
      const filters: [string, unknown][] = [];
      queries.push({ table, filters });
      const q = {
        select: () => {
          if (table === "repair_requests") throw new Error("Forbidden direct request access");
          return q;
        },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
        order: () => q, limit: () => q,
        maybeSingle: async () => {
          if (table === "repair_appointments") return { data: { id: appointmentId }, error: null };
          if (table === "towing_live_locations") return { data: { is_active: false }, error: null };
          throw new Error(`Unexpected query: ${table}`);
        },
        insert: (data: unknown) => { writes.push({ table, data }); throw new Error("Direct insert forbidden"); },
        update: (data: unknown) => { writes.push({ table, data }); throw new Error("Direct update forbidden"); },
      };
      return q;
    },
  };
  const modules: Record<string, unknown> = {};
  function load(name: string): unknown {
    if (name in modules) return modules[name];
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Node["props"]) => ({ type, props }), jsxs: (type: unknown, props: Node["props"]) => ({ type, props }) };
    if (name === "react") return {
      useEffect: (fn: () => () => void) => effects.push(fn),
      useState: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = initial;
        return [slots[i], (value: unknown) => { slots[i] = value; }]; },
      useRef: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    };
    if (name === "next/navigation") return { useParams: () => ({ id: routeId }), useRouter: () => router };
    if (name === "@/lib/towing/TowingLiveTrackingProvider") return { useTowingLiveTrackingSession: () => tracking };
    const paths: Record<string, string> = {
      "@/lib/supabase/workshop-request-detail": "./workshop-request-detail.ts",
      "@/lib/supabase/workshop-work-progress": "./workshop-work-progress.ts",
      "@/lib/supabase/work-progress": "./work-progress.ts",
      "@/lib/work-progress/workflows": "../work-progress/workflows.ts",
      "@/lib/repair-requests/service-types": "../repair-requests/service-types.ts",
    };
    assert.ok(paths[name], `Unexpected offline import: ${name}`);
    const exported = {};
    new Function("require", "exports", compile(read(paths[name])))(load, exported);
    modules[name] = exported;
    return exported;
  }
  const exported: { default?: () => Node } = {};
  new Function("require", "exports", compile(page))(load, exported);
  const render = () => { cursor = 0; effects.length = 0; return exported.default!(); };
  const buttons = () => {
    const result: Node[] = [];
    function visit(node: unknown) {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const n = node as Node;
      if (n.type === "button" && "aria-pressed" in n.props) result.push(n);
      visit(n.props.children);
    }
    visit(render()); return result;
  };
  const start = () => { render(); return effects[0](); };
  return { calls, writes, queries, urls, render, buttons, start,
    load: async () => { const cleanup = start(); await settle(); return cleanup; },
    setRoute: (id: string) => { routeId = id; },
    click: async (index = 0) => { const button = buttons()[index]; assert.ok(button);
      (button.props.onClick as () => void)(); await settle(); },
  };
}

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  test(`${category}: authorized context initializes identity and passes the exact request to the original save helper`, async () => {
    const f = fixture({ category }); await f.load();
    assert.deepEqual(f.calls, [
      { name: "get_workshop_repair_request_detail", args: { p_request_id: requestId } },
      { name: "get_workshop_latest_work_progress", args: { p_request_id: requestId } },
    ]);
    assert.ok(JSON.stringify(f.render()).includes("Synthetic Model"));
    assert.ok(f.buttons().every(button => button.props.disabled === false));
    assert.equal(f.queries.some(q => q.table === "repair_requests"), false);
    assert.deepEqual(f.writes, [], "loading never saves progress");
    await f.click();
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.calls[2], { name: "save_work_progress_update", args: {
      p_request_id: requestId, p_status: "Received", p_message: "", p_images: [],
    } });
    assert.equal(f.buttons()[0].props["aria-pressed"], true);
    assert.ok(JSON.stringify(f.render()).includes("Etapa a fost schimbată"));
    if (category === "towing") assert.deepEqual(f.queries.find(q => q.table === "repair_appointments")?.filters,
      [["request_id", requestId], ["offer_id", offerId], ["workshop_id", workshopId], ["status", "confirmed"]]);
  });
}

for (const [name, reply] of Object.entries({
  absent: { data: [], error: null }, denied: { data: null, error: { code: "42501" } },
  invalid: { data: [{ request_data: "invalid" }], error: null },
  wrongId: { data: [{ request_data: { ...detail(), id: offerId } }], error: null },
})) test(`${name}: no fallback and no misleading identity error or saving after failed load`, async () => {
  const f = fixture({ reply: async () => reply }); await f.load();
  assert.equal(f.calls.length, 2); assert.deepEqual(f.writes, []);
  assert.equal(f.queries.some(q => q.table === "repair_requests"), false);
  assert.ok(f.buttons().every(button => button.props.disabled));
  assert.ok(!JSON.stringify(f.render()).includes("Utilizatorul autentificat nu a fost găsit"));
});

test("unauthenticated session redirects without requesting context or saving", async () => {
  const f = fixture({ user: false }); await f.load();
  assert.deepEqual(f.urls, ["/login"]); assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
});
test("auth failure blocks loading and saving", async () => {
  const f = fixture({ authError: new Error("Session expired") }); await f.load();
  assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
  assert.ok(JSON.stringify(f.render()).includes("Session expired"));
});
test("progress RPC refusal blocks saving rather than inventing an initial stage", async () => {
  const f = fixture({ progressError: new Error("Access denied") }); await f.load();
  assert.deepEqual(f.writes, []); assert.ok(f.buttons().every(button => button.props.disabled));
  assert.ok(JSON.stringify(f.render()).includes("Access denied"));
});
test("incompatible existing stage stays blocked and cannot reach the save helper", async () => {
  const f = fixture({ category: "mechanical", status: "Painting" }); await f.load();
  assert.ok(f.buttons().every(button => button.props.disabled)); await f.click();
  assert.deepEqual(f.writes, []);
});
test("reopening a loaded page with denied context clears the previous job and identity", async () => {
  let denied = false;
  const f = fixture({ reply: async () => ({ data: denied ? [] : [{ request_data: detail() }], error: null }) });
  const cleanup = await f.load(); assert.ok(f.buttons().length); cleanup(); denied = true;
  await f.load();
  assert.ok(!JSON.stringify(f.render()).includes("Synthetic Model"));
  assert.deepEqual(f.writes, []); assert.ok(f.buttons().every(button => button.props.disabled));
});
test("a response after unmount cannot restore context", async () => {
  let finish!: (reply: Reply) => void;
  const f = fixture({ reply: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = await f.load(); cleanup();
  finish({ data: [{ request_data: detail() }], error: null }); await settle();
  assert.ok(!JSON.stringify(f.render()).includes("Synthetic Model")); assert.deepEqual(f.writes, []);
});
test("request switch ignores the old response and keeps the new authorized context", async () => {
  let finish!: (reply: Reply) => void, count = 0;
  const nextId = "10000000-0000-4000-8000-000000000005";
  const f = fixture({ reply: () => ++count === 1 ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ data: [{ request_data: { ...detail(), id: nextId, car_model: "New" } }], error: null }) });
  const cleanup = await f.load(); cleanup(); f.setRoute(nextId); await f.load();
  finish({ data: [{ request_data: detail() }], error: null }); await settle();
  assert.ok(JSON.stringify(f.render()).includes("Synthetic New"));
  await f.click();
  assert.equal((f.calls.at(-1)?.args as { p_request_id: string }).p_request_id, nextId);
});
test("an atomic save error never presents success or falls back to direct writes", async () => {
  const f = fixture({ saveError: new Error("Progress refused") }); await f.load(); await f.click();
  assert.equal(f.writes.length, 0); assert.equal(f.buttons()[0].props["aria-pressed"], false);
  assert.ok(JSON.stringify(f.render()).includes("Progress refused"));
});
test("zero RPC rows cannot produce false success or automatic retry", async () => {
  const f = fixture({ saveResult: { data: [], error: null } }); await f.load(); await f.click();
  assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 3); assert.equal(f.buttons()[0].props["aria-pressed"], false);
  assert.ok(JSON.stringify(f.render()).includes("Starea lucrării nu a putut fi actualizată"));
  assert.ok(!JSON.stringify(f.render()).includes("Etapa a fost schimbată"));
});
test("selecting the active stage does not insert duplicate progress", async () => {
  const f = fixture({ status: "Received" }); await f.load(); await f.click();
  assert.deepEqual(f.writes, []);
});
test("the original Ready transition is unchanged", async () => {
  const f = fixture(); await f.load(); await f.click(f.buttons().length - 1);
  assert.deepEqual(f.calls[2], { name: "save_work_progress_update", args: {
    p_request_id: requestId, p_status: "Ready", p_message: "", p_images: [],
  } });
  assert.ok(JSON.stringify(f.render()).includes("Etapa a fost schimbată"));
});

for (const [category, stage, index] of [
  ["bodywork", "Painting", 4], ["mechanical", "Diagnosis", 1],
  ["wheels", "Inspection", 1], ["towing", "Dispatch", 1],
] as const) test(`${category}: saved latest stage is visible again after reloading Clock`, async () => {
  const f = fixture({ category }); const cleanup = await f.load(); await f.click(index);
  assert.equal(f.buttons()[index].props["aria-pressed"], true);
  assert.equal((f.calls.at(-1)?.args as { p_status: string }).p_status, stage);
  cleanup(); await f.load();
  assert.equal(f.buttons()[index].props["aria-pressed"], true);
  assert.equal(f.calls.filter(c => c.name === "save_work_progress_update").length, 1);
  assert.deepEqual(f.writes, []);
});
for (const data of [null, [{ request_id: offerId, status: "Received" }], [{ request_id: requestId, status: null }],
  [{ request_id: requestId, status: "Received" }, { request_id: requestId, status: "Ready" }]])
  test(`invalid history ${JSON.stringify(data)} blocks Clock without fallback`, async () => {
    const f = fixture({ progressReply: async () => ({ data, error: null }) }); await f.load(); await f.click();
    assert.ok(f.buttons().every(b => b.props.disabled));
    assert.equal(f.calls.filter(c => c.name === "save_work_progress_update").length, 0);
    assert.deepEqual(f.writes, []);
  });
test("late history response cannot replace a newly loaded request stage", async () => {
  let finish!: (reply: Reply) => void, request = requestId;
  const nextId = "10000000-0000-4000-8000-000000000005";
  const f = fixture({ reply: async () => ({ data: [{ request_data: { ...detail(), id: request } }], error: null }),
    progressReply: async id => id === requestId ? new Promise(resolve => { finish = resolve; })
      : { data: [{ request_id: id, status: "Painting" }], error: null } });
  const cleanup = await f.load(); cleanup(); request = nextId; f.setRoute(nextId); await f.load();
  finish({ data: [{ request_id: requestId, status: "Ready" }], error: null }); await settle();
  assert.equal(f.buttons()[4].props["aria-pressed"], true);
  assert.equal(f.buttons().at(-1)?.props["aria-pressed"], false);
});
test("late history after unmount cannot restore an active stage", async () => {
  let finish!: (reply: Reply) => void;
  const f = fixture({ progressReply: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = await f.load(); cleanup();
  finish({ data: [{ request_id: requestId, status: "Painting" }], error: null }); await settle();
  assert.ok(!f.buttons().some(b => b.props["aria-pressed"]));
});
