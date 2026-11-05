import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type { NotificationFocusOptions, NotificationFocusTarget } from "./useNotificationFocus";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const compile = (s: string) => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const request = "11111111-1111-4111-8111-111111111111", offer = "22222222-2222-4222-8222-222222222222", appointment = "33333333-3333-4333-8333-333333333333";
const target = { requestId: request, offerId: offer, appointmentId: appointment, category: "wheels", tab: "appointments" };
function fixture() {
  let cursor = 0; const refs: { current: unknown }[] = []; const effects: (() => unknown)[] = [];
  const calls: string[] = []; let displayed = true;
  const element = { isConnected: true, getClientRects: () => displayed ? [1] : [], scrollIntoView: () => calls.push("scroll"),
    classList: { add: () => calls.push("highlight"), remove: () => calls.push("unhighlight") } };
  const exported: Record<string, unknown> = {};
  new Function("require", "exports", "document", compile(read("./useNotificationFocus.ts")))(
    () => ({ useRef: (initial: unknown) => { const i = cursor++; return refs[i] ??= { current: initial }; },
      useEffect: (fn: () => unknown) => effects.push(fn) }), exported,
    { dispatchEvent: () => calls.push("focus-event"), querySelector: (selector: string) => { calls.push(selector); return element; } });
  const hook = exported.useNotificationFocus as (o: NotificationFocusOptions<NotificationFocusTarget>, s: string) => void;
  const resolve = exported.resolveNotificationFocus as (s: string, items: NotificationFocusTarget[]) => { target: NotificationFocusTarget; selector: string } | null;
  return { resolve, calls, element, hide: () => { displayed = false; }, render: (options: NotificationFocusOptions<NotificationFocusTarget>, search: string) => {
    cursor = 0; effects.length = 0; hook(options, search); const cleanup = effects[0]() as () => void; effects[1](); return cleanup;
  } };
}
for (const category of ["bodywork", "mechanical", "wheels", "towing"]) test(`${category}: wait for authorized load, select actual tab/category, then focus once`, () => {
  const f = fixture(); const t = { ...target, category }; const search = `focusOffer=${offer}&category=towing&tab=completed`;
  let selected = false, selections = 0;
  const options = { ready: false, targets: [t], select: () => { selections++; if (!selected) { selected = true; return false; } return true; } };
  f.render(options, search); assert.equal(selections, 0);
  options.ready = true; f.render(options, search); assert.equal(selections, 1); assert.ok(!f.calls.includes("scroll"));
  f.render(options, search); assert.equal(f.calls.filter(c => c === "scroll").length, 1);
  f.render({ ...options, targets: [{ ...t }] }, search); assert.equal(selections, 2); assert.equal(f.calls.filter(c => c === "scroll").length, 1);
});
for (const search of [`focusOffer=${offer}`, `focusRequest=${request}`, `focusAppointment=${appointment}`, `focusRequest=${request}&focusOffer=${offer}&focusAppointment=${appointment}`]) test(`exact target: ${search.split('=')[0]}`, () => {
  const f = fixture(); const resolved = f.resolve(search, [target]); assert.equal(resolved?.target, target);
  assert.ok(resolved?.selector.includes(`data-focus-request="${request}"`));
});
for (const search of ["", "focusOffer=bad%22%5D", `focusOffer=${offer}&focusRequest=${offer}`, `focusOffer=${offer}&focusAppointment=${offer}`, `focusOffer=${offer}&focusOffer=${offer}`]) test(`invalid/contradictory focus fails closed: ${search}`, () => {
  assert.equal(fixture().resolve(search, [target]), null);
});
test("no rows or RPC failure exposes no focus even if a DOM card exists", () => {
  const f = fixture(); f.render({ ready: true, targets: [], select: () => { throw new Error("No authorized target"); } }, `focusOffer=${offer}`);
  assert.ok(!f.calls.includes("scroll"));
});
test("two offers on the same request select only the requested offer", () => {
  const other = { ...target, offerId: appointment };
  assert.equal(fixture().resolve(`focusOffer=${appointment}`, [target, other])?.target, other);
});
test("query-only navigation to another context scrolls once again; clearing URL removes old highlight", () => {
  const f = fixture(); const options = { ready: true, targets: [target, { ...target, offerId: appointment }], select: () => true };
  f.render(options, `focusOffer=${offer}`); f.render(options, `focusOffer=${appointment}`);
  assert.equal(f.calls.filter(c => c === "scroll").length, 2);
  f.render(options, ""); assert.equal(f.calls.at(-1), "unhighlight");
});
test("hidden or disconnected card cannot complete focus; unmount releases highlight", () => {
  const f = fixture(); f.hide(); const cleanup = f.render({ ready: true, targets: [target], select: () => true }, `focusOffer=${offer}`);
  assert.ok(!f.calls.includes("scroll")); cleanup();
});
test("account reset invalidates old target; a moved stage reselects its actual tab", () => {
  const f = fixture(); let selected = 0; const select = () => { selected++; return true; };
  f.render({ ready: true, targets: [target], select }, `focusOffer=${offer}`);
  f.render({ ready: true, targets: [{ ...target, tab: "completed" }], select }, `focusOffer=${offer}`);
  assert.equal(selected, 2);
  f.render({ ready: false, targets: [target], select }, `focusOffer=${offer}`);
  f.render({ ready: true, targets: [], select }, `focusOffer=${offer}`); assert.equal(selected, 2);
});
// Execute the actual page adapter JSX independently from networking and rendering.
function adapter(path: string, values: Record<string, unknown>) {
  const page = read(path); const start = page.indexOf("<NotificationFocus\n"); const end = page.indexOf("\n      />", start);
  assert.ok(start >= 0 && end > start);
  const source = compile(`const node = (${page.slice(start, end + 9)});`);
  return new Function("React", "NotificationFocus", ...Object.keys(values), source + "\nreturn node;")(
    { createElement: (_type: unknown, props: unknown) => props }, "focus", ...Object.values(values)) as NotificationFocusOptions<NotificationFocusTarget>;
}
for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  test(`${category}: Client offer adapter ignores URL category and uses authorized offer context`, () => {
    let chosen = "all";
    const p = adapter("../../app/offers/page.tsx", { authorized: true, checkingAccess: false, loadingOffers: false,
      items: [{ request: { id: request, serviceType: category }, offer: { id: offer }, appointment: { id: appointment } }],
      getOfferCategory: (v: string) => v, activeCategory: "all", setActiveCategory: (v: string) => { chosen = v; } });
    assert.equal(p.targets[0].category, category); assert.equal(p.select(p.targets[0]), false); assert.equal(chosen, category);
  });
  test(`${category}: Service rejected offer from notification uses the same category selection`, () => {
    let chosen = "all";
    const p = adapter("../../app/workshops/my-offers/page.tsx", { authorized: true, checkingAccess: false, loading: false, loadError: false,
      normalizedOffers: [], focusedRejectedOffer: { id: offer, repair_requests: { id: request, service_type: category }, repair_appointments: [{ id: appointment }] },
      resolveRepairServiceType: (v: string) => v, activeCategory: "all", setActiveCategory: (v: string) => { chosen = v; } });
    assert.equal(p.targets[0].offerId, offer); p.select(p.targets[0]); assert.equal(chosen, category);
  });
  for (const stage of ["appointments", "workshop", "completed"]) test(`${category}/${stage}: Service job adapter selects real stage, clears obstructing search`, () => {
    const chosen: unknown[] = [];
    const p = adapter("../../app/workshops/won-jobs/page.tsx", { authorized: true, checkingAccess: false, loadingJobs: false, jobsLoadError: false,
      jobs: [{ requestId: request, offerId: offer, request: { status: "matched", serviceType: category }, appointment: { id: appointment, status: "customer_proposed" } }],
      resolveRepairServiceType: (v: string) => v, getJobState: () => ({ stage }), activeTab: "other", activeCategory: "all", search: "unrelated",
      setActiveTab: (v: unknown) => chosen.push(v), setSearch: (v: unknown) => chosen.push(v),
      setActiveCategoryByTab: (fn: (v: object) => object) => chosen.push(fn({})) });
    assert.equal(p.targets.length, 1); p.select(p.targets[0]); assert.deepEqual(chosen, [stage, { [stage]: category }, ""]);
  });
  for (const tab of ["scheduled", "in_progress", "completed"]) test(`${category}/${tab}: Client jobs select actual tab after loading, not stale URL`, () => {
    const chosen: unknown[] = []; const job = { request: { id: request, service_type: category }, acceptedOffer: { id: offer }, appointment: { id: appointment } };
    const p = adapter("../../app/customer/my-jobs/page.tsx", { loading: false,
      scheduledJobs: tab === "scheduled" ? [job] : [], inProgressJobs: tab === "in_progress" ? [job] : [], completedJobs: tab === "completed" ? [job] : [],
      resolveRepairServiceType: (v: string) => v, activeTab: "other", activeCategory: "all", search: "unrelated",
      setActiveTab: (v: unknown) => chosen.push(v), setSearch: (v: unknown) => chosen.push(v),
      setActiveCategoryByTab: (fn: (v: object) => object) => chosen.push(fn({})) });
    p.select(p.targets[0]); assert.deepEqual(chosen, [tab, { [tab]: category }, ""]);
  });
}
test("same-page navigation subscribes to search parameters inside a local Suspense boundary", () => {
  const s = read("../../app/components/NotificationFocus.tsx"); assert.match(s, /useSearchParams\(\)/); assert.match(s, /<Suspense fallback=\{null\}>/);
  assert.doesNotMatch(read("./useNotificationFocus.ts"), /router\.|supabase|\.rpc\(|setInterval|\.update\(/);
});
test("Client focus query remains in place for selective receipts; no timer consumes it", () => {
  const s = read("../../app/customer/my-jobs/page.tsx"); assert.doesNotMatch(s, /params.delete\("focusRequest"\)/);
  assert.match(read("./useVisibleNotificationRead.ts"), /focus.has\("focusRequest"\).*context.requestId/);
});
test("matched winning jobs remain visible during repeated proposals; appointment mutations unchanged", () => {
  const s = read("../../app/workshops/won-jobs/page.tsx"); assert.match(s, /const shouldShowInWonJobs =\s*job.request.status === "matched"/);
});

test("same-page rejected-offer navigation reloads authorized context once, not on ordinary refetch", () => {
  const source = read("../../app/components/NotificationFocus.tsx");
  let search = new URLSearchParams(`focusOffer=${offer}`);
  const previous = { current: undefined as string | undefined };
  const effects: (() => void)[] = [], changes: string[] = [];
  const exports: Record<string, unknown> = {};
  const react = { Suspense: "suspense", useRef: (initial: string) => { previous.current ??= initial; return previous; },
    useEffect: (fn: () => void) => effects.push(fn) };
  new Function("require", "exports", compile(source + "\nexport { FocusController };"))((name: string) => {
    if (name === "react") return react;
    if (name === "next/navigation") return { useSearchParams: () => search };
    return { useNotificationFocus() {} };
  }, exports);
  const render = () => { (exports.FocusController as (p: object) => void)({ onFocusChange: (value: string) => changes.push(value) }); effects.splice(0).forEach(fn => fn()); };
  render(); render(); assert.equal(changes.length, 0);
  search = new URLSearchParams(`focusOffer=${appointment}`); render(); render(); assert.equal(changes.length, 1);
  search.set("category", "wheels"); render(); assert.equal(changes.length, 1);
  search = new URLSearchParams(); render(); assert.equal(changes.length, 2);
  const page = read("../../app/workshops/my-offers/page.tsx");
  assert.match(page, /setFocusedRejectedOffer\(null\);\s*setLoading\(true\);\s*setFocusNavigation\(focus\)/);
  assert.match(page, /\[router, capture, complete, focusNavigation\]/);
  assert.match(page, /cancelled = true;[\s\S]*removeChannel\(realtimeChannel\)/);
});

test("loading-state refetch restores highlighting without repeating scrolling or overriding user filters", () => {
  const f = fixture(); let selected = 0;
  const options = { ready: true, targets: [target], select: () => { selected++; return true; } };
  const search = `focusOffer=${offer}`;
  f.render(options, search);
  f.render({ ...options, ready: false }, search);
  f.render({ ...options, targets: [{ ...target }] }, search);
  assert.equal(selected, 1);
  assert.equal(f.calls.filter(c => c === "scroll").length, 1);
  assert.equal(f.calls.at(-1), "highlight");
});
