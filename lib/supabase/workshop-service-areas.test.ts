import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PostgrestClient } from "@supabase/postgrest-js";
import ts from "typescript";
import type { GeoLocation } from "../geo/geo-location";
import type { WorkshopServiceArea } from "./workshop-service-areas";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function moduleAt(path: string, requireMock: (name: string) => unknown = () => { throw new Error("Unexpected import"); }) {
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compile(read(path)))(requireMock, exports);
  return exports;
}
const geo = moduleAt("../geo/geo-location.ts");
const geoapify = moduleAt("../geo/geoapify.ts", () => geo);
const workshopId = "10000000-0000-4000-8000-000000000002";
const selected: GeoLocation = { locality: "Synthetic town", postalCode: null, countryCode: "RO", lat: 45.125, lng: 25.25 };
type Input = { location: GeoLocation | null; radiusKm: number | null; existingArea: WorkshopServiceArea | null };
type Save = (input: Input) => Promise<WorkshopServiceArea>;

type Response = { data: Record<string, unknown> | null; error: unknown };
function fixture(options: { error?: unknown; authenticated?: boolean; responses?: Response[] } = {}) {
  const { error = null, authenticated = true } = options;
  const row = { workshop_id: workshopId, locality: selected.locality, postal_code: null, country_code: "RO",
    radius_km: 50, geocoded_at: "2026-11-08T00:00:00Z", updated_at: "2026-11-08T00:00:00Z" };
  const calls: unknown[][] = [];
  const responses = [...(options.responses ?? [])];
  const response = () => responses.shift() ?? { data: error ? null : row, error };
  const query = {
    insert(payload: unknown) { calls.push(["insert", payload]); return query; },
    update(payload: unknown) { calls.push(["update", payload]); return query; },
    eq(key: string, value: unknown) { calls.push(["eq", key, value]); return query; },
    select(projection: string) { calls.push(["select", projection]); return query; },
    async single() { calls.push(["single"]); return response(); },
    async maybeSingle() { calls.push(["maybeSingle"]); return response(); },
  };
  const supabase = {
    auth: { async getUser() { return { data: { user: authenticated ? { id: workshopId } : null }, error: null }; } },
    from(table: string) { assert.equal(table, "workshop_service_areas"); calls.push(["from", table]); return query; },
  };
  const mod = moduleAt("./workshop-service-areas.ts", name => name.includes("geo-location") ? geo : { supabase });
  return { save: mod.saveOwnWorkshopServiceArea as Save, calls, row };
}

test("Geoapify suggestion retains numerical coordinates; text alone is not selectable", () => {
  const normalize = geoapify.normalizeGeoapifySuggestion as (input: Record<string, unknown>) => { location: GeoLocation } | null;
  const source = { city: selected.locality, country_code: "ro", lat: selected.lat, lon: selected.lng };
  assert.deepEqual(normalize(source)?.location, selected);
  assert.equal(normalize({ ...source, lat: undefined }), null);
  assert.equal(normalize({ ...source, lon: "25.25" }), null);
});

test("selected coordinates update the own area without assigning workshop_id", async () => {
  const f = fixture();
  const result = await f.save({ location: selected, radiusKm: 50, existingArea: null });
  const write = f.calls.find(call => call[0] === "update")!;
  const payload = write[1] as Record<string, unknown>;
  assert.equal(Object.hasOwn(payload, "workshop_id"), false);
  assert.equal(payload.location, `POINT(${selected.lng} ${selected.lat})`);
  assert.equal(payload.radius_km, 50);
  assert.equal(payload.country_code, "RO");
  assert.deepEqual(f.calls.find(call => call[0] === "eq"), ["eq", "workshop_id", workshopId]);
  assert.equal(f.calls.at(-1)?.[0], "maybeSingle");
  assert.ok(!f.calls.some(call => call[0] === "insert"));
  assert.equal(result.workshopId, workshopId);
  assert.equal(result.radiusKm, 50);
});

