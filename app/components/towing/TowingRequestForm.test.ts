import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { ComponentProps } from "react";
import type { TowingRequestFormValues, TowingRouteSnapshot, TowingRouteStatus } from "./TowingRequestForm";

type FormApi = typeof import("./TowingRequestForm");
type Props = ComponentProps<FormApi["default"]>;
type Element = { type: unknown; props: Record<string, unknown> };
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function pure(path: string) {
  const exports: Record<string, unknown> = {};
  new Function("exports", compile(read(path)))(exports);
  return exports;
}
const geo = pure("../../../lib/geo/geo-location.ts");
const plate = pure("../../../lib/utils/licensePlate.ts");
const schedule = pure("../../../lib/towing/towing-schedule-display.ts");
const route = pure("../../../lib/towing/towing-route.ts");
const componentJs = compile(read("./TowingRequestForm.tsx"));

// Synthetic data only. These tests never call a browser, Geoapify or Supabase.
const routeResult: TowingRouteSnapshot = { distanceMeters: 1000, durationSeconds: 120, paths: [[[0, 0], [0, 1]]] };
function initial(overrides: Partial<TowingRequestFormValues> = {}): TowingRequestFormValues {
  return {
    carBrand: "Synthetic", carModel: "Fixture", carYear: "2020", licensePlate: "B 123 TST",
    pickupAddress: "Synthetic A", pickupCity: "City A", destinationAddress: "Synthetic B", destinationCity: "City B",
    pickupCoordinates: { lat: 0, lng: 0 }, destinationCoordinates: { lat: 0, lng: 1 },
    pickupDiscoveryLocation: { locality: "City A", countryCode: "RO", postalCode: null, lat: 0, lng: 0 },
    route: null, scheduleType: "asap", requestedDate: "2099-12-01", requestedTime: "12:00", requestedTimezone: "UTC",
    reason: "breakdown", starts: false, canBePushed: true, wheels: "free", ...overrides,
  };
}
function ready(overrides: Partial<TowingRequestFormValues> = {}) {
  return initial({ route: { ...routeResult, coordinatesKey: "0,0|0,1" }, ...overrides });
}
function suggestion(lng: number) {
  return { location: { locality: "Synthetic destination", countryCode: "RO", postalCode: null, lat: 0, lng } };
}

