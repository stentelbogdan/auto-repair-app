import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const start = page.indexOf('  useEffect(() => {\n    let cancelled = false;') + '  useEffect(() => {'.length;
const end = page.indexOf('\n  }, [router, capture, complete, focusNavigation]);', start);
assert.ok(start > 0 && end > start);
const body = ts.transpileModule(page.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const settle = async () => { for (let n = 0; n < 8; n++) await new Promise(resolve => setImmediate(resolve)); };
function fixture() {
  const state = { user: 'owner', items: [] as unknown[], authorized: false, loadError: false, captures: 0, loads: 0, removed: 0, authRemoved: 0 };
  const listeners = new Map<string, () => void>();
  const realtime = new Map<string, () => void>();
  let subscribed!: (status: string) => void;
  let auth!: (event: string, session: { user: { id: string } } | null) => void;
  let loader = async () => ({ items: ['initial'], markedOffersAsRead: false });
  const channel = { on: (_type: string, spec: { table: string }, fn: () => void) => { realtime.set(spec.table, fn); return channel; },
    subscribe: (fn: typeof subscribed) => { subscribed = fn; return channel; } };
  const events = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const deps = {
    supabase: { auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }),
      onAuthStateChange: (fn: typeof auth) => { auth = fn; return { data: { subscription: { unsubscribe() { state.authRemoved++; } } } }; } },
      channel: () => channel, removeChannel: () => { state.removed++; } },
    router: { replace: () => {} }, getOwnProfile: async () => ({ data: { role: ['customer', 'workshop'] }, error: null }),
    setAuthorized: (v: boolean) => { state.authorized = v; }, setLoadingOffers: () => {}, setCheckingAccess: () => {},
    setOffersLoadError: (v: boolean) => { state.loadError = v; },
    capture: async (_id: string, renew: boolean) => { assert.equal(renew, true); state.captures++; }, complete: () => {},
    loadCustomerOffers: async () => { state.loads++; return loader(); }, setItems: (v: unknown[]) => { state.items = v; },
    window: { ...events, dispatchEvent: () => { throw new Error('No receipt from refresh'); } },
    document: { ...events, visibilityState: 'visible' }, console: { error() {} },
  };
  const cleanup = new Function(...Object.keys(deps), body)(...Object.values(deps)) as () => void;
  return { state, listeners, realtime, cleanup, setLoader: (fn: typeof loader) => { loader = fn; },
    subscribed: (status: string) => subscribed(status), auth: (id: string) => { state.user = id; auth('SIGNED_IN', { user: { id } }); } };
}
test('Client Realtime and reconnect reload authorized data without polling or renewing notification snapshots', async () => {
  const f = fixture(); await settle(); assert.deepEqual(f.state.items, ['initial']);
  f.setLoader(async () => ({ items: ['new-version'], markedOffersAsRead: false }));
  for (const table of ['repair_offers', 'repair_requests', 'repair_appointments']) { f.realtime.get(table)!(); await settle(); }
  f.subscribed('SUBSCRIBED'); await settle();
  assert.deepEqual(f.state.items, ['new-version']); assert.equal(f.state.captures, 1); assert.equal(f.state.loads, 5);
  assert.doesNotMatch(page, /setInterval|\.update\(/);
  f.cleanup();
});
test('foreground refetches, older concurrent response cannot replace newer displayed version', async () => {
  const f = fixture(); await settle();
  let first!: (v: { items: string[]; markedOffersAsRead: boolean }) => void;
  f.setLoader(() => new Promise(resolve => { first = resolve; })); f.listeners.get('focus')!();
  f.setLoader(async () => ({ items: ['latest'], markedOffersAsRead: false })); f.listeners.get('visibilitychange')!(); await settle();
  first({ items: ['stale'], markedOffersAsRead: false }); await settle();
  assert.deepEqual(f.state.items, ['latest']); f.cleanup();
});
test('account change clears old contexts and refuses late responses; cleanup removes owned subscription', async () => {
  const f = fixture(); await settle();
  let finish!: (v: { items: string[]; markedOffersAsRead: boolean }) => void;
  f.setLoader(() => new Promise(resolve => { finish = resolve; })); f.listeners.get('focus')!();
  f.auth('other-account'); finish({ items: ['wrong-account'], markedOffersAsRead: false }); await settle();
  assert.deepEqual(f.state.items, []); assert.equal(f.state.authorized, false);
  const loads = f.state.loads; f.realtime.get('repair_offers')!(); await settle(); assert.equal(f.state.loads, loads);
  f.cleanup(); assert.equal(f.state.removed, 1); assert.equal(f.state.authRemoved, 1); assert.equal(f.listeners.size, 0);
});
test('refresh failure displays no invented or stale successful context', async () => {
  const f = fixture(); await settle(); f.setLoader(async () => { throw new Error('denied'); });
  f.realtime.get('repair_offers')!(); await settle(); assert.deepEqual(f.state.items, []); assert.equal(f.state.loadError, true); f.cleanup();
});
