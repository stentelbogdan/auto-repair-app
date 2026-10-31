import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
// @ts-expect-error TS5097: offline Node tests.
import { createRequestPhotoNotifications, createUploadPhotoNotifications } from "../admin/photo-notification-client.ts";
// @ts-expect-error TS5097: offline Node tests.
import { formatLicensePlateForDb } from "../utils/licensePlate.ts";
// @ts-expect-error TS5097: offline Node tests.
import { uploadPreparedRepairImages, type RepairImageUploadDependencies, type PreparedRepairImageUpload } from "./repair-request-images.ts";

type Create = typeof import("./repair-requests").createRepairRequest;
type Input = Parameters<Create>[0];
const owner = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000002";
const ticket = "30000000-0000-4000-8000-000000000003";
const env = { NEXT_PUBLIC_ADMIN_PHOTO_BROADCAST_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://bstjobvvxxfqqwyjoimx.supabase.co", NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: "bstjobvvxxfqqwyjoimx" };
const session = { user: { id: owner }, access_token: "synthetic-session" };
const input: Input = { userId: owner, carBrand: "synthetic", carModel: "model", carYear: "2020", city: "test-city",
  licensePlate: "b123abc", damageType: "test", description: "draft", images: [{ name: "one", path: `${owner}/one.jpg` }],
  discoveryLocation: { locality: "test-city", postalCode: "000000", countryCode: "RO", lat: 44, lng: 26, source: "locality" } };
const source = readFileSync(new URL("./repair-requests.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
type Options = {
  data?: unknown; error?: unknown; thrown?: Error;
  fetch?: typeof fetch;
  rpc?: (args: unknown) => Promise<{ data: unknown; error: unknown }>;
  factory?: typeof createRequestPhotoNotifications;
  timeoutMs?: number;
  enabled?: string;
};
function fixture(options: Options = {}) {
  const events: string[] = [], bodies: Record<string, unknown>[] = [], rpcCalls: { name: string; args: unknown }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "/api/repair-requests/images/notify-change");
    const body = JSON.parse(String(init!.body)); bodies.push(body); events.push(`notify-${body.action}`);
    return options.fetch ? options.fetch(url, init) : body.action === "prepare"
      ? Response.json({ status: "prepared", ticket }) : new Response(null, { status: 202 });
  };
  const supabase = {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    rpc: async (name: string, args: unknown) => {
      events.push("create"); rpcCalls.push({ name, args });
      if (options.thrown) throw options.thrown;
      if (options.rpc) return options.rpc(args);
      return { data: Object.hasOwn(options, "data") ? options.data : id, error: options.error ?? null };
    },
  };
  // Execute the actual common module with explicit offline dependencies. Unknown
  // imports fail rather than loading the real Supabase client or a network SDK.
  const requireMock = (name: string) => {
    if (name === "@/lib/supabase/client") return { supabase };
    if (name === "@/lib/utils/licensePlate") return { formatLicensePlateForDb };
    if (name === "../admin/photo-notification-client.ts") return { createRequestPhotoNotifications: options.factory
      ?? ((deps: Parameters<typeof createRequestPhotoNotifications>[0]) => createRequestPhotoNotifications({ ...deps, timeoutMs: options.timeoutMs ?? 1000 })) };
    throw new Error("Unexpected import");
  };
  const exported: { createRepairRequest?: Create } = {};
  new Function("require", "exports", "process", "window", "globalThis", js)(requireMock, exported,
    { env: { ...env, NEXT_PUBLIC_ADMIN_PHOTO_BROADCAST_ENABLED: options.enabled ?? "true" } }, {}, { fetch: fetcher });
  return { create: exported.createRepairRequest!, events, bodies, rpcCalls, fetcher };
}

for (const serviceType of ["bodywork", "mechanical", "wheels", "towing"] as const) test(`creation ${serviceType}: single prepare, exact RPC payload, then confirm returned ID`, async () => {
  const f = fixture(); const value = { ...input, serviceType, images: [...input.images, { name: "two", path: `${owner}/two.jpg` }] };
  assert.equal(await f.create(value), id);
  assert.deepEqual(f.events, ["notify-prepare", "create", "notify-confirm"]);
  assert.deepEqual(f.bodies, [{ action: "prepare", kind: "request_images", requestId: null }, { action: "confirm", ticket, requestId: id }]);
  assert.deepEqual(f.rpcCalls, [{ name: "create_repair_request_with_discovery_location", args: {
    p_request: { car_brand: value.carBrand, car_model: value.carModel, car_year: value.carYear, city: value.city,
      pickup_lat: undefined, pickup_lng: undefined, destination_lat: undefined, destination_lng: undefined,
      route_distance_meters: undefined, route_duration_seconds: undefined, towing_schedule_type: null,
      towing_requested_at: null, towing_requested_timezone: null, license_plate: "B 123 ABC", damage_type: value.damageType,
      service_details: [], description: value.description, service_type: serviceType, request_type: "repair",
      target_workshop_id: null, images: value.images, status: "open" },
    p_discovery: { locality: "test-city", postal_code: "000000", country_code: "RO", lat: 44, lng: 26, source: "locality" },
  } }]);
});
test("no photos means no preparation/session lookup/notification, even when factory would throw", async () => {
  const f = fixture({ factory: () => { throw new Error("must not initialize"); } });
  assert.equal(await f.create({ ...input, images: [] }), id); assert.deepEqual(f.events, ["create"]);
});
test("disabled client flag leaves creation unchanged and performs no notification HTTP", async () => {
  const f = fixture({ enabled: "false" }); assert.equal(await f.create(input), id); assert.deepEqual(f.events, ["create"]);
});
for (const mode of ["error", "throw"]) test(`failed creation ${mode} preserves exact error and never confirms`, async () => {
  const failure = new Error("synthetic creation failure");
  const f = fixture(mode === "error" ? { error: failure } : { thrown: failure });
  await assert.rejects(f.create(input), error => error === failure);
  assert.deepEqual(f.events, ["notify-prepare", "create"]);
});
test("creation cannot start until prepare resolves", async () => {
  let resolve!: (r: Response) => void;
  const f = fixture({ fetch: async (_url, init) => JSON.parse(String(init!.body)).action === "prepare"
    ? new Promise(r => { resolve = r; }) : new Response(null, { status: 202 }) });
  const pending = f.create(input); await new Promise(r => setImmediate(r)); assert.equal(f.rpcCalls.length, 0);
  resolve(Response.json({ status: "prepared", ticket })); assert.equal(await pending, id);
});
for (const phase of ["prepare", "confirm"]) {
  for (const failure of ["throw", "timeout", "403", "429", "503", "200"]) test(`${phase} ${failure} preserves created request, no retry`, async () => {
    const f = fixture({ timeoutMs: 5, fetch: async (_url, init) => {
      const action = JSON.parse(String(init!.body)).action;
      if (action !== phase) return action === "prepare" ? Response.json({ status: "prepared", ticket }) : new Response(null, { status: 202 });
      if (failure === "throw") throw new Error("sensitive notification failure");
      if (failure === "timeout") return new Promise(() => {});
      return new Response(null, { status: Number(failure) });
    } });
    assert.equal(await f.create(input), id); assert.equal(f.rpcCalls.length, 1);
    assert.deepEqual(f.events, phase === "prepare" ? ["notify-prepare", "create"] : ["notify-prepare", "create", "notify-confirm"]);
  });
}
for (const data of [null, [], { id }, "bad"]) test(`unexpected successful RPC data is preserved, not used as notification proof: ${JSON.stringify(data)}`, async () => {
  const f = fixture({ data }); assert.equal(await f.create(input), data);
  assert.deepEqual(f.events, ["notify-prepare", "create"]);
});
test("throwing auxiliary factory/confirm cannot change creation outcome", async () => {
  for (const factory of [() => { throw new Error("auxiliary"); }, () => ({ prepareCreation: async () => ({ confirm: async () => { throw new Error("auxiliary"); } }) })]) {
    const f = fixture({ factory }); assert.equal(await f.create(input), id); assert.equal(f.rpcCalls.length, 1);
  }
});
test("two simultaneous creations confirm their own tickets/IDs despite reversed RPC completions", async () => {
  let ticketIndex = 0; const ids = [id, ticket]; const resolvers: ((value: { data: unknown; error: unknown }) => void)[] = [];
  const f = fixture({ fetch: async (_url, init) => JSON.parse(String(init!.body)).action === "prepare"
    ? Response.json({ status: "prepared", ticket: ids[ticketIndex++] }) : new Response(null, { status: 202 }),
    rpc: async () => new Promise(r => resolvers.push(r)) });
  const a = f.create(input), b = f.create(input); await new Promise(r => setImmediate(r));
  resolvers[1]({ data: owner, error: null }); resolvers[0]({ data: id, error: null });
  assert.deepEqual(await Promise.all([a, b]), [id, owner]);
  assert.deepEqual(f.bodies.filter(b => b.action === "confirm"), [
    { action: "confirm", ticket, requestId: owner }, { action: "confirm", ticket: id, requestId: id },
  ]);
});
test("stage 1 uploads and stage 2 association each notify their distinct committed change", async () => {
  const f = fixture(); const path = `${owner}/one.jpg`;
  const notifications = createUploadPhotoNotifications({ enabled: true, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    projectRef: env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF, session: async () => session, fetch: f.fetcher });
  const deps: RepairImageUploadDependencies = {
    reserve: async () => ({ data: { object_path: path, upload_lease_id: ticket, upload_lease_expires_at: new Date(Date.now() + 60000).toISOString() }, error: null }),
    upload: async () => { f.events.push("storage-upload"); return { data: null, error: null }; },
    confirm: async () => { f.events.push("upload-confirm-rpc"); return { data: "uploaded", error: null }; },
    abandon: async () => { throw new Error("must not abandon"); },
    publicUrl: () => "https://example.invalid/image", fingerprint: async () => "hash", now: Date.now, notifications,
  };
  const file = new File(["synthetic"], "one.jpg", { type: "image/jpeg" });
  const prepared = { originalName: "one.jpg", preparedImage: { file, extension: "jpg", contentType: "image/jpeg" } } as PreparedRepairImageUpload;
  const images = await uploadPreparedRepairImages([prepared, prepared], owner, [], deps);
  assert.equal(await f.create({ ...input, images }), id);
  assert.deepEqual(f.events, ["notify-prepare", "storage-upload", "upload-confirm-rpc", "notify-confirm", "notify-prepare", "create", "notify-confirm"]);
  assert.deepEqual(f.bodies.filter(b => b.action === "prepare").map(b => b.kind), ["upload", "request_images"]);
});
