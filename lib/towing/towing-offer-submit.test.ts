import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const errorApi: Record<string, unknown> = {};
new Function("exports", ts.transpileModule(
  readFileSync(new URL("./towing-offer-error.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText)(errorApi);
const towingOfferErrorMessage = errorApi.towingOfferErrorMessage as (error: unknown) => string;

// Execute the actual submit handler's catch/finally, without React or network.
const path = "../../app/workshops/[id]/page.tsx";
const source = readFileSync(new URL(path, import.meta.url), "utf8");
const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handleSubmit") {
    handler = node.initializer as ts.ArrowFunction;
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(handler && ts.isBlock(handler.body));
const attempt = handler.body.statements.find(ts.isTryStatement)!;
assert.ok(attempt.catchClause && attempt.finallyBlock);
const js = ts.transpileModule(`function run(error: unknown, request: {service_type: string}, alert: (s: string) => void, setIsSubmitting: (v: boolean) => void) {
  try { throw error; } ${attempt.catchClause.getText(file)} finally ${attempt.finallyBlock.getText(file)}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const run = new Function("towingOfferErrorMessage", `${js}; return run;`)(towingOfferErrorMessage) as (
  error: unknown, request: { service_type: string }, alert: (s: string) => void,
  setIsSubmitting: (v: boolean) => void,
) => void;

for (const error of [
  { code: "42501", message: "Repair request is not available for a new offer", details: "synthetic" },
  { code: "23514", message: "Synthetic constraint failure" },
  { code: "PGRST202", message: "Synthetic missing RPC" },
  new Error("Synthetic transport failure"),
]) test(`towing reveals ${"code" in error ? error.code : "Error"} and releases submit state`, () => {
  const alerts: string[] = [], states: boolean[] = [];
  run(error, { service_type: "towing" }, s => alerts.push(s), s => states.push(s));
  assert.equal(alerts.length, 1);
  if ("code" in error && error.code === "42501") assert.ok(alerts[0].includes(error.message));
  else assert.ok(!alerts[0].includes(error.message));
  if ("code" in error) assert.ok(alerts[0].includes(error.code));
  assert.ok(alerts[0].includes("Verifică lista ofertelor înainte de a reîncerca."));
  assert.deepEqual(states, [false]);
});
for (const error of [null, undefined, {}, { message: 42, code: {} }, { message: "  " }]) {
  test(`unknown towing error ${JSON.stringify(error)} does not claim rollback`, () => {
    const alerts: string[] = [];
    run(error, { service_type: "towing" }, s => alerts.push(s), () => {});
    assert.equal(alerts[0], "Nu am putut confirma trimiterea ofertei. Mesajul tehnic este mascat pentru protecția datelor.\nVerifică lista ofertelor înainte de a reîncerca.");
  });
}
for (const service_type of ["bodywork", "mechanical", "wheels"]) {
  test(`${service_type} retains existing error handling`, () => {
    const alerts: string[] = [];
    run({ message: "plain object" }, { service_type }, s => alerts.push(s), () => {});
    run(new Error("native error"), { service_type }, s => alerts.push(s), () => {});
    assert.deepEqual(alerts, ["Nu am putut trimite oferta.", "native error"]);
  });
}

const handlerJs = ts.transpileModule(`const submit = ${handler!.getText(file)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
for (const proposedDate of ["2026-11-08", "2026-11-09"]) {
  test(`actual towing handler sends service date ${proposedDate} independently of requested date`, async () => {
    const calls: Record<string, unknown>[] = [], alerts: string[] = [], navigation: string[] = [];
    const deps = {
      towingOfferErrorMessage,
      assertWorkshopSlotAvailable: async (date: string, time: string, workshop: string) => {
        assert.equal(date, proposedDate); assert.equal(time, "10:00"); assert.equal(workshop, "workshop");
      },
      isSubmitting: false,
      request: { service_type: "towing", route_duration_seconds: 5400,
        towing_requested_at: "2026-11-08T19:00:00Z", towing_requested_timezone: "Europe/Berlin",
        service_details: { pickup: { address: "Synthetic", city: "City" } } },
      availableDate: proposedDate, availableTime: "10:00", price: "450", days: "", message: "", id: "synthetic-request",
      isNonNegativeFinite: () => true, formatTowingRouteDuration: () => "1 oră 30 minute",
      isTowingServiceDetailsV1: () => true,
      setIsSubmitting: () => {}, alert: (s: string) => alerts.push(s),
      supabase: { auth: { getUser: async () => ({ data: { user: { id: "workshop" } } }) } },
      getOwnProfile: async () => ({ data: { workshop_name: "Synthetic" } }),
      sessionStorage: { getItem: () => null, removeItem: () => {} },
      createRepairOffer: async (input: Record<string, unknown>) => { calls.push(input); },
      router: { replace: (s: string) => navigation.push(s) },
    };
    const submit = new Function(...Object.keys(deps), `${handlerJs}; return submit;`)(...Object.values(deps));
    await submit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].availableDate, proposedDate);
    assert.equal(calls[0].availableTime, "10:00");
    assert.equal(calls[0].handoverMethod, "workshop_pickup");
    assert.equal(calls[0].days, "1 oră 30 minute");
    assert.deepEqual(alerts, []);
    assert.deepEqual(navigation, ["/workshops/dashboard?offerSent=1"]);
  });
}

for (const code of ["22P02", "23505", "PGRST202", "42501", "PT409"]) {
  test(`diagnostic ${code} never reveals interpolated values, details or hint`, () => {
    const secret = "private@example.invalid Bearer synthetic-token 12 Private Street";
    const result = towingOfferErrorMessage({ code,
      message: `invalid input syntax: "${secret}"`, details: secret, hint: secret });
    assert.ok(result.includes(`(${code})`));
    assert.ok(!result.includes(secret));
    assert.ok(result.includes("mascat"));
  });
}
test("untrusted code and native Error messages are not exposed", () => {
  const secret = "private@example.invalid";
  for (const error of [{ code: secret, message: secret }, new Error(secret)]) {
    assert.ok(!towingOfferErrorMessage(error).includes(secret));
  }
});
test("safe slot collision message remains exact", () => {
  assert.ok(towingOfferErrorMessage({ code: "PT409", message: "Appointment slot is no longer available" })
    .startsWith("Appointment slot is no longer available (PT409)"));
});

for (const category of ["bodywork", "mechanical", "wheels", "towing"]) {
  test(`${category}: final offer creation does not depend on an occupancy read`, async () => {
    const events: string[] = [], alerts: string[] = [];
    const deps = {
      towingOfferErrorMessage,
      assertWorkshopSlotAvailable: () => { throw new Error("Occupancy must not gate creation"); },
      isSubmitting: false,
      request: { service_type: category, route_duration_seconds: 5400,
        service_details: { pickup: { address: "Synthetic", city: "City" } } },
      availableDate: "2099-11-09", availableTime: "10:00", price: "450", days: "1 zi", message: "", id: "synthetic-request",
      isNonNegativeFinite: () => true, formatTowingRouteDuration: () => "1 oră 30 minute",
      isTowingServiceDetailsV1: () => true,
      setIsSubmitting: (value: boolean) => events.push(value ? "busy" : "idle"), alert: (s: string) => alerts.push(s),
      supabase: { auth: { getUser: async () => ({ data: { user: { id: "authenticated-service" } } }) } },
      getOwnProfile: async () => ({ data: { workshop_name: "Synthetic" } }),
      sessionStorage: { getItem: () => null, removeItem: () => events.push("remove-draft") },
      createRepairOffer: async () => { events.push("create"); },
      router: { replace: () => events.push("navigate") },
    };
    const submit = new Function(...Object.keys(deps), `${handlerJs}; return submit;`)(...Object.values(deps));
    const pending = submit({ preventDefault() {} });

    await pending;
    assert.deepEqual(events, ["busy", "create", "remove-draft", "navigate", "idle"]);
    assert.equal(alerts.length, 0);
  });
}