// Runs actual component handlers/effects, with controlled timers and promises.
// Native React scheduling, touch interactions and maps still require Preview/iPhone.
function fixture(values = initial()) {
  const slots: unknown[] = [];
  const effects = new Map<number, { deps: unknown[]; cleanup: void | (() => void) }>();
  const pendingEffects: (() => void)[] = [];
  const timers = new Map<number, { fn: () => unknown; delay: number }>();
  const requests: { url: string; body: unknown; signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  const changes: TowingRequestFormValues[] = [];
  const statuses: TowingRouteStatus[] = [];
  let cursor = 0, timerId = 0, dirty = true;
  let tree: Element;
  let gpsSuccess: ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined;
  const react = {
    useRef: (value: unknown) => { const n = cursor++; return slots[n] ??= { current: value }; },
    useState: (value: unknown) => {
      const n = cursor++;
      if (!(n in slots)) slots[n] = typeof value === "function" ? value() : value;
      return [slots[n], (next: unknown) => {
        next = typeof next === "function" ? next(slots[n]) : next;
        if (!Object.is(next, slots[n])) { slots[n] = next; dirty = true; }
      }];
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const n = cursor++;
      const previous = slots[n] as { fn: unknown; deps: unknown[] } | undefined;
      if (!previous || deps.some((d, i) => !Object.is(d, previous.deps[i]))) slots[n] = { fn, deps };
      return (slots[n] as { fn: unknown }).fn;
    },
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
      const n = cursor++, previous = effects.get(n);
      if (!previous || deps.some((d, i) => !Object.is(d, previous.deps[i]))) pendingEffects.push(() => {
        previous?.cleanup?.(); effects.set(n, { deps, cleanup: fn() });
      });
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const api = {} as FormApi;
  const deps: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/dynamic": { default: () => "SyntheticMap" },
    "lucide-react": { MapPin: "MapPin", CheckCircle2: "Check", XCircle: "Error" },
    "@/app/components/AppointmentDateTimePicker": { default: "DatePicker", toLocalDateValue: () => "2026-01-01" },
    "@/app/components/towing/TowingLocationCombobox": { default: "LocationCombobox" },
    "@/lib/data/car-data": { carBrands: [], carModelsByBrand: {} },
    "@/lib/geo/geo-location": geo, "@/lib/utils/licensePlate": plate,
    "@/lib/towing/towing-schedule-display": schedule, "@/lib/towing/towing-route": route,
    "@/lib/towing/towing-display": { formatTowingRouteDistance: () => "synthetic distance", formatTowingRouteDuration: () => "synthetic duration" },
  };
  new Function("require", "exports", "fetch", "setTimeout", "clearTimeout", "navigator", componentJs)(
    (name: string) => { assert.ok(name in deps, `Unexpected import ${name}`); return deps[name]; }, api,
    (url: string, options: { body: string; signal: AbortSignal }) => new Promise(resolve => {
      requests.push({ url, body: JSON.parse(options.body), signal: options.signal, resolve });
    }),
    (fn: () => unknown, delay: number) => { timers.set(++timerId, { fn, delay }); return timerId; },
    (id: number) => timers.delete(id),
    { geolocation: { getCurrentPosition: (success: typeof gpsSuccess) => { gpsSuccess = success; } } },
  );
  const props: Props = { initialValues: values, onValuesChange: v => { changes.push(v); }, onRouteStatusChange: s => { statuses.push(s); } };
  function render() {
    let passes = 0;
    while (dirty) {
      assert.ok(++passes < 25, "effects must settle");
      dirty = false; cursor = 0;
      tree = api.default(props) as unknown as Element;
      pendingEffects.splice(0).forEach(fn => fn());
    }
  }
  function nodes(predicate: (node: Element) => boolean) {
    const found: Element[] = [];
    function visit(value: unknown) {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const node = value as Element;
      if (predicate(node)) found.push(node);
      visit(node.props.children); visit(node.props.action);
    }
    visit(tree); return found;
  }
  function call(node: Element, name: string, args: unknown[] = [], flush = true) {
    const handler = node.props[name]; assert.equal(typeof handler, "function");
    if (typeof handler === "function") handler(...args);
    if (flush) render();
  }
  render();
  return {
    api, requests, changes, statuses, nodes, call, render,
    latest: () => changes.at(-1)!,
    location: (kind: "pickup" | "destination") => nodes(n => n.props.title === (kind === "pickup" ? "Locație preluare" : "Destinație"))[0],
    select: (lng: number, flush = true) => call(nodes(n => n.props.title === "Destinație")[0], "onCitySelect", [suggestion(lng)], flush),
    runTimer: (delay: number) => {
      const entries = [...timers].filter(([, t]) => t.delay === delay);
      entries.forEach(([id, t]) => { timers.delete(id); void t.fn(); }); render();
    },
    timerCount: (delay: number) => [...timers.values()].filter(t => t.delay === delay).length,
    reply: async (index: number, data: unknown, ok = true) => {
      requests[index].resolve({ ok, json: async () => data });
      await new Promise(resolve => setImmediate(resolve)); render();
    },
    retry: () => call(nodes(n => n.props.children === "Reîncearcă traseul")[0], "onClick"),
    gps: () => { const button = nodes(n => n.type === "button" && Array.isArray(n.props.children) && n.props.children.includes("Folosește locația mea"))[0]; call(button, "onClick"); },
    gpsReply: () => { assert.ok(gpsSuccess); gpsSuccess({ coords: { latitude: 0, longitude: 3 } }); render(); },
    unmount: () => { effects.forEach(e => e.cleanup?.()); dirty = false; },
  };
}

test("slow calculation stays unpublished until both metrics and geometry belong to current coordinates", async () => {
  const f = fixture();
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), false);
  f.runTimer(700);
  assert.equal(f.requests.length, 1);
  assert.equal(f.statuses.at(-1), "loading");
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), false);
  await f.reply(0, { route: routeResult });
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), true);
  assert.deepEqual(f.latest().route, { ...routeResult, coordinatesKey: "0,0|0,1" });
});

