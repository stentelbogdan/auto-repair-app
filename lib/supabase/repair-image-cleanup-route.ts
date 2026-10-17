import { timingSafeEqual } from "node:crypto";
// Node's built-in TypeScript test runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this local TypeScript import.
import { runRepairImageCleanup, type RepairImageCleanupResult } from "./repair-image-cleanup-worker.ts";

type CleanupRunner = () => Promise<RepairImageCleanupResult>;
type ErrorLogger = (message: string) => void;

function authorized(request: Request, secret: string | undefined): boolean {
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function safeErrorMessage(error: unknown, secrets: Array<string | undefined>): string {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }

  return message;
}

export async function handleRepairImageCleanupRequest(
  request: Request,
  cleanup: CleanupRunner = runRepairImageCleanup,
  secret = process.env.CRON_SECRET,
  logError: ErrorLogger = console.error,
): Promise<Response> {
  if (!authorized(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await cleanup());
  } catch (error) {
    const safeMessage = safeErrorMessage(error, [
      secret,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ]);
    logError(`Repair image cleanup failed. ${safeMessage}`);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
