import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type API = typeof import("./repair-appointments");
const source = readFileSync(new URL("./repair-appointments.ts", import.meta.url), "utf8");
const id = "10000000-0000-4000-8000-000000000001";
const request = "20000000-0000-4000-8000-000000000001";
const offer = "30000000-0000-4000-8000-000000000001";
const customer = "40000000-0000-4000-8000-000000000001";
const workshop = "50000000-0000-4000-8000-000000000001";
const initial = "2026-11-01T10:00:00.000000+00:00";
const row = () => ({ id, request_id: request, offer_id: offer, customer_id: customer, workshop_id: workshop,
  appointment_date: "2026-12-01", appointment_time: "09:00", handover_method: "customer_dropoff",
  pickup_address: null, customer_note: null, workshop_note: null, proposed_date: null as string | null,
  proposed_time: null as string | null, status: "requested", updated_at: initial });

function fixture(override?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let state = row();
  let version = 0;
  const exports: Record<string, unknown> = {};
  const supabase = { rpc: (name: string, args: Record<string, unknown>) => ({ single: async () => {
    calls.push({ name, args });
    if (override) return override(name, args);
    if (args.p_expected_updated_at !== state.updated_at) return { data: null, error: { code: "40001" } };
    if (name.includes("propose_repair")) {
      if (state.status === "confirmed") return { data: null, error: { code: "55000" } };
      state = { ...state, status: name.startsWith("customer") ? "customer_proposed" : "workshop_proposed",
        proposed_date: String(args.p_proposed_date), proposed_time: String(args.p_proposed_time).trim() };
    } else if (args.p_decision === "declined") state = { ...state, status: "declined" };
    else state = { ...state, status: "confirmed", appointment_date: state.proposed_date!,
      appointment_time: state.proposed_time!, proposed_date: null, proposed_time: null };
    state = { ...state, updated_at: `2026-11-01T10:00:00.${String(++version).padStart(6, "0")}+00:00` };
    return { data: { ...state }, error: null };
  } }), from: () => { throw new Error("No direct table access"); } };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", js)((name: string) => {
    assert.equal(name, "@/lib/supabase/client"); return { supabase };
  }, exports);
  return { api: exports as API, calls, state: () => state };
}
const proposal = (version = initial) => ({ appointmentId: id, expectedUpdatedAt: version,
  proposedDate: "2026-12-02", proposedTime: "12:00", handoverMethod: "customer_dropoff" as const,
  pickupAddress: null, customerNote: null });

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  for (const acceptor of ["customer", "workshop"]) test(`${category}: two rounds, ${acceptor} accepts last persisted proposal`, async () => {
    // Offline RPC responses; real PostgreSQL authorization/concurrency is separate evidence.
    const f = fixture();
    let version = initial;
    for (let round = 0; round < 2; round++) {
      const a = await f.api.customerProposeRepairAppointment({ ...proposal(version), proposedDate: `2026-12-0${2+round}` });
      const b = await f.api.workshopProposeRepairAppointment({ ...proposal(a.updated_at),
        proposedDate: `2026-12-0${5+round}`, workshopNote: "Synthetic" });
      version = b.updated_at;
    }
    let result;
    if (acceptor === "customer") result = await f.api.customerAcceptWorkshopAppointment({ appointmentId: id, expectedUpdatedAt: version });
    else {
      const a = await f.api.customerProposeRepairAppointment({ ...proposal(version), proposedDate: "2026-12-09" });
      result = await f.api.workshopResolveCustomerAppointment({ appointmentId: id, expectedUpdatedAt: a.updated_at, decision: "confirmed" });
    }
    assert.equal(result.appointment_date, acceptor === "customer" ? "2026-12-06" : "2026-12-09");
    assert.equal(result.status, "confirmed");
    assert.equal(result.proposed_date, null);
    assert.deepEqual(result, f.state());
    await assert.rejects(f.api.customerProposeRepairAppointment(proposal(result.updated_at)), { code: "55000" });
  });
}
test("exact historical parameters, no actor authority or direct UPDATE", async () => {
  const f = fixture(); await f.api.customerProposeRepairAppointment(proposal());
  assert.deepEqual(f.calls[0], { name: "customer_propose_repair_appointment", args: {
    p_appointment_id: id, p_expected_updated_at: initial, p_proposed_date: "2026-12-02", p_proposed_time: "12:00",
    p_handover_method: "customer_dropoff", p_pickup_address: null, p_customer_note: null,
  } });
  assert.doesNotMatch(source, /\.from\(|\.update\(|service_role/);
});
test("decline, counterproposal, repeat; version forwarded without timestamp rounding", async () => {
  const f=fixture(); const a=await f.api.customerProposeRepairAppointment(proposal());
  const b=await f.api.workshopResolveCustomerAppointment({ appointmentId:id,expectedUpdatedAt:a.updated_at,decision:"declined" });
  assert.equal(b.appointment_date,"2026-12-01");
  await f.api.workshopProposeRepairAppointment({ ...proposal(b.updated_at), workshopNote:null });
  assert.equal(f.calls[2].args.p_expected_updated_at,b.updated_at);
});
for (const code of ["42501", "55000", "40001", "55P03", "40P01", "PT409", "23505", "57014"]) {
  test(`propagates ${code} with no retry or synthetic success`, async () => {
    const f=fixture(()=>({data:null,error:{code}}));
    await assert.rejects(f.api.customerProposeRepairAppointment(proposal()), {code});
    assert.equal(f.calls.length,1);
    assert.ok(f.api.appointmentMutationErrorMessage({code}).length>10);
  });
}
test("concurrent proposals with the same version: only one succeeds",async()=>{
  const f=fixture(); const results=await Promise.allSettled([
    f.api.customerProposeRepairAppointment(proposal()),f.api.customerProposeRepairAppointment(proposal())]);
  assert.deepEqual(results.map(r=>r.status),["fulfilled","rejected"]);
  assert.equal(f.calls.length,2);
});
for (const invalid of [null, [], {}, { ...row(),status:"customer_proposed" },
  {...row(),id:offer,updated_at:"2026-11-02T10:00:00Z"},
  {...row(),updated_at:"bad"}, {...row(),customer_id:null}, {...row(),handover_method:"bad"}]) {
  test(`rejects unverified RPC row ${JSON.stringify(invalid)}`,async()=>{
    const f=fixture(()=>({data:invalid,error:null}));
    await assert.rejects(f.api.customerProposeRepairAppointment(proposal()));
    assert.equal(f.calls.length,1);
  });
}
test("accepted result with uncleared proposal is not success",async()=>{
  const f=fixture(()=>({data:{...row(),status:"confirmed",updated_at:"2026-11-02T10:00:00Z",proposed_date:"2026-12-03"},error:null}));
  await assert.rejects(f.api.customerAcceptWorkshopAppointment({appointmentId:id,expectedUpdatedAt:initial}));
});
test("transport failure has unknown outcome, no retry",async()=>{
  const f=fixture(()=>{throw new Error("Synthetic offline timeout");});
  await assert.rejects(f.api.customerProposeRepairAppointment(proposal()));
  assert.equal(f.calls.length,1);
  assert.match(f.api.appointmentMutationErrorMessage(new Error()),/nu poate fi confirmat/);
});

test("three pages use RPCs; initial award finalizers remain",()=>{
  for (const path of ["../../app/customer/my-jobs/page.tsx","../../app/workshops/won-jobs/page.tsx","../../app/customer/schedule-damage/[id]/page.tsx"]) {
    const page=readFileSync(new URL(path,import.meta.url),"utf8");
    assert.doesNotMatch(page,/\.from\("repair_appointments"\)\s*\.update\(/);
    assert.match(page,/expectedUpdatedAt:/);
    assert.match(page,/appointmentMutationErrorMessage/);
  }
  assert.match(readFileSync(new URL("../services/offers/customer-appointments.service.ts",import.meta.url),"utf8"),/finalizeCustomerRepairOffer/);
  assert.match(readFileSync(new URL("../../app/workshops/my-offers/page.tsx",import.meta.url),"utf8"),/finalizeWorkshopCustomerProposal/);
});

function handler(page: string, name: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(page, import.meta.url), "utf8");
  const ast = ts.createSourceFile(page, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) text = `const ${node.getText(ast)};`;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(text);
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), js+`\nreturn ${name};`)(...Object.values(dependencies));
}

