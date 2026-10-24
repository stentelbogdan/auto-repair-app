import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import * as projectBoundary from "./project-boundary.ts";

// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import { runRepairImageCleanup as runProductionRepairImageCleanup } from "./repair-image-cleanup-worker.ts";
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import * as productionExports from "./repair-image-cleanup-worker.ts";
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import { runRepairImageCleanupCore, type RepairImageCleanupClient } from "./repair-image-cleanup-core.ts";

const LIVE_URL = "https://ouoiykudvcoqbkybkqvs.supabase.co";
const TEST_URL = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const LIVE_REF = "ouoiykudvcoqbkybkqvs";
const TEST_REF = "bstjobvvxxfqqwyjoimx";
const PATH_A = "11111111-1111-4111-8111-111111111111/image-a.jpg";
const PATH_B = "22222222-2222-4222-8222-222222222222/image-b.jpg";
const CLAIM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAIM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-10-24T12:00:00.000Z");

type RpcCall = { name: string; args: Record<string, unknown> };
type Scenario = {
  claims?: Array<{ object_path: string; delete_claim_id: string }>;
  claimError?: unknown;
  revalidationRows?: unknown[][];
  revalidationErrors?: unknown[];
  completionErrors?: unknown[];
  removeErrors?: unknown[];
  presence?: Array<"present" | "absent" | "absent404" | "object-not-found" | "ambiguous" | "unauthorized" | "redirect" | "invalid-json" | "oversized">;
};

function revalidated(path = PATH_A, claim = CLAIM_A, storage = true) {
  return [{
    object_path: path,
    delete_claim_id: claim,
    delete_lease_expires_at: new Date(NOW + 5 * 60_000).toISOString(),
    storage_object_exists: storage,
  }];
}

function jsonResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createScenario(scenario: Scenario = {}) {
  const rpcCalls: RpcCall[] = [];
  const removedPaths: string[][] = [];
  const authorizationHeaders: string[] = [];
  const events: string[] = [];
  let revalidationIndex = 0;
  let completionIndex = 0;
  let removeIndex = 0;
  let presenceIndex = 0;

  const client: RepairImageCleanupClient = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "claim_repair_image_deletions") {
        events.push("claim");
        return {
          data: scenario.claims ?? [{ object_path: PATH_A, delete_claim_id: CLAIM_A }],
          error: scenario.claimError ?? null,
        };
      }
      if (name === "revalidate_repair_image_deletion_claim") {
        events.push("revalidate");
        const error = scenario.revalidationErrors?.[revalidationIndex] ?? null;
        const data = scenario.revalidationRows?.[revalidationIndex] ??
          revalidated(PATH_A, CLAIM_A, revalidationIndex === 0);
        revalidationIndex += 1;
        return { data, error };
      }
      if (name === "complete_repair_image_deletion") {
        events.push(`completion:${String(args.p_deleted)}`);
        const error = scenario.completionErrors?.[completionIndex] ?? null;
        completionIndex += 1;
        return { data: null, error };
      }
      throw new Error("Unexpected RPC.");
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, "repair-images");
        return {
          remove: async (paths) => {
            events.push("delete");
            removedPaths.push(paths);
            const error = scenario.removeErrors?.[removeIndex] ?? null;
            removeIndex += 1;
            return { data: error ? null : [], error };
          },
        };
      },
    },
  };

  const fetchMock: typeof fetch = async (_input, init) => {
    authorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    const presence = scenario.presence?.[presenceIndex] ??
      (presenceIndex === 0 ? "present" : "absent");
    presenceIndex += 1;
    events.push(`get:${presence}`);
    if (presence === "present") {
      return new Response(new Uint8Array([0]), { status: 206 });
    }
    if (presence === "absent") return jsonResponse(400, "NoSuchKey");
    if (presence === "absent404") return jsonResponse(404, "NoSuchKey");
    if (presence === "object-not-found") return jsonResponse(404, "ObjectNotFound");
    if (presence === "redirect") return new Response(null, { status: 302, headers: { location: LIVE_URL } });
    if (presence === "invalid-json") return new Response("not-json", { status: 404 });
    if (presence === "oversized") {
      return new Response(JSON.stringify({ code: "NoSuchKey", padding: "x".repeat(2_000) }), {
        status: 404,
        headers: { "content-length": "2048" },
      });
    }
    if (presence === "unauthorized") return jsonResponse(403, "AccessDenied");
    return jsonResponse(500, "InternalError");
  };

  return { client, fetchMock, rpcCalls, removedPaths, authorizationHeaders, events };
}

