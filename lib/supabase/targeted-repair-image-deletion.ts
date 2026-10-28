// @ts-expect-error TS5097: source extension for local Node tests.
import { createTargetedImageDiagnostic } from './targeted-image-diagnostics.server.ts';
import type { ImageDiagnostic, ImageDiagnosticCode } from '../repair-requests/image-deletion-diagnostics';
import { randomUUID } from "node:crypto";
// @ts-expect-error TS5097: source extension for Node's local test runner.
import { assertSupabaseProjectUrl, TEST_SUPABASE_PROJECT_REF } from "./project-boundary.ts";
// @ts-expect-error TS5097: source extension for Node's local test runner.
import { processRepairImageDeletionClaim, type RepairImageCleanupClient } from "./repair-image-cleanup-core.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]*$/i;
type Input = { requestId: string; operationId: string; image: Record<string, unknown> };
type Result = {
  operationId: string;
  status: "deleted" | "retained" | "already_completed_unverified" | "unauthenticated" | "invalid_input" | "configuration_error" | "forbidden" | "conflict" | "recovery_required";
  detached: boolean | "unknown";
  physicalDeletionConfirmed: boolean;
};
const finalCodes: Record<Result['status'], ImageDiagnosticCode> = {
  deleted: 'TARGETED_DELETION_DELETED', retained: 'TARGETED_DELETION_RETAINED',
  already_completed_unverified: 'TARGETED_DELETION_ALREADY_COMPLETED_UNVERIFIED',
  unauthenticated: 'TARGETED_DELETION_UNAUTHENTICATED', invalid_input: 'TARGETED_DELETION_INVALID_INPUT',
  configuration_error: 'TARGETED_DELETION_CONFIGURATION_ERROR', forbidden: 'TARGETED_DELETION_FORBIDDEN',
  conflict: 'TARGETED_DELETION_CONFLICT', recovery_required: 'TARGETED_DELETION_RECOVERY_REQUIRED',
};
function row(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") throw new Error("Invalid RPC response");
  return data[0];
}

/** Internal test seam. Production callers use deleteTargetedRepairImage below.
 * The same operationId must be retained by the caller for explicit recovery.
 * No retries, batch claims, UI route or periodic execution are installed.
 */
export async function targetedDeletionProtocol(input: Input, deps: {
  diagnostic?: ImageDiagnostic;
  authenticate(): Promise<string | null>;
  userRpc: RepairImageCleanupClient["rpc"];
  admin: RepairImageCleanupClient;
  getObject(path: string, signal: AbortSignal): Promise<Response>;
}): Promise<Result> {
  const diagnostic: ImageDiagnostic = (code, status) => { try { deps.diagnostic?.(code, status); } catch {} };
  let detached: boolean | "unknown" = false;
  const result = (status: Result["status"]): Result => {
    diagnostic(finalCodes[status]);
    return { operationId: input.operationId, status, detached, physicalDeletionConfirmed: status === "deleted" };
  };
  if (!UUID.test(input.requestId) || !UUID.test(input.operationId) || !input.image ||
      typeof input.image.path !== "string" || input.image.path.length > 1024 || !PATH.test(input.image.path) ||
      Object.keys(input).some(k => !["requestId", "operationId", "image"].includes(k))) return result("invalid_input");
  let failedStage: ImageDiagnosticCode = 'AUTH_FAILED';
  try {
    diagnostic('AUTH_STARTED');
    const user = await deps.authenticate();
    if (!user) { diagnostic('AUTH_FAILED'); return result("unauthenticated"); }
    diagnostic('AUTH_OK');
    if (!UUID.test(user) || !input.image.path.startsWith(`${user}/`)) return result("forbidden");
    detached = "unknown"; // Even a transport failure can follow a committed detach.
    failedStage = 'DETACH_FAILED'; diagnostic('DETACH_STARTED');
    const detach = await deps.userRpc("detach_own_repair_request_image", {
      p_request_id: input.requestId, p_selected_image: input.image, p_operation_id: input.operationId,
    });
    if (detach.error) {
      diagnostic('DETACH_FAILED');
      const code = (detach.error as { code?: string }).code;
      if (code === "42501") { detached = false; return result("forbidden"); }
      if (["55P03", "PT409", "40001"].includes(code ?? "")) return result("conflict");
      return result("recovery_required");
    }
    const d = row(detach.data);
    if (d.operation_id !== input.operationId || !["detached", "retained"].includes(String(d.outcome))) throw new Error("Invalid detach");
    diagnostic('DETACH_OK');
    detached = true;
    if (d.outcome === "retained") return result("retained");
    failedStage = 'CLAIM_FAILED'; diagnostic('CLAIM_STARTED');
    const claim = await deps.admin.rpc("claim_authorized_repair_image_deletion", { p_operation_id: input.operationId });
    if (claim.error) {
      diagnostic('CLAIM_FAILED');
      const code = (claim.error as { code?: string }).code;
      return result(["55P03", "40001", "55000", "23514"].includes(code ?? "") ? "conflict" : "recovery_required");
    }
    const c = row(claim.data);
    if (c.outcome === "retained" || c.outcome === "already_completed") {
      if (c.object_path !== null || c.delete_claim_id !== null) throw new Error("Invalid terminal claim");
      diagnostic('CLAIM_OK');
      return result(c.outcome === "retained" ? "retained" : "already_completed_unverified");
    }
    if (c.outcome !== "claimed" || c.object_path !== input.image.path || typeof c.delete_claim_id !== "string" || !UUID.test(c.delete_claim_id)) throw new Error("Claim mismatch");
    diagnostic('CLAIM_OK');
    failedStage = 'TARGETED_DELETION_RECOVERY_REQUIRED';
    const deleted = await processRepairImageDeletionClaim({
      diagnostic, revalidateBeforeDelete: true, client: deps.admin, claim: { object_path: input.image.path, delete_claim_id: c.delete_claim_id },
      getObject: deps.getObject, now: Date.now, rpcTimeoutMs: 15000, storageTimeoutMs: 20000,
    });
    return result(deleted ? "deleted" : "recovery_required");
  } catch { diagnostic(failedStage); return result("recovery_required"); }
}

