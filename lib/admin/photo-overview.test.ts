import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error TS5097: Node source import.
import { createPhotoMonitor, parsePhotoOverview, isPhotoMonitorTestUrl, formatPhotoCount, type PhotoMonitorState } from "./photo-overview.ts";
const row = {
  valid_photo_associations: 4, total_photo_associations: 4, associations_complete: true,
  unclassifiable_entries: 0, storage_objects_count: 6, unfinished_targeted_operations: 2,
  expired_delete_claims: 1, observed_at: "2026-10-29T12:00:00.123456+00:00",
};
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
function fixture() {
  const states: PhotoMonitorState[] = [];
  const reads: Array<{ resolve: (value: { data: unknown; error: { code?: string } | null }) => void; reject: (reason: unknown) => void }> = [];
  const monitor = createPhotoMonitor({ read: () => new Promise((resolve,reject) => reads.push({ resolve,reject })), publish: s => states.push(s) });
  return { monitor, states, reads, state: () => states.at(-1)! };
}
test("valid Admin response preserves counts and metadata", async () => {
  const f=fixture(); f.monitor.sessionChanged("synthetic-session"); await tick();
  assert.equal(f.state().loading,true);
  f.reads[0].resolve({data:row,error:null}); await tick();
  assert.equal(f.state().data?.storage_objects_count,"6"); assert.equal(f.state().error,null);
});
test("zero counts are a result, not missing data", () => {
  const r=parsePhotoOverview({...row,valid_photo_associations:0,total_photo_associations:0,storage_objects_count:0,unfinished_targeted_operations:0,expired_delete_claims:0});
  assert.equal(r.total_photo_associations,"0"); assert.equal(formatPhotoCount(r.total_photo_associations!),"0");
});
test("incomplete associations keep total null", () => {
  const r=parsePhotoOverview({...row,total_photo_associations:null,associations_complete:false,unclassifiable_entries:2});
  assert.equal(r.total_photo_associations,null); assert.equal(r.valid_photo_associations,"4");
});
test("bigint strings are lossless; unsafe JSON numbers refused", () => {
  assert.equal(parsePhotoOverview({...row,storage_objects_count:"9223372036854775807"}).storage_objects_count,"9223372036854775807");
  assert.throws(()=>parsePhotoOverview({...row,storage_objects_count:Number.MAX_SAFE_INTEGER+1}));
});
for (const [name, patch] of Object.entries({negative:{expired_delete_claims:-1},fraction:{storage_objects_count:1.1},missing:{storage_objects_count:undefined},timestamp:{observed_at:"yesterday"},boolean:{associations_complete:"true"},mismatch:{total_photo_associations:3},incomplete:{associations_complete:false},overflow:{storage_objects_count:"9223372036854775808"}})) {
  test(`invalid RPC data: ${name}`,()=>assert.throws(()=>parsePhotoOverview({...row,...patch})));
}
test("unexpected payload shapes rejected; extra data never propagated", () => {
  for (const value of [null,[],[row],"raw error"]) assert.throws(()=>parsePhotoOverview(value));
  assert.equal("secret" in parsePhotoOverview({...row,secret:"do-not-publish"}),false);
});
test("authorization failure clears earlier data, never displays raw error",async()=>{
  const f=fixture(); f.monitor.sessionChanged("session"); await tick(); f.reads[0].resolve({data:row,error:null}); await tick();
  const task=f.monitor.refresh(); f.reads[1].resolve({data:null,error:{code:"42501"}}); await task;
  assert.equal(f.state().data,null); assert.equal(f.state().error,"authorization");
});
test("RPC failure retains snapshot explicitly stale; retry restores readiness",async()=>{
  const f=fixture(); f.monitor.sessionChanged("session"); await tick(); f.reads[0].resolve({data:row,error:null}); await tick();
  const task=f.monitor.refresh(); f.reads[1].reject(new Error("secret raw SQL")); await task;
  assert.equal(f.state().stale,true); assert.equal(f.state().data?.valid_photo_associations,"4");
  assert.ok(!JSON.stringify(f.states).includes("secret"));
  const retry=f.monitor.refresh(); f.reads[2].resolve({data:row,error:null}); await retry; assert.equal(f.state().stale,false);
});
test("invalid initial response yields sanitized error",async()=>{
  const f=fixture(); f.monitor.sessionChanged("session"); await tick(); f.reads[0].resolve({data:{bad:true},error:null}); await tick();
  assert.equal(f.state().error,"unavailable"); assert.equal(f.state().data,null);
});
test("session change invalidates old request and clears old data",async()=>{
  const f=fixture(); f.monitor.sessionChanged("first"); await tick(); f.monitor.sessionChanged("second"); await tick();
  f.reads[1].resolve({data:row,error:null}); await tick(); f.reads[0].resolve({data:{...row,storage_objects_count:99},error:null}); await tick();
  assert.equal(f.state().data?.storage_objects_count,"6");
  f.monitor.sessionChanged(null); assert.equal(f.state().data,null); assert.equal(f.state().error,"session");
});
test("unmount discards pending and queued work",async()=>{
  const f=fixture(); f.monitor.sessionChanged("session"); await tick(); f.monitor.dispose(); const n=f.states.length;
  f.reads[0].resolve({data:row,error:null}); await tick(); assert.equal(f.states.length,n);
  const g=fixture(); g.monitor.sessionChanged("session"); g.monitor.dispose(); await tick(); assert.equal(g.reads.length,0);
});
test("out-of-order refresh cannot overwrite newer response",async()=>{
  const f=fixture(); f.monitor.sessionChanged("session"); await tick(); const second=f.monitor.refresh();
  f.reads[1].resolve({data:row,error:null}); await second;
  f.reads[0].resolve({data:{...row,storage_objects_count:99},error:null}); await tick();
  assert.equal(f.state().data?.storage_objects_count,"6");
});
test("stale lifecycle signal and duplicate session do not refetch",async()=>{
  const f=fixture(); f.monitor.sessionChanged("session"); await tick(); f.reads[0].resolve({data:row,error:null}); await tick();
  f.monitor.markStale(); f.monitor.sessionChanged("session"); await tick();
  assert.equal(f.state().stale,true); assert.equal(f.reads.length,1);
});
test("TEST-only boundary refuses LIVE, unknown hosts and URL tricks",()=>{
  assert.equal(isPhotoMonitorTestUrl("https://bstjobvvxxfqqwyjoimx.supabase.co"),true);
  for (const url of [undefined,"https://ouoiykudvcoqbkybkqvs.supabase.co","https://example.invalid","https://bstjobvvxxfqqwyjoimx.supabase.co@evil.invalid","https://bstjobvvxxfqqwyjoimx.supabase.co?x=1"]) assert.equal(isPhotoMonitorTestUrl(url),false);
});
test("component wiring: responsive grid, manual refresh, auth cleanup and no new data subscriptions",()=>{
  const source=readFileSync(new URL("../../app/admin/AdminPhotoMonitor.tsx",import.meta.url),"utf8");
  assert.match(source,/grid-cols-1.*sm:grid-cols-2.*xl:grid-cols-4/);
  assert.match(source,/min-w-0/); assert.match(source,/break-words/); assert.match(source,/min-h-11/);
  assert.match(source,/subscription.unsubscribe\(\)/); assert.match(source,/monitor.dispose\(\)/);
  assert.match(source,/revision === authRevision/); assert.match(source,/removeEventListener/);
  assert.match(source,/rpc\("get_admin_photo_overview"\)/);
  assert.doesNotMatch(source,/service.role|\.from\(|\.channel\(|setInterval|setTimeout/i);
});
