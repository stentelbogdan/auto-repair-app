import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../../app/workshops/in-workshop/[id]/page.tsx");
const requestId = "10000000-0000-4000-8000-000000000001";
const offerId = "20000000-0000-4000-8000-000000000002";
const workshopId = "30000000-0000-4000-8000-000000000003";
function detail(category = "bodywork") {
  return { id: requestId, car_brand: "Synthetic", car_model: "Model", car_year: "2025", city: "City",
    license_plate: "TEST", damage_type: "other", description: "Synthetic description",
    images: [{ name: "Synthetic photo", url: "https://example.invalid/photo" }],
    status: "in_progress", accepted_offer_id: offerId, service_type: category, service_details: null,
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null,
    route_distance_meters: null, route_duration_seconds: null, route_paths: null,
    towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null,
    request_type: "repair", target_workshop_id: null, created_at: "2026-11-01T10:00:00Z" };
}
type Reply = { data: unknown; error: unknown };
type Node = { props: Record<string, unknown> };
function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}
function fixture(reply: () => Promise<Reply> = async () => ({ data: [{ request_data: detail() }], error: null }), user = true) {
  const states: unknown[] = [], effects: (() => unknown)[] = [], navigation: string[] = [];
  const calls: { name: string; args: unknown }[] = [], directReads: string[] = [], diagnostics: unknown[] = [];
  let cursor = 0;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: user ? { id: workshopId } : null } }) },
    rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return reply(); },
    from: (table: string) => { directReads.push(table); throw new Error("Direct table access is forbidden"); },
  };
  const reader: Record<string, unknown> = {};
  new Function("require", "exports", compile(read("./workshop-request-detail.ts")))(() => ({ supabase }), reader);
  const exported: { default?: () => Node } = {};
  const jsx = (_type: unknown, props: Record<string, unknown>) => ({ props });
  new Function("require", "exports", "console", "alert", compile(page))((name: string) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return {
      useEffect: (effect: () => unknown) => effects.push(effect),
      useState: (initial: unknown) => { const i = cursor++; if (!(i in states)) states[i] = initial;
        return [states[i], (value: unknown) => { states[i] = value; }]; },
    };
    if (name === "next/navigation") return { useParams: () => ({ id: requestId }),
      useRouter: () => ({ push: (url: string) => navigation.push(url), back() {} }) };
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "@/lib/supabase/profiles") return { getOwnProfile: async () => ({ data: { workshop_name: "Service" } }) };
    if (name === "@/lib/supabase/workshop-request-detail") return reader;
    if (name === "lucide-react" || name.startsWith("@/app/components/")) return {};
    throw new Error(`Unexpected offline import: ${name}`);
  }, exported, { log: (...values: unknown[]) => diagnostics.push(values), error: (...values: unknown[]) => diagnostics.push(values) },
  (value: unknown) => diagnostics.push(value));
  const render = () => { cursor = 0; effects.length = 0; return exported.default!(); };
  return { states, calls, directReads, diagnostics, navigation, render, load: async () => {
    render(); effects[0](); await new Promise(resolve => setImmediate(resolve));
  } };
}

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  test(`${category}: in-progress request loads through the validated Service RPC`, async () => {
    const data = detail(category), f = fixture(async () => ({ data: [{ request_data: data }], error: null }));
    await f.load();
    assert.deepEqual(f.calls, [{ name: "get_workshop_repair_request_detail", args: { p_request_id: requestId } }]);
    assert.deepEqual(f.directReads, []);
    assert.equal(f.states[0], false);
    assert.deepEqual(f.states[1], Object.fromEntries(["id", "car_brand", "car_model", "car_year", "city",
      "license_plate", "damage_type", "description", "images", "status", "accepted_offer_id"].map(key => [key, data[key as keyof typeof data]])));
    assert.ok(!JSON.stringify(f.render()).includes("Lucrarea nu a fost găsită"));
  });
}
for (const [label, result] of Object.entries({
  absent: { data: [], error: null },
  denied: { data: null, error: { code: "42501", message: "Private synthetic error" } },
  wrongId: { data: [{ request_data: { ...detail(), id: offerId } }], error: null },
  malformed: { data: [{ request_data: "invalid" }], error: null },
})) test(`${label}: neutral missing-context presentation, no fallback or raw error disclosure`, async () => {
  let failed = false;
  const f = fixture(async () => failed ? result : { data: [{ request_data: detail() }], error: null });
  await f.load(); assert.ok(f.states[1]);
  failed = true; await f.load();
  assert.equal(f.states[1], null); assert.equal(f.states[0], false);
  assert.ok(JSON.stringify(f.render()).includes("Lucrarea nu a fost găsită"));
  assert.deepEqual(f.directReads, []); assert.deepEqual(f.diagnostics, []);
  assert.equal(f.calls.length, 2, "one RPC per load, without retry");
});
test("transport error remains neutral and does not retry or issue mutations", async () => {
  const f = fixture(async () => { throw new Error("Private transport details"); }); await f.load();
  assert.equal(f.states[1], null); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.directReads, []); assert.deepEqual(f.diagnostics, []);
});
test("missing session navigates to login without calling the context RPC", async () => {
  const f = fixture(undefined, false); await f.load();
  assert.deepEqual(f.navigation, ["/login"]); assert.deepEqual(f.calls, []);
});
test("Actualizează passes the request ID, not offer or appointment ID", () => {
  const source = ts.createSourceFile("won-jobs.tsx", read("../../app/workshops/won-jobs/page.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let action: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.children.some(child => ts.isJsxText(child) && child.text.trim() === "Actualizează")) {
      const attribute = node.openingElement.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === "onClick");
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) action = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(action);
  const urls: string[] = [];
  new Function("router", "job", compile(`const action = ${action.getText(source)}; action();`))(
    { push: (url: string) => urls.push(url) }, { requestId, offerId, appointment: { id: workshopId } });
  assert.deepEqual(urls, [`/workshops/in-workshop/${requestId}`]);
});
test("progress, photos and Chat destinations retain the loaded request and accepted offer IDs", async () => {
  const f = fixture(); await f.load();
  const actions = new Map<string, () => void>();
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const props = (value as Node).props;
    if (typeof props.title === "string" && typeof props.onClick === "function") actions.set(props.title, props.onClick as () => void);
    visit(props.children);
  }
  visit(f.render());
  for (const title of ["Ceas", "Fă poză", "Chat client", "Poze dosar"]) { assert.ok(actions.has(title)); actions.get(title)!(); }
  assert.deepEqual(f.navigation, [`/workshops/in-workshop/${requestId}/status`, `/workshops/in-workshop/${requestId}/photos`,
    `/chat/${requestId}?offerId=${offerId}&role=workshop`, `/workshops/in-workshop/${requestId}/photos-folder`]);
  assert.equal(f.calls.length, 1, "navigation does not update progress or create appointments");
  assert.deepEqual(f.directReads, []);
});