test("actual Client handler: accepts RPC result before scheduling refresh; no refresh on failure", async () => {
  for (const fail of [false,true]) {
    const events: string[]=[]; const f=fixture();
    const accept=handler("../../app/customer/my-jobs/page.tsx","acceptAppointmentProposal",{
      customerAcceptWorkshopAppointment:async (input:unknown)=>{events.push("rpc");assert.deepEqual(input,{appointmentId:id,expectedUpdatedAt:initial});if(fail)throw {code:"40001"};return {...row(),status:"confirmed"};},
      scheduleJobsRefreshRef:{current:()=>events.push("refresh")},alert:()=>events.push("alert"),
      console:{error:()=>{}},appointmentMutationErrorMessage:f.api.appointmentMutationErrorMessage,
    });
    await accept(row());assert.deepEqual(events,fail?["rpc","alert"]:["rpc","refresh"]);
  }
});

for (const decision of ["confirmed","declined"] as const) {
  test(`actual Service handler ${decision}: uses persistent row; ignores newer local version`,async()=>{
    const f=fixture();
    for(const newer of [false,true]) {
      const job={requestId:request,offerId:offer,appointment:{...row(),status:"customer_proposed"}};
      const returned={...row(),status:decision,appointment_date:"2026-12-09",updated_at:"2026-11-02T12:00:00Z"};
      let jobs=[{...job,appointment:{...job.appointment,updated_at:newer?"2026-11-03T12:00:00Z":initial}}];
      const resolve=handler("../../app/workshops/won-jobs/page.tsx","updateAppointmentStatus",{
        workshopResolveCustomerAppointment:async()=>returned,
        setJobs:(fn:(items:typeof jobs)=>typeof jobs)=>{jobs=fn(jobs);},
        alert:()=>{throw new Error("Unexpected alert");},console:{error:()=>{}},
        appointmentMutationErrorMessage:f.api.appointmentMutationErrorMessage,
      });
      await resolve(job,decision);
      assert.equal(jobs[0].appointment.appointment_date,newer?"2026-12-01":"2026-12-09");
      assert.equal(jobs[0].appointment.updated_at,newer?"2026-11-03T12:00:00Z":returned.updated_at);
    }
  });
}

