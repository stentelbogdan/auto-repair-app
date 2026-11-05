import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import type { OfferReadObservation } from "../../lib/offer-read-version";
import type { useVisibleNotificationRead } from "../../lib/hooks/useVisibleNotificationRead";
const source = readFileSync(new URL('./CustomerOfferReadCard.tsx', import.meta.url), 'utf8');
type Observe = ReturnType<typeof useVisibleNotificationRead>["observe"];
const observation: OfferReadObservation = { userId: 'user', role: 'customer', offerId: 'offer', version: '9007199254740993' };
function fixture() {
  let saved: { deps: unknown[]; value: unknown } | undefined;
  let attached: unknown, cleanup: (() => void) | undefined;
  let attempts = 0, aborted = 0;
  const controllers: AbortController[] = [];
  const observe: Observe = (_context, observed) => () => {
    assert.ok(observed); attempts++; const controller = new AbortController(); controllers.push(controller);
    return () => { controller.abort(); aborted++; };
  };
  const react = {
    createElement: (_type: unknown, props: unknown) => props,
    useMemo: (fn: () => unknown, deps: unknown[]) => {
      if (!saved || deps.some((value, i) => value !== saved!.deps[i])) saved = { deps, value: fn() };
      return saved.value;
    },
  };
  const api: Record<string, unknown> = {};
  new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText)(
    (name: string) => name === 'react/jsx-runtime' ? { jsx: react.createElement } : react, api);
  const card = api.default as (props: object) => { ref: (element: HTMLElement) => void | (() => void); [key: string]: unknown };
  return {
    controllers, observe, counts: () => ({ attempts, aborted }),
    render: (observed = observation, overrides: object = {}) => {
      const node = card({ requestId: 'request', offerId: 'offer', appointmentId: 'appointment', observation: observed, observe, children: 'visible authorized offer', ...overrides });
      if (node.ref !== attached) { cleanup?.(); cleanup = node.ref({} as HTMLElement) || undefined; attached = node.ref; }
      return node;
    },
    unmount: () => cleanup?.(),
  };
}
test('carousel scroll rerenders preserve the ref and pending receipt for the exact displayed version', async () => {
  const f = fixture(); const first = f.render();
  await Promise.resolve();
  for (let n = 0; n < 5; n++) assert.equal(f.render({ ...observation }).ref, first.ref);
  assert.deepEqual(f.counts(), { attempts: 1, aborted: 0 });
  assert.equal(f.controllers[0].signal.aborted, false);
  f.unmount(); assert.equal(f.controllers[0].signal.aborted, true);
});
for (const change of [{ version: '9007199254740994' }, { userId: 'other' }, { role: 'workshop' as const }, { offerId: 'other' }]) {
  test(`changed observation ${Object.keys(change)[0]} aborts the old read, without recycling its version`, () => {
    const f = fixture(); const previous = f.render();
    assert.notEqual(f.render({ ...observation, ...change }).ref, previous.ref);
    assert.deepEqual(f.counts(), { attempts: 2, aborted: 1 });
  });
}
test('query-only new context and new snapshot detach previous visibility guard', () => {
  const f = fixture(); const first = f.render();
  assert.notEqual(f.render(observation, { requestId: 'another-request' }).ref, first.ref);
  const nextObserve: Observe = (...args) => f.observe(...args);
  f.render(observation, { observe: nextObserve });
  assert.equal(f.counts().aborted, 2);
});
test('the card preserves exact focus attributes; it does not accept or reschedule offers', () => {
  const f = fixture(); const node = f.render();
  assert.equal(node['data-focus-request'], 'request'); assert.equal(node['data-focus-offer'], 'offer');
  assert.equal(node['data-focus-appointment'], 'appointment');
  assert.doesNotMatch(source, /supabase|\.rpc\(|\.update\(|finalize|appointment_date/);
});
