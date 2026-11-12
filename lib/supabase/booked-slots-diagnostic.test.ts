import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const page = readFileSync(new URL("../../app/customer/schedule-damage/[id]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(source: ts.SourceFile, name: string) {
  let found: ts.Expression | undefined;
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name) found = n.initializer;
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.ok(found);
  return ts.transpileModule(`const fn = ${found.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const loader = extract(ast, "loadBookedSlots");
const readerCode = ts.transpileModule(readFileSync(new URL("./workshop-booked-slots.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture(reply: () => Promise<{ data: unknown; error: unknown }>) {
  const states: string[][] = [], loading: boolean[] = [], calls: unknown[] = [];
  const errors: string[] = [], contexts: string[] = [], ref = { current: 1 };
  const api: Record<string, unknown> = {};
  new Function("require", "exports", readerCode)((name: string) => {
    assert.equal(name, "@/lib/supabase/client");
    return { supabase: { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return reply(); } } };
  }, api);
  const fn = new Function("getWorkshopBookedSlots", "setBookedSlots", "setLoadingSlots", "setSlotsError", "setLoadedSlotsContext", "slotsAttemptRef", "slotsContext", `${loader}; return fn;`)(
    api.getWorkshopBookedSlots,
    (v: string[]) => states.push(v), (v: boolean) => loading.push(v),
    (v: string) => errors.push(v), (v: string) => contexts.push(v), ref, "current-date-context",
  );
  return { run: () => fn("2099-11-09", "synthetic-workshop", null, ref.current), states, loading, calls, errors, contexts, ref };
}
test("original RPC arguments retained; zero-second SQL times normalized for existing controls", async () => {
  const f = fixture(async () => ({ data: [{ slot_time: "10:00:00" }, { slot_time: "11:00" }], error: null }));
  assert.deepEqual(await f.run(), ["10:00", "11:00"]);
  assert.deepEqual(f.contexts, ["", "current-date-context"]);
  assert.deepEqual(f.calls, [{ name: "get_workshop_booked_slots", args: {
    p_workshop_id: "synthetic-workshop", p_date: "2099-11-09", p_exclude_appointment_id: null,
  } }]);
});
for (const failure of ["permission", "transport", "malformed", "null"]) {
  test(`${failure}: no successful empty availability or ready context`, async () => {
    const f = fixture(async () => {
      if (failure === "transport") throw new Error("synthetic");
      return { data: failure === "malformed" ? [{ slot_time: "invalid" }] : null,
        error: failure === "permission" ? { code: "42501" } : null };
    });
    assert.equal(await f.run(), null);
    assert.deepEqual(f.states, []);
    assert.deepEqual(f.contexts, [""]);
    assert.match(f.errors.at(-1)!, /Nu am putut consulta/);
    assert.deepEqual(f.loading, [true, false]);
  });
}
test("successful empty response is available; delayed/stale response cannot overwrite new date", async () => {
  const resolvers: ((value: { data: unknown; error: unknown }) => void)[] = [];
  const f = fixture(() => new Promise(resolve => resolvers.push(resolve)));
  const first = f.run();
  assert.deepEqual(f.contexts, [""]);
  assert.deepEqual(f.loading, [true]);
  f.ref.current++;
  const second = f.run();
  resolvers[1]({ data: [{ slot_time: "10:00" }], error: null });
  await second;
  resolvers[0]({ data: [], error: null });
  assert.equal(await first, null);
  assert.deepEqual(f.states, [["10:00"]]);
  assert.deepEqual(f.loading, [true, true, false]);
  const free = fixture(async () => ({ data: [], error: null }));
  assert.deepEqual(await free.run(), []);
  assert.equal(free.contexts.at(-1), "current-date-context");
});

type Node = { type: unknown; props: Record<string, unknown> };
function flatten(n: unknown): Node[] {
  if (Array.isArray(n)) return n.flatMap(flatten);
  if (!n || typeof n !== "object" || !("props" in n)) return [];
  const element = n as Node;
  return [element, ...flatten(element.props.children)];
}
const pickerApi: Record<string, unknown> = {};
const pickerCode = ts.transpileModule(readFileSync(new URL("../../app/components/AppointmentDateTimePicker.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function("require", "exports", pickerCode)((name: string) => {
  if (name === "@/app/components/TimeWheelPicker") return { default: "Wheel" };
  assert.equal(name, "react/jsx-runtime");
  return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
}, pickerApi);
const wheelSource = ts.createSourceFile("wheel.tsx", readFileSync(new URL("../../app/components/TimeWheelPicker.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const confirmCode = extract(wheelSource, "confirmTime");
for (const category of ["towing", "bodywork", "mechanical", "wheels"]) {
  test(`${category}: existing selector marks occupied times while permitting occupied and free selections`, () => {
    const tree = (pickerApi.default as (props: Record<string, unknown>) => unknown)({ date: "2099-11-09", dateInput: "09.11.2099", dateError: "", time: "",
      timeSlots: ["10:00", "11:00"], timeSelectionMode: category === "towing" ? "wheel" : "grid",
      bookedTimes: ["10:00"], minDate: "2099-11-09", onTimeChange() {} });
    if (category !== "towing") {
      for (const time of ["10:00", "11:00"]) {
        const button = flatten(tree).find(n => n.type === "button" && Array.isArray(n.props.children) && n.props.children[0] === time)!;
        assert.equal(button.props.disabled, false);
        if (time === "10:00") assert.ok(flatten(button).some(n => n.props.children === "Ocupat"));
      }
    } else {
      const wheel = flatten(tree).find(n => n.type === "Wheel")!;
      for (const hour of ["10", "11"]) {
        const changes: string[] = [], errors: string[] = [];
        const confirm = new Function("date", "draftHour", "draftMinute", "isTimeDisabled", "setError", "onChange", "setIsOpen", `${confirmCode}; return fn;`)(
          "2099-11-09", hour, "00", wheel.props.isTimeDisabled,
          (v: string) => errors.push(v), (v: string) => changes.push(v), () => {},
        );
        confirm();
        assert.deepEqual(changes, [`${hour}:00`]);
        assert.equal(errors.length, 0);
      }
    }
  });
}

for (const mode of ["wheel", "grid"]) test(`${mode}: saving flag still prevents duplicate interaction`, () => {
  const tree = (pickerApi.default as (props: Record<string, unknown>) => unknown)({
    date: "2099-11-09", dateInput: "09.11.2099", dateError: "", time: "",
    timeSlots: ["11:00"], timeSelectionMode: mode, bookedTimes: [], loadingTimes: true,
    minDate: "2099-11-09", onTimeChange() {},
  });
  if (mode === "grid") {
    assert.equal(flatten(tree).find(n => n.type === "button")!.props.disabled, true);
  } else {
    const wheel = flatten(tree).find(n => n.type === "Wheel")!;
    const changes: string[] = [], errors: string[] = [];
    const confirm = new Function("date", "draftHour", "draftMinute", "isTimeDisabled", "setError", "onChange", "setIsOpen", `${confirmCode}; return fn;`)(
      "2099-11-09", "11", "00", wheel.props.isTimeDisabled,
      (v: string) => errors.push(v), (v: string) => changes.push(v), () => {},
    );
    confirm();
    assert.deepEqual(changes, []);
    assert.equal(errors.length, 1);
  }
});

test("late failure from a previous date cannot invalidate the new successful result", async () => {
  const resolvers: ((reply: { data: unknown; error: unknown }) => void)[] = [];
  const f = fixture(() => new Promise(resolve => resolvers.push(resolve)));
  const old = f.run(); f.ref.current++;
  const current = f.run();
  resolvers[1]({ data: [], error: null }); await current;
  resolvers[0]({ data: null, error: { code: "42501" } }); await old;
  assert.equal(f.contexts.at(-1), "current-date-context");
  assert.deepEqual(f.errors, ["", ""]);
});