test("no existing row inserts once, with authenticated ownership and a returned row", async () => {
  const f = fixture({ responses: [{ data: null, error: null }] });
  const result = await f.save({ location: selected, radiusKm: 50, existingArea: null });
  const payload = f.calls.find(call => call[0] === "insert")![1] as Record<string, unknown>;
  assert.equal(payload.workshop_id, workshopId);
  assert.equal(payload.location, `POINT(${selected.lng} ${selected.lat})`);
  assert.equal(payload.radius_km, 50);
  assert.equal(f.calls.at(-1)?.[0], "single");
  assert.equal(result.workshopId, workshopId);
});

test("stale UI ownership is never used as the write target", async () => {
  const f = fixture();
  const existingArea = { workshopId: "20000000-0000-4000-8000-000000000002" } as WorkshopServiceArea;
  await f.save({ location: selected, radiusKm: null, existingArea });
  assert.deepEqual(f.calls.find(call => call[0] === "eq"), ["eq", "workshop_id", workshopId]);
  assert.equal((f.calls.find(call => call[0] === "update")![1] as Record<string, unknown>).radius_km, null);
});

test("changed radius without a new location only updates the own existing row", async () => {
  const f = fixture();
  const area = await f.save({ location: selected, radiusKm: 50, existingArea: null });
  f.calls.length = 0;
  await f.save({ location: null, radiusKm: 100, existingArea: area });
  assert.ok(f.calls.some(call => call[0] === "update"));
  assert.deepEqual(f.calls.find(call => call[0] === "eq"), ["eq", "workshop_id", workshopId]);
  assert.ok(!f.calls.some(call => call[0] === "upsert"));
});

for (const code of ["42501", "23503", "PGRST204", "PGRST116"]) {
  test(`server error ${code} is propagated unchanged; no successful result or alternate write`, async () => {
    const error = { code, message: "Synthetic rejected write", details: null, hint: null };
    const f = fixture({ error });
    await assert.rejects(f.save({ location: selected, radiusKm: 50, existingArea: null }), value => value === error);
    assert.equal(f.calls.filter(call => call[0] === "update").length, 1);
    assert.ok(!f.calls.some(call => call[0] === "insert"));
  });
}

test("INSERT denied after an empty UPDATE is not a successful save or a retry", async () => {
  const error = { code: "42501", message: "Synthetic INSERT denied" };
  const f = fixture({ responses: [{ data: null, error: null }, { data: null, error }] });
  await assert.rejects(f.save({ location: selected, radiusKm: 50, existingArea: null }), value => value === error);
  assert.equal(f.calls.filter(call => call[0] === "update").length, 1);
  assert.equal(f.calls.filter(call => call[0] === "insert").length, 1);
});

test("concurrent creation by another device retries only the own mutable fields once", async () => {
  const f = fixture({ responses: [
    { data: null, error: null }, { data: null, error: { code: "23505" } },
  ] });
  const result = await f.save({ location: selected, radiusKm: 50, existingArea: null });
  const updates = f.calls.filter(call => call[0] === "update");
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0][1], updates[1][1]);
  assert.equal(Object.hasOwn(updates[1][1] as object, "workshop_id"), false);
  assert.equal(f.calls.filter(call => call[0] === "insert").length, 1);
  assert.equal(result.workshopId, workshopId);
});

for (const retryError of [null, { code: "42501", message: "Synthetic denied retry" }]) {
  test(`concurrent conflict with ${retryError ? "denied" : "empty"} retry never reports success`, async () => {
    const conflict = { code: "23505", message: "Synthetic concurrent insert" };
    const f = fixture({ responses: [
      { data: null, error: null }, { data: null, error: conflict }, { data: null, error: retryError },
    ] });
    await assert.rejects(f.save({ location: selected, radiusKm: 50, existingArea: null }), value => value === (retryError ?? conflict));
    assert.equal(f.calls.filter(call => call[0] === "update").length, 2);
    assert.equal(f.calls.filter(call => call[0] === "insert").length, 1);
  });
}

test("zero-row INSERT/RETURNING error never reports success", async () => {
  const error = { code: "PGRST116", message: "Synthetic missing returned row" };
  const f = fixture({ responses: [{ data: null, error: null }, { data: null, error }] });
  await assert.rejects(f.save({ location: selected, radiusKm: 50, existingArea: null }), value => value === error);
});

