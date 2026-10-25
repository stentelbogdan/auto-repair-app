/** Internal protocol engine. No environment, credentials, endpoint or client factory.
 * Production callers must use the guarded worker, never this injectable module.
 */
const REPAIR_IMAGES_BUCKET = "repair-images";
const DEFAULT_BATCH_LIMIT = 3;
const MAX_BATCH_LIMIT = 3;
const DEFAULT_RPC_TIMEOUT_MS = 15_000;
const DEFAULT_STORAGE_TIMEOUT_MS = 20_000;
const MINIMUM_LEASE_REMAINING_MS = 30_000;
const MAX_ERROR_BODY_BYTES = 1_024;
const OBJECT_PATH_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

type DeleteClaim = {
  object_path: string;
  delete_claim_id: string;
};

type RevalidatedClaim = DeleteClaim & {
  delete_lease_expires_at: string;
  storage_object_exists: boolean;
};

type RpcResult = { data: unknown; error: unknown };
type StorageRemoveResult = { data: unknown; error: unknown };

export type RepairImageCleanupClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<StorageRemoveResult>;
    };
  };
};

export type RepairImageCleanupResult = {
  claimed: number;
  deleted: number;
  failed: number;
};

type RepairImageCleanupDependencies = {
  getObject: (objectPath: string, signal: AbortSignal) => Promise<Response>;
  now?: () => number;
  batchLimit?: number;
  rpcTimeoutMs?: number;
  storageTimeoutMs?: number;
};

type ObjectPresence = "present" | "absent" | "ambiguous";
type DeleteOutcome = "accepted" | "confirmed-absent" | "rejected" | "ambiguous";

function validatedTimeout(value: number | undefined, fallback: number): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 60_000) {
    throw new Error("Repair image cleanup timeout is invalid.");
  }
  return timeout;
}

function validatedBatchLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_BATCH_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_LIMIT) {
    throw new Error("Repair image cleanup batch limit is invalid.");
  }
  return limit;
}

async function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Repair image cleanup operation timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isDeleteClaim(value: unknown): value is DeleteClaim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Record<string, unknown>;
  return (
    typeof claim.object_path === "string" &&
    OBJECT_PATH_PATTERN.test(claim.object_path) &&
    claim.object_path.length <= 1_024 &&
    typeof claim.delete_claim_id === "string" &&
    UUID_PATTERN.test(claim.delete_claim_id)
  );
}

function parseClaims(data: unknown, limit: number): DeleteClaim[] {
  if (!Array.isArray(data) || data.length > limit || !data.every(isDeleteClaim)) {
    throw new Error("Repair image deletion claim response is invalid.");
  }
  const paths = new Set(data.map((claim) => claim.object_path));
  const claimIds = new Set(data.map((claim) => claim.delete_claim_id));
  if (paths.size !== data.length || claimIds.size !== data.length) {
    throw new Error("Repair image deletion claim response is ambiguous.");
  }
  return data;
}

