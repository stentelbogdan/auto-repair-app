import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type API = typeof import("./offer-read-version");
const exports: Record<string, unknown> = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("./offer-read-version.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(exports);
const api = exports as API;
const user = "10000000-0000-4000-8000-000000000001", offer = "10000000-0000-4000-8000-000000000002";
for (const version of ["1", "9007199254740991", "9007199254740993", "9223372036854775807"]) {
  test(`exact PostgreSQL bigint ${version}`, () => {
    assert.equal(api.offerReadVersion(version), version);
    assert.deepEqual(api.offerReadObservation(user, "customer", offer, version), { userId: user, role: "customer", offerId: offer, version });
    assert.ok(Object.isFrozen(api.offerReadObservation(user, "workshop", offer, version)));
  });
}
for (const value of [1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, BigInt(1), null, undefined, true, {}, [], "", "0", "01", "-1", "1.0", "1e2", " 1", "1\n", "9223372036854775808", "10000000000000000000"]) {
  test(`unsafe/noncanonical version ${String(value)} disables receipt`, () => {
    assert.equal(api.offerReadVersion(value), null);
    assert.equal(api.offerReadObservation(user, "customer", offer, value), null);
  });
}
test("observation cannot bind invalid user, offer or role", () => {
  assert.equal(api.offerReadObservation("invalid", "customer", offer, "1"), null);
  assert.equal(api.offerReadObservation(user, "customer", "invalid", "1"), null);
});
for (const code of ["42703", "PGRST204"]) test(`${code}: only missing version permits read-only compatibility query`, async () => {
  const calls: string[] = [];
  const result = await api.loadWithOfferVersion(async projection => {
    calls.push(projection);
    return projection ? { data: null, error: { code, message: 'column repair_offers.read_state_version does not exist' } }
      : { data: [{ id: offer, price: "150", customer_read_at: null }], error: null };
  });
  assert.deepEqual(calls, [",read_state_version::text", ""]);
  assert.equal(result.data?.[0].price, "150");
  assert.equal(api.offerReadObservation(user, "customer", offer, undefined), null);
});
for (const error of [{ code: "42501", message: "read_state_version" }, { code: "42703", message: "other_column missing" },
  { code: "PGRST204", message: "other_column" }, { code: "57014", message: "timeout" }, { code: "NETWORK", message: "failed" }]) {
  test(`no fallback/retry for ${error.code}/${error.message}`, async () => {
    let calls = 0;
    const result = await api.loadWithOfferVersion(async () => { calls++; return { data: null, error }; });
    assert.equal(result.error, error); assert.equal(calls, 1);
  });
}
test("transport exception is not retried", async () => {
  let calls = 0;
  await assert.rejects(api.loadWithOfferVersion(async () => { calls++; throw new Error("offline"); }));
  assert.equal(calls, 1);
});
test("refresh/reconnect after migration rechecks capability; exact version comes with same displayed row", async () => {
  let installed = false;
  const load = (projection: string) => Promise.resolve(!installed && projection
    ? { data: null, error: { code: "42703", message: "read_state_version missing" } }
    : { data: [{ id: offer, message: installed ? "new contents" : "old contents", read_state_version: installed ? "9007199254740993" : undefined }], error: null });
  assert.equal((await api.loadWithOfferVersion(load)).data?.[0].read_state_version, undefined);
  installed = true;
  const row = (await api.loadWithOfferVersion(load)).data![0];
  assert.equal(row.message, "new contents");
  assert.equal(api.offerReadObservation(user, "customer", row.id, row.read_state_version)?.version, "9007199254740993");
});