test("destination change invalidates synchronously, before render/effects notify the parent", () => {
  const f = fixture(ready());
  f.select(2, false);
  assert.equal(f.latest().route, null);
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), false);
  f.render(); f.runTimer(700);
  assert.deepEqual(f.requests[0].body, { pickupLat: 0, pickupLng: 0, destinationLat: 0, destinationLng: 2 });
});

test("late route A cannot overwrite B, including returning to the same coordinates A", async () => {
  const f = fixture(); f.runTimer(700);
  f.select(2); f.runTimer(700);
  f.select(1); f.runTimer(700);
  await f.reply(0, { route: { ...routeResult, distanceMeters: 999 } });
  await f.reply(1, { route: { ...routeResult, distanceMeters: 888 } });
  assert.equal(f.latest().route, null);
  assert.equal(f.statuses.at(-1), "loading");
  await f.reply(2, { route: routeResult });
  assert.equal(f.latest().route?.distanceMeters, 1000);
  assert.equal(f.requests[0].signal.aborted, true);
});

test("reselecting identical coordinates cannot clear the route forever without recalculating", async () => {
  const f = fixture(ready()); f.select(1); f.runTimer(700);
  assert.equal(f.requests.length, 1);
  await f.reply(0, { route: routeResult });
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), true);
});

test("a late forward-geocode response cannot replace a newer autocomplete selection", async () => {
  const f = fixture(ready());
  f.call(f.location("destination"), "onAddressChange", ["Synthetic new address"]); f.runTimer(900);
  f.select(2, false);
  await f.reply(0, { matched: true, lat: 0, lng: 3, location: suggestion(3).location });
  assert.deepEqual(f.latest().destinationCoordinates, { lat: 0, lng: 2 });
  assert.equal(f.latest().route, null);
  assert.equal(f.requests[0].signal.aborted, true);
});

test("a successful forward lookup still requires a new route before publication", async () => {
  const f = fixture(ready());
  f.call(f.location("destination"), "onAddressChange", ["Synthetic new address"]);
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), false);
  f.runTimer(900);
  await f.reply(0, { matched: true, lat: 0, lng: 2, location: suggestion(2).location });
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), false);
  f.runTimer(700);
  await f.reply(1, { route: { ...routeResult, paths: [[[0, 0], [0, 2]]] } });
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), true);
  assert.equal(f.latest().route?.coordinatesKey, "0,0|0,2");
});

test("drag cancels queued forward geocoding and invalidates the old route while reverse lookup is pending", async () => {
  const f = fixture(ready());
  f.call(f.location("destination"), "onAddressChange", ["Synthetic other address"]);
  f.call(f.location("destination"), "onPositionChange", [0, 4]);
  assert.equal(f.timerCount(900), 0);
  assert.equal(f.latest().route, null);
  assert.equal(f.latest().destinationCoordinates, null);
  f.select(2);
  await f.reply(0, { address: "Stale address", city: "Stale city", location: suggestion(4).location });
  assert.deepEqual(f.latest().destinationCoordinates, { lat: 0, lng: 2 });
});

test("pending device location cannot overwrite a subsequent manual pickup edit", () => {
  const f = fixture(ready()); f.gps();
  assert.equal(f.latest().route, null);
  f.call(f.location("pickup"), "onCityChange", ["Manual city"]);
  f.gpsReply();
  assert.equal(f.requests.length, 0);
  assert.equal(f.latest().pickupCity, "Manual city");
});

