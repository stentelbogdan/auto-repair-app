import assert from "node:assert/strict";
import test from "node:test";

// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import { LIVE_SUPABASE_PROJECT_REF, TEST_SUPABASE_PROJECT_REF, assertSupabaseDeploymentBoundary, assertSupabaseProjectUrl } from "./project-boundary.ts";

const TEST_URL = `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`;
const LIVE_URL = `https://${LIVE_SUPABASE_PROJECT_REF}.supabase.co`;

test("allows Preview only with Supabase TEST", () => {
  assert.doesNotThrow(() =>
    assertSupabaseDeploymentBoundary({
      url: TEST_URL,
      vercelEnvironment: "preview",
      bundledExpectedProjectRef: TEST_SUPABASE_PROJECT_REF,
    }),
  );
  assert.throws(
    () =>
      assertSupabaseDeploymentBoundary({
        url: LIVE_URL,
        vercelEnvironment: "preview",
        bundledExpectedProjectRef: TEST_SUPABASE_PROJECT_REF,
      }),
    /project mismatch/,
  );
});

test("allows Production only with Supabase LIVE", () => {
  assert.doesNotThrow(() =>
    assertSupabaseDeploymentBoundary({
      url: LIVE_URL,
      vercelEnvironment: "production",
      bundledExpectedProjectRef: LIVE_SUPABASE_PROJECT_REF,
    }),
  );
  assert.throws(
    () =>
      assertSupabaseDeploymentBoundary({
        url: TEST_URL,
        vercelEnvironment: "production",
        bundledExpectedProjectRef: LIVE_SUPABASE_PROJECT_REF,
      }),
    /project mismatch/,
  );
});

test("rejects a bundled project that disagrees with Vercel", () => {
  assert.throws(
    () =>
      assertSupabaseDeploymentBoundary({
        url: TEST_URL,
        vercelEnvironment: "preview",
        bundledExpectedProjectRef: LIVE_SUPABASE_PROJECT_REF,
      }),
    /does not match the Vercel environment/,
  );
});

test("rejects missing and malformed project URLs", () => {
  assert.throws(
    () => assertSupabaseProjectUrl(undefined, TEST_SUPABASE_PROJECT_REF),
    /URL is missing/,
  );

  for (const url of [
    "not-a-url",
    `http://${TEST_SUPABASE_PROJECT_REF}.supabase.co`,
    `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co:8443`,
    `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co/path`,
    `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co?query=1`,
    `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co#fragment`,
    `https://user:secret@${TEST_SUPABASE_PROJECT_REF}.supabase.co`,
    `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co.example.com`,
  ]) {
    assert.throws(
      () => assertSupabaseProjectUrl(url, TEST_SUPABASE_PROJECT_REF),
      /invalid|not an approved/,
    );
  }
});
