export const TEST_SUPABASE_PROJECT_REF = "bstjobvvxxfqqwyjoimx";
export const LIVE_SUPABASE_PROJECT_REF = "ouoiykudvcoqbkybkqvs";

const APPROVED_PROJECT_REFS = new Set([
  TEST_SUPABASE_PROJECT_REF,
  LIVE_SUPABASE_PROJECT_REF,
]);

export type VercelEnvironment = "preview" | "production" | "development";

export function expectedProjectRefForVercelEnvironment(
  vercelEnvironment: string | undefined,
): string | null {
  if (vercelEnvironment === "preview") return TEST_SUPABASE_PROJECT_REF;
  if (vercelEnvironment === "production") return LIVE_SUPABASE_PROJECT_REF;
  if (vercelEnvironment === undefined || vercelEnvironment === "development") {
    return null;
  }

  throw new Error(
    `Unsupported Vercel environment: ${vercelEnvironment}.`,
  );
}

export function supabaseProjectRefFromUrl(rawUrl: string): string {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Supabase URL is invalid.");
  }

  const hostnameMatch = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  const projectRef = hostnameMatch?.[1];
  const hasExactEndpoint =
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search === "" &&
    url.hash === "";

  if (
    !hasExactEndpoint ||
    !projectRef ||
    !APPROVED_PROJECT_REFS.has(projectRef)
  ) {
    throw new Error("Supabase URL is not an approved project endpoint.");
  }

  return projectRef;
}

export function assertSupabaseProjectUrl(
  rawUrl: string | undefined,
  expectedProjectRef: string | undefined,
): asserts rawUrl is string {
  if (!rawUrl) throw new Error("Supabase URL is missing.");
  if (!expectedProjectRef || !APPROVED_PROJECT_REFS.has(expectedProjectRef)) {
    throw new Error("Expected Supabase project is missing or unapproved.");
  }

  const observedProjectRef = supabaseProjectRefFromUrl(rawUrl);
  if (observedProjectRef !== expectedProjectRef) {
    throw new Error(
      `Supabase project mismatch: expected ${expectedProjectRef}, received ${observedProjectRef}.`,
    );
  }
}

export function assertSupabaseDeploymentBoundary(input: {
  url: string | undefined;
  vercelEnvironment: string | undefined;
  bundledExpectedProjectRef: string | undefined;
}): void {
  const environmentProjectRef = expectedProjectRefForVercelEnvironment(
    input.vercelEnvironment,
  );
  const expectedProjectRef =
    environmentProjectRef ?? input.bundledExpectedProjectRef;

  if (
    environmentProjectRef &&
    input.bundledExpectedProjectRef !== environmentProjectRef
  ) {
    throw new Error(
      "Bundled Supabase project does not match the Vercel environment.",
    );
  }

  assertSupabaseProjectUrl(input.url, expectedProjectRef);
}
