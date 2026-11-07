import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Save = typeof import("./work-progress").saveWorkProgressUpdate;
type Input = Parameters<Save>[0];
type Reply = { data: unknown; error: unknown };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const input: Input = {
  requestId: "10000000-0000-4000-8000-000000000001",
  senderId: "20000000-0000-4000-8000-000000000002",
  status: "Received", message: "  Mesaj sintetic\ncu detalii  ",
  images: ["https://example.invalid/work-progress/reference.jpg"],
};
function fixture(reply?: (args: Record<string, unknown>) => Promise<Reply>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return reply ? reply(args) : { data: [{ id: input.requestId,
        status: args.p_status === "Ready" ? "completed" : "in_progress" }], error: null };
    },
    from: () => { throw new Error("Direct query/fallback/compensation forbidden"); },
  };
  const modules: Record<string, unknown> = { "@/lib/supabase/client": { supabase } };
  const paths: Record<string, string> = {
    "@/lib/work-progress/workflows": "../work-progress/workflows.ts",
    "@/lib/repair-requests/service-types": "../repair-requests/service-types.ts",
  };
  function load(name: string): unknown {
    if (name in modules) return modules[name];
    assert.ok(paths[name]); const exported = {};
    new Function("require", "exports", compile(read(paths[name])))(load, exported);
    modules[name] = exported; return exported;
  }
  const exported: { saveWorkProgressUpdate?: Save } = {};
  new Function("require", "exports", compile(read("./work-progress.ts")))(load, exported);
  return { save: exported.saveWorkProgressUpdate!, calls };
}

test("one atomic RPC preserves messages/images and the existing result shape", async () => {
  const f = fixture(); assert.deepEqual(await f.save(input), { id: input.requestId, status: "in_progress" });
  assert.deepEqual(f.calls, [{ name: "save_work_progress_update", args: {
    p_request_id: input.requestId, p_status: "Received", p_message: input.message, p_images: input.images,
  } }]);
});
test("senderId is not authority and is never sent to the RPC", async () => {
  const f = fixture(); await f.save(input); await f.save({ ...input, senderId: "untrusted-id" });
  assert.deepEqual(f.calls[0], f.calls[1]);
});
test("Clock empty message/images stay valid", async () => {
  const f = fixture(); await f.save({ ...input, message: "", images: [] });
  assert.equal(f.calls[0].args.p_message, ""); assert.deepEqual(f.calls[0].args.p_images, []);
});
for (const stage of ["Received", "Painting", "Diagnosis", "Wheel / Tire service", "Dispatch", "Vehicle picked up"])
  test(`${stage}: canonical workflow stage reaches the atomic contract`, async () => {
    const f = fixture(); await f.save({ ...input, status: stage }); assert.equal(f.calls[0].args.p_status, stage);
  });
for (const stage of ["Ready", "Gata"])
  test(`${stage}: completion requires persistent completed result`, async () => {
    const f = fixture(); assert.equal((await f.save({ ...input, status: stage })).status, "completed");
    assert.equal(f.calls[0].args.p_status, "Ready");
    const wrong = fixture(async () => ({ data: [{ id: input.requestId, status: "in_progress" }], error: null }));
    await assert.rejects(wrong.save({ ...input, status: stage }));
  });
for (const [name, patch] of Object.entries({
  request: { requestId: "wrong" }, stage: { status: "completed" }, message: { message: null },
  images: { images: {} }, nullImage: { images: [null] }, emptyImage: { images: [" "] },
})) test(`${name}: invalid input never invokes RPC`, async () => {
  const f = fixture(); await assert.rejects(f.save({ ...input, ...patch } as Input)); assert.deepEqual(f.calls, []);
});
for (const [name, data] of Object.entries({
  absent: null, zero: [], many: [{ id: input.requestId, status: "in_progress" }, { id: input.requestId, status: "in_progress" }],
  object: { id: input.requestId, status: "in_progress" }, malformed: ["wrong"], missingStatus: [{ id: input.requestId }],
  wrongId: [{ id: input.senderId, status: "in_progress" }], wrongStatus: [{ id: input.requestId, status: "matched" }],
})) test(`${name}: no false success, follow-up read or retry`, async () => {
  const f = fixture(async () => ({ data, error: null })); await assert.rejects(f.save(input)); assert.equal(f.calls.length, 1);
});
for (const code of ["42501", "23514", "P0001", "PGRST202", "40P01", "57014"])
  test(`${code}: server/trigger/transport failures propagate without split writes or retry`, async () => {
    const error = { code, message: "Synthetic failure" };
    const f = fixture(async () => ({ data: null, error }));
    await assert.rejects(f.save(input), value => value === error); assert.equal(f.calls.length, 1);
  });
test("rejected network promise is not retried", async () => {
  const error = new Error("Offline failure"), f = fixture(async () => { throw error; });
  await assert.rejects(f.save(input), value => value === error); assert.equal(f.calls.length, 1);
});
test("no success is returned before the server reply", async () => {
  let finish!: (reply: Reply) => void, resolved = false;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.save(input).then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false);
  finish({ data: [{ id: input.requestId, status: "in_progress" }], error: null });
  await pending; assert.equal(resolved, true);
});
