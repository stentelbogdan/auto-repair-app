import assert from "node:assert/strict";
import test from "node:test";
// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import { handleRepairImageCleanupRequest } from "./repair-image-cleanup-route.ts";

const URL = "https://local.invalid/api/internal/repair-image-cleanup";
const SECRET = "local-test-cron-secret";

function request(token?: string): Request {
  return new Request(URL, {
    headers: token === undefined ? undefined : { authorization: `Bearer ${token}` },
  });
}

test("rejects a request without an authorization token", async () => {
  let calls = 0;
  const response = await handleRepairImageCleanupRequest(
    request(),
    async () => {
      calls += 1;
      return { claimed: 0, deleted: 0, failed: 0 };
    },
    SECRET,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(calls, 0);
});

test("rejects an incorrect authorization token", async () => {
  let calls = 0;
  const response = await handleRepairImageCleanupRequest(
    request("incorrect-secret"),
    async () => {
      calls += 1;
      return { claimed: 0, deleted: 0, failed: 0 };
    },
    SECRET,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(calls, 0);
});

test("rejects every token when CRON_SECRET is missing", async () => {
  let calls = 0;
  const response = await handleRepairImageCleanupRequest(
    request(SECRET),
    async () => {
      calls += 1;
      return { claimed: 0, deleted: 0, failed: 0 };
    },
    undefined,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(calls, 0);
});

test("runs cleanup once for the exact CRON_SECRET", async () => {
  let calls = 0;
  const response = await handleRepairImageCleanupRequest(
    request(SECRET),
    async () => {
      calls += 1;
      return { claimed: 1, deleted: 1, failed: 0 };
    },
    SECRET,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: 1, deleted: 1, failed: 0 });
  assert.equal(calls, 1);
});

test("returns a generic error without disclosing the secret", async () => {
  const logs: string[] = [];
  const response = await handleRepairImageCleanupRequest(
    request(SECRET),
    async () => {
      throw new Error(`internal failure containing ${SECRET}`);
    },
    SECRET,
    (message) => logs.push(message),
  );

  assert.equal(response.status, 500);
  const body = JSON.stringify(await response.json());
  assert.equal(body.includes(SECRET), false);
  assert.deepEqual(JSON.parse(body), { error: "Cleanup failed" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes(SECRET), false);
  assert.match(logs[0], /\[REDACTED\]/);
});
