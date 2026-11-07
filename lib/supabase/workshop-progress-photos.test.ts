import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const requestId = "10000000-0000-4000-8000-000000000001";
const workshopId = "20000000-0000-4000-8000-000000000002";
const offerId = "30000000-0000-4000-8000-000000000003";
type Reply = { data: unknown; error: unknown };
type Node = { type: unknown; props: Record<string, unknown> };
const settle = () => new Promise(resolve => setImmediate(resolve));
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function detail(id: string, category: string) {
  return { id, car_brand: "Synthetic", car_model: "Model", car_year: "2025", city: "City",
    license_plate: null, damage_type: null, description: null, images: [], status: "in_progress",
    accepted_offer_id: offerId, service_type: category, service_details: null,
    pickup_lat: null, pickup_lng: null, destination_lat: null, destination_lng: null,
    route_distance_meters: null, route_duration_seconds: null, route_paths: null,
    towing_schedule_type: null, towing_requested_at: null, towing_requested_timezone: null,
    request_type: "repair", target_workshop_id: null, created_at: "2026-11-01T10:00:00Z" };
}
function fixture(page: "photos" | "photos-folder", options: {
  category?: string; stage?: string | null; user?: boolean; authError?: unknown;
  detailReply?: (id: string) => Promise<Reply>; latestReply?: () => Promise<Reply>;
  historyReply?: (id: string) => Promise<Reply>;
  saveReply?: () => Promise<Reply>; upload?: (index: number) => Promise<{ error: unknown }>;
  progress?: Reply; offer?: Reply;
} = {}) {
  let cursor = 0, route = requestId;
  const slots: unknown[] = [], effects: (() => (() => void) | void)[] = [], navigation: string[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const uploads: { path: string; contentType: string }[] = [];
  const queries: { table: string; filters: [string, unknown][]; order?: unknown }[] = [];
  const prepared: unknown[] = [];
  const router = { push: (url: string) => navigation.push(url), back() {} };
  const stage = options.stage === undefined ? "Body repair" : options.stage;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: workshopId } }, error: options.authError ?? null }) },
    rpc: async (name: string, args: Record<string, unknown>): Promise<Reply> => {
      calls.push({ name, args });
      if (name === "get_workshop_repair_request_detail") return options.detailReply
        ? options.detailReply(args.p_request_id as string)
        : { data: [{ request_data: detail(args.p_request_id as string, options.category ?? "bodywork") }], error: null };
      if (name === "get_workshop_latest_work_progress") return options.latestReply ? options.latestReply()
        : { data: stage ? [{ request_id: args.p_request_id, status: stage }] : [], error: null };
      if (name === "get_workshop_work_progress_history") return options.historyReply
        ? options.historyReply(args.p_request_id as string) : options.progress ?? { data: [], error: null };
      assert.equal(name, "save_work_progress_update");
      return options.saveReply ? options.saveReply() : { data: [{ id: args.p_request_id,
        status: args.p_status === "Ready" ? "completed" : "in_progress" }], error: null };
    },
    from: (table: string) => {
      assert.equal(page, "photos-folder", "photo submission must use RPCs, never direct table queries");
      assert.equal(table, "repair_offers", `Forbidden direct query/fallback: ${table}`);
      const query: typeof queries[number] = { table, filters: [] }; queries.push(query);
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => { query.filters.push([key, value]); return q; },
        order: (key: string, value: unknown) => { query.order = [key, value]; return q; },
        maybeSingle: async () => options.offer ?? { data: { id: offerId }, error: null },
        then: (resolve: (value: Reply) => unknown) => Promise.resolve(options.progress ?? { data: [], error: null }).then(resolve),
      };
      return q;
    },
    storage: { from: (bucket: string) => {
      assert.equal(bucket, "work-progress", "request-photo registry must remain untouched");
      return {
        upload: async (path: string, file: File, input: { contentType: string }) => {
          assert.ok(file instanceof File); uploads.push({ path, contentType: input.contentType });
          return options.upload ? options.upload(uploads.length) : { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.invalid/work-progress/${path}` } }),
        remove: () => { throw new Error("Unsafe compensating deletion forbidden"); },
      };
    } },
  };
  const modules: Record<string, unknown> = {};
  function load(name: string): unknown {
    if (name in modules) return modules[name];
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Node["props"]) => ({ type, props }), jsxs: (type: unknown, props: Node["props"]) => ({ type, props }) };
    if (name === "react") return {
      useEffect: (fn: typeof effects[number]) => effects.push(fn),
      useState: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = initial;
        return [slots[i], (value: unknown) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
      useRef: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    };
    if (name === "next/navigation") return { useParams: () => ({ id: route }), useRouter: () => router };
    if (name === "lucide-react") return { Camera: "Camera", Images: "Images" };
    if (name === "@/app/components/ImageGallery") return { default: "ImageGallery" };
    if (name === "@/lib/images/prepare-image-for-upload") return { prepareImageForUpload: async (file: File, preset: unknown) => {
      prepared.push(preset); return { file, extension: "jpg", contentType: "image/jpeg" };
    } };
    const paths: Record<string, string> = {
      "@/lib/supabase/workshop-request-detail": "./workshop-request-detail.ts",
      "@/lib/supabase/workshop-work-progress": "./workshop-work-progress.ts",
      "@/lib/supabase/workshop-work-progress-history": "./workshop-work-progress-history.ts",
      "@/lib/supabase/work-progress": "./work-progress.ts",
      "@/lib/work-progress/workflows": "../work-progress/workflows.ts",
      "@/lib/repair-requests/service-types": "../repair-requests/service-types.ts",
    };
    assert.ok(paths[name], `Unexpected offline import ${name}`);
    const exported = {};
    new Function("require", "exports", compile(read(paths[name])))(load, exported);
    modules[name] = exported; return exported;
  }
  const exported: { default?: () => Node } = {};
  new Function("require", "exports", compile(read(`../../app/workshops/in-workshop/[id]/${page}/page.tsx`)))(load, exported);
  const render = () => { cursor = 0; effects.length = 0; return exported.default!(); };
  const nodes = (type: string) => {
    const result: Node[] = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const n = node as Node; if (n.type === type) result.push(n); visit(n.props.children);
    };
    visit(render()); return result;
  };
  const button = () => nodes("button").find(n => /poze/.test(String(n.props.children)))!;
  const start = () => { render(); return effects[0]() as () => void; };
  return { calls, uploads, queries, navigation, prepared, render, nodes, start,
    text: () => JSON.stringify(render()), button,
    load: async () => { const cleanup = start(); await settle(); return cleanup; },
    route: (id: string) => { route = id; },
    images: (count = 1) => {
      const target = { files: Array.from({ length: count }, (_, i) => new File(["synthetic"], `${i}.jpg`, { type: "image/jpeg" })), value: "" };
      (nodes("input")[0].props.onChange as (e: unknown) => void)({ target });
    },
    message: (value: string) => (nodes("textarea")[0].props.onChange as (e: unknown) => void)({ target: { value } }),
    submit: async () => { (button().props.onClick as () => void)(); await settle(); },
    saves: () => calls.filter(c => c.name === "save_work_progress_update"),
  };
}

for (const [category, stage] of Object.entries({ bodywork: "Body repair", mechanical: "Diagnosis", wheels: "Wheel / Tire service", towing: "Dispatch" })) {
  test(`${category}: authorized context and stage, preview, three-part upload, atomic save`, async () => {
    const f = fixture("photos", { category, stage }), cleanup = await f.load();
    assert.equal(f.calls[0].name, "get_workshop_repair_request_detail");
    assert.equal(f.calls[1].name, "get_workshop_latest_work_progress");
    assert.ok(f.text().includes("Synthetic Model"));
    assert.equal(f.saves().length, 0); f.images(2); f.message("Descriere sintetică");
    assert.equal((f.nodes("ImageGallery")[0].props.images as unknown[]).length, 2);
    assert.equal(f.button().props.disabled, false); await f.submit();
    assert.deepEqual(f.prepared, [{ preset: "workProgress" }, { preset: "workProgress" }]);
    assert.equal(f.uploads.length, 2);
    for (const upload of f.uploads) {
      assert.deepEqual(upload.path.split("/").slice(0, 2), [requestId, workshopId]);
      assert.equal(upload.path.split("/").length, 3); assert.equal(upload.contentType, "image/jpeg");
    }
    assert.deepEqual(f.saves()[0].args, { p_request_id: requestId, p_status: stage,
      p_message: "Descriere sintetică", p_images: f.uploads.map(u => `https://example.invalid/work-progress/${u.path}`) });
    assert.ok(f.text().includes("Pozele au fost trimise")); assert.equal(f.nodes("ImageGallery").length, 0); cleanup();
  });
}
for (const [label, options] of Object.entries({
  missingStage: { stage: null }, incompatibleStage: { category: "mechanical", stage: "Painting" },
  absent: { detailReply: async () => ({ data: [], error: null }) },
  invalid: { detailReply: async () => ({ data: [{ request_data: "invalid" }], error: null }) },
  denied: { latestReply: async () => ({ data: null, error: { code: "42501" } }) },
})) test(`${label}: no upload/save after unauthorized or invalid context`, async () => {
  const f = fixture("photos", options), cleanup = await f.load(); f.images();
  assert.equal(f.button().props.disabled, true); await f.submit();
  assert.deepEqual(f.uploads, []); assert.deepEqual(f.saves(), []); cleanup();
});
test("unauthenticated photo page redirects before RPC or Storage", async () => {
  const f = fixture("photos", { user: false }); await f.load();
  assert.deepEqual(f.navigation, ["/login"]); assert.deepEqual(f.calls, []); assert.deepEqual(f.uploads, []);
});
for (const failAt of [1, 2]) test(`upload ${failAt} fails: no progress save or compensating delete`, async () => {
  const f = fixture("photos", { upload: async i => ({ error: i === failAt ? new Error("Upload denied") : null }) });
  const cleanup = await f.load(); f.images(2); await f.submit();
  assert.equal(f.uploads.length, failAt); assert.deepEqual(f.saves(), []);
  assert.ok(!f.text().includes("Pozele au fost trimise"));
  assert.equal(f.nodes("ImageGallery").length, 1); assert.ok(f.text().includes("Upload denied"));
  if (failAt === 2) assert.ok(f.text().includes("salvarea lor în progres nu este confirmată")); cleanup();
});
for (const [label, reply] of Object.entries({
  denied: { data: null, error: { code: "42501" } }, zero: { data: [], error: null },
  invalid: { data: [{ id: offerId, status: "in_progress" }], error: null },
})) test(`save ${label}: successful upload is not reported as completed delivery`, async () => {
  const f = fixture("photos", { saveReply: async () => reply }), cleanup = await f.load();
  f.images(); await f.submit(); assert.equal(f.saves().length, 1);
  assert.ok(f.text().includes("Trimiterea nu este finalizată")); assert.ok(!f.text().includes("Pozele au fost trimise"));
  assert.equal(f.nodes("ImageGallery").length, 1); cleanup();
});
test("success waits for persistent RPC response; double click does not duplicate", async () => {
  let finish!: (reply: Reply) => void;
  const f = fixture("photos", { saveReply: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = await f.load(); f.images(); await f.submit(); await f.submit();
  assert.equal(f.saves().length, 1); assert.ok(!f.text().includes("Pozele au fost trimise"));
  finish({ data: [{ id: requestId, status: "in_progress" }], error: null }); await settle();
  assert.ok(f.text().includes("Pozele au fost trimise")); cleanup();
});
test("Ready photos preserve completed contract", async () => {
  const f = fixture("photos", { stage: "Ready" }), cleanup = await f.load(); f.images(); await f.submit();
  assert.equal(f.saves()[0].args.p_status, "Ready"); assert.ok(f.text().includes("Pozele au fost trimise")); cleanup();
});
test("late upload after leaving the page never saves references or reports success", async () => {
  let finish!: (reply: { error: unknown }) => void;
  const f = fixture("photos", { upload: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = await f.load(); f.images(); await f.submit(); cleanup();
  finish({ error: null }); await settle(); assert.deepEqual(f.saves(), []); assert.ok(!f.text().includes("Pozele au fost trimise"));
});
test("route switch clears selected photos and ignores late delivery result", async () => {
  let finish!: (reply: Reply) => void;
  const f = fixture("photos", { saveReply: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = await f.load(); f.images(); await f.submit(); cleanup(); f.route(offerId); await f.load();
  finish({ data: [{ id: requestId, status: "in_progress" }], error: null }); await settle();
  assert.equal(f.nodes("ImageGallery").length, 0); assert.ok(!f.text().includes("Pozele au fost trimise"));
});

for (const [category, stage] of Object.entries({ bodywork: "Tinichigerie", mechanical: "Diagnosis", wheels: "Wheel / Tire service", towing: "Dispatch" }))
  test(`${category}: readable historical gallery preserves stage, message and image URLs`, async () => {
    const image = "https://example.invalid/legacy/image.jpg";
    const f = fixture("photos-folder", { category, stage, progress: { error: null, data: [
      { id: offerId, request_id: requestId, status: stage, message: "Mesaj istoric", images: [image, null], created_at: "2026-11-01T10:00:00Z" },
    ] } });
    await f.load(); assert.ok(f.text().includes("Synthetic Model")); assert.ok(f.text().includes("Mesaj istoric"));
    assert.deepEqual(f.nodes("ImageGallery")[0].props.images, [{ name: `folder-${offerId}-0`, url: image }]);
    assert.deepEqual(f.queries[0].filters, [["id", offerId], ["request_id", requestId], ["workshop_user_id", workshopId], ["status", "accepted"]]);
    assert.equal(f.queries.length, 1);
    assert.deepEqual(f.calls[1], { name: "get_workshop_work_progress_history", args: { p_request_id: requestId } });
  });
test("missing gallery RPC is not presented as an empty photo folder or retried by SELECT", async () => {
  const f = fixture("photos-folder", { progress: { data: null, error: { code: "PGRST202" } } }); await f.load();
  assert.ok(f.text().includes("Dosarul foto nu a putut fi încărcat")); assert.ok(!f.text().includes("Nu există încă poze"));
  assert.equal(f.nodes("ImageGallery").length, 0); assert.deepEqual(f.uploads, []);
});
test("authorized no history remains a genuinely empty folder", async () => {
  const f = fixture("photos-folder", { stage: null }); await f.load(); assert.ok(f.text().includes("Nu există încă poze"));
});
for (const [label, options] of Object.entries({
  noWinningOffer: { offer: { data: null, error: null } },
  inaccessible: { detailReply: async () => ({ data: [], error: null }) },
  invalid: { detailReply: async () => ({ data: [{ request_data: "invalid" }], error: null }) },
  denied: { historyReply: async () => ({ data: null, error: new Error("Access denied") }) },
  historyError: { progress: { data: null, error: new Error("History unavailable") } },
})) test(`folder ${label}: error, no fabricated empty gallery or unsafe navigation`, async () => {
  const f = fixture("photos-folder", options); await f.load();
  assert.equal(f.nodes("ImageGallery").length, 0); assert.ok(!f.text().includes("Nu există încă poze"));
  assert.deepEqual(f.uploads, []); assert.deepEqual(f.navigation, []);
});
test("unknown historical stage remains in Altele", async () => {
  const f = fixture("photos-folder", { progress: { error: null, data: [
    { id: offerId, request_id: requestId, status: "Legacy operation", message: "", images: ["https://example.invalid/old.jpg"], created_at: "2020-01-01T00:00:00Z" },
  ] } }); await f.load(); assert.ok(f.text().includes("Altele")); assert.ok(f.text().includes("Legacy operation"));
});
test("gallery keeps workflow grouping and newest-first order within each stage", async () => {
  const row = (id: string, status: string, date: string) => ({ id, request_id: requestId, status,
    message: null, images: [`https://example.invalid/${id}.jpg`], created_at: date });
  const f = fixture("photos-folder", { progress: { error: null, data: [
    row(offerId, "Painting", "2026-11-04T00:00:00Z"),
    row(workshopId, "Body repair", "2026-11-03T00:00:00Z"),
    row(requestId, "Body repair", "2026-11-02T00:00:00Z"),
  ] } }); await f.load();
  assert.deepEqual(f.nodes("ImageGallery").map(n => (n.props.images as { url: string }[])[0].url),
    [workshopId, requestId, offerId].map(id => `https://example.invalid/${id}.jpg`));
});
test("history from another request fails closed before rendering photos", async () => {
  const f = fixture("photos-folder", { progress: { error: null, data: [
    { id: offerId, request_id: offerId, status: "Painting", message: "", images: ["https://example.invalid/private.jpg"], created_at: "2026-11-01T00:00:00Z" },
  ] } }); await f.load(); assert.equal(f.nodes("ImageGallery").length, 0);
  assert.ok(f.text().includes("Dosarul foto al lucrării nu a putut fi încărcat"));
});
test("late history after leaving the gallery cannot restore photos", async () => {
  let finish!: (reply: Reply) => void;
  const f = fixture("photos-folder", { historyReply: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = await f.load(); cleanup();
  finish({ data: [{ id: offerId, request_id: requestId, status: "Painting", message: "", images: ["https://example.invalid/old.jpg"], created_at: "2026-11-01T00:00:00Z" }], error: null });
  await settle(); assert.equal(f.nodes("ImageGallery").length, 0);
});
test("switching requests clears previous gallery and ignores late history", async () => {
  let finish!: (reply: Reply) => void;
  const f = fixture("photos-folder", { historyReply: id => id === requestId
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: [], error: null }) });
  const cleanup = await f.load(); cleanup(); f.route(offerId); await f.load();
  finish({ data: [{ id: workshopId, request_id: requestId, status: "Painting", message: "", images: ["https://example.invalid/old.jpg"], created_at: "2026-11-01T00:00:00Z" }], error: null });
  await settle(); assert.equal(f.nodes("ImageGallery").length, 0); assert.ok(f.text().includes("Nu există încă poze"));
});
test("both entry buttons pass request.id, not an offer/appointment id", () => {
  const page = read("../../app/workshops/in-workshop/[id]/page.tsx");
  for (const route of ["photos", "photos-folder"]) assert.ok(page.includes('`/workshops/in-workshop/${request.id}/' + route + '`'));
});