function parseRevalidatedClaim(
  data: unknown,
  expected: DeleteClaim,
  now: number,
): RevalidatedClaim | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown> | null;
  if (
    !row ||
    row.object_path !== expected.object_path ||
    row.delete_claim_id !== expected.delete_claim_id ||
    typeof row.delete_lease_expires_at !== "string" ||
    typeof row.storage_object_exists !== "boolean"
  ) {
    return null;
  }
  const leaseExpiresAt = Date.parse(row.delete_lease_expires_at);
  if (
    !Number.isFinite(leaseExpiresAt) ||
    leaseExpiresAt - now < MINIMUM_LEASE_REMAINING_MS
  ) {
    return null;
  }
  return row as RevalidatedClaim;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  for (const candidate of [record.status, record.statusCode]) {
    const parsed = typeof candidate === "string" ? Number(candidate) : candidate;
    if (typeof parsed === "number" && Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  for (const candidate of [record.code, record.errorCode]) {
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

function isConfirmedMissingError(error: unknown): boolean {
  const status = errorStatus(error);
  const code = errorCode(error);
  return (
    (status === 400 || status === 404) &&
    (code === "NoSuchKey" || code === "ObjectNotFound")
  );
}

function isConclusiveRejectedDelete(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

async function readAllowedErrorCode(response: Response): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_ERROR_BODY_BYTES) {
    return null;
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).byteLength > MAX_ERROR_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const code = parsed.code ?? parsed.errorCode;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

async function checkObjectPresence(input: {
  objectPath: string;
  getObject: RepairImageCleanupDependencies["getObject"];
  timeoutMs: number;
}): Promise<ObjectPresence> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.getObject(input.objectPath, controller.signal);
    if (response.status === 200 || response.status === 206) {
      await response.body?.cancel();
      return "present";
    }
    if (response.status === 400 || response.status === 404) {
      const code = await readAllowedErrorCode(response);
      if (code === "NoSuchKey" || code === "ObjectNotFound") return "absent";
    }
    return "ambiguous";
  } catch {
    return "ambiguous";
  } finally {
    clearTimeout(timeout);
  }
}

async function revalidateClaim(input: {
  client: RepairImageCleanupClient;
  claim: DeleteClaim;
  now: () => number;
  timeoutMs: number;
}): Promise<RevalidatedClaim | null> {
  let response: RpcResult;
  try {
    response = await withTimeout(
      input.client.rpc("revalidate_repair_image_deletion_claim", {
        p_object_path: input.claim.object_path,
        p_delete_claim_id: input.claim.delete_claim_id,
      }),
      input.timeoutMs,
    );
  } catch {
    return null;
  }
  if (response.error !== null) return null;
  return parseRevalidatedClaim(response.data, input.claim, input.now());
}

async function completeClaim(input: {
  client: RepairImageCleanupClient;
  claim: DeleteClaim;
  deleted: boolean;
  timeoutMs: number;
}): Promise<boolean> {
  try {
    const response = await withTimeout(
      input.client.rpc("complete_repair_image_deletion", {
        p_object_path: input.claim.object_path,
        p_delete_claim_id: input.claim.delete_claim_id,
        p_deleted: input.deleted,
      }),
      input.timeoutMs,
    );
    return response.error === null;
  } catch {
    return false;
  }
}

async function deleteObject(input: {
  client: RepairImageCleanupClient;
  claim: DeleteClaim;
  timeoutMs: number;
}): Promise<DeleteOutcome> {
  try {
    const response = await withTimeout(
      input.client.storage.from(REPAIR_IMAGES_BUCKET).remove([
        input.claim.object_path,
      ]),
      input.timeoutMs,
    );
    if (response.error === null) return "accepted";
    if (isConfirmedMissingError(response.error)) return "confirmed-absent";
    if (isConclusiveRejectedDelete(response.error)) return "rejected";
    return "ambiguous";
  } catch {
    return "ambiguous";
  }
}

export async function processRepairImageDeletionClaim(input: {
  revalidateBeforeDelete?: boolean;
  client: RepairImageCleanupClient;
  claim: DeleteClaim;
  getObject: RepairImageCleanupDependencies["getObject"];
  now: () => number;
  rpcTimeoutMs: number;
  storageTimeoutMs: number;
}): Promise<boolean> {
  const revalidated = await revalidateClaim({
    client: input.client,
    claim: input.claim,
    now: input.now,
    timeoutMs: input.rpcTimeoutMs,
  });
  if (!revalidated) return false;

  const beforeDelete = await checkObjectPresence({
    objectPath: input.claim.object_path,
    getObject: input.getObject,
    timeoutMs: input.storageTimeoutMs,
  });

  if (
    (revalidated.storage_object_exists && beforeDelete !== "present") ||
    (!revalidated.storage_object_exists && beforeDelete !== "absent")
  ) {
    return false;
  }

  if (beforeDelete === "present") {
    if (input.revalidateBeforeDelete) {
      const immediatelyBeforeDelete = await revalidateClaim({
        client: input.client, claim: input.claim, now: input.now,
        timeoutMs: input.rpcTimeoutMs,
      });
      if (!immediatelyBeforeDelete?.storage_object_exists) return false;
    }
    const deletion = await deleteObject({
      client: input.client,
      claim: input.claim,
      timeoutMs: input.storageTimeoutMs,
    });
    // A local 401/403 response does not prove that the remote deletion did not
    // take effect. Preserve the claim for explicit recovery in every rejected
    // or otherwise ambiguous deletion outcome.
    if (deletion === "rejected") return false;
    if (deletion === "ambiguous") return false;
  }

  const afterDelete = await checkObjectPresence({
    objectPath: input.claim.object_path,
    getObject: input.getObject,
    timeoutMs: input.storageTimeoutMs,
  });
  if (afterDelete !== "absent") return false;

  const finalRevalidation = await revalidateClaim({
    client: input.client,
    claim: input.claim,
    now: input.now,
    timeoutMs: input.rpcTimeoutMs,
  });
  if (!finalRevalidation || finalRevalidation.storage_object_exists) return false;

  return completeClaim({
    client: input.client,
    claim: input.claim,
    deleted: true,
    timeoutMs: input.rpcTimeoutMs,
  });
}

type CleanupCoreInput = {
  client: RepairImageCleanupClient;
  dependencies: RepairImageCleanupDependencies;
};

export async function runRepairImageCleanupCore(
  input: CleanupCoreInput,
): Promise<RepairImageCleanupResult> {
  const dependencies = input.dependencies;
  const cleanupClient = input.client;
  const getObject = dependencies.getObject;
  const now = dependencies.now ?? Date.now;
  const batchLimit = validatedBatchLimit(dependencies.batchLimit);
  const rpcTimeoutMs = validatedTimeout(
    dependencies.rpcTimeoutMs,
    DEFAULT_RPC_TIMEOUT_MS,
  );
  const storageTimeoutMs = validatedTimeout(
    dependencies.storageTimeoutMs,
    DEFAULT_STORAGE_TIMEOUT_MS,
  );

  const claimResponse = await withTimeout(
    cleanupClient.rpc("claim_repair_image_deletions", { p_limit: batchLimit }),
    rpcTimeoutMs,
  );
  if (claimResponse.error !== null) {
    throw new Error("Repair image cleanup claim failed.");
  }
  const claims = parseClaims(claimResponse.data, batchLimit);
  const result: RepairImageCleanupResult = {
    claimed: claims.length,
    deleted: 0,
    failed: 0,
  };

  for (const claim of claims) {
    const deleted = await processRepairImageDeletionClaim({
      client: cleanupClient,
      claim,
      getObject,
      now,
      rpcTimeoutMs,
      storageTimeoutMs,
    });
    if (deleted) result.deleted += 1;
    else result.failed += 1;
  }

  return result;
}