/** Server-only entrypoint. Bearer access token is verified against TEST Auth,
 * never decoded/trusted locally. No caller-supplied clients, URL or credentials.
 * Generate operationId once with newTargetedImageOperationId(), retain on retry.
 */
export async function deleteTargetedRepairImage(input: Input, accessToken: string): Promise<Result> {
  const diagnostic = createTargetedImageDiagnostic();
  const failure = (status: Result["status"]): Result => {
    diagnostic(finalCodes[status]);
    return { operationId: input.operationId, status, detached: false, physicalDeletionConfirmed: false };
  };
  if (typeof window !== "undefined") return failure("configuration_error");
  const url = process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try { assertSupabaseProjectUrl(url, TEST_SUPABASE_PROJECT_REF); } catch { return failure("configuration_error"); }
  if (!anon || !service || process.env.VERCEL_ENV === "production") return failure("configuration_error");
  if (!accessToken?.trim() || accessToken === service || accessToken === anon) return failure("unauthenticated");
  const base = url!.replace(/\/$/, "");
  const request = (path: string, key: string, token: string, init: RequestInit = {}) => fetch(`${base}${path}`, {
    ...init, redirect: "manual", cache: "no-store", signal: init.signal ?? AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const rpc = (key: string, token: string): RepairImageCleanupClient["rpc"] => async (name, args) => {
    let response: Response;
    try {
      response = await request(`/rest/v1/rpc/${name}`, key, token, { method: "POST", body: JSON.stringify(args) });
    } catch (error) {
      if (name === 'complete_repair_image_deletion') diagnostic('COMPLETE_TRANSPORT_FAILED');
      throw error;
    }
    if (name === "complete_repair_image_deletion") {
      // This RPC returns void. Never treat an HTTP failure (even JSON null)
      // as success, and do not relax the data contracts of other RPCs.
      if (!response.ok) { diagnostic('COMPLETE_HTTP_FAILED', response.status); return { data: null, error: { status: response.status } }; }
      let body: string;
      try { body = await response.text(); } catch (error) { diagnostic('COMPLETE_TRANSPORT_FAILED'); throw error; }
      try {
        if (body.trim() !== "" && JSON.parse(body) !== null) throw new Error("Invalid completion response");
      } catch (error) { diagnostic('COMPLETE_BODY_INVALID'); throw error; }
      return { data: null, error: null };
    }
    const data = await response.json();
    return response.ok ? { data, error: null } : { data: null, error: data };
  };
  const admin: RepairImageCleanupClient = {
    rpc: rpc(service, service),
    storage: { from: bucket => ({ remove: async paths => {
      if (bucket !== "repair-images" || paths.length !== 1 || paths[0] !== input.image.path) throw new Error("Storage scope mismatch");
      const response = await request('/storage/v1/object/repair-images', service, service, {
        method: "DELETE", body: JSON.stringify({ prefixes: paths }), signal: AbortSignal.timeout(20000),
      });
      return { data: null, error: response.ok ? null : { status: response.status } };
    } }) },
  };
  return targetedDeletionProtocol(input, {
    diagnostic,
    authenticate: async () => {
      const response = await request('/auth/v1/user', anon, accessToken);
      if (!response.ok) return null;
      const user = await response.json();
      return typeof user.id === "string" ? user.id : null;
    },
    userRpc: rpc(anon, accessToken), admin,
    getObject: (path, signal) => {
      if (path !== input.image.path) throw new Error("Storage scope mismatch");
      return request(`/storage/v1/object/authenticated/repair-images/${path.split('/').map(encodeURIComponent).join('/')}`, service, service, { method: "GET", headers: { Range: "bytes=0-0" }, signal });
    },
  });
}

export function newTargetedImageOperationId(): string { return randomUUID(); }