for (const invalid of [
  null, { ...routeResult, distanceMeters: null }, { ...routeResult, durationSeconds: -1 },
  { ...routeResult, distanceMeters: Infinity }, { ...routeResult, durationSeconds: "120" },
  { ...routeResult, paths: [] }, { ...routeResult, paths: [[[0, 0]]] },
]) test(`invalid route response remains blocked (${JSON.stringify(invalid)})`, async () => {
  const f = fixture(); f.runTimer(700); await f.reply(0, { route: invalid });
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), false);
  assert.equal(f.statuses.at(-1), "error");
  assert.equal(f.nodes(n => n.props.role === "alert").length, 1);
});

test("failed calculation can be retried successfully with the same coordinates", async () => {
  const f = fixture(); f.runTimer(700); await f.reply(0, {}, false);
  f.retry(); f.runTimer(700); await f.reply(1, { route: routeResult });
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), true);
  assert.equal(f.statuses.at(-1), "success");
});

test("timeout exposes retry; a late success from the timed-out request is ignored", async () => {
  const f = fixture(); f.runTimer(700); f.runTimer(15_000);
  assert.equal(f.statuses.at(-1), "error");
  assert.equal(f.requests[0].signal.aborted, true);
  f.retry(); f.runTimer(700);
  await f.reply(0, { route: { ...routeResult, distanceMeters: 999 } });
  assert.equal(f.latest().route, null);
  await f.reply(1, { route: routeResult });
  assert.equal(f.latest().route?.distanceMeters, 1000);
});

test("unmount prevents a late routing response from publishing a snapshot", async () => {
  const f = fixture(); f.runTimer(700); const count = f.changes.length;
  f.unmount(); await f.reply(0, { route: routeResult });
  assert.equal(f.changes.length, count);
});

test("ASAP/scheduled toggles preserve the valid route and do not request a different route", () => {
  const f = fixture(ready());
  for (const label of ["Alege data și ora", "Cât mai repede"]) {
    f.call(f.nodes(n => n.props.children === label)[0], "onClick");
    assert.equal(f.api.hasCurrentTowingRoute(f.latest()), true);
    assert.equal(f.api.validateTowingRequestFormValues(f.latest()).valid, true);
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.timerCount(700), 0);
});

test("existing editor snapshots without local provenance remain compatible", () => {
  const f = fixture(initial({ route: routeResult }));
  assert.equal(f.api.hasCurrentTowingRoute(f.latest()), true);
  assert.equal(f.timerCount(700), 0);
});

// Execute the real publication handler and the real request-to-RPC mapper.
// Authentication, uploads, RPC and navigation are isolated in-memory doubles.
function declaration(path: string, name: string) {
  const source = read(path), file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = "";
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(file).replace(/^export\s+/, "");
    ts.forEachChild(n, visit);
  }
  visit(file); assert.ok(found, `${name} exists`); return found;
}
const submitJs = compile(declaration("../../post-towing/page.tsx", "handleSubmit"));
const createJs = compile(declaration("../../../lib/supabase/repair-requests.ts", "createRepairRequest"));
const pageSource = read("../../post-towing/page.tsx");
const pageAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let submitButton = "";
function findSubmitButton(n: ts.Node) {
  if (ts.isJsxElement(n) && n.openingElement.tagName.getText(pageAst) === "button" &&
    n.openingElement.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(pageAst) === "type" &&
      a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text === "submit")) submitButton = n.getText(pageAst);
  ts.forEachChild(n, findSubmitButton);
}
findSubmitButton(pageAst);
assert.ok(submitButton);
const buttonJs = compile(`export const button = ${submitButton};`);
for (const [label, values, status, submitting, disabled] of [
  ["loading", initial(), "loading", false, true],
  ["failed", initial(), "error", false, true],
  ["stale", ready({ destinationCoordinates: { lat: 0, lng: 2 } }), "success", false, true],
  ["valid", ready(), "success", false, false],
  ["submitting", ready(), "success", true, true],
] as const) test(`actual publish button is correctly gated when ${label}`, () => {
  const exports: { button?: Element } = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  new Function("exports", "require", "hasCurrentTowingRoute", "towingValues", "routeStatus", "isSubmitting", buttonJs)(
    exports, (name: string) => { assert.equal(name, "react/jsx-runtime"); return { jsx, jsxs: jsx }; },
    fixture().api.hasCurrentTowingRoute, values, status, submitting,
  );
  assert.equal(exports.button?.props.disabled, disabled);
});

