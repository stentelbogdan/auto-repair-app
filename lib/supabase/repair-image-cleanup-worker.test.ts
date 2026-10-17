import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import { assertApprovedRepairImageCleanupUrl, runRepairImageCleanup } from "./repair-image-cleanup-worker.ts";

const TEST_URL = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const LIVE_URL = "https://ouoiykudvcoqbkybkqvs.supabase.co";
const TEST_PROJECT_REF = "bstjobvvxxfqqwyjoimx";
const LIVE_PROJECT_REF = "ouoiykudvcoqbkybkqvs";

type RpcCall = { name: string; args: Record<string, unknown> };

function mockClient(options: { storageFails?: boolean } = {}) {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "claim_repair_image_deletions") {
        return {
          data: [{ object_path: "owner/image.jpg", delete_claim_id: "claim-id" }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, "repair-images");
        return {
          remove: async (paths: string[]) => {
            assert.deepEqual(paths, ["owner/image.jpg"]);
            return {
              data: options.storageFails ? null : [],
              error: options.storageFails ? new Error("Storage unavailable") : null,
            };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls };
}

test("records a successful Storage API deletion", async () => {
  const { client, rpcCalls } = mockClient();
  const result = await runRepairImageCleanup(client, TEST_URL, TEST_PROJECT_REF);

  assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });
  assert.deepEqual(rpcCalls.at(-1), {
    name: "complete_repair_image_deletion",
    args: {
      p_object_path: "owner/image.jpg",
      p_delete_claim_id: "claim-id",
      p_deleted: true,
    },
  });
});

test("returns a failed deletion to the retry queue", async () => {
  const { client, rpcCalls } = mockClient({ storageFails: true });
  const result = await runRepairImageCleanup(client, TEST_URL, TEST_PROJECT_REF);

  assert.deepEqual(result, { claimed: 1, deleted: 0, failed: 1 });
  assert.equal(rpcCalls.at(-1)?.args.p_deleted, false);
});

test("accepts the exact endpoint for an explicitly approved project", () => {
  assert.doesNotThrow(() =>
    assertApprovedRepairImageCleanupUrl(TEST_URL, TEST_PROJECT_REF),
  );
  assert.doesNotThrow(() =>
    assertApprovedRepairImageCleanupUrl(`${TEST_URL}/`, TEST_PROJECT_REF),
  );
  assert.doesNotThrow(() =>
    assertApprovedRepairImageCleanupUrl(LIVE_URL, LIVE_PROJECT_REF),
  );
});

test("rejects a URL that does not match the configured project before cleanup", async () => {
  const { client, rpcCalls } = mockClient();

  await assert.rejects(
    runRepairImageCleanup(client, LIVE_URL, TEST_PROJECT_REF),
    /does not match the approved server-side project/,
  );
  assert.deepEqual(rpcCalls, []);
});

test("rejects endpoint redirection parameters and lookalike hosts", () => {
  for (const url of [
    `${TEST_URL}?redirect=elsewhere`,
    `https://${TEST_URL.slice("https://".length)}.example.com`,
    `https://${TEST_URL.slice("https://".length)}:8443`,
    `https://user:secret@${TEST_URL.slice("https://".length)}`,
  ]) {
    assert.throws(
      () => assertApprovedRepairImageCleanupUrl(url, TEST_PROJECT_REF),
      /does not match the approved server-side project/,
    );
  }
});

test("rejects an unapproved project reference before any cleanup call", async () => {
  const { client, rpcCalls } = mockClient();

  await assert.rejects(
    runRepairImageCleanup(client, TEST_URL, "unapproved-project"),
    /project is not approved/,
  );
  assert.deepEqual(rpcCalls, []);
});

test("fails closed when the server-side project is not configured", () => {
  const previousProjectRef = process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF;
  delete process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF;

  try {
    assert.throws(
      () => assertApprovedRepairImageCleanupUrl(TEST_URL),
      /project is not approved/,
    );
  } finally {
    if (previousProjectRef === undefined) {
      delete process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF;
    } else {
      process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF = previousProjectRef;
    }
  }
});
