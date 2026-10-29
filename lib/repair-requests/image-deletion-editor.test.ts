import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
// @ts-expect-error TS5097: Node source import.
import { createImageDeletionEditor, removeLocalImage, type ImageDeletionState } from './image-deletion-editor.ts';
const id = '11111111-1111-4111-8111-111111111111';
const op = '22222222-2222-4222-8222-222222222222';
const image = { path: `${id}/a.jpg`, name: 'a', url: 'https://example.invalid/a' };
const other = { path: `${id}/b.jpg`, name: 'b' };
function fixture(status = 'deleted', options: { token?: boolean; network?: boolean; readFailure?: boolean; present?: boolean; physical?: boolean } = {}) {
  const storage = new Map<string,string>(); const states: ImageDeletionState[] = []; const sent: unknown[] = []; const applied: unknown[] = [];
  let token = options.token !== false; let network = !!options.network; let readFailure = !!options.readFailure;
  let server = options.present ? [image,other] : [other];
  const deps = {
    token: async () => token ? 'session-token' : null,
    send: async (body: unknown, accessToken: string) => { sent.push({ body, accessToken }); if (network) throw new Error('network'); return { ok: ['deleted','retained','already_completed_unverified'].includes(status), body: { operationId: op, status, detached: status === 'forbidden' ? false : true, physicalDeletionConfirmed: options.physical ?? status === 'deleted' } }; },
    readImages: async () => { if (readFailure) throw new Error('read failed'); return server; },
    applyImages: (images: unknown) => { applied.push(images); },
    publish: (state: ImageDeletionState) => states.push(state), uuid: () => op,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string,v: string) => { storage.set(k,v); }, removeItem: (k: string) => { storage.delete(k); } },
  };
  const editor = createImageDeletionEditor(id, deps);
  return { editor,deps,storage,states,sent,applied,setToken: () => { token=true; }, setNetwork: () => { network=false; }, setRead: () => { readFailure=false; }, setServer: () => { server=[other]; } };
}
test('local image removes only local file and revokes its object URL', () => {
  const revoked: string[] = [];
  assert.deepEqual(removeLocalImage(['a','b'],['blob:a','blob:b'],0,u=>revoked.push(u)), { files:['b'],previews:['blob:b'] });
  assert.deepEqual(revoked,['blob:a']);
});
for (const status of ['deleted','retained']) test(`${status}: synchronize server before unlocking save`, async () => {
  const f=fixture(status); await f.editor.remove(image);
  assert.deepEqual(f.applied,[[other]]); assert.equal(f.editor.blocked(),false);
  assert.deepEqual(await f.editor.imagesForSave(),[other]); assert.equal(f.storage.size,0);
  assert.deepEqual(f.sent,[{ body:{ requestId:id,operationId:op,image },accessToken:'session-token' }]);
  assert.ok(f.states.at(-1)!.message.includes(status === 'deleted' ? 'confirmată' : 'păstrat'));
});
for (const status of ['already_completed_unverified','recovery_required','unauthenticated','conflict']) test(`${status} remains ambiguous until explicit reconciliation`, async () => {
  const f=fixture(status); await f.editor.remove(image);
  assert.equal(f.editor.blocked(),true); assert.equal(f.applied.length,0);
  await assert.rejects(f.editor.imagesForSave()); await f.editor.remove(other); assert.equal(f.sent.length,1);
  await f.editor.reconcile(); assert.equal(f.editor.blocked(),false);
  assert.ok(f.states.at(-1)!.message.includes('nu este confirmată'));
});
test('missing or expired token sends no request; explicit recovery retains ID', async () => {
  const f=fixture('deleted',{token:false}); await f.editor.remove(image); assert.equal(f.sent.length,0);
  assert.equal(f.editor.blocked(),true); f.setToken(); await f.editor.retry();
  assert.equal(f.states.find(s=>s.operationId)?.operationId,op); assert.equal(f.sent.length,1);
});
test('forbidden does not claim deletion, synchronizes unchanged association', async () => {
  const f=fixture('forbidden',{present:true}); await f.editor.remove(image);
  assert.deepEqual(f.applied,[[image,other]]); assert.equal(f.editor.blocked(),false);
  assert.ok(f.states.at(-1)!.message.includes('refuzată'));
});
test('network error retains same operation across explicit retry and remount', async () => {
  const f=fixture('deleted',{network:true}); await f.editor.remove(image); assert.equal(f.editor.blocked(),true);
  f.editor.dispose(); const recovered=createImageDeletionEditor(id,f.deps);
  assert.equal(recovered.blocked(),true); assert.equal(f.sent.length,1);
  f.setNetwork(); await recovered.retry(); assert.equal(f.sent.length,2);
  assert.deepEqual(f.sent[0],f.sent[1]);
});
test('double clicks and concurrent other image are suppressed synchronously', async () => {
  const f=fixture(); const first=f.editor.remove(image);
  await f.editor.remove(image); await f.editor.remove(other); await first;
  assert.equal(f.sent.length,1);
});
test('failed sync stays blocked and retry only reads, never repeats confirmed DELETE', async () => {
  const f=fixture('deleted',{readFailure:true}); await f.editor.remove(image);
  assert.equal(f.editor.blocked(),true); assert.equal(f.applied.length,0);
  f.setRead(); await f.editor.retry(); assert.equal(f.sent.length,1); assert.equal(f.editor.blocked(),false);
});
test('stale server image list cannot reintroduce confirmed detached image through save', async () => {
  const f=fixture('deleted',{present:true}); await f.editor.remove(image);
  assert.equal(f.applied.length,0); await assert.rejects(f.editor.imagesForSave());
  f.setServer(); await f.editor.reconcile(); assert.deepEqual(await f.editor.imagesForSave(),[other]);
});
test('inconsistent physical confirmation is never success', async () => {
  const f=fixture('deleted',{physical:false}); await f.editor.remove(image);
  assert.equal(f.editor.blocked(),true); assert.equal(f.applied.length,0);
});
test('legacy photo without path stays visible and makes no request', async () => {
  const f=fixture(); await f.editor.remove({url:'https://example.invalid/legacy'});
  assert.equal(f.sent.length,0); assert.equal(f.applied.length,0); assert.equal(f.editor.blocked(),false);
});
test('dispose prevents late response from mutating another editor', async () => {
  const f=fixture(); const pending=f.editor.remove(image); f.editor.dispose(); await pending;
  assert.equal(f.applied.length,0); assert.equal(f.sent.length,0);
});
test('page wiring retains Safari selection reset, dedup, cleanup and fresh save images', () => {
  const source=readFileSync(new URL('../../app/customer/my-requests/[id]/page.tsx',import.meta.url),'utf8');
  assert.ok(source.includes('e.target.value = "";'));
  assert.ok(source.includes('existingFileKeys.has(fileKey)'));
  assert.ok(source.includes('URL.revokeObjectURL(previewUrl)'));
  assert.ok(source.includes('const currentImages = await imageDeletionRef.current!.imagesForSave()'));
  assert.ok(source.includes('const nextImages = [...latestImages, ...uploadedImages]'));
  assert.ok(!source.includes('window.location.reload'));
  assert.ok(!source.includes('SUPABASE_SERVICE_ROLE_KEY'));
});
test('fresh save reads pick up changes that occurred during upload', async () => {
  const f=fixture('deleted',{present:true});
  assert.deepEqual(await f.editor.imagesForSave(),[image,other]);
  f.setServer(); // Another authorized edit completed while uploads were prepared.
  const uploaded={path:`${id}/new.jpg`,name:'new'};
  const savePayload=[...await f.editor.imagesForSave(),uploaded];
  assert.deepEqual(savePayload,[other,uploaded]);
});
test('save refresh locks deletion while awaiting server', async () => {
  const f=fixture(); let resolve!: (images: typeof other[])=>void;
  f.deps.readImages=()=>new Promise(r=>{resolve=r;});
  const saving=f.editor.imagesForSave(); await f.editor.remove(image);
  assert.equal(f.sent.length,0); resolve([other]); await saving;
});
test('unavailable session storage fails closed before any mutation', async () => {
  const f=fixture(); f.deps.storage.setItem=()=>{throw new Error('quota');};
  await f.editor.remove(image); assert.equal(f.sent.length,0);
  assert.equal(f.editor.blocked(),true); await assert.rejects(f.editor.imagesForSave());
});

