import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
// @ts-expect-error TS5097: offline Node tests.
import { createEditedRequestPhotoNotifications } from "../admin/photo-notification-client.ts";

const source = readFileSync(new URL("../../app/customer/my-requests/[id]/page.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "handleSave") handler = node.initializer!.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed); assert.ok(handler);
const js = ts.transpileModule(`const handleSave = ${handler}; handleSave;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const owner = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000002";
const ticket = "30000000-0000-4000-8000-000000000003";
const oldImage = { name: "old", path: `${owner}/old.jpg` };
const newImage = { name: "new", path: `${owner}/new.jpg` };
type Image = typeof oldImage;
type Options = {
  branch?: "bodywork" | "mechanical" | "wheels" | "towing" | "details-direct" | "details-location";
  uploaded?: Image[]; latest?: Image[]; uploadError?: Error; saveError?: Error; emptyUpdate?: boolean;
  fetch?: typeof fetch; timeoutMs?: number;
};
function fixture(options: Options = {}) {
  const branch = options.branch ?? "bodywork";
  const service = branch.startsWith("details") ? (branch === "details-direct" ? "towing" : "wheels") : branch;
  const events: string[] = [], bodies: Record<string, unknown>[] = [], messages: string[] = [];
  const saved: { images: Image[]; description: string; [key: string]: unknown }[] = [];
  let reads = 0;
  const save = async (value: typeof saved[number]) => {
    events.push("save"); saved.push(value);
    if (options.saveError) throw options.saveError;
  };
  let direct: typeof saved[number];
  const chain = { update: (v: typeof direct) => { direct = v; return chain; }, eq: () => chain, is: () => chain, select: () => chain,
    maybeSingle: async () => { await save(direct); return { data: options.emptyUpdate ? null : { id }, error: null }; } };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "/api/repair-requests/images/notify-change");
    const body = JSON.parse(String(init!.body)); bodies.push(body); events.push(`notify-${body.action}`);
    return options.fetch ? options.fetch(url, init) : body.action === "prepare"
      ? Response.json({ status: "prepared", ticket }) : new Response(null, { status: 202 });
  };
  const refs = { current: false };
  const scope = {
    request: { id, user_id: owner, service_type: service, service_details: [], damage_type: "bodywork" },
    saveInProgressRef: refs, canEdit: true, deleting: false,
    imageDeletionRef: { current: { blocked: () => false, setPaused: (v: boolean) => events.push(`paused-${v}`),
      imagesForSave: async () => { events.push("read-images"); return ++reads === 1 ? [oldImage] : options.latest ?? [oldImage]; } } },
    resolveRepairServiceType: (v: string) => v,
    wheelsDetails: branch === "wheels" ? { selectedServices: [] } : null,
    towingDetails: branch === "towing" ? {} : null,
    locationDirty: branch === "details-location", selectedLocation: { locality: "synthetic" },
    mechanicalSymptomsByCategory: {}, activeMechanicalCategory: "engine", isMechanicalCategoryId: () => true,
    buildMechanicalServiceDetails: () => ({ selections: [{ category: "engine" }] }),
    normalizeWheelsServiceDetailsV2: () => ({}), toPartsSupply: () => "customer",
    validateTowingRequestFormValues: () => ({ valid: true, values: { serviceDetails: [], licensePlate: "B 123 ABC" } }),
    newFiles: [], uploadEditableRepairImages: async () => {
      events.push("upload"); if (options.uploadError) throw options.uploadError; return options.uploaded ?? [newImage];
    },
    createEditedRequestPhotoNotifications: (deps: Parameters<typeof createEditedRequestPhotoNotifications>[0]) =>
      createEditedRequestPhotoNotifications({ ...deps, timeoutMs: options.timeoutMs ?? 1000 }),
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: "synthetic" } }, error: null }) }, from: () => chain },
    globalThis: { fetch: fetcher }, window: { alert: (m: string) => messages.push(m) },
    process: { env: { NEXT_PUBLIC_ADMIN_PHOTO_BROADCAST_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://bstjobvvxxfqqwyjoimx.supabase.co", NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "bstjobvvxxfqqwyjoimx" } },
    updateEditableRepairRequest: save, description: "unsaved description", licensePlate: "B 123 ABC",
    serviceDetails: [], selectedCarParts: [], isStructuredServiceDetails: () => false,
    newFilesRef: { current: [] }, newImagePreviewsRef: { current: ["blob:synthetic"] }, URL: { revokeObjectURL: () => events.push("revoke-preview") },
    setSaving: () => {}, setImages: () => events.push("apply-images"), setNewFiles: () => {}, setNewImagePreviews: () => {},
    setRequest: () => {}, setLicensePlate: () => {}, setLocationText: () => {}, setSelectedLocation: () => {}, setLocationDirty: () => {},
    alert: (m: string) => messages.push(m), console: { error: () => {} }, isRepairRequestEditBlockedError: () => false,
  };
  const run = runInNewContext(js, scope) as () => Promise<void>;
  return { run, events, bodies, messages, saved, refs };
}

for (const branch of ["bodywork", "mechanical", "wheels", "towing", "details-direct", "details-location"] as const) {
  test(`${branch}: common prepare before final read, confirm only after successful save`, async () => {
    const f = fixture({ branch }); await f.run();
    assert.deepEqual(f.events, ["paused-true", "read-images", "upload", "notify-prepare", "read-images", "save", "notify-confirm", "apply-images", "revoke-preview", "paused-false"]);
    assert.deepEqual(f.bodies, [{ action: "prepare", kind: "request_images", requestId: id }, { action: "confirm", ticket, requestId: id }]);
    assert.deepEqual(JSON.parse(JSON.stringify(f.saved[0].images)), [oldImage, newImage]);
    assert.equal(f.saved[0].description, "unsaved description");
    assert.deepEqual(f.messages, ["Modificările au fost salvate."]); assert.equal(f.refs.current, false);
  });
}
for (const branch of ["bodywork", "mechanical", "wheels", "towing", "details-direct", "details-location"] as const) {
  test(`${branch}: description-only or deduplicated uploads never prepare or confirm`, async () => {
    const f = fixture({ branch, uploaded: [] }); await f.run();
    assert.equal(f.bodies.length, 0); assert.equal(f.saved.length, 1);
    assert.deepEqual(f.messages, ["Modificările au fost salvate."]);
  });
}
test("remote removal before final read is preserved; saving description does not claim another deletion", async () => {
  const f = fixture({ uploaded: [], latest: [] }); await f.run();
  assert.equal(f.bodies.length, 0); assert.equal(f.saved[0].images.length, 0);
});
test("remote removal while preparing ticket cannot reintroduce detached photo", async () => {
  const f = fixture({ latest: [] }); await f.run();
  assert.deepEqual(JSON.parse(JSON.stringify(f.saved[0].images)), [newImage]);
  assert.equal(f.events.indexOf("notify-prepare") < f.events.lastIndexOf("read-images"), true);
});
for (const branch of ["bodywork", "mechanical", "wheels", "towing", "details-direct", "details-location"] as const) {
  test(`${branch}: failed save keeps error message and does not confirm association`, async () => {
    const f = fixture({ branch, saveError: new Error("save failed after confirmed uploads") }); await f.run();
    assert.equal(f.bodies.length, 1); assert.ok(!f.events.includes("apply-images")); assert.ok(!f.events.includes("revoke-preview"));
    assert.deepEqual(f.messages, ["Nu am putut salva modificările."]); assert.equal(f.refs.current, false);
  });
}
test("direct UPDATE with no returned row cannot confirm", async () => {
  const f = fixture({ branch: "details-direct", emptyUpdate: true }); await f.run();
  assert.equal(f.bodies.length, 1); assert.deepEqual(f.messages, ["Nu am putut salva modificările."]);
});
test("failed/partial upload stops before association ticket, preserving stage 1 responsibility", async () => {
  const f = fixture({ uploadError: new Error("second file failed") }); await f.run();
  assert.equal(f.bodies.length, 0); assert.equal(f.saved.length, 0);
  assert.deepEqual(f.messages, ["Nu am putut salva modificările."]);
});
for (const phase of ["prepare", "confirm"]) for (const failure of ["throw", "timeout", "401", "403", "429", "503", "200"]) {
  test(`${phase} ${failure}: save success, no retry and unchanged cleanup`, async () => {
    const f = fixture({ timeoutMs: 5, fetch: async (_url, init) => {
      assert.equal(_url, "/api/repair-requests/images/notify-change");
      assert.equal(init!.credentials, "same-origin");
      assert.equal(init!.redirect, "error");
      assert.equal(new Headers(init!.headers).get("Authorization"), "Bearer synthetic");
      const action = JSON.parse(String(init!.body)).action;
      if (action !== phase) return action === "prepare" ? Response.json({ status: "prepared", ticket }) : new Response(null, { status: 202 });
      if (failure === "throw") throw new Error("notification error");
      if (failure === "timeout") return new Promise(() => {});
      return new Response(null, { status: Number(failure) });
    } });
    await f.run(); assert.equal(f.saved.length, 1); assert.equal(f.bodies.length, phase === "prepare" ? 1 : 2);
    assert.deepEqual(f.messages, ["Modificările au fost salvate."]); assert.ok(f.events.includes("revoke-preview"));
  });
}
test("concurrent clicks in one editor cannot double prepare/save/confirm", async () => {
  const f = fixture(); await Promise.all([f.run(), f.run()]);
  assert.equal(f.saved.length, 1); assert.equal(f.bodies.length, 2);
});
test("independent concurrent editors retain separate ticket and confirmation", async () => {
  const f = fixture(), g = fixture(); await Promise.all([f.run(), g.run()]);
  for (const v of [f, g]) { assert.equal(v.saved.length, 1); assert.equal(v.bodies.length, 2); }
});
