import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type { OfferReadObservation } from "../../../lib/offer-read-version";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const observation: OfferReadObservation = { userId: "10000000-0000-4000-8000-000000000001", role: "customer",
  offerId: "10000000-0000-4000-8000-000000000002", version: "9007199254740993" };
function fixture() {
  let saved: { deps: unknown[]; value: unknown } | undefined;
  const calls: { context: unknown; observation: unknown }[] = [];
  let aborted = 0;
  const observe = (context: unknown, observed: unknown) => {
    calls.push({ context, observation: observed });
    return () => () => { aborted++; };
  };
  const react = { useMemo: (fn: () => unknown, deps: unknown[]) => {
    if (!saved || deps.some((v, i) => v !== saved!.deps[i])) saved = { deps, value: fn() };
    return saved.value;
  } };
  const api: Record<string, unknown> = {};
  const js = ts.transpileModule(source + "\nexports.testCard = CustomerJobReadCard;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", js)((name: string) => name === "react" ? react
    : name === "react/jsx-runtime" ? { jsx: (_type: unknown, props: unknown) => props } : {}, api);
  const card = api.testCard as (props: object) => { ref: () => () => void; [key: string]: unknown };
  return { calls, aborted: () => aborted, render: (observed: OfferReadObservation | null | undefined = observation) => card({
    requestId: "request", offerId: observation.offerId, appointmentId: "appointment", observation: observed,
    observe, onClick() {}, children: "authorized accepted offer",
  }) };
}
test("accepted offer card supplies the displayed version and exact conversation context", () => {
  const f = fixture(); const node = f.render();
  assert.deepEqual(f.calls, [{ context: { requestId: "request", offerId: observation.offerId, appointmentId: "appointment" }, observation }]);
  assert.equal(node["data-focus-offer"], observation.offerId);
  assert.equal(node["data-focus-request"], "request");
  assert.equal(node["data-focus-appointment"], "appointment");
});
test("unrelated job renders do not detach the ref or cancel the pending receipt", () => {
  const f = fixture(); const first = f.render(); const cleanup = first.ref();
  for (let n = 0; n < 5; n++) assert.equal(f.render().ref, first.ref);
  assert.equal(f.calls.length, 1); assert.equal(f.aborted(), 0);
  cleanup(); assert.equal(f.aborted(), 1);
});
test("new observed version or account replaces the visibility receipt", () => {
  const f = fixture(); const a = f.render();
  const b = f.render({ ...observation, version: "9007199254740994" });
  assert.notEqual(a.ref, b.ref);
  assert.notEqual(b.ref, f.render({ ...observation, userId: "other" }).ref);
});
test("missing version stays unavailable rather than using a legacy receipt", () => {
  const f = fixture(); f.render(null);
  assert.equal(f.calls[0].observation, null);
});
test("page connects authorized loaded offer versions to visible cards, not appointment mutations", () => {
  assert.match(source, /getOffersForCustomerRequests\(userId, true\)/);
  assert.match(source, /readObservation: offerReadObservation\(userId, "customer", offer.id, offer.read_state_version\)/);
  assert.match(source, /observation=\{acceptedOffer\?\.readObservation\}/);
  const card = source.slice(source.indexOf("function CustomerJobReadCard"), source.indexOf("type UnreadProgressRow"));
  assert.doesNotMatch(card, /\.rpc\(|\.update\(|customerAccept|finalize|appointment_date/);
  assert.doesNotMatch(source, /customer_read_at:\s*|mark_customer_repair_offers_read/);
});