async function runRepairImageCleanup(
  client: RepairImageCleanupClient,
  suppliedUrl: string,
  _suppliedProjectRef: string,
  _suppliedVercelEnvironment: string,
  dependencies: {
    fetch?: typeof fetch;
    now?: () => number;
    serviceRoleKey?: string;
    batchLimit?: number;
    rpcTimeoutMs?: number;
    storageTimeoutMs?: number;
  } = {},
) {
  const { serviceRoleKey = "", ...coreDependencies } = dependencies;
  const { fetch: fetchMock, ...options } = coreDependencies;
  return runRepairImageCleanupCore({ client, dependencies: {
    ...options,
    getObject: (path, signal) => {
      if (!fetchMock) throw new Error("A local GET mock is required.");
      return fetchMock(`${suppliedUrl}/${path}`, {
        signal,
        headers: { Authorization: `Bearer ${serviceRoleKey}` },
      });
    },
  } });
}

async function runScenario(scenario: Scenario = {}) {
  const mocks = createScenario(scenario);
  const result = await runRepairImageCleanup(
    mocks.client,
    LIVE_URL,
    LIVE_REF,
    "production",
    {
      fetch: mocks.fetchMock,
      now: () => NOW,
      serviceRoleKey: "mock-service-role-key",
      batchLimit: 3,
      rpcTimeoutMs: 2_000,
      storageTimeoutMs: 2_000,
    },
  );
  return { ...mocks, result };
}

test("revalidates immediately before DELETE and again before completion(true)", async () => {
  const { result, rpcCalls, removedPaths, events } = await runScenario();
  assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });
  assert.deepEqual(removedPaths, [[PATH_A]]);
  assert.deepEqual(rpcCalls.map(({ name }) => name), [
    "claim_repair_image_deletions",
    "revalidate_repair_image_deletion_claim",
    "revalidate_repair_image_deletion_claim",
    "complete_repair_image_deletion",
  ]);
  assert.equal(rpcCalls.at(-1)?.args.p_deleted, true);
  assert.deepEqual(events, ["claim", "revalidate", "get:present", "delete", "get:absent", "revalidate", "completion:true"]);
});

test("a refused revalidation stops before Storage and completion", async () => {
  const { result, rpcCalls, removedPaths } = await runScenario({
    revalidationErrors: [{ code: "23514" }],
  });
  assert.deepEqual(result, { claimed: 1, deleted: 0, failed: 1 });
  assert.deepEqual(removedPaths, []);
  assert.equal(rpcCalls.length, 2);
});

test("an active-reference rejection remains fail-closed", async () => {
  const { result, removedPaths } = await runScenario({
    revalidationErrors: [{ code: "23514", message: "active reference" }],
  });
  assert.equal(result.failed, 1);
  assert.deepEqual(removedPaths, []);
});

test("a lease that is expired or too near expiry is refused", async () => {
  for (const expiry of [NOW - 1, NOW + 29_999]) {
    const { result, removedPaths } = await runScenario({
      revalidationRows: [[{
        object_path: PATH_A,
        delete_claim_id: CLAIM_A,
        delete_lease_expires_at: new Date(expiry).toISOString(),
        storage_object_exists: true,
      }]],
    });
    assert.equal(result.failed, 1);
    assert.deepEqual(removedPaths, []);
  }
});

