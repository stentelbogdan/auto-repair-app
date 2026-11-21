import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ComponentProps } from "react";
import ts from "typescript";
import type { GeoLocationOption } from "./GeoLocationCombobox";

type Props = ComponentProps<typeof import("./GeoLocationCombobox").default>;
type Element = { type: string; props: Record<string, unknown> };
const compile = (path: string) => ts.transpileModule(
  readFileSync(new URL(path, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } },
).outputText;
const componentSource = compile("./GeoLocationCombobox.tsx");
const geo = {} as typeof import("../../lib/geo/geo-location");
new Function("exports", compile("../../lib/geo/geo-location.ts"))(geo);

// Synthetic location; never contacts geocoding, Supabase or a browser.
const suggestion: GeoLocationOption = {
  id: "synthetic-nijmegen", city: "Nijmegen", label: "Nijmegen, Netherlands",
  region: "Gelderland", country: "Netherlands", countryCode: "NL",
  postalCode: null, lat: 0, lng: 0,
  location: { locality: "Nijmegen", countryCode: "NL", postalCode: null, lat: 0, lng: 0 },
};

// Runs the real component handlers/effects using the repository's Node harness
// convention. Native focus ordering, scrolling and VoiceOver require an iPhone.
function fixture(overrides: Partial<Props> = {}) {
  const slots: unknown[] = [];
  const effects = new Map<number, { deps: unknown[]; cleanup: void | (() => void) }>();
  const pendingEffects: (() => void)[] = [];
  const timers = new Map<number, () => unknown>();
  const requests: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  const changes: string[] = [];
  const selections: GeoLocationOption[] = [];
  let cursor = 0, timerId = 0, dirty = true;
  let tree: Element;
  const props: Props = {
    value: "nijm", localSuggestions: [], ...overrides,
    onChange: (value) => { changes.push(value); props.value = value; dirty = true; },
    onSelect: (option) => { selections.push(option); },
  };
  const react = {
    useId: () => "locality-test",
    useRef: (initial: unknown) => {
      const n = cursor++;
      return slots[n] ??= { current: initial };
    },
    useState: (initial: unknown) => {
      const n = cursor++;
      if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial;
      return [slots[n], (value: unknown) => {
        const next = typeof value === "function" ? value(slots[n]) : value;
        if (!Object.is(next, slots[n])) { slots[n] = next; dirty = true; }
      }];
    },
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
      const n = cursor++;
      const previous = effects.get(n);
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects.set(n, { deps, cleanup: fn() });
        });
      }
    },
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", "fetch", "setTimeout", "clearTimeout", componentSource)(
    (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/lib/geo/geo-location") return geo;
      throw new Error(`Unexpected dependency: ${name}`);
    }, exports,
    (_url: string, options: { signal: AbortSignal }) => new Promise(resolve => {
      requests.push({ signal: options.signal, resolve });
    }),
    (fn: () => unknown) => { timers.set(++timerId, fn); return timerId; },
    (id: number) => { timers.delete(id); },
  );
  const component = exports.default as (props: Props) => Element;
  function render() {
    let passes = 0;
    while (dirty) {
      assert.ok(++passes < 20, "render/effect loop must settle");
      dirty = false; cursor = 0;
      tree = component(props);
      pendingEffects.splice(0).forEach(fn => fn());
    }
  }
  function nodes(role: string) {
    const found: Element[] = [];
    function visit(value: unknown) {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const node = value as Element;
      if (node.props.role === role) found.push(node);
      visit(node.props.children);
    }
    visit(tree);
    return found;
  }
  function fire(node: Element, name: string, event: unknown = {}) {
    const handler = node.props[name];
    assert.equal(typeof handler, "function", `${name} must be handled`);
    if (typeof handler === "function") handler(event);
    render();
  }
  render();
  return {
    changes, selections, requests, nodes, fire,
    input: () => nodes("combobox")[0],
    focus: () => fire(nodes("combobox")[0], "onFocus"),
    blur: () => fire(nodes("combobox")[0], "onBlur"),
    type: (value: string) => fire(nodes("combobox")[0], "onChange", { target: { value } }),
    key: (key: string) => {
      const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      fire(nodes("combobox")[0], "onKeyDown", event);
      return event;
    },
    runDebounce: () => {
      const callbacks = [...timers.values()]; timers.clear();
      callbacks.forEach(fn => { void fn(); }); render();
    },
    reply: async (index: number, options: GeoLocationOption[]) => {
      requests[index].resolve({ ok: true, json: async () => ({ suggestions: options }) });
      await new Promise(resolve => setImmediate(resolve)); render();
    },
    pendingTimers: () => timers.size,
    rerender: () => { dirty = true; render(); },
  };
}

async function remoteFixture() {
  const f = fixture(); f.focus(); f.runDebounce();
  await f.reply(0, [suggestion]);
  assert.equal(f.nodes("option").length, 1);
  return f;
}

