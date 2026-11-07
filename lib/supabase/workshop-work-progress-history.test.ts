import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Read = typeof import("./workshop-work-progress-history").getWorkshopWorkProgressHistory;
const requestId = "a0000000-0000-4000-8000-000000000001";
const id = "b0000000-0000-4000-8000-000000000002";
const row = { id, request_id: requestId, status: "Tinichigerie", message: "  Mesaj\nistoric  ",
  images: ["https://example.invalid/legacy.jpg?x=1", "request/workshop/photo.jpg"],
  created_at: "2026-11-07T10:11:12.123456+00:00" };
type Reply = { data: unknown; error: unknown };
const source = readFileSync(new URL("./workshop-work-progress-history.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function fixture(reply: () => Promise<Reply>) {
  const calls: { name: string; args: unknown }[] = [];
  const supabase = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return reply(); },
    from: () => { throw new Error("Direct table SELECT/fallback forbidden"); } };
  const exported: { getWorkshopWorkProgressHistory?: Read } = {};
  new Function("require", "exports", js)((name: string) => {
    assert.equal(name, "@/lib/supabase/client"); return { supabase };
  }, exported);
  return { read: exported.getWorkshopWorkProgressHistory!, calls };
}
test("exact request RPC preserves all stored fields without URL/stage/date rewriting", async () => {
  const f = fixture(async () => ({ data: [{ ...row, sender_id: "not-needed" }], error: null }));
  assert.deepEqual(await f.read(requestId), [row]);
  assert.deepEqual(f.calls, [{ name: "get_workshop_work_progress_history", args: { p_request_id: requestId } }]);
});
test("server ordering is kept, including timestamp precision and tied records", async () => {
  const data = [row, { ...row, id: requestId, created_at: "2026-11-07T10:11:12.123455+00:00" }];
  const f = fixture(async () => ({ data, error: null })); assert.deepEqual(await f.read(requestId), data);
});
test("authorized empty result is empty, not an authorization error", async () => {
  const f = fixture(async () => ({ data: [], error: null })); assert.deepEqual(await f.read(requestId), []);
});
for (const images of [null, [], [null, "", "  untouched  ", { url: "legacy" }], { legacy: "url" }])
  test(`legacy JSON ${JSON.stringify(images)} and nullable text pass through unchanged`, async () => {
    const data = [{ ...row, status: null, message: null, images }];
    const f = fixture(async () => ({ data, error: null })); assert.deepEqual(await f.read(requestId), data);
  });
for (const [label, data] of Object.entries({
  null: null, object: row, rowString: ["bad"], rowNull: [null], rowArray: [[]],
  wrongId: [{ ...row, id: "bad" }], otherRequest: [{ ...row, request_id: id }],
  missingRequest: [{ ...row, request_id: undefined }], invalidStatus: [{ ...row, status: 2 }],
  missingStatus: [{ ...row, status: undefined }], invalidMessage: [{ ...row, message: {} }],
  missingImages: [{ ...row, images: undefined }], invalidJson: [{ ...row, images: [undefined] }],
  invalidDate: [{ ...row, created_at: "bad" }], missingDate: [{ ...row, created_at: null }],
  duplicate: [row, row], duplicateCase: [row, { ...row, id: id.toUpperCase() }],
})) test(`${label}: invalid response fails without returning partial history or retry`, async () => {
  const f = fixture(async () => ({ data, error: null })); await assert.rejects(f.read(requestId)); assert.equal(f.calls.length, 1);
});
for (const code of ["42501", "PGRST202", "57014"])
  test(`${code}: denied/missing/timed-out RPC is not mistaken for empty history`, async () => {
    const error = { code, message: "Synthetic failure" };
    const f = fixture(async () => ({ data: [], error })); await assert.rejects(f.read(requestId), e => e === error);
    assert.equal(f.calls.length, 1);
  });
test("network failure propagates without retry", async () => {
  const error = new Error("Offline"), f = fixture(async () => { throw error; });
  await assert.rejects(f.read(requestId), e => e === error); assert.equal(f.calls.length, 1);
});
test("invalid request cannot reach RPC", async () => {
  const f = fixture(async () => ({ data: [], error: null })); await assert.rejects(f.read("draft")); assert.deepEqual(f.calls, []);
});
test("UUID case changes only the identity comparison", async () => {
  const f = fixture(async () => ({ data: [row], error: null })); assert.deepEqual(await f.read(requestId.toUpperCase()), [row]);
});