const settle = () => new Promise(resolve => setImmediate(resolve));
test('Realtime filters request id and refreshes images without sending a deletion', async () => {
  const f = fixture();
  f.editor.notifyUpdate('another-request'); await settle(); assert.equal(f.applied.length, 0);
  f.editor.notifyUpdate(id); await settle(); assert.deepEqual(f.applied, [[other]]);
  assert.equal(f.sent.length, 0);
});
test('repeated notifications discard stale read and serialize the trailing refresh', async () => {
  const f = fixture(); const resolvers: ((v: typeof other[]) => void)[] = [];
  f.deps.readImages = () => new Promise(resolve => resolvers.push(resolve));
  f.editor.requestRefresh(); f.editor.requestRefresh(); f.editor.requestRefresh();
  assert.equal(resolvers.length, 1);
  resolvers[0]([image, other]); await settle();
  assert.equal(f.applied.length, 0); assert.equal(resolvers.length, 2);
  resolvers[1]([other]); await settle(); assert.deepEqual(f.applied, [[other]]);
});
test('save and upload pause refresh and invalidate an already running snapshot', async () => {
  const f = fixture(); let resolve!: (v: typeof other[]) => void;
  f.deps.readImages = () => new Promise(r => { resolve = r; });
  f.editor.requestRefresh(); f.editor.setPaused(true); f.editor.requestRefresh();
  resolve([image, other]); await settle(); assert.equal(f.applied.length, 0);
  f.deps.readImages = async () => [other];
  assert.deepEqual(await f.editor.imagesForSave(), [other]);
  f.editor.setPaused(false); await settle();
  assert.deepEqual(f.applied, [[other], [other]]); assert.equal(f.sent.length, 0);
});
test('background refresh preserves pending operation and recovery lock', async () => {
  const f = fixture('recovery_required'); await f.editor.remove(image);
  const saved = [...f.storage.values()]; const state = f.states.at(-1);
  f.editor.requestRefresh(); await settle();
  assert.deepEqual(f.applied, [[other]]); assert.deepEqual([...f.storage.values()], saved);
  assert.equal(f.editor.blocked(), true); assert.equal(f.states.at(-1), state);
  assert.equal(f.sent.length, 1); await assert.rejects(f.editor.imagesForSave());
});
test('notifications during deletion wait and never trigger retry', async () => {
  const f = fixture('recovery_required'); let resolve!: (v: "session-token") => void;
  f.deps.token = () => new Promise<"session-token" | null>(r => { resolve = r; });
  const deleting = f.editor.remove(image); f.editor.requestRefresh();
  assert.equal(f.applied.length, 0); resolve('session-token'); await deleting; await settle();
  assert.equal(f.sent.length, 1); assert.deepEqual(f.applied, [[other]]); assert.equal(f.editor.blocked(), true);
});
test('unmount ignores delayed refresh and subsequent notifications', async () => {
  const f = fixture(); let resolve!: (v: typeof other[]) => void;
  f.deps.readImages = () => new Promise(r => { resolve = r; });
  f.editor.requestRefresh(); f.editor.dispose(); resolve([other]); await settle();
  f.editor.requestRefresh(); assert.equal(f.applied.length, 0); assert.equal(f.sent.length, 0);
});
test('failed background read waits for next foreground/reconnect notification', async () => {
  const f = fixture('deleted', { readFailure: true });
  f.editor.requestRefresh(); await settle(); assert.equal(f.applied.length, 0);
  f.setRead(); f.editor.requestRefresh(); await settle(); assert.deepEqual(f.applied, [[other]]);
});
test('page wiring isolates drafts, scopes subscription and cleans foreground listeners', () => {
  const source = readFileSync(new URL('../../app/customer/my-requests/[id]/page.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('// Subscribe only after');
  const effect = source.slice(start, source.indexOf('let cancelled = false', start));
  assert.ok(effect.includes('loading || request?.id !== requestId'));
  assert.ok(effect.includes('event: "UPDATE", schema: "public", table: "repair_requests", filter: `id=eq.${requestId}`'));
  assert.ok(effect.includes('editor.notifyUpdate(payload.new.id)'));
  assert.ok(effect.includes('status === "SUBSCRIBED"'));
  for (const event of ['visibilitychange', 'pageshow']) {
    assert.ok(effect.includes(`addEventListener("${event}"`));
    assert.ok(effect.includes(`removeEventListener("${event}"`));
  }
  assert.ok(effect.includes('supabase.removeChannel(channel)'));
  assert.ok(effect.includes('document.visibilityState === "visible"'));
  assert.doesNotMatch(effect, /setDescription|setNewFiles|revokeObjectURL|loadRequest\(/);
});

test('client diagnostics distinguish restored pending and never unlock via Realtime', async () => {
  const f = fixture('recovery_required'); await f.editor.remove(image); f.editor.dispose();
  const codes: string[] = [];
  const editor = createImageDeletionEditor(id, { ...f.deps, diagnostic: code => { codes.push(code); } });
  assert.deepEqual(codes, ['PENDING_RESTORED']);
  editor.requestRefresh(); await settle();
  assert.ok(codes.includes('IMAGE_SYNC_OK')); assert.ok(!codes.includes('EDITOR_UNLOCKED'));
  assert.equal(editor.blocked(), true); assert.equal(f.sent.length, 1);
  await editor.retry(); assert.ok(codes.includes('API_RECOVERY_REQUIRED'));
  assert.equal(editor.blocked(), true);
});
test('confirmed result diagnostics separate synchronization failure from deletion outcome', async () => {
  const f = fixture('deleted', { readFailure: true }); const codes: string[] = [];
  const editor = createImageDeletionEditor(id, { ...f.deps, diagnostic: code => { codes.push(code); } });
  await editor.remove(image);
  assert.ok(codes.includes('API_DELETED_CONFIRMED')); assert.ok(codes.includes('IMAGE_SYNC_FAILED'));
  assert.equal(editor.blocked(), true); assert.ok(!codes.includes('EDITOR_UNLOCKED'));
  f.setRead(); await editor.retry();
  assert.equal(f.sent.length, 1); assert.ok(codes.includes('EDITOR_UNLOCKED')); assert.equal(editor.blocked(), false);
});
test('storage failure and still-associated image use fixed diagnostics', async () => {
  const f = fixture('deleted', { present: true }); const codes: string[] = [];
  const editor = createImageDeletionEditor(id, { ...f.deps, diagnostic: code => { codes.push(code); } });
  await editor.remove(image); assert.ok(codes.includes('IMAGE_STILL_ASSOCIATED')); assert.equal(editor.blocked(), true);
  const broken = fixture(); broken.deps.storage.setItem = () => { throw Error('private path token'); };
  const e = createImageDeletionEditor(id, { ...broken.deps, diagnostic: code => { codes.push(code); } });
  await e.remove(image); assert.ok(codes.includes('PENDING_STORAGE_FAILED')); assert.equal(broken.sent.length, 0);
  assert.ok(codes.every(code => /^[A-Z_]+$/.test(code)));
});
test('client diagnostics cannot change behavior when sink throws', async () => {
  const f = fixture();
  const editor = createImageDeletionEditor(id, { ...f.deps, diagnostic: () => { throw Error('logger'); } });
  await editor.remove(image); assert.equal(editor.blocked(), false);
});

test('confirmed deletion clears pending and permits the next image deletion', async () => {
  const f = fixture();
  await f.editor.remove(image);
  assert.equal(f.editor.blocked(), false); assert.equal(f.storage.size, 0);
  assert.deepEqual(await f.editor.imagesForSave(), [other]);
  f.deps.readImages = async () => [];
  await f.editor.remove(other);
  assert.equal(f.sent.length, 2);
  assert.equal(f.editor.blocked(), false); assert.equal(f.storage.size, 0);
  assert.deepEqual(f.applied, [[other], [other], []]);
});
