import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this local import.
import { LIVE_SUPABASE_PROJECT_REF, TEST_SUPABASE_PROJECT_REF, assertSupabaseProjectUrl } from "./project-boundary.ts";

type DeleteClaim = {
  object_path: string;
  delete_claim_id: string;
};

const CLEANUP_PROJECTS = {
  test: {
    projectRef: "bstjobvvxxfqqwyjoimx",
  },
  live: {
    projectRef: "ouoiykudvcoqbkybkqvs",
  },
} as const;

const APPROVED_CLEANUP_PROJECT_REFS = new Set<string>(
  Object.values(CLEANUP_PROJECTS).map(({ projectRef }) => projectRef),
);

export type RepairImageCleanupResult = {
  claimed: number;
  deleted: number;
  failed: number;
};

function configuredCleanupProjectRef(): string {
  const projectRef = process.env.REPAIR_IMAGE_CLEANUP_PROJECT_REF;
  if (!projectRef || !APPROVED_CLEANUP_PROJECT_REFS.has(projectRef)) {
    throw new Error("Server-side repair image cleanup project is not approved.");
  }

  return projectRef;
}

export function assertApprovedRepairImageCleanupUrl(
  rawUrl: string,
  projectRef = configuredCleanupProjectRef(),
): void {
  if (!APPROVED_CLEANUP_PROJECT_REFS.has(projectRef)) {
    throw new Error("Server-side repair image cleanup project is not approved.");
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Repair image cleanup Supabase URL is invalid.");
  }

  const expectedHostname = `${projectRef}.supabase.co`;
  const hasExactEndpoint =
    url.protocol === "https:" &&
    url.hostname === expectedHostname &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search === "" &&
    url.hash === "";

  if (!hasExactEndpoint) {
    throw new Error(
      "Repair image cleanup URL does not match the approved server-side project.",
    );
  }
}

export function assertRepairImageCleanupDeployment(
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

function configuredSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("Server-side Supabase cleanup URL is missing.");
  }

  return url;
}

function createAdminClient(url: string): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Server-side Supabase cleanup credentials are missing.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function runRepairImageCleanup(
  client?: SupabaseClient,
  suppliedUrl?: string,
  suppliedProjectRef?: string,
  suppliedVercelEnvironment?: string,
): Promise<RepairImageCleanupResult> {
  const url = suppliedUrl ?? configuredSupabaseUrl();
  const projectRef = suppliedProjectRef ?? configuredCleanupProjectRef();
  assertRepairImageCleanupDeployment(
    url,
    projectRef,
    suppliedVercelEnvironment,
  );
  assertApprovedRepairImageCleanupUrl(url, projectRef);
  const cleanupClient = client ?? createAdminClient(url);

  const { data, error } = await cleanupClient.rpc("claim_repair_image_deletions", {
    p_limit: 25,
  });
  if (error) throw error;

  const claims = (data ?? []) as DeleteClaim[];
  const result: RepairImageCleanupResult = {
    claimed: claims.length,
    deleted: 0,
    failed: 0,
  };

  for (const claim of claims) {
    const { error: storageError } = await cleanupClient.storage
      .from("repair-images")
      .remove([claim.object_path]);

    const deleted = storageError === null;
    const { error: completionError } = await cleanupClient.rpc(
      "complete_repair_image_deletion",
      {
        p_object_path: claim.object_path,
        p_delete_claim_id: claim.delete_claim_id,
        p_deleted: deleted,
      },
    );

    if (completionError) throw completionError;
    if (deleted) result.deleted += 1;
    else result.failed += 1;
  }

  return result;
}
