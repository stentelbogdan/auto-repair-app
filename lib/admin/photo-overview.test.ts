import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error TS5097: Node source import.
import { createPhotoMonitor, parsePhotoOverview, isPhotoMonitorTestUrl, formatPhotoCount, type PhotoMonitorState, createPhotoBroadcastConnector } from "./photo-overview.ts";
const row = {
  valid_photo_associations: 4, total_photo_associations: 4, associations_complete: true,
  unclassifiable_entries: 0, storage_objects_count: 6, unfinished_targeted_operations: 2,
  expired_delete_claims: 1, observed_at: "2026-10-29T12:00:00.123456+00:00",
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
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
test("overlapping refreshes serialize and preserve trailing invalidation",async()=>{
  const f=fixture(); f.monitor.sessionChanged("session"); await tick(); const second=f.monitor.refresh();
  assert.equal(f.reads.length,1);
  f.reads[0].resolve({data:{...row,storage_objects_count:99},error:null}); await tick();
  assert.equal(f.reads.length,2);
  f.reads[1].resolve({data:row,error:null}); await second;
  assert.equal(f.state().data?.storage_objects_count,"6"); f.monitor.dispose();
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
test("component wiring: responsive grid, manual refresh, auth cleanup and private Broadcast only",()=>{
  const source=readFileSync(new URL("../../app/admin/AdminPhotoMonitor.tsx",import.meta.url),"utf8");
  assert.match(source,/grid-cols-1.*sm:grid-cols-2.*xl:grid-cols-4/);
  assert.match(source,/min-w-0/); assert.match(source,/break-words/); assert.match(source,/min-h-11/);
  assert.match(source,/subscription.unsubscribe\(\)/); assert.match(source,/monitor.dispose\(\)/);
  assert.match(source,/revision === authRevision/); assert.match(source,/removeEventListener/);
  assert.match(source,/rpc\("get_admin_photo_overview"\)/);
  assert.doesNotMatch(source,/service.role|\.from\(|setInterval|setTimeout/i);
});

function connectedFixture() {
  const channels: Array<{message:(p:unknown)=>void;status:(s:string)=>void}> = [];
  const reads: Array<(v:{data:unknown;error:{code?:string}|null})=>void> = [];
  const states: PhotoMonitorState[]=[]; let removed=0;
  const monitor=createPhotoMonitor({read:()=>new Promise(resolve=>reads.push(resolve)),publish:s=>states.push(s),
    connect:events=>{channels.push(events);return ()=>{removed++;};}});
  return {monitor,channels,reads,state:()=>states.at(-1)!,removed:()=>removed};
}
test("Admin connects only after authorized RPC; LIVE only after SUBSCRIBED",async()=>{
 const f=connectedFixture(); f.monitor.sessionChanged("admin"); await tick(); assert.equal(f.channels.length,0);
 f.reads[0]({data:row,error:null}); await tick(); assert.equal(f.state().connection,"connecting");
 f.channels[0].status("SUBSCRIBED"); await tick(); assert.equal(f.state().connection,"subscribed");
 assert.equal(f.reads.length,2); assert.equal(f.state().data?.storage_objects_count,"6");
 f.reads[1]({data:row,error:null}); await tick(); f.monitor.dispose(); assert.equal(f.removed(),1);
});
for(const role of ["anon","customer"]) test(`${role} cannot subscribe without Admin RPC authorization`,async()=>{
 const f=connectedFixture(); if(role==="customer") {f.monitor.sessionChanged("customer"); await tick();f.reads[0]({data:null,error:{code:"42501"}});}
 else f.monitor.sessionChanged(null);
 await tick(); assert.equal(f.channels.length,0); f.monitor.dispose();
});
test("duplicates coalesce, invalid payload ignored, in-flight events cause one trailing read",async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 const c=f.channels[0];for(const p of [null,{v:2},{v:1,path:"private"}]) c.message(p);
 await tick(); assert.equal(f.reads.length,1);
 c.message({v:1});c.message({v:1});await tick();assert.equal(f.reads.length,2);
 c.message({v:1});c.message({v:1});await tick();assert.equal(f.reads.length,2);
 f.reads[1]({data:row,error:null});await tick();assert.equal(f.reads.length,3);
 f.reads[2]({data:{...row,storage_objects_count:7},error:null});await tick();assert.equal(f.state().data?.storage_objects_count,"7");f.monitor.dispose();
});
test("reconnect and foreground refetch without discarding numbers",async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 f.channels[0].status("CHANNEL_ERROR");assert.equal(f.state().stale,true);assert.equal(f.state().connection,"reconnecting");
 f.channels[0].status("SUBSCRIBED");await tick();f.reads[1]({data:row,error:null});await tick();
 f.monitor.foreground();f.monitor.foreground();await tick();assert.equal(f.reads.length,3);assert.ok(f.state().data);
 f.reads[2]({data:row,error:null});await tick();f.monitor.dispose();
});
test("session replacement and unmount invalidate channel callbacks and late reads",async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("first");await tick();f.reads[0]({data:row,error:null});await tick();
 const old=f.channels[0];old.message({v:1});await tick();f.monitor.sessionChanged("second");await tick();
 assert.equal(f.removed(),1);assert.equal(f.state().data,null);
 f.reads[2]({data:{...row,storage_objects_count:8},error:null});await tick();
 f.reads[1]({data:row,error:null});old.status("SUBSCRIBED");old.message({v:1});await tick();
 assert.equal(f.state().data?.storage_objects_count,"8");const n=f.reads.length;
 f.monitor.dispose();f.channels[1].message({v:1});await tick();assert.equal(f.reads.length,n);
});

test("channel replacement waits for asynchronous teardown; old events ignored",async()=>{
 const opened:Array<{message:(p:unknown)=>void;status:(s:string)=>void}>=[];
 let release:()=>void=()=>{};let seen=0;
 const connect=createPhotoBroadcastConnector({open:events=>{opened.push(events);return opened.length;},close:()=>new Promise<void>(resolve=>{release=resolve;})});
 const events={message:()=>{seen++;},status:()=>{seen++;}};
 const leave=connect(events);await tick();assert.equal(opened.length,1);leave();connect(events);await tick();
 assert.equal(opened.length,1);opened[0].message({v:1});opened[0].status("SUBSCRIBED");assert.equal(seen,0);
 release();await tick();assert.equal(opened.length,2);opened[1].message({v:1});assert.equal(seen,1);
});
test("unmount before channel creation does not subscribe",async()=>{
 let opened=0;const connect=createPhotoBroadcastConnector({open:()=>++opened,close:async()=>{}});
 connect({message:()=>{},status:()=>{}})();await tick();assert.equal(opened,0);
});

test("CLOSED reauthorizes, replaces once, and resyncs after actual SUBSCRIBED",async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 const old=f.channels[0];old.status("CLOSED");old.status("CLOSED");old.message({v:1});old.status("SUBSCRIBED");await tick();
 assert.equal(f.removed(),1);assert.equal(f.channels.length,1);assert.equal(f.reads.length,2);
 assert.equal(f.state().connection,"reconnecting");assert.equal(f.state().data?.storage_objects_count,"6");
 f.reads[1]({data:row,error:null});await tick();assert.equal(f.channels.length,2);assert.equal(f.state().connection,"connecting");
 f.channels[1].status("SUBSCRIBED");await tick();assert.equal(f.reads.length,3);
 f.reads[2]({data:{...row,storage_objects_count:5},error:null});await tick();
 assert.equal(f.state().connection,"subscribed");assert.equal(f.state().stale,false);assert.equal(f.state().data?.storage_objects_count,"5");
 f.monitor.dispose();assert.equal(f.removed(),2);
});
test("CLOSED invalidates an in-flight snapshot before reauthorization",async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 f.channels[0].message({v:1});await tick();f.channels[0].status("CLOSED");await tick();
 assert.equal(f.reads.length,3);f.reads[1]({data:{...row,storage_objects_count:99},error:null});await tick();
 assert.equal(f.channels.length,1);assert.equal(f.state().data?.storage_objects_count,"6");
 f.reads[2]({data:{...row,storage_objects_count:4},error:null});await tick();
 assert.equal(f.channels.length,2);assert.equal(f.state().data?.storage_objects_count,"4");f.monitor.dispose();
});
for(const code of ["42501","PGRST301"]) test(`CLOSED reauthorization ${code} does not open a replacement`,async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 f.channels[0].status("CLOSED");await tick();f.reads[1]({data:null,error:{code}});await tick();
 assert.equal(f.channels.length,1);assert.equal(f.state().connection,"denied");assert.equal(f.state().data,null);f.monitor.dispose();
});
test("replacement CLOSED before SUBSCRIBED stops automatic loops; foreground retries",async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 f.channels[0].status("CLOSED");await tick();f.reads[1]({data:row,error:null});await tick();
 f.channels[1].status("CLOSED");await tick();assert.equal(f.reads.length,2);assert.equal(f.removed(),2);
 f.monitor.markStale();assert.equal(f.state().stale,true);f.monitor.foreground();f.monitor.foreground();await tick();
 assert.equal(f.reads.length,3);f.reads[2]({data:row,error:null});await tick();assert.equal(f.channels.length,3);f.monitor.dispose();
});
test("manual refresh can recover a failed CLOSED reauthorization",async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 f.channels[0].status("CLOSED");await tick();f.reads[1]({data:null,error:{code:"UNAVAILABLE"}});await tick();
 assert.equal(f.channels.length,1);assert.equal(f.state().error,"unavailable");
 const refresh=f.monitor.refresh();f.reads[2]({data:row,error:null});await refresh;await tick();
 assert.equal(f.channels.length,2);f.monitor.dispose();
});
for(const action of ["session","unmount"]) test(`CLOSED recovery discarded on ${action}`,async()=>{
 const f=connectedFixture();f.monitor.sessionChanged("admin");await tick();f.reads[0]({data:row,error:null});await tick();
 const old=f.channels[0];old.status("CLOSED");await tick();
 if(action==="session")f.monitor.sessionChanged("other");else f.monitor.dispose();
 await tick();f.reads[1]({data:row,error:null});old.status("SUBSCRIBED");old.message({v:1});await tick();
 assert.equal(f.channels.length,1);
 if(action==="session"){assert.equal(f.state().data,null);f.reads[2]({data:row,error:null});await tick();assert.equal(f.channels.length,2);f.monitor.dispose();}
});
test("CLOSED replacement waits for real connector teardown and ignores delayed old events",async()=>{
 const opened:Array<{message:(p:unknown)=>void;status:(s:string)=>void}>=[];
 let release:()=>void=()=>{};let closes=0,reads=0;
 const connect=createPhotoBroadcastConnector({open:e=>{opened.push(e);return opened.length;},close:async()=>{closes++;if(closes===1)await new Promise<void>(r=>{release=r;});}});
 const monitor=createPhotoMonitor({read:async()=>{reads++;return {data:row,error:null};},publish:()=>{},connect});
 monitor.sessionChanged("admin");await tick();opened[0].status("CLOSED");await tick();
 assert.equal(reads,2);assert.equal(closes,1);assert.equal(opened.length,1);
 opened[0].status("SUBSCRIBED");opened[0].message({v:1});await tick();assert.equal(reads,2);
 release();await tick();assert.equal(opened.length,2);opened[1].status("SUBSCRIBED");await tick();assert.equal(reads,3);
 monitor.dispose();await tick();assert.equal(closes,2);
});
