import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const page = readFileSync(new URL("../../app/workshops/won-jobs/page.tsx", import.meta.url), "utf8");
const loadSource = page.slice(page.indexOf("  const loadWonJobs ="), page.indexOf("  useEffect", page.indexOf("  const loadWonJobs =")));
const requestId = "10000000-0000-4000-8000-000000000001";
const owner = "20000000-0000-4000-8000-000000000001";
const offer = { id: "30000000-0000-4000-8000-000000000001", request_id: requestId,
  workshop_user_id: owner, status: "accepted", price: 150, days: "2 zile", message: "Synthetic",
  workshop_name: "Service", created_at: "2026-11-01T10:00:00Z", workshop_read_at: "2026-11-01T10:00:00Z", read_state_version: "9007199254740993" };
const appointment = { id: "40000000-0000-4000-8000-000000000001", request_id: requestId,
  appointment_date: "2026-12-01", appointment_time: "09:00", status: "confirmed", updated_at: "2026-11-02T10:00:00Z" };
function detail(category = "bodywork", status = "matched") {
  return { id: requestId, car_brand: "Synthetic", car_model: "Model", car_year: "2020", city: "City",
    license_plate: "TEST", damage_type: "other", service_type: category, service_details: ["Synthetic"],
    description: "Description", images: [{ name: "Photo", url: "https://example.invalid/photo" }],
    pickup_lat: 44, pickup_lng: 26, destination_lat: 45, destination_lng: 27,
    route_distance_meters: 1000, route_duration_seconds: 100, route_paths: [],
    towing_schedule_type: "scheduled", towing_requested_at: "2026-12-01T10:00:00Z",
    towing_requested_timezone: "Europe/Bucharest", status, request_type: "repair",
    target_workshop_id: null, accepted_offer_id: offer.id, created_at: "2026-10-31T10:00:00Z" };
}
type Reply = { data: unknown; error: unknown };
function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function moduleAt(path: string, requireMock: (name: string) => unknown) {
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compile(readFileSync(new URL(path, import.meta.url), "utf8")))(requireMock, exports);
  return exports;
}
type Job = { readObservation: { userId: string; role: string; offerId: string; version: string } | null; offerId: string; requestId: string; price: string; appointment: typeof appointment;
  latestProgressStatus: string | null; completionTimestamp: string | null; clientName: string; request: Record<string, unknown> };
const progress = { id: "50000000-0000-4000-8000-000000000001", request_id: requestId, status: "Ready",
  message: null, images: [], created_at: "2026-11-02T12:00:00Z" };