test("a different claim ID or path is rejected", async () => {
  for (const row of [
    revalidated(PATH_A, CLAIM_B, true),
    revalidated(PATH_B, CLAIM_A, true),
  ]) {
    const { result, removedPaths } = await runScenario({ revalidationRows: [row] });
    assert.equal(result.failed, 1);
    assert.deepEqual(removedPaths, []);
  }
});

test("an incomplete or multiple-row revalidation response is rejected", async () => {
  for (const rows of [[], [{}], [...revalidated(), ...revalidated()]]) {
    const { result, removedPaths } = await runScenario({
      revalidationRows: [rows],
    });
    assert.equal(result.failed, 1);
    assert.deepEqual(removedPaths, []);
  }
});

test("a successful DELETE requires confirmed post-delete absence", async () => {
  const { result, rpcCalls } = await runScenario({
    presence: ["present", "ambiguous"],
  });
  assert.equal(result.failed, 1);
  assert.equal(rpcCalls.some(({ name }) => name === "complete_repair_image_deletion"), false);
});

test("a confirmed NoSuchKey DELETE still requires an independent absence check", async () => {
  const { result, rpcCalls } = await runScenario({
    removeErrors: [{ status: 404, code: "NoSuchKey" }],
    presence: ["present", "absent"],
  });
  assert.equal(result.deleted, 1);
  assert.equal(rpcCalls.at(-1)?.args.p_deleted, true);
});

test("registry and physical Storage contradictions stop without completion", async () => {
  for (const scenario of [
    {
      revalidationRows: [revalidated(PATH_A, CLAIM_A, false)],
      presence: ["present"] as Scenario["presence"],
    },
    {
      revalidationRows: [revalidated(PATH_A, CLAIM_A, true)],
      presence: ["absent"] as Scenario["presence"],
    },
  ]) {
    const { result, rpcCalls, removedPaths } = await runScenario(scenario);
    assert.equal(result.failed, 1);
    assert.deepEqual(removedPaths, []);
    assert.equal(
      rpcCalls.some(({ name }) => name === "complete_repair_image_deletion"),
      false,
    );
  }
});

test("an already absent object is completed without another DELETE", async () => {
  const { result, removedPaths, rpcCalls } = await runScenario({
    revalidationRows: [
      revalidated(PATH_A, CLAIM_A, false),
      revalidated(PATH_A, CLAIM_A, false),
    ],
    presence: ["absent", "absent"],
  });
  assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });
  assert.deepEqual(removedPaths, []);
  assert.equal(rpcCalls.at(-1)?.args.p_deleted, true);
});

test("HTTP 400/404 NoSuchKey is absent but other 400 responses are ambiguous", async () => {
  const confirmed = await runScenario({
    revalidationRows: [
      revalidated(PATH_A, CLAIM_A, false),
      revalidated(PATH_A, CLAIM_A, false),
    ],
    presence: ["absent", "absent"],
  });
  assert.equal(confirmed.result.deleted, 1);

  const ambiguous = createScenario({
    revalidationRows: [revalidated(PATH_A, CLAIM_A, false)],
  });
  const invalidRequestFetch: typeof fetch = async () =>
    jsonResponse(400, "InvalidRequest");
  const result = await runRepairImageCleanup(
    ambiguous.client,
    LIVE_URL,
    LIVE_REF,
    "production",
    {
      fetch: invalidRequestFetch,
      now: () => NOW,
      serviceRoleKey: "mock-service-role-key",
      rpcTimeoutMs: 2_000,
      storageTimeoutMs: 2_000,
    },
  );
  assert.equal(result.failed, 1);
  assert.deepEqual(ambiguous.removedPaths, []);

  const wrongStatus = createScenario({
    revalidationRows: [revalidated(PATH_A, CLAIM_A, false)],
  });
  const wrongStatusResult = await runRepairImageCleanup(
    wrongStatus.client,
    LIVE_URL,
    LIVE_REF,
    "production",
    {
      fetch: async () => jsonResponse(500, "NoSuchKey"),
      now: () => NOW,
      serviceRoleKey: "mock-service-role-key",
      rpcTimeoutMs: 2_000,
      storageTimeoutMs: 2_000,
    },
  );
  assert.equal(wrongStatusResult.failed, 1);
  assert.deepEqual(wrongStatus.removedPaths, []);
});