function publication(values = ready(), authGate: Promise<void> = Promise.resolve()) {
  const form = fixture();
  const calls: { name: string; payload: Record<string, unknown> }[] = [];
  const alerts: string[] = [], states: boolean[] = [];
  let authCalls = 0;
  const current = { current: values };
  const busy = { current: false };
  const create = new Function("supabase", "formatLicensePlateForDb", `${createJs}; return createRepairRequest;`)(
    { rpc: async (name: string, payload: Record<string, unknown>) => { calls.push({ name, payload }); return { data: "synthetic-request", error: null }; } },
    plate.formatLicensePlateForDb,
  );
  const deps = {
    towingValuesRef: current, isSubmittingRef: busy,
    hasCurrentTowingRoute: form.api.hasCurrentTowingRoute,
    validateTowingRequestFormValues: form.api.validateTowingRequestFormValues,
    setIsSubmitting: (v: boolean) => states.push(v), alert: (s: string) => alerts.push(s),
    supabase: { auth: { getUser: async () => { authCalls++; await authGate; return { data: { user: { id: "synthetic-owner" } } }; } } },
    files: [], description: "", targetWorkshopId: null,
    uploadPreparedRepairImages: async () => [], createRepairRequest: create,
    sessionStorage: { setItem() {} }, router: { replace() {}, push() {} }, console: { error() {} },
  };
  const submit = new Function(...Object.keys(deps), `${submitJs}; return handleSubmit;`)(...Object.values(deps)) as (e: { preventDefault(): void }) => Promise<void>;
  return { current, busy, calls, alerts, states, authCalls: () => authCalls, submit: () => submit({ preventDefault() {} }) };
}

for (const scheduleType of ["asap", "scheduled"] as const) test(`${scheduleType}: publication sends both metrics and complete geometry to the actual RPC mapper`, async () => {
  const f = publication(ready({ scheduleType })); await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "create_repair_request_with_discovery_location");
  const payload = f.calls[0].payload.p_request as Record<string, unknown>;
  assert.equal(payload.route_distance_meters, 1000);
  assert.equal(payload.route_duration_seconds, 120);
  assert.deepEqual(payload.route_paths, routeResult.paths);
  assert.equal(payload.destination_lng, 1);
  assert.equal(payload.towing_schedule_type, scheduleType);
  assert.equal(payload.towing_requested_at === null, scheduleType === "asap");
  assert.equal("coordinatesKey" in payload, false);
  assert.equal(f.alerts.length, 0);
});

for (const values of [initial(), ready({ destinationCoordinates: { lat: 0, lng: 2 } }), ready({ route: { ...routeResult, paths: [] } })]) {
  test("publication refuses absent, mismatched or invalid snapshots before auth/upload/RPC", async () => {
    const f = publication(values); await f.submit();
    assert.equal(f.authCalls(), 0); assert.equal(f.calls.length, 0); assert.equal(f.alerts.length, 1);
  });
}

test("location invalidation during asynchronous preparation prevents an obsolete payload", async () => {
  let resolve!: () => void;
  const f = publication(ready(), new Promise<void>(r => { resolve = r; }));
  const pending = f.submit();
  f.current.current = initial({ destinationCoordinates: { lat: 0, lng: 2 } });
  resolve(); await pending;
  assert.equal(f.calls.length, 0); assert.equal(f.busy.current, false);
  assert.match(f.alerts[0], /s-au schimbat/);
});

test("repeated submits are blocked both in flight and after a confirmed successful publication", async () => {
  let resolve!: () => void;
  const f = publication(ready(), new Promise<void>(r => { resolve = r; }));
  const first = f.submit(); await f.submit();
  assert.equal(f.authCalls(), 1);
  resolve(); await first; await f.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.busy.current, true);
  assert.deepEqual(f.states, [true]);
});