test("mouse-down prevents focus loss without selecting; click selects once and the value persists", async () => {
  const f = await remoteFixture();
  const option = f.nodes("option")[0];
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  f.fire(option, "onMouseDown", event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.selections, []);
  assert.equal(f.nodes("listbox").length, 1);
  f.fire(option, "onClick");
  f.blur(); f.rerender();
  assert.equal(f.input().props.value, "Nijmegen");
  assert.deepEqual(f.changes, ["Nijmegen"]);
  assert.deepEqual(f.selections, [suggestion]);
  assert.equal(f.nodes("listbox").length, 0);
  assert.equal(f.pendingTimers(), 0);
});

test("an outside blur closes suggestions without selecting or rewriting the typed text", async () => {
  const f = await remoteFixture();
  f.blur();
  assert.equal(f.input().props.value, "nijm");
  assert.equal(f.input().props["aria-expanded"], false);
  assert.equal(f.nodes("option").length, 0);
  assert.deepEqual(f.selections, []);
  assert.deepEqual(f.changes, []);
  f.focus();
  assert.equal(f.nodes("option").length, 1);
});

test("touch/pointer scrolling without a click cannot select a suggestion or cancel native scrolling", async () => {
  const f = await remoteFixture();
  const option = f.nodes("option")[0];
  const event = { preventDefault: () => assert.fail("scroll must not be cancelled") };
  for (const name of ["onTouchStart", "onPointerDown", "onTouchMove", "onPointerMove", "onPointerCancel", "onTouchEnd", "onPointerUp"]) {
    const handler = option.props[name];
    if (typeof handler === "function") handler(event);
  }
  f.rerender();
  assert.equal(f.input().props.value, "nijm");
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.selections, []);
});

test("arrow keys expose the active option and Enter selects once without submitting", async () => {
  const f = await remoteFixture();
  const input = f.input();
  assert.equal(input.props["aria-controls"], f.nodes("listbox")[0].props.id);
  assert.equal(input.props["aria-autocomplete"], "list");
  assert.equal(f.key("ArrowDown").defaultPrevented, true);
  assert.equal(f.input().props["aria-activedescendant"], f.nodes("option")[0].props.id);
  assert.equal(f.nodes("option")[0].props["aria-selected"], true);
  assert.equal(f.key("ArrowUp").defaultPrevented, true);
  assert.equal(f.key("Enter").defaultPrevented, true);
  f.key("Enter");
  assert.equal(f.input().props.value, "Nijmegen");
  assert.equal(f.selections.length, 1);
  assert.equal(f.input().props["aria-activedescendant"], undefined);
});

test("Escape dismisses the active option and subsequent Enter does not select it", async () => {
  const f = await remoteFixture();
  f.key("ArrowDown"); f.key("Escape"); f.key("Enter");
  assert.equal(f.input().props.value, "nijm");
  assert.equal(f.input().props["aria-expanded"], false);
  assert.equal(f.input().props["aria-activedescendant"], undefined);
  assert.deepEqual(f.selections, []);
});

test("direct click activation without mouse-down remains available to assistive technology", async () => {
  const f = await remoteFixture();
  assert.equal(f.nodes("option")[0].props.type, "button");
  f.fire(f.nodes("option")[0], "onClick");
  assert.deepEqual(f.changes, ["Nijmegen"]);
  assert.equal(f.selections.length, 1);
});

test("a late aborted autocomplete response cannot replace or reopen a selected locality", async () => {
  const f = fixture({ localSuggestions: [suggestion] });
  f.focus(); f.runDebounce();
  f.fire(f.nodes("option")[0], "onClick");
  assert.equal(f.requests[0].signal.aborted, true);
  await f.reply(0, [{ ...suggestion, id: "stale", city: "Stale", location: { ...suggestion.location!, locality: "Stale" } }]);
  assert.equal(f.input().props.value, "Nijmegen");
  assert.equal(f.nodes("listbox").length, 0);
  assert.deepEqual(f.changes, ["Nijmegen"]);
  assert.equal(f.selections.length, 1);
});

test("the Service area consumer can still select its full label and receive the original location", () => {
  const f = fixture({ localSuggestions: [suggestion], getSelectionValue: option => option.label, ariaLabel: "Localitatea zonei de lucru" });
  f.focus(); f.fire(f.nodes("option")[0], "onClick"); f.blur();
  assert.equal(f.input().props.value, suggestion.label);
  assert.equal(f.input().props["aria-label"], "Localitatea zonei de lucru");
  assert.deepEqual(f.selections, [suggestion]);
  assert.equal(f.pendingTimers(), 0);
});

test("the towing local fallback still updates text when no geocoded location is available", () => {
  const local = { ...suggestion, id: "local-fixture", location: null, lat: null, lng: null };
  const f = fixture({ localSuggestions: [local] });
  f.focus(); f.fire(f.nodes("option")[0], "onClick");
  assert.deepEqual(f.changes, [local.city]);
  assert.deepEqual(f.selections, [local]);
});

test("editing after selection resumes autocomplete instead of restoring the previous selected value", async () => {
  const f = await remoteFixture();
  f.fire(f.nodes("option")[0], "onClick");
  f.type("next"); f.runDebounce();
  assert.equal(f.input().props.value, "next");
  assert.equal(f.requests.length, 2);
  await f.reply(1, []);
  assert.equal(f.input().props.value, "next");
  assert.equal(f.selections.length, 1);
});
