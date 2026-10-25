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