test("401/403 and network failures in existence checks are fail-closed", async () => {
  for (const fetchMock of [
    async () => jsonResponse(401, "Unauthorized"),
    async () => jsonResponse(403, "AccessDenied"),
    async () => { throw new Error("network unavailable"); },
  ] satisfies Array<typeof fetch>) {
    const mocks = createScenario();
    const result = await runRepairImageCleanup(
      mocks.client,
      LIVE_URL,
      LIVE_REF,
      "production",
      {
        fetch: fetchMock,
        now: () => NOW,
        serviceRoleKey: "mock-service-role-key",
        rpcTimeoutMs: 2_000,
        storageTimeoutMs: 2_000,
      },
    );
    assert.equal(result.failed, 1);
    assert.deepEqual(mocks.removedPaths, []);
  }
});

test("a rejected DELETE preserves the claim because the remote result is not proven", async () => {
  const { result, rpcCalls, events } = await runScenario({
    removeErrors: [{ status: 403, code: "AccessDenied" }],
    presence: ["present"],
  });
  assert.equal(result.failed, 1);
  assert.equal(rpcCalls.some(({ name }) => name === "complete_repair_image_deletion"), false);
  assert.deepEqual(events, ["claim", "revalidate", "get:present", "delete"]);
});

test("network and ambiguous DELETE errors preserve the claim for recovery", async () => {
  for (const error of [new Error("network unavailable"), { status: 400, code: "InvalidRequest" }]) {
    const { result, rpcCalls } = await runScenario({
      removeErrors: [error],
      presence: ["present"],
    });
    assert.equal(result.failed, 1);
    assert.equal(rpcCalls.some(({ name }) => name === "complete_repair_image_deletion"), false);
  }
});

test("a completion(true) failure is retained for idempotent recovery", async () => {
  const { result, rpcCalls } = await runScenario({
    completionErrors: [{ code: "network" }],
  });
  assert.deepEqual(result, { claimed: 1, deleted: 0, failed: 1 });
  assert.equal(rpcCalls.at(-1)?.args.p_deleted, true);
});

test("a retry completes an already absent object idempotently", async () => {
  const { result, removedPaths } = await runScenario({
    revalidationRows: [
      revalidated(PATH_A, CLAIM_A, false),
      revalidated(PATH_A, CLAIM_A, false),
    ],
    presence: ["absent", "absent"],
  });
  assert.equal(result.deleted, 1);
  assert.deepEqual(removedPaths, []);
});

test("a partial batch isolates one failed object", async () => {
  const mocks = createScenario({
    claims: [
      { object_path: PATH_A, delete_claim_id: CLAIM_A },
      { object_path: PATH_B, delete_claim_id: CLAIM_B },
    ],
    revalidationRows: [
      revalidated(PATH_A, CLAIM_A, true),
      revalidated(PATH_A, CLAIM_A, false),
      [],
    ],
    presence: ["present", "absent"],
  });
  const result = await runRepairImageCleanup(
    mocks.client,
    LIVE_URL,
    LIVE_REF,
    "production",
    {
      fetch: mocks.fetchMock,
      now: () => NOW,
      serviceRoleKey: "mock-service-role-key",
      rpcTimeoutMs: 2_000,
      storageTimeoutMs: 2_000,
    },
  );
  assert.deepEqual(result, { claimed: 2, deleted: 1, failed: 1 });
  assert.deepEqual(mocks.removedPaths, [[PATH_A]]);
});