test("real SDK request shape avoids merge-duplicates and ownership UPDATE (mock HTTP, no database)", async () => {
  const calls: { method: string; payload: Record<string, unknown>; url: URL; prefer: string }[] = [];
  const client = new PostgrestClient("https://example.invalid/rest/v1", {
    fetch: async (input, init) => {
      const call = { method: init?.method ?? "GET", payload: JSON.parse(String(init?.body)),
        url: new URL(String(input)), prefer: new Headers(init?.headers).get("Prefer") ?? "" };
      calls.push(call);
      const ownerUpdate = Object.hasOwn(call.payload, "workshop_id") &&
        (call.method === "PATCH" || call.prefer.includes("resolution=merge-duplicates"));
      const body = ownerUpdate ? { code: "42501", message: "Synthetic ownership UPDATE denied" } : [fixture().row];
      return new globalThis.Response(JSON.stringify(body), { status: ownerUpdate ? 403 : 200 });
    },
  });
  // Exercise the historical wire request and the fixed helper with the same SDK.
  const legacy = await client.from("workshop_service_areas").upsert({ workshop_id: workshopId, radius_km: 50 }, { onConflict: "workshop_id" });
  assert.equal(legacy.error?.code, "42501");
  assert.equal(calls[0].url.searchParams.get("on_conflict"), "workshop_id");
  assert.ok(calls[0].prefer.includes("resolution=merge-duplicates"));
  const supabase = { auth: { async getUser() { return { data: { user: { id: workshopId } }, error: null }; } }, from: client.from.bind(client) };
  const mod = moduleAt("./workshop-service-areas.ts", name => name.includes("geo-location") ? geo : { supabase });
  const result = await (mod.saveOwnWorkshopServiceArea as Save)({ location: selected, radiusKm: 50, existingArea: null });
  assert.equal(result.workshopId, workshopId);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].url.searchParams.get("workshop_id"), `eq.${workshopId}`);
  assert.equal(Object.hasOwn(calls[1].payload, "workshop_id"), false);
  assert.ok(!calls[1].prefer.includes("merge-duplicates"));
});

test("invalid coordinates and expired identity stop before a database write", async () => {
  const invalid = fixture();
  await assert.rejects(invalid.save({ location: { ...selected, lat: NaN }, radiusKm: 50, existingArea: null }), /localitate validă/);
  assert.equal(invalid.calls.length, 0);
  const expired = fixture({ authenticated: false });
  await assert.rejects(expired.save({ location: selected, radiusKm: 50, existingArea: null }), /autentificat/);
  assert.equal(expired.calls.length, 0);
});

test("invalid radius stops before a write", async () => {
  for (const radiusKm of [0, 1001, 1.5, NaN]) {
    const f = fixture();
    await assert.rejects(f.save({ location: selected, radiusKm, existingArea: null }));
    assert.equal(f.calls.length, 0);
  }
});

test("Account generic message hides the plain Supabase error but never sets successful area", async () => {
  const page = read("../../app/account/page.tsx");
  const source = page.slice(page.indexOf("const handleSaveServiceArea ="), page.indexOf("const handleGeocodeWorkshopAddress ="));
  const failure = { code: "42501", message: "Synthetic denied" };
  const displayed: unknown[] = [], logged: unknown[] = [];
  let saves = 0, successes = 0;
  const deps = { isWorkshopMode: true, savingServiceArea: false, serviceArea: null,
    serviceAreaLocality: "Synthetic selected label", selectedServiceAreaLocation: selected,
    serviceAreaRadiusOption: "50", customServiceAreaRadius: "50", setSavingServiceArea: () => {},
    setServiceAreaError: (value: unknown) => displayed.push(value),
    saveOwnWorkshopServiceArea: async (input: Input) => { saves++; assert.equal(input.location, selected); assert.equal(input.radiusKm, 50); throw failure; },
    setServiceArea: () => { successes++; }, setServiceAreaLocality: () => {}, setSelectedServiceAreaLocation: () => {},
    console: { error: (_label: string, error: unknown) => logged.push(error) } };
  const handler = new Function(...Object.keys(deps), compile(source) + "\nreturn handleSaveServiceArea;")(...Object.values(deps)) as () => Promise<void>;
  await handler();
  assert.equal(saves, 1);
  assert.equal(successes, 0);
  assert.equal(displayed.at(-1), "Zona de lucru nu a putut fi salvată.");
  assert.equal(logged[0], failure);
});
