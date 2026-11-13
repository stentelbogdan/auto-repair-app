import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const dateCode = compile("./date-only.ts");
const dateApi: Record<string, (value: string, arg?: never) => unknown> = {};
new Function("exports", dateCode)(dateApi);
const componentCode = compile("../../app/components/RomanianDateCalendar.tsx");
type Element = { type: unknown; props: Record<string, unknown> };
function nodes(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const node = tree as Element;
  return [node, ...nodes(node.props.children)];
}
function fixture(value = "2026-11-20") {
  const states: unknown[] = [], refs: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0;
  let tree: unknown, restored = false, modal = false;
  const changes: string[] = [];
  const effects: (() => unknown)[] = [];
  const documentMock = { body: { style: { overflow: "auto" } } };
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", "document", componentCode)((name: string) => {
    if (name === "react") return {
      useState: (initial: unknown) => {
        const i = stateIndex++; if (!(i in states)) states[i] = initial;
        return [states[i], (next: unknown) => { states[i] = next; }];
      },
      useRef: (initial: unknown) => { const i = refIndex++; return refs[i] ?? (refs[i] = { current: initial }); },
      useEffect: (effect: () => unknown) => { effects.push(effect); }, useId: () => "synthetic-id",
    };
    if (name === "@/lib/calendar/date-only") return { ...dateApi, localToday: () => "2026-11-13" };
    if (name === "lucide-react") return { CalendarDays: "Icon", Check: "Icon", X: "Icon", ChevronLeft: "Icon", ChevronRight: "Icon" };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) };
    throw new Error(name);
  }, exports, documentMock);
  const component = exports.default as (props: unknown) => unknown;
  const find = (predicate: (node: Element) => boolean) => { const node = nodes(tree).find(predicate); assert.ok(node); return node; };
  const event = (node: Element, name: string, arg?: unknown) => (node.props[name] as (event?: unknown) => void)(arg);
  const render = () => {
    stateIndex = 0; refIndex = 0; effects.length = 0;
    tree = component({ value, minDate: "2026-11-13", onChange: (v: string) => changes.push(v) });
    refs[0].current = { showModal: () => { modal = true; }, close: () => { modal = false; event(find(n => n.type === "dialog"), "onClose"); }, querySelector: () => ({ focus() {} }) };
    refs[1].current = { focus: () => { restored = true; } };
    return tree;
  };
  render();
  const click = (label: string) => { event(find(n => n.props["aria-label"] === label || n.props.children === label), "onClick"); render(); };
  const day = (value: string) => find(n => n.props["data-day"] === value);
  return { render, click, day, event, find, changes, states, modal: () => modal, restored: () => restored };
}
for (const tz of ["Europe/Berlin", "America/Los_Angeles", "Pacific/Kiritimati"]) test(`date-only selection and DST: ${tz}`, () => {
  const code = `const a={}; (new Function('exports',${JSON.stringify(dateCode)}))(a);
    const assert=require('node:assert/strict');
    for(const d of ['2026-03-29','2026-10-25','2026-11-20','2028-02-29']) assert.equal(a.dateKey(a.calendarDate(d)),d);
    assert.equal(a.calendarDate('2026-02-29'),null);
    assert.equal(a.calendarDate('2026-13-01'),null);
    assert.equal(a.moveMonth('2028-01-31',1),'2028-02-29');
    assert.equal(a.addDays('2026-12-31',1),'2027-01-01');
    assert.equal(a.romanianDate('2026-11-01',true),'noiembrie 2026');
    assert.equal(a.localToday(new Date(2026,10,13,0,15)),'2026-11-13');
    const days=a.monthCells('2026-11'); assert.equal(days[6],'2026-11-01'); assert.equal(days.filter(Boolean).length,30);`;
  const result = spawnSync(process.execPath, ["-e", code], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
test("selection commits only with checkmark; date string and focus preserved", () => {
  const f = fixture(); f.click("Deschide calendarul"); assert.equal(f.modal(), true);
  assert.equal(f.day("2026-11-12").props.disabled, true);
  f.event(f.day("2026-11-21"), "onClick"); f.render(); assert.deepEqual(f.changes, []);
  f.click("Confirmă data"); assert.deepEqual(f.changes, ["2026-11-21"]);
  assert.equal(f.restored(), true); assert.equal(f.modal(), false);
});
test("cancel preserves saved value; opening again discards temporary draft", () => {
  const f = fixture(); f.click("Deschide calendarul");
  f.event(f.day("2026-11-21"), "onClick"); f.render(); f.click("Închide fără modificări");
  assert.deepEqual(f.changes, []); f.click("Deschide calendarul");
  assert.equal(f.states[1], "2026-11-20"); f.click("Confirmă data");
  assert.deepEqual(f.changes, [], "confirming unchanged date must not reset the selected time");
});
test("reset remains temporary until confirmed", () => {
  const f = fixture(); f.click("Deschide calendarul"); f.click("Resetați");
  assert.deepEqual(f.changes, []); f.click("Confirmă data"); assert.deepEqual(f.changes, [""]);
});
test("month arrows and keyboard navigation respect minimum and month boundaries", () => {
  const f = fixture(); f.click("Deschide calendarul"); f.click("Luna următoare");
  assert.equal(f.states[2], "2026-12-20"); f.click("Luna precedentă");
  let prevented = false;
  f.event(f.day("2026-11-20"), "onKeyDown", { key: "ArrowDown", preventDefault: () => { prevented = true; } });
  f.render(); assert.equal(f.states[2], "2026-11-27"); assert.equal(prevented, true);
  f.event(f.day("2026-11-27"), "onKeyDown", { key: "PageUp", preventDefault() {} }); f.render();
  assert.equal(f.states[2], "2026-11-13"); assert.deepEqual(f.changes, []);
});
test("shared and legacy scheduling routes contain no native date input", () => {
  for (const path of ["../../app/components/AppointmentDateTimePicker.tsx", "../../app/workshops/[id]/offer/page.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes("<RomanianDateCalendar")); assert.doesNotMatch(source, /type="date"/);
  }
});