test("claim responses with malformed or duplicate entries fail before Storage", async () => {
  for (const claims of [
    [{ object_path: "unsafe/path", delete_claim_id: CLAIM_A }],
    [
      { object_path: PATH_A, delete_claim_id: CLAIM_A },
      { object_path: PATH_A, delete_claim_id: CLAIM_B },
    ],
  ]) {
    const mocks = createScenario({ claims });
    await assert.rejects(
      runRepairImageCleanup(mocks.client, LIVE_URL, LIVE_REF, "production", {
        fetch: mocks.fetchMock,
        now: () => NOW,
        serviceRoleKey: "mock-service-role-key",
      }),
      /claim response is (invalid|ambiguous)/,
    );
    assert.deepEqual(mocks.removedPaths, []);
  }
});

test("missing RPC error fields and oversized batches are rejected", async () => {
  const missingError = createScenario();
  missingError.client.rpc = async () => ({ data: [], error: undefined });
  await assert.rejects(
    runRepairImageCleanup(
      missingError.client,
      LIVE_URL,
      LIVE_REF,
      "production",
      { serviceRoleKey: "mock-service-role-key" },
    ),
    /claim failed/,
  );

  const oversized = createScenario();
  await assert.rejects(
    runRepairImageCleanup(oversized.client, LIVE_URL, LIVE_REF, "production", {
      serviceRoleKey: "mock-service-role-key",
      batchLimit: 4,
    }),
    /batch limit is invalid/,
  );
  assert.deepEqual(oversized.rpcCalls, []);
});

test("the production module exposes only the zero-argument entrypoint", () => {
  assert.deepEqual(Object.keys(productionExports), ["runRepairImageCleanup"]);
  assert.equal(runProductionRepairImageCleanup.length, 0);
});

test("final revalidation rejects a lost or replaced claim", async () => {
  for (const finalRows of [[], revalidated(PATH_A, CLAIM_B, false), revalidated(PATH_B, CLAIM_A, false)]) {
    const { result, events } = await runScenario({ revalidationRows: [revalidated(PATH_A, CLAIM_A, true), finalRows] });
    assert.equal(result.failed, 1);
    assert.equal(events.at(-1), "revalidate");
    assert.equal(events.includes("completion:true"), false);
  }
});

test("final revalidation rejects storage_object_exists=true", async () => {
  const { result, events } = await runScenario({
    revalidationRows: [revalidated(PATH_A, CLAIM_A, true), revalidated(PATH_A, CLAIM_A, true)],
  });
  assert.equal(result.failed, 1);
  assert.equal(events.at(-1), "revalidate");
});

test("final revalidation rejects an expired or short lease", async () => {
  for (const expiry of [NOW - 1, NOW + 29_999]) {
    const finalRow = [{ object_path: PATH_A, delete_claim_id: CLAIM_A, delete_lease_expires_at: new Date(expiry).toISOString(), storage_object_exists: false }];
    const { result, events } = await runScenario({ revalidationRows: [revalidated(PATH_A, CLAIM_A, true), finalRow] });
    assert.equal(result.failed, 1);
    assert.equal(events.at(-1), "revalidate");
  }
});

test("final revalidation rejects multiple rows", async () => {
  const finalRows = [...revalidated(PATH_A, CLAIM_A, false), ...revalidated(PATH_A, CLAIM_A, false)];
  const { result, events } = await runScenario({ revalidationRows: [revalidated(PATH_A, CLAIM_A, true), finalRows] });
  assert.equal(result.failed, 1);
  assert.equal(events.at(-1), "revalidate");
});

test("redirects, invalid JSON, and oversized error bodies remain ambiguous", async () => {
  for (const presence of ["redirect", "invalid-json", "oversized"] as const) {
    const { result, events } = await runScenario({
      revalidationRows: [revalidated(PATH_A, CLAIM_A, false)],
      presence: [presence],
    });
    assert.equal(result.failed, 1);
    assert.equal(events.includes("delete"), false);
    assert.equal(events.some((event) => event.startsWith("completion")), false);
  }
});