function fixture(read: (id: string) => Promise<Reply> = async id => ({ data: [{ request_data: { ...detail(), id } }], error: null }), offers = [offer],
  history: (id: string) => Promise<Reply> = async id => ({ data: [{ ...progress, request_id: id }], error: null })) {
  const reads: string[] = [], rpcCalls: string[] = [], filters: unknown[][] = [];
  const state = { jobs: [] as Job[], error: false, loading: false };
  const supabase = {
    rpc: async (name: string, args: { p_request_id: string }) => {
      assert.ok(offers.some(offer => offer.request_id === args.p_request_id));
      rpcCalls.push(name);
      if (name === "get_workshop_work_progress_history") return history(args.p_request_id);
      assert.equal(name, "get_workshop_repair_request_detail"); return read(args.p_request_id);
    },
    from: (table: string) => {
      assert.ok(["repair_offers", "repair_appointments"].includes(table), `Forbidden read: ${table}`);
      reads.push(table);
      const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        in: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        order: () => { const result = { error: null, data: table === "repair_offers" ? offers : [appointment] }; return { ...result, overrideTypes: () => result }; } };
      return query;
    },
  };
  const reader = moduleAt("./workshop-request-detail.ts", () => ({ supabase }));
  const batch = moduleAt("./workshop-offer-requests.ts", () => reader);
  const historyReader = moduleAt("./workshop-work-progress-history.ts", () => ({ supabase }));
  const workflows = moduleAt("../work-progress/workflows.ts", name => {
    assert.equal(name, "@/lib/repair-requests/service-types");
    return moduleAt("../repair-requests/service-types.ts", () => { throw new Error("Unexpected dependency"); });
  });
  const jobsLoadVersion = { current: 0 };
  const dependencies = { ...historyReader, ...moduleAt("../offer-read-version.ts", () => { throw new Error("Unexpected dependency"); }), supabase, useCallback: (fn: unknown) => fn, capture: async () => {}, allowOffers: () => {}, complete: () => {}, jobsLoadVersion,
    setLoadingJobs: (value: boolean) => { state.loading = value; }, setJobsLoadError: (value: boolean) => { state.error = value; },
    setJobs: (value: Job[]) => { state.jobs = value; }, loadWorkshopOfferRequests: batch.loadWorkshopOfferRequests,
    getWorkshopRequestClientNames: async () => new Map([[requestId, "Client"]]),
    normalizeProgressStatus: workflows.normalizeProgressStatus,
    sortJobsByLatestActivity: (jobs: Job[]) => jobs };
  const load = new Function(...Object.keys(dependencies), compile(loadSource) + "\nreturn loadWonJobs;")(...Object.values(dependencies)) as (owner: string) => Promise<void>;
  return { load: () => load(owner), state, reads, rpcCalls, filters, invalidate: () => { jobsLoadVersion.current += 1; } };
}

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  for (const status of ["matched", "in_progress", "completed"]) test(`${category}/${status}: authorized context preserves vehicle, photos and appointment`, async () => {
    const data = detail(category, status); const f = fixture(async () => ({ data: [{ request_data: data }], error: null }));
    await f.load(); assert.equal(f.state.error, false); assert.equal(f.state.loading, false);
    const job = f.state.jobs[0]; assert.equal(job.offerId, offer.id); assert.equal(job.requestId, requestId);
    assert.equal(job.request.carBrand, data.car_brand); assert.equal(job.request.carModel, data.car_model);
    assert.equal(job.request.licensePlate, data.license_plate); assert.equal(job.request.serviceType, category);
    assert.equal(job.request.status, status); assert.deepEqual(job.request.serviceDetails, data.service_details);
    assert.deepEqual(job.request.images, [{ name: "Photo", dataUrl: data.images[0].url, url: data.images[0].url }]);
    assert.equal(job.request.routeDistanceMeters, 1000); assert.equal(job.request.towingRequestedAt, data.towing_requested_at);
    assert.deepEqual(job.appointment, appointment); assert.equal(job.latestProgressStatus, "Ready");
    assert.equal(job.completionTimestamp, "2026-11-02T12:00:00Z"); assert.equal(job.clientName, "Client");
    assert.deepEqual(job.readObservation, { userId: owner, role: "workshop", offerId: offer.id, version: "9007199254740993" });
    assert.equal(job.price, "150"); assert.deepEqual(f.filters.slice(0, 2), [["workshop_user_id", owner], ["status", "accepted"]]);
    assert.deepEqual(f.reads, ["repair_offers", "repair_appointments"]);
  });
}
for (const [name, reply] of Object.entries({ absent: { data: [], error: null }, denied: { data: null, error: { code: "42501" } },
  invalid: { data: [{ request_data: { ...detail(), id: owner } }], error: null }, malformed: { data: "invalid", error: null } })) {
  test(`${name}: neutral error, no synthetic matched job or fallback; clears previous context`, async () => {
    let fail = false; const f = fixture(async () => fail ? reply : { data: [{ request_data: detail() }], error: null });
    await f.load(); assert.equal(f.state.jobs.length, 1); fail = true; await f.load();
    assert.deepEqual(f.state.jobs, []); assert.equal(f.state.error, true); assert.equal(f.state.loading, false);
    assert.equal(f.rpcCalls.filter(name => name === "get_workshop_repair_request_detail").length, 2);
  });
}
test("transport error does not disclose raw error or preserve fake success", async () => {
  const f = fixture(async () => { throw new Error("sensitive transport detail"); }); await f.load();
  assert.equal(f.state.error, true); assert.deepEqual(f.state.jobs, []);
});
test("no offers is legitimate empty state and no context RPC", async () => {
  const f = fixture(undefined, []); await f.load(); assert.equal(f.state.error, false); assert.deepEqual(f.rpcCalls, []);
});
test("same request in multiple own offers is fetched once", async () => {
  const f = fixture(undefined, [offer, { ...offer, id: owner }]); await f.load();
  assert.deepEqual(f.rpcCalls, ["get_workshop_work_progress_history", "get_workshop_repair_request_detail"]);
  assert.equal(f.state.jobs.length, 2);
});
test("late authorized response cannot overwrite newer denied refresh", async () => {
  let resolve!: (value: Reply) => void; let started!: () => void;
  const firstStarted = new Promise<void>(done => { started = done; }); let calls = 0;
  const f = fixture(() => ++calls === 1 ? new Promise(done => { resolve = done; started(); }) : Promise.resolve({ data: [], error: null }));
  const first = f.load(); await firstStarted; await f.load();
  resolve({ data: [{ request_data: detail() }], error: null }); await first;
  assert.equal(f.state.error, true); assert.deepEqual(f.state.jobs, []); assert.equal(f.state.loading, false);
});
test("late denied response cannot clear newer authorized refresh", async () => {
  let resolve!: (value: Reply) => void; let started!: () => void;
  const firstStarted = new Promise<void>(done => { started = done; }); let calls = 0;
  const f = fixture(() => ++calls === 1 ? new Promise(done => { resolve = done; started(); }) : Promise.resolve({ data: [{ request_data: detail() }], error: null }));
  const first = f.load(); await firstStarted; await f.load(); resolve({ data: [], error: null }); await first;
  assert.equal(f.state.error, false); assert.equal(f.state.jobs.length, 1);
});
test("error presentation precedes empty tabs; no direct request read in loader", () => {
  assert.doesNotMatch(loadSource, /\.from\(["'](?:repair_requests|work_progress_updates)["']\)/);
  assert.match(page, /jobsLoadError \? \([\s\S]*?role="alert"[\s\S]*?filteredJobs.length === 0/);
});

test("authorized empty history keeps the work and leaves stage/completion absent", async () => {
  const f = fixture(undefined, undefined, async () => ({ data: [], error: null }));
  await f.load(); assert.equal(f.state.error, false); assert.equal(f.state.jobs.length, 1);
  assert.equal(f.state.jobs[0].latestProgressStatus, null); assert.equal(f.state.jobs[0].completionTimestamp, null);
});

for (const [name, reply] of Object.entries({
  denied: { data: [], error: { code: "42501" } }, missingRPC: { data: null, error: { code: "PGRST202" } },
  wrongRequest: { data: [{ ...progress, request_id: owner }], error: null }, malformed: { data: {}, error: null },
})) test(`history ${name}: fails visibly and clears stale jobs without direct fallback`, async () => {
  let fail = false;
  const f = fixture(undefined, undefined, async () => fail ? reply : { data: [progress], error: null });
  await f.load(); assert.equal(f.state.jobs.length, 1); fail = true; await f.load();
  assert.equal(f.state.error, true); assert.deepEqual(f.state.jobs, []);
});

test("latest stage is distinct from the latest Ready/Gata completion", async () => {
  const f = fixture(undefined, undefined, async () => ({ error: null, data: [
    { ...progress, id: owner, status: "Painting", created_at: "2026-11-04T12:00:00Z" },
    { ...progress, id: offer.id, status: "Gata", created_at: "2026-11-03T12:00:00Z" }, progress,
  ] }));
  await f.load(); assert.equal(f.state.error, false);
  assert.equal(f.state.jobs[0].latestProgressStatus, "Painting");
  assert.equal(f.state.jobs[0].completionTimestamp, "2026-11-03T12:00:00Z");
});

test("completed tab orders by persisted completion, with the existing fallback for empty history", async () => {
  const secondId = "10000000-0000-4000-8000-000000000002";
  const thirdId = "10000000-0000-4000-8000-000000000003";
  const f = fixture(async id => ({ data: [{ request_data: { ...detail("bodywork", "completed"), id,
    created_at: id === requestId ? "2026-11-06T00:00:00Z" : "2026-11-01T00:00:00Z" } }], error: null }),
    [offer, { ...offer, id: owner, request_id: secondId }, { ...offer, id: requestId, request_id: thirdId }],
    async id => ({ data: id === thirdId ? [] : [{ ...progress, request_id: id,
      created_at: id === secondId ? "2026-11-05T12:00:00Z" : progress.created_at }], error: null }));
  await f.load(); assert.equal(f.state.error, false);
  const start = page.indexOf("return [...matchingJobs].sort(");
  const sortSource = page.slice(start, page.indexOf("\n  }, [jobs, search", start));
  const sorted = new Function("matchingJobs", "getValidTimestamp", compile(sortSource))(
    f.state.jobs, (value: string | null) => value === null ? null : Date.parse(value)) as Job[];
  assert.deepEqual(sorted.map(job => job.requestId), [secondId, requestId, thirdId]);
});

test("history resolving after a newer refresh cannot replace current progress", async () => {
  let resolve!: (reply: Reply) => void; let started!: () => void; let calls = 0;
  const pending = new Promise<void>(done => { started = done; });
  const f = fixture(undefined, undefined, () => ++calls === 1
    ? new Promise(done => { resolve = done; started(); })
    : Promise.resolve({ data: [{ ...progress, status: "Painting" }], error: null }));
  const first = f.load(); await pending; await f.load(); resolve({ data: [progress], error: null }); await first;
  assert.equal(f.state.jobs[0].latestProgressStatus, "Painting");
});

test("account change or unmount invalidates pending history before publishing any jobs", async () => {
  let resolve!: (reply: Reply) => void; let started!: () => void;
  const pending = new Promise<void>(done => { started = done; });
  const f = fixture(undefined, undefined, () => new Promise(done => { resolve = done; started(); }));
  const first = f.load(); await pending; f.invalidate(); resolve({ data: [progress], error: null }); await first;
  assert.deepEqual(f.state.jobs, []); assert.deepEqual(f.rpcCalls, ["get_workshop_work_progress_history"]);
});
