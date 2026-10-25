// @ts-expect-error TS5097: Node's local TypeScript test runner needs source extensions.
import { deleteTargetedRepairImage } from "./targeted-repair-image-deletion.ts";
// @ts-expect-error TS5097: Node's local TypeScript test runner needs source extensions.
import { assertSupabaseProjectUrl, TEST_SUPABASE_PROJECT_REF } from "./project-boundary.ts";

type AdapterInput = Parameters<typeof deleteTargetedRepairImage>[0];
type AdapterResult = Awaited<ReturnType<typeof deleteTargetedRepairImage>>;
type FailureStatus = Exclude<AdapterResult["status"], "deleted" | "retained" | "already_completed_unverified">
  | "unavailable" | "method_not_allowed" | "unsupported_media_type" | "payload_too_large" | "request_timeout";
export type TargetedImageDeletionResponse =
  | { operationId: string; status: "deleted"; detached: true; physicalDeletionConfirmed: true }
  | { operationId: string; status: "retained" | "already_completed_unverified"; detached: true; physicalDeletionConfirmed: false }
  | { operationId: string | null; status: FailureStatus; detached: boolean | "unknown"; physicalDeletionConfirmed: false };

const MAX_BODY_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_LIMITS: Record<string, number> = {
  path: 1024, name: 512, url: 2048, thumbUrl: 2048, dataUrl: 8192,
  fingerprint: 128, fingerprintVersion: 64,
};
const HTTP: Record<AdapterResult["status"], number> = {
  deleted: 200, retained: 200, already_completed_unverified: 200,
  unauthenticated: 401, invalid_input: 400, configuration_error: 503,
  forbidden: 403, conflict: 409, recovery_required: 503,
};
function reply(http: number, body: TargetedImageDeletionResponse, head = false): Response {
  const headers = {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...(http === 405 ? { Allow: "POST" } : {}),
  };
  return head ? new Response(null, { status: http, headers }) : Response.json(body, { status: http, headers });
}
function failure(http: number, status: FailureStatus, operationId: string | null = null,
  detached: boolean | "unknown" = false, head = false): Response {
  return reply(http, { operationId, status, detached, physicalDeletionConfirmed: false }, head);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function validInput(value: unknown): value is AdapterInput {
  if (!record(value) || Object.keys(value).length !== 3 ||
    !Object.keys(value).every(k => ["requestId", "operationId", "image"].includes(k)) ||
    !validId(value.requestId) || !validId(value.operationId) || !record(value.image)) return false;
  const image = value.image;
  if (typeof image.path !== "string") return false;
  const parts = image.path.split('/');
  if (parts.length !== 2 || !validId(parts[0]) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[1])) return false;
  return Object.entries(image).every(([key, v]) => Object.hasOwn(IMAGE_LIMITS, key) &&
    typeof v === "string" && v.length <= IMAGE_LIMITS[key] && !/[\u0000-\u001f]/.test(v));
}

class BodyFailure extends Error {
  status: "payload_too_large" | "request_timeout";
  constructor(status: "payload_too_large" | "request_timeout") { super(status); this.status = status; }
}
/** Enforce actual streamed bytes as well as Content-Length, including chunked bodies. */
async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let total = 0;
  let text = "";
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BodyFailure("request_timeout")), 5000);
    });
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new BodyFailure("payload_too_large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Do not wait on a stalled/hostile sender's cancellation acknowledgement.
    void reader.cancel().catch(() => {});
  }
}

/** Only this fixed adapter is reachable from the route; no injected runner or
 * request-provided environment, credentials, identity, bucket or endpoint.
 */
export async function handleTargetedImageDeletionRequest(request: Request): Promise<Response> {
  const head = request.method === "HEAD";
  if (typeof window !== "undefined" || process.env.VERCEL_ENV !== "preview") return failure(404, "unavailable", null, false, head);
  try {
    assertSupabaseProjectUrl(process.env.SUPABASE_URL, TEST_SUPABASE_PROJECT_REF);
    assertSupabaseProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, TEST_SUPABASE_PROJECT_REF);
    if (process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF !== TEST_SUPABASE_PROJECT_REF) throw new Error("Project mismatch");
  } catch { return failure(404, "unavailable", null, false, head); }
  if (request.method !== "POST") return failure(405, "method_not_allowed", null, false, head);
  const authorization = request.headers.get("authorization");
  // Exactly one bearer credential. Supabase Auth, not this syntax check, authenticates it.
  if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~+\/-]+=*$/i.test(authorization)) return failure(401, "unauthenticated");
  const token = authorization.slice(7);
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
    ![null, "identity"].includes(request.headers.get("content-encoding"))) return failure(415, "unsupported_media_type");
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) return failure(400, "invalid_input");
    if (Number(length) > MAX_BODY_BYTES) return failure(413, "payload_too_large");
  }
  let body: unknown;
  try { body = await readBody(request); } catch (error) {
    if (error instanceof BodyFailure) return failure(error.status === "payload_too_large" ? 413 : 408, error.status);
    return failure(400, "invalid_input");
  }
  const operationId = record(body) && validId(body.operationId) ? body.operationId : null;
  if (!validInput(body)) return failure(400, "invalid_input", operationId);
  // Keep the caller's ID verbatim: a lost response must not create a new operation.
  try {
    const result = await deleteTargetedRepairImage(body, token);
    if (!result || result.operationId !== operationId || !Object.hasOwn(HTTP, result.status) ||
      ![true, false, "unknown"].includes(result.detached)) throw new Error("Invalid adapter result");
    if (result.status === "deleted") {
      if (result.physicalDeletionConfirmed !== true || result.detached !== true) throw new Error("Unconfirmed deletion");
      return reply(200, { operationId: body.operationId, status: "deleted", detached: true, physicalDeletionConfirmed: true });
    }
    if (result.physicalDeletionConfirmed !== false) throw new Error("Contradictory result");
    if (result.status === "retained" || result.status === "already_completed_unverified") {
      if (result.detached !== true) throw new Error("Invalid detached state");
      return reply(200, { operationId: body.operationId, status: result.status, detached: true, physicalDeletionConfirmed: false });
    }
    return failure(HTTP[result.status], result.status, body.operationId, result.detached);
  } catch {
    // The mutation may already have committed. Do not retry or leak exception text.
    return failure(503, "recovery_required", body.operationId, "unknown");
  }
}
