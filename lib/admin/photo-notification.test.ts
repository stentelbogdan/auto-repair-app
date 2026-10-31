import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
// @ts-expect-error TS5097: Node source import.
import {createPhotoEmitter,createPhotoNotificationHandler,parsePhotoNotification,photoNotificationEnabled} from './photo-notification.ts';
const env={VERCEL_ENV:'preview',ADMIN_PHOTO_NOTIFICATION_ENABLED:'true',ADMIN_PHOTO_SQL_CONTRACT:'4g-v1',SUPABASE_URL:'https://bstjobvvxxfqqwyjoimx.supabase.co',NEXT_PUBLIC_SUPABASE_URL:'https://bstjobvvxxfqqwyjoimx.supabase.co',NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF:'bstjobvvxxfqqwyjoimx',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-secret',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon'};
const actor='10000000-0000-4000-8000-000000000001', ticket='20000000-0000-4000-8000-000000000002';
const confirm={action:'confirm',ticket};
const gate=(status:string)=>({version:'4g-v1',status});
function req(body:unknown=confirm, token='synthetic-user') {return new Request('https://app.invalid/api/repair-requests/images/notify-change',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});}
function transport(responses:Array<Response|Error>) {
 const calls:Array<{url:string;init:RequestInit|undefined}>=[];
 const fetcher:typeof fetch=async (input,init)=>{calls.push({url:String(input),init}); const next=responses.shift();if(next instanceof Error)throw next;if(!next)throw new Error('unexpected call');return next;};
 return {fetch:fetcher,calls};
}
for(const [name,patch] of Object.entries({production:{VERCEL_ENV:'production'},flag:{ADMIN_PHOTO_NOTIFICATION_ENABLED:undefined},contract:{ADMIN_PHOTO_SQL_CONTRACT:undefined},live:{SUPABASE_URL:'https://ouoiykudvcoqbkybkqvs.supabase.co'},publicLive:{NEXT_PUBLIC_SUPABASE_URL:'https://ouoiykudvcoqbkybkqvs.supabase.co'},unknown:{SUPABASE_URL:'https://example.invalid'},ref:{NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF:'unknown'},key:{SUPABASE_SERVICE_ROLE_KEY:undefined}})) test(`disabled ${name}: no network possible`,async()=>{
 const t=transport([]), config={...env,...patch}; assert.equal(photoNotificationEnabled(config),false);
 assert.equal(await createPhotoEmitter({env:config,fetch:t.fetch})(),'disabled');
 assert.equal((await createPhotoNotificationHandler({env:config,fetch:t.fetch})(req())).status,404);assert.equal(t.calls.length,0);
});
test('one private fixed broadcast; secrets only in headers',async()=>{
 const t=transport([new Response(null,{status:202})]);assert.equal(await createPhotoEmitter({env,fetch:t.fetch})(),'accepted');
 assert.equal(t.calls.length,1);const {url,init}=t.calls[0];assert.equal(url,env.SUPABASE_URL+'/realtime/v1/api/broadcast');
 assert.equal(init?.redirect,'manual');assert.equal(init?.cache,'no-store');
 assert.deepEqual(JSON.parse(String(init?.body)),{messages:[{topic:'admin:photo-overview:v1',event:'invalidate',payload:{v:1},private:true}]});
 assert.ok(!url.includes(env.SUPABASE_SERVICE_ROLE_KEY));assert.ok(!String(init?.body).includes('secret'));
});
for(const status of [200,302,401,403,429,500]) test(`broadcast ${status} contained, no retry`,async()=>{
 const t=transport([new Response('sensitive-raw-body',{status})]);assert.equal(await createPhotoEmitter({env,fetch:t.fetch})(),'unavailable');assert.equal(t.calls.length,1);
});
test('transport exception and ignored-abort timeout cannot escape emitter',async()=>{
 const t=transport([new Error('sensitive')]);assert.equal(await createPhotoEmitter({env,fetch:t.fetch})(),'unavailable');
 let n=0; const stuck:typeof fetch=()=>{n++;return new Promise(()=>{});};
 assert.equal(await createPhotoEmitter({env,fetch:stuck,timeoutMs:5})(),'unavailable');assert.equal(n,1);
});
test('strict inputs reject arbitrary paths, counts, actors and extra fields',()=>{
 for(const body of [null,{...confirm,actor},{...confirm,count:1},{action:'prepare',kind:'upload',objectName:'../photo.jpg'},{action:'prepare',kind:'upload',objectName:'owner/photo.jpg'},{action:'confirm',ticket:'bad'}]) assert.equal(parsePhotoNotification(body),null);
 assert.ok(parsePhotoNotification({action:'prepare',kind:'upload',objectName:'photo.jpg'}));
 assert.ok(parsePhotoNotification({action:'prepare',kind:'request_images',requestId:null}));
});
test('anonymous, malformed and oversized requests rejected before authentication',async()=>{
 const t=transport([]),handler=createPhotoNotificationHandler({env,fetch:t.fetch});
 assert.equal((await handler(new Request('https://app.invalid',{method:'POST'}))).status,401);
 assert.equal((await handler(req({...confirm,extra:true}))).status,400);
 assert.equal((await handler(req('x'.repeat(1100)))).status,400);assert.equal(t.calls.length,0);
});
test('invalid user token cannot reach SQL or Broadcast',async()=>{
 const t=transport([new Response('private',{status:401})]);const r=await createPhotoNotificationHandler({env,fetch:t.fetch})(req());
 assert.equal(r.status,401);assert.equal(t.calls.length,1);assert.ok(!(await r.text()).includes('private'));
});
test('prepare authenticates actor server-side, returns opaque ticket without emitting',async()=>{
 const t=transport([Response.json({id:actor}),Response.json({...gate('prepared'),ticket})]);
 const r=await createPhotoNotificationHandler({env,fetch:t.fetch})(req({action:'prepare',kind:'request_images',requestId:null}));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'prepared',ticket});assert.equal(t.calls.length,2);
 assert.equal(JSON.parse(String(t.calls[1].init?.body)).p_actor,actor);
});
for(const [status,http] of [['ineligible',403],['throttled',429],['suppressed',200]] as const) test(`gate ${status}: no Broadcast`,async()=>{
 const t=transport([Response.json({id:actor}),Response.json(gate(status))]);assert.equal((await createPhotoNotificationHandler({env,fetch:t.fetch})(req())).status,http);assert.equal(t.calls.length,2);
});
for(const result of [new Response(null,{status:404}),Response.json({version:'old',status:'claimed'}),Response.json({...gate('claimed'),path:'sensitive'})]) test('missing or malformed SQL contract fails closed',async()=>{
 const t=transport([Response.json({id:actor}),result]);const r=await createPhotoNotificationHandler({env,fetch:t.fetch})(req());assert.equal(r.status,503);assert.equal(t.calls.length,2);assert.ok(!(await r.text()).includes('sensitive'));
});
test('claimed change sends exactly once; response is notification acceptance only',async()=>{
 const t=transport([Response.json({id:actor}),Response.json(gate('claimed')),new Response(null,{status:202})]);
 const r=await createPhotoNotificationHandler({env,fetch:t.fetch})(req());assert.equal(r.status,202);assert.deepEqual(await r.json(),{status:'accepted'});assert.equal(t.calls.length,3);
});
test('notification failure remains separate and exposes no raw error',async()=>{
 const t=transport([Response.json({id:actor}),Response.json(gate('claimed')),new Error('sensitive-service-secret')]);
 const r=await createPhotoNotificationHandler({env,fetch:t.fetch})(req());assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'notification_unavailable'});
});
test('concurrent confirms respect atomic gate result: only winner emits (mock contract)',async()=>{
 let claimed=false,broadcasts=0;
 const fetcher:typeof fetch=async input=>{const url=String(input);if(url.endsWith('/user'))return Response.json({id:actor});if(url.endsWith('/admin_photo_notification_gate')){const status=claimed?'suppressed':'claimed';claimed=true;return Response.json(gate(status));}broadcasts++;return new Response(null,{status:202});};
 const handler=createPhotoNotificationHandler({env,fetch:fetcher});const results=await Promise.all([handler(req()),handler(req())]);assert.deepEqual(results.map(r=>r.status).sort(),[200,202]);assert.equal(broadcasts,1);
});
test('no logging, no browser publisher, SQL atomic guards and no business DML',()=>{
 const source=readFileSync(new URL('./photo-notification.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/console\.|\.log\(/);
 const sql=readFileSync(new URL('../../supabase/migrations/20261030020000_admin_photo_notification_gate.sql',import.meta.url),'utf8');
 assert.match(sql,/for update/g);assert.match(sql,/on conflict\(actor,evidence\) do nothing/);assert.match(sql,/q\.calls>=120/);assert.match(sql,/q\.prepared>=30/);
 assert.doesNotMatch(sql,/(?:insert into|update|delete from)\s+(?:public|storage|repair_image_private)\./i);
 const policies=readFileSync(new URL('../../supabase/migrations/20261030010000_admin_photo_broadcast_policies.sql',import.meta.url),'utf8');
 assert.match(policies,/as restrictive for select to authenticated/);assert.match(policies,/as restrictive for insert to anon, authenticated/);assert.match(policies,/public\.is_admin\(\) is true/);assert.doesNotMatch(policies,/create trigger/i);
});
