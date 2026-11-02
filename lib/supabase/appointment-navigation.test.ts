import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
type API = typeof import("./appointment-navigation");
const request = "10000000-0000-4000-8000-000000000001";
const offer = "20000000-0000-4000-8000-000000000001";
const appointment = "30000000-0000-4000-8000-000000000001";
const user = "40000000-0000-4000-8000-000000000001";
const notification = (role: string) => ({type:role==="workshop"?"customer_proposed_appointment":"workshop_proposed_appointment",
  request_id:request,offer_id:offer,appointment_id:appointment});
function fixture(options: {status?:string; category?:string; winner?:string|null; absent?:boolean; error?:boolean; mismatch?:boolean}={}) {
  const calls: string[]=[];const filters:[string,unknown][]=[];
  const data={id:request,status:options.status??"matched",accepted_offer_id:options.winner===undefined?offer:options.winner,service_type:options.category??"bodywork"};
  const query=(table:string)=>({select:()=>q,eq:(key:string,v:unknown)=>{filters.push([key,v]);return q;},maybeSingle:async()=>({error:options.error?{code:"42501"}:null,data:options.absent?null:table==="repair_appointments"?{id:options.mismatch?offer:appointment,request_id:request,offer_id:offer}:data})});
  let q: ReturnType<typeof query>;
  const supabase={from:(table:string)=>{calls.push(table);q=query(table);return q;}};
  const exports:Record<string,unknown>={};
  const source=readFileSync(new URL("./appointment-navigation.ts",import.meta.url),"utf8");
  new Function("require","exports",ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)((name:string)=>{
    if(name==="@/lib/supabase/client")return {supabase};
    assert.equal(name,"@/lib/supabase/workshop-request-detail");
    return {getWorkshopRequestDetail:async()=>{calls.push("authorized_detail_rpc");return options.absent?null:data;}};
  },exports);
  return {api:exports as API,calls,filters};
}
for (const role of ["customer","workshop"] as const) for(const category of ["bodywork","mechanical","wheels","towing"]) {
  test(`${role}/${category}: attributed proposal uses jobs, not stale notification URL`,async()=>{
    const f=fixture({category});
    const url=await f.api.getAppointmentProposalDestination(notification(role),role,user);
    assert.equal(url,`${role==="workshop"?"/workshops/won-jobs?tab=appointments":"/customer/my-jobs?tab=scheduled"}&category=${category}&focusRequest=${request}`);
    assert.ok(f.filters.some(([k,v])=>k===(role==="workshop"?"workshop_id":"customer_id")&&v===user));
    assert.ok(f.filters.some(([k,v])=>k==="offer_id"&&v===offer));
    if(role==="workshop")assert.deepEqual(f.calls,["repair_appointments","authorized_detail_rpc"]);
    else assert.ok(f.filters.some(([k,v])=>k==="user_id"&&v===user));
  });
}
for (const role of ["customer","workshop"] as const) {
  test(`${role}: preaward stays in original offers surface`,async()=>{
    const f=fixture({status:"open",winner:null});
    assert.match((await f.api.getAppointmentProposalDestination(notification(role),role,user))!,role==="workshop"?/^\/workshops\/my-offers\?/:/^\/offers\?/);
  });
  test(`${role}: in-progress tab respected`,async()=>{
    const f=fixture({status:"in_progress"});
    assert.ok((await f.api.getAppointmentProposalDestination(notification(role),role,user))?.includes(role==="workshop"?"tab=workshop":"tab=in_progress"));
  });
}
for(const options of [{absent:true},{mismatch:true},{status:"closed"},{winner:request}]) {
  test(`neutral result, no fallback ${JSON.stringify(options)}`,async()=>{
    const f=fixture(options);assert.equal(await f.api.getAppointmentProposalDestination(notification("workshop"),"workshop",user),null);
  });
}
test("error propagates without retry or direct Service request SELECT",async()=>{
  const f=fixture({error:true});await assert.rejects(f.api.getAppointmentProposalDestination(notification("workshop"),"workshop",user),{code:"42501"});
  assert.deepEqual(f.calls,["repair_appointments"]);
});
test("invalid identity, unrelated notification and wrong recipient role never read",async()=>{
  const f=fixture();
  assert.equal(await f.api.getAppointmentProposalDestination(notification("customer"),"workshop",user),null);
  assert.equal(await f.api.getAppointmentProposalDestination({...notification("customer"),appointment_id:"draft"},"customer",user),null);
  assert.equal(await f.api.getAppointmentProposalDestination({...notification("customer"),type:"message"},"customer",user),null);
  assert.deepEqual(f.calls,[]);
});
test("toast and unread proposals both use resolver, other notifications stay separate",()=>{
  const navbar=readFileSync(new URL("../../app/components/AppNavbar.tsx",import.meta.url),"utf8");
  assert.equal((navbar.match(/await getAppointmentProposalDestination\(/g)??[]).length,2);
  assert.match(navbar,/if \(isAppointmentProposal\(toast.type\)\)/);
  assert.match(navbar,/getWorkshopReviewDestination\(\)/);
});