test("GET 404 NoSuchKey and ObjectNotFound are confirmed absent", async () => {
  for (const presence of ["absent404", "object-not-found"] as const) {
    const { result, removedPaths } = await runScenario({
      revalidationRows: [revalidated(PATH_A, CLAIM_A, false), revalidated(PATH_A, CLAIM_A, false)],
      presence: [presence, presence],
    });
    assert.equal(result.deleted, 1);
    assert.deepEqual(removedPaths, []);
  }
});

test("a remote DELETE continuing after local timeout remains ambiguous", async () => {
  const mocks = createScenario({ presence: ["present"] });
  mocks.client.storage.from = () => ({ remove: async () => {
    mocks.events.push("delete");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    mocks.events.push("delete:remote-resolved");
    return { data: [], error: null };
  } });
  const result = await runRepairImageCleanup(mocks.client, LIVE_URL, LIVE_REF, "production", {
    fetch: mocks.fetchMock, now: () => NOW, serviceRoleKey: "mock-service-role-key", rpcTimeoutMs: 1_000, storageTimeoutMs: 1_000,
  });
  assert.equal(result.failed, 1);
  assert.deepEqual(mocks.events, ["claim", "revalidate", "get:present", "delete"]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(mocks.events.at(-1), "delete:remote-resolved");
  assert.equal(mocks.events.some((event) => event.startsWith("completion")), false);
});

test("a completion resolving after timeout is not retried or reported successful", async () => {
  const mocks = createScenario();
  const originalRpc = mocks.client.rpc.bind(mocks.client);
  mocks.client.rpc = async (name, args) => {
    if (name !== "complete_repair_image_deletion") return originalRpc(name, args);
    mocks.events.push("completion:true");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    mocks.events.push("completion:remote-resolved");
    return { data: null, error: null };
  };
  const result = await runRepairImageCleanup(mocks.client, LIVE_URL, LIVE_REF, "production", {
    fetch: mocks.fetchMock, now: () => NOW, serviceRoleKey: "mock-service-role-key", rpcTimeoutMs: 1_000, storageTimeoutMs: 1_000,
  });
  assert.equal(result.failed, 1);
  assert.equal(mocks.events.filter((event) => event === "completion:true").length, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(mocks.events.at(-1), "completion:remote-resolved");
});

test("the public entrypoint cannot use an injected client or configuration", async () => {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    REPAIR_IMAGE_CLEANUP_PROJECT_REF: process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF,
    VERCEL_ENV: process.env.VERCEL_ENV,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const mocks = createScenario();
  try {
    process.env.SUPABASE_URL = TEST_URL;
    process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF = "bstjobvvxxfqqwyjoimx";
    process.env.VERCEL_ENV = "preview";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const callable = runProductionRepairImageCleanup as unknown as (...args: unknown[]) => Promise<unknown>;
    await assert.rejects(callable(mocks.client, LIVE_URL, LIVE_REF, "production", { serviceRoleKey: "injected-key" }), /disabled in Preview/);
    assert.deepEqual(mocks.rpcCalls, []);
  } finally {
    restoreEnvironment(previous);
  }
});

test("deployment boundary rejects every environment/project mismatch", async () => {
  for (const [url, project, environment] of [
    [TEST_URL, TEST_REF, "preview"],
    [TEST_URL, TEST_REF, "production"],
    [LIVE_URL, LIVE_REF, "preview"],
    [LIVE_URL, LIVE_REF, "development"],
    [LIVE_URL, LIVE_REF, "unknown"],
  ]) {
    await assertBlockedProduction(url, project, environment);
  }
  // Valid LIVE configuration reaches the credential check, without constructing a client.
  await assertBlockedProduction(LIVE_URL, LIVE_REF, "production", /credentials are missing/);
});

test("no injectable harness is exported even in NODE_ENV=test", () => {
  assert.equal("repairImageCleanupTestHarness" in productionExports, false);
  const source = readFileSync(new URL("./repair-image-cleanup-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|createClient|serviceRoleKey|SUPABASE_|\bfetch\s*\(/);
});

test("the unconditional server guard cannot be bypassed by arguments", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const mocks = createScenario();
  try {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    const callable = runProductionRepairImageCleanup as unknown as (...args: unknown[]) => Promise<unknown>;
    await assert.rejects(callable(mocks.client, LIVE_URL, LIVE_REF, "production", { serviceRoleKey: "injected-key" }), /server runtime/);
    assert.deepEqual(mocks.rpcCalls, []);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("approved URLs reject redirects, credentials, ports, and lookalike hosts", async () => {
  for (const url of [
    `${LIVE_URL}?redirect=elsewhere`,
    `https://${LIVE_REF}.supabase.co.example.com`,
    `https://${LIVE_REF}.supabase.co:8443`,
    `https://user:secret@${LIVE_REF}.supabase.co`,
  ]) {
    await assertBlockedProduction(url, LIVE_REF, "production", /endpoint|URL|mismatch/);
  }
});

test("the key is sent only in request headers and never returned", async () => {
  // Execute the actual worker source with a closed import map and mock transports.
  // No real Supabase factory or network implementation is available in this context.
  const source = readFileSync(new URL("./repair-image-cleanup-worker.ts", import.meta.url), "utf8");
  const mocks = createScenario();
  const exports: { runRepairImageCleanup?: () => Promise<unknown> } = {};
  let clientsCreated = 0;
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    process: { env: {
      SUPABASE_URL: LIVE_URL, REPAIR_IMAGE_CLEANUP_PROJECT_REF: LIVE_REF,
      VERCEL_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key",
    } },
    require: (name: string) => {
      if (name === "./project-boundary.ts") return projectBoundary;
      if (name === "./repair-image-cleanup-core.ts") return {
        runRepairImageCleanupCore: (input: Parameters<typeof runRepairImageCleanupCore>[0]) =>
          runRepairImageCleanupCore({ ...input, dependencies: { ...input.dependencies, now: () => NOW } }),
      };
      if (name === "@supabase/supabase-js") return {
        createClient: (url: string, key: string) => {
          assert.equal(url, LIVE_URL);
          assert.equal(key, "mock-service-role-key");
          clientsCreated += 1;
          return mocks.client;
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
    fetch: (url: string, init: RequestInit) => {
      assert.equal(url, `${LIVE_URL}/storage/v1/object/authenticated/repair-images/${PATH_A}`);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(new Headers(init.headers).get("apikey"), "mock-service-role-key");
      assert.equal(new Headers(init.headers).get("range"), "bytes=0-0");
      assert.ok(init.signal);
      return mocks.fetchMock(url, init);
    },
  });
  assert.ok(exports.runRepairImageCleanup);
  const result = await exports.runRepairImageCleanup();
  assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });
  assert.equal(clientsCreated, 1);
  assert.deepEqual(mocks.authorizationHeaders, [
    "Bearer mock-service-role-key",
    "Bearer mock-service-role-key",
  ]);
  assert.equal(JSON.stringify(result).includes("mock-service-role-key"), false);
});

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function assertBlockedProduction(
  url: string, project: string, environment: string, expected?: RegExp,
): Promise<void> {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    REPAIR_IMAGE_CLEANUP_PROJECT_REF: process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF,
    VERCEL_ENV: process.env.VERCEL_ENV,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      SUPABASE_URL: url, REPAIR_IMAGE_CLEANUP_PROJECT_REF: project, VERCEL_ENV: environment,
    });
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalThis.fetch = async () => { throw new Error("External access forbidden in tests."); };
    await assert.rejects(runProductionRepairImageCleanup, expected ?? /Preview|Production|LIVE|TEST/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
}

test("an RPC error at the second revalidation preserves the claim without completion or retry", async () => {
  const { result, events, removedPaths } = await runScenario({
    revalidationErrors: [null, { code: "23514", message: "ownership lost" }],
  });
  assert.deepEqual(result, { claimed: 1, deleted: 0, failed: 1 });
  assert.deepEqual(events, ["claim", "revalidate", "get:present", "delete", "get:absent", "revalidate"]);
  assert.deepEqual(removedPaths, [[PATH_A]]);
});
