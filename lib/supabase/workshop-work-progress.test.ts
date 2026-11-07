import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Read = typeof import("./workshop-work-progress").getWorkshopLatestWorkProgress;
const id = "a0000000-0000-4000-8000-000000000001";
const other = "b0000000-0000-4000-8000-000000000002";
type Reply = { data: unknown; error: unknown };
const source = readFileSync(new URL("./workshop-work-progress.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function fixture(reply: () => Promise<Reply>) {
  const calls: { name: string; args: unknown }[] = [];
  const supabase = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return reply(); },
    from: () => { throw new Error("Direct SELECT/fallback forbidden"); } };
  const exported: { getWorkshopLatestWorkProgress?: Read } = {};
  new Function("require", "exports", js)((name: string) => {
    assert.equal(name, "@/lib/supabase/client"); return { supabase };
  }, exported);
  return { read: exported.getWorkshopLatestWorkProgress!, calls };
}
for (const status of ["Painting", "Diagnosis", "Wheel / Tire service", "Dispatch", "Ready", "Gata"])
  test(`${status}: exact stored stage and request identity, no normalization or sensitive fields`, async () => {
    const f = fixture(async () => ({ data: [{ request_id: id, status, ignored: "unused" }], error: null }));
    assert.deepEqual(await f.read(id), { request_id: id, status });
    assert.deepEqual(f.calls, [{ name: "get_workshop_latest_work_progress", args: { p_request_id: id } }]);
  });
test("authorized empty history returns null", async () => {
  const f = fixture(async () => ({ data: [], error: null })); assert.equal(await f.read(id), null);
});
for (const [label, data] of Object.entries({
  null: null, object: {}, rowString: ["invalid"], rowNull: [null], arrayRow: [[]],
  multiple: [{ request_id: id, status: "Ready" }, { request_id: id, status: "Received" }],
  wrongRequest: [{ request_id: other, status: "Received" }], missingRequest: [{ status: "Ready" }],
  missingStatus: [{ request_id: id }], nullStatus: [{ request_id: id, status: null }],
  numberStatus: [{ request_id: id, status: 3 }], emptyStatus: [{ request_id: id, status: " " }],
})) test(`${label}: malformed response rejects without fallback/retry`, async () => {
  const f = fixture(async () => ({ data, error: null })); await assert.rejects(f.read(id)); assert.equal(f.calls.length, 1);
});
for (const code of ["42501", "PGRST202", "57014"])
  test(`${code}: error wins over response data and is not mistaken for empty history`, async () => {
    const error = { code, message: "Synthetic failure" };
    const f = fixture(async () => ({ data: [], error }));
    await assert.rejects(f.read(id), e => e === error); assert.equal(f.calls.length, 1);
  });
test("network failure propagates without retry", async () => {
  const error = new Error("Offline failure"), f = fixture(async () => { throw error; });
  await assert.rejects(f.read(id), e => e === error); assert.equal(f.calls.length, 1);
});
test("invalid request ID is rejected before RPC", async () => {
  const f = fixture(async () => ({ data: [], error: null })); await assert.rejects(f.read("draft")); assert.deepEqual(f.calls, []);
});
test("UUID case is canonicalized only for response comparison", async () => {
  const f = fixture(async () => ({ data: [{ request_id: id, status: "Received" }], error: null }));
  assert.deepEqual(await f.read(id.toUpperCase()), { request_id: id, status: "Received" });
});