test("actual Service proposal handler: failure keeps editor open; success uses RPC row",async()=>{
  for(const fail of [false,true]) {
    const f=fixture();const events:string[]=[];
    const job={requestId:request,offerId:offer,appointment:row()};
    const returned={...row(),status:"workshop_proposed",updated_at:"2026-11-02T12:00:00Z",proposed_date:"2026-12-09",proposed_time:"14:00"};
    let jobs=[job];
    const propose=handler("../../app/workshops/won-jobs/page.tsx","proposeAnotherAppointment",{
      newAppointmentDate:"2026-12-09",newAppointmentTime:"14:00",
      workshopProposeRepairAppointment:async()=>{events.push("rpc");if(fail)throw {code:"PT409"};return returned;},
      setJobs:(fn:(items:typeof jobs)=>typeof jobs)=>{jobs=fn(jobs);events.push("state");},
      setEditingAppointmentId:()=>events.push("close"),setNewAppointmentDate:()=>{},setNewAppointmentTime:()=>{},
      alert:()=>events.push("alert"),console:{error:()=>{}},appointmentMutationErrorMessage:f.api.appointmentMutationErrorMessage,
    });
    await propose(job);
    assert.deepEqual(events,fail?["rpc","alert"]:["rpc","state","close","alert"]);
    assert.deepEqual(jobs[0].appointment,fail?job.appointment:returned);
  }
});

for(const role of ["customer","workshop"] as const) for(const category of ["bodywork","mechanical","wheels","towing"]) {
  test(`actual calendar ${role}/${category}: proposal RPC before navigation, error stays in editor`,async()=>{
    for(const failure of [false,true]) {
      const f=fixture();const events:string[]=[];const parameters:Record<string,unknown>[]=[];
      const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id,updated_at:initial,workshop_note:null},error:null})};
      const rpc=async(input:Record<string,unknown>)=>{
        parameters.push(input);events.push("proposal");if(failure)throw {code:"40001"};
        return {...row(),status:role==="workshop"?"workshop_proposed":"customer_proposed",updated_at:"2026-11-02T12:00:00Z"};
      };
      const submit=handler("../../app/customer/schedule-damage/[id]/page.tsx","submitAppointment",{
        request:{id:request,service_type:category,status:"matched",service_details:{pickup:{address:"Synthetic",city:"City"}}},
        offer:{id:offer,status:"accepted",workshop_user_id:workshop},
        isTowingServiceDetailsV1:()=>true,toLocalDateTime:()=>new Date("2099-12-02T12:00:00Z"),
        appointmentDate:"2099-12-02",appointmentTime:"12:00",handoverMethod:"customer_dropoff",pickupAddress:"",customerNote:"Synthetic note",
        isInitialOfferMode:false,isWorkshopMode:role==="workshop",
        supabase:{from:(table:string)=>{assert.equal(table,"repair_appointments");return q;},
          rpc:async(name:string)=>{assert.equal(name,"get_workshop_booked_slots");return {data:[],error:null};},
          auth:{getUser:async()=>({data:{user:{id:role==="workshop"?workshop:customer}}})}},
        customerProposeRepairAppointment:rpc,workshopProposeRepairAppointment:rpc,
        appointmentMutationErrorMessage:f.api.appointmentMutationErrorMessage,
        router:{replace:(url:string)=>events.push(url),push:()=>{throw new Error("Unexpected initial navigation");}},
        setSaving:()=>{},alert:()=>events.push("alert"),console:{error:()=>{}},
        loadBookedSlots:()=>{throw new Error("Unexpected occupied slot");},setAppointmentTime:()=>{},
      });
      await submit();
      assert.equal(parameters.length,1);assert.equal(parameters[0].appointmentId,id);
      assert.equal(parameters[0].expectedUpdatedAt,initial);
      if(role==="workshop")assert.deepEqual(Object.keys(parameters[0]).sort(),["appointmentId","expectedUpdatedAt","proposedDate","proposedTime","workshopNote"].sort());
      else assert.equal(parameters[0].handoverMethod,category==="towing"?"workshop_pickup":"customer_dropoff");
      if(failure)assert.deepEqual(events,["proposal","alert"]);
      else {assert.equal(events[0],"proposal");assert.match(events[1],role==="workshop"?/^\/workshops\/won-jobs/:/^\/customer\/my-jobs/);}
    }
  });
}
