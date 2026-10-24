import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this local import.
import { LIVE_SUPABASE_PROJECT_REF, TEST_SUPABASE_PROJECT_REF, assertSupabaseProjectUrl } from "./project-boundary.ts";

// @ts-expect-error TS5097 is intentionally limited to this local import.
import { runRepairImageCleanupCore, type RepairImageCleanupClient, type RepairImageCleanupResult } from "./repair-image-cleanup-core.ts";

const CLEANUP_PROJECTS = new Set([
  TEST_SUPABASE_PROJECT_REF,
  LIVE_SUPABASE_PROJECT_REF,
]);

function configuredCleanupProjectRef(): string {
  const projectRef = process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF;
  if (!projectRef || !CLEANUP_PROJECTS.has(projectRef)) {
    throw new Error("Server-side repair image cleanup project is not approved.");
  }
  return projectRef;
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Repair image cleanup requires a server runtime.");
  }
}

function configuredSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("Server-side Supabase cleanup URL is missing.");
  return url;
}

function configuredServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Server-side Supabase cleanup credentials are missing.");
  }
  return key;
}

function createAdminClient(url: string, key: string): RepairImageCleanupClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient as unknown as RepairImageCleanupClient;
}

function assertApprovedRepairImageCleanupUrl(
  rawUrl: string,
  projectRef = configuredCleanupProjectRef(),
): void {
  if (!CLEANUP_PROJECTS.has(projectRef)) {
    throw new Error("Server-side repair image cleanup project is not approved.");
  }
  assertSupabaseProjectUrl(rawUrl, projectRef);
}

function assertRepairImageCleanupDeployment(
  rawUrl: string,
  projectRef: string,
  vercelEnvironment = process.env.VERCEL_ENV,
): void {
  if (vercelEnvironment === "preview") {
    if (projectRef !== TEST_SUPABASE_PROJECT_REF) {
      throw new Error("Preview cleanup configuration must target TEST.");
    }
    assertSupabaseProjectUrl(rawUrl, TEST_SUPABASE_PROJECT_REF);
    throw new Error("Repair image cleanup is disabled in Preview.");
  }
  if (vercelEnvironment !== "production") {
    throw new Error("Repair image cleanup requires a Production deployment.");
  }
  if (projectRef !== LIVE_SUPABASE_PROJECT_REF) {
    throw new Error("Production cleanup must target the LIVE project.");
  }
  assertSupabaseProjectUrl(rawUrl, LIVE_SUPABASE_PROJECT_REF);
}

/**
 * Production entrypoint. Its zero-argument signature deliberately prevents a
 * route handler from injecting a client, endpoint, environment, or credential.
 */
export async function runRepairImageCleanup(): Promise<RepairImageCleanupResult> {
  assertServerRuntime();

  const url = configuredSupabaseUrl();
  const projectRef = configuredCleanupProjectRef();
  assertRepairImageCleanupDeployment(url, projectRef, process.env.VERCEL_ENV);
  assertApprovedRepairImageCleanupUrl(url, projectRef);

  const serviceRoleKey = configuredServiceRoleKey();
  const client = createAdminClient(url, serviceRoleKey);
  return runRepairImageCleanupCore({
    client,
    dependencies: {
      getObject: (objectPath, signal) => {
        const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
        return fetch(`${url}/storage/v1/object/authenticated/repair-images/${encodedPath}`, {
          method: "GET",
          redirect: "manual",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            Range: "bytes=0-0",
          },
          signal,
        });
      },
    },
  });
}
