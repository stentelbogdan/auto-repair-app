import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "bstjobvvxxfqqwyjoimx";
const LIVE_REF = "ouoiykudvcoqbkybkqvs";
const TEST_URL = `https://${TEST_REF}.supabase.co`;
const TEST_SYSTEM_IDENTIFIER = "7692131729119822239";
const BARRIER_ERROR_MESSAGE = "repair-images is temporarily read-only for maintenance.";
const STORAGE_BARRIER_ERROR_MESSAGE = "database error, code: 55000";
const PSQL = "/opt/homebrew/opt/libpq/bin/psql";
const DIR = resolve("supabase/tests/test_repair_image_maintenance");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0rQAAAAASUVORK5CYII=",
  "base64",
);

type Snapshot = {
  eligible: number;
  quarantinedCount: number;
  quarantinedHash: string;
  storageCount: number;
  storageHash: string;
  barrierCount: number;
};

function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required server-side.`);
  return value;
}

function databaseTarget() {
  const mode = process.env.REPAIR_IMAGE_TEST_DB_MODE;
  if (mode === "direct") {
    return { host: `db.${TEST_REF}.supabase.co`, user: "postgres" };
  }
  if (mode === "session_pooler") {
    const host = process.env.REPAIR_IMAGE_TEST_POOLER_HOST?.toLowerCase();
    if (!host || !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
      throw new Error("A valid TEST Session Pooler hostname is required.");
    }
    if (host.includes(TEST_REF) || host.includes(LIVE_REF)) {
      throw new Error("Pooler hostname must use the official regional form.");
    }
    return { host, user: `postgres.${TEST_REF}` };
  }
  throw new Error("REPAIR_IMAGE_TEST_DB_MODE must be direct or session_pooler.");
}

function pgEnv(): NodeJS.ProcessEnv {
  const passFile = secret("PGPASSFILE");
  if ((statSync(passFile).mode & 0o077) !== 0) {
    throw new Error("PGPASSFILE permissions must exclude group and other users.");
  }
  const target = databaseTarget();
  return {
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "C",
    PGPASSFILE: passFile,
    PGHOST: target.host,
    PGPORT: "5432",
    PGUSER: target.user,
    PGDATABASE: "postgres",
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "10",
  };
}

function redact(value: unknown, key: string): string {
  const text = value instanceof Error ? value.message : JSON.stringify(value);
  return (text || String(value)).replaceAll(key, "[REDACTED]");
}

function psql(input: string): string {
  const result = spawnSync(
    PSQL,
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t"],
    { input, encoding: "utf8", env: pgEnv() },
  );
  if (result.status !== 0) throw new Error(result.stderr.trim() || "psql failed");
  return result.stdout.trim();
}

function runFile(name: string): string {
  return psql(readFileSync(resolve(DIR, name), "utf8"));
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPostgresBarrierProbe(existingPath: string, insertPath: string) {
  const output = psql(`
begin;
do $identity_and_contract$
declare
  v_system_identifier text;
begin
  select control.system_identifier::text into v_system_identifier
  from pg_catalog.pg_control_system() as control;
  if current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or v_system_identifier is distinct from '${TEST_SYSTEM_IDENTIFIER}'
    or v_system_identifier = '7623125441096521075'
  then
    raise exception using errcode='55000', message='Expected TEST identity.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    join pg_catalog.pg_proc as function_record
      on function_record.oid = trigger_record.tgfoid
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_record.pronamespace
    where trigger_record.tgrelid = 'storage.objects'::pg_catalog.regclass
      and trigger_record.tgname = 'block_repair_image_storage_writes_during_maintenance'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 31
      and function_schema.nspname = 'repair_image_private'
      and function_record.proname = 'block_repair_image_storage_writes_during_maintenance'
      and pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''
      and pg_catalog.pg_get_userbyid(function_record.proowner) = 'postgres'
      and not function_record.prosecdef
      and function_record.proconfig = array['search_path=""']
      and function_record.prorettype = 'trigger'::pg_catalog.regtype
      and pg_catalog.md5(function_record.prosrc) = 'b0559e204ecc97fcc5438bad0a833396'
      and function_record.proacl is not null
      and not exists (
        select 1 from pg_catalog.aclexplode(function_record.proacl) as acl
        where acl.grantee <> function_record.proowner
      )
  ) is distinct from 1::bigint then
    raise exception using errcode='55000', message='Exact TEST barrier contract mismatch.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger as trigger_record
    join pg_catalog.pg_proc as function_record
      on function_record.oid = trigger_record.tgfoid
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_record.pronamespace
    join pg_catalog.pg_language as function_language
      on function_language.oid = function_record.prolang
    where trigger_record.tgrelid = 'storage.objects'::pg_catalog.regclass
      and trigger_record.tgname = 'protect_objects_delete'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 10
      and pg_catalog.pg_get_triggerdef(trigger_record.oid) =
        'CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete()'
      and function_schema.nspname = 'storage'
      and function_record.proname = 'protect_delete'
      and pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''
      and pg_catalog.pg_get_userbyid(function_record.proowner) = 'supabase_storage_admin'
      and function_language.lanname = 'plpgsql'
      and not function_record.prosecdef
      and function_record.proconfig is null
      and function_record.proacl is null
      and function_record.prorettype = 'trigger'::pg_catalog.regtype
      and pg_catalog.md5(function_record.prosrc) = '998d324ea2b1abc49351e8c2367b5796'
  ) is distinct from 1::bigint then
    raise exception using errcode='55000', message='Storage DELETE protection contract mismatch.';
  end if;

  if (
    select pg_catalog.count(*) from storage.objects
    where bucket_id = 'repair-images' and name = ${sqlLiteral(existingPath)}
  ) is distinct from 1::bigint or exists (
    select 1 from storage.objects
    where bucket_id = 'repair-images' and name = ${sqlLiteral(insertPath)}
  ) then
    raise exception using errcode='55000', message='Synthetic Storage probe baseline mismatch.';
  end if;
end
$identity_and_contract$;

do $probe$
declare
  v_state text;
  v_message text;
begin
  v_state := null;
  v_message := null;
  begin
    insert into storage.objects (bucket_id, name)
    values ('repair-images', ${sqlLiteral(insertPath)});
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform pg_catalog.set_config(
    'autorepair.barrier_insert_probe',
    case when v_state = '55000' and v_message = ${sqlLiteral(BARRIER_ERROR_MESSAGE)}
      then 'PASS' else 'FAIL' end,
    true
  );

  v_state := null;
  v_message := null;
  begin
    update storage.objects set name = name
    where bucket_id = 'repair-images' and name = ${sqlLiteral(existingPath)};
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform pg_catalog.set_config(
    'autorepair.barrier_update_probe',
    case when v_state = '55000' and v_message = ${sqlLiteral(BARRIER_ERROR_MESSAGE)}
      then 'PASS' else 'FAIL' end,
    true
  );

  v_state := null;
  v_message := null;
  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
  begin
    delete from storage.objects
    where bucket_id = 'repair-images' and name = ${sqlLiteral(existingPath)};
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform pg_catalog.set_config(
    'autorepair.barrier_delete_probe',
    case when v_state = '55000' and v_message = ${sqlLiteral(BARRIER_ERROR_MESSAGE)}
      then 'PASS' else 'FAIL' end,
    true
  );
end
$probe$;

select current_setting('autorepair.barrier_insert_probe'),
       current_setting('autorepair.barrier_update_probe'),
       current_setting('autorepair.barrier_delete_probe');
rollback;`);
  assert.equal(output, "PASS\tPASS\tPASS", "PostgreSQL barrier probe failed.");
}

function snapshot(): Snapshot {
  const output = psql(`
begin read only;
do $identity$ begin
  if current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or (select control.system_identifier::text from pg_catalog.pg_control_system() control)
       is distinct from '${TEST_SYSTEM_IDENTIFIER}'
    or (select control.system_identifier::text from pg_catalog.pg_control_system() control)
       = '7623125441096521075'
  then raise exception using errcode='55000', message='Expected TEST identity.'; end if;
end $identity$;
select
  count(*) filter (where lifecycle_state = 'tombstoned'
    or (lifecycle_state = 'delete_claimed' and delete_lease_expires_at <= clock_timestamp())
    or (lifecycle_state = 'reserved' and upload_lease_expires_at <= clock_timestamp() - interval '1 hour')
    or (lifecycle_state = 'uploaded' and uploaded_at <= clock_timestamp() - interval '1 hour')),
  count(*) filter (where lifecycle_state = 'quarantined'),
  md5(coalesce(string_agg(to_jsonb(r)::text, E'\\n' order by object_path)
    filter (where lifecycle_state = 'quarantined'), '')),
  (select count(*) from storage.objects),
  (select md5(coalesce(string_agg(bucket_id || '/' || name || '|' || id::text,
    E'\\n' order by bucket_id, name), '')) from storage.objects),
  (select count(*) from pg_catalog.pg_trigger
    where tgrelid='storage.objects'::regclass
      and tgname='block_repair_image_storage_writes_during_maintenance')
from repair_image_private.repair_image_objects r;
rollback;`);
  const [eligible, quarantinedCount, quarantinedHash, storageCount, storageHash, barrierCount] =
    output.split("\t");
  assert.ok([eligible, quarantinedCount, quarantinedHash, storageCount, storageHash, barrierCount]
    .every((value) => value !== undefined));
  return {
    eligible: Number(eligible),
    quarantinedCount: Number(quarantinedCount),
    quarantinedHash,
    storageCount: Number(storageCount),
    storageHash,
    barrierCount: Number(barrierCount),
  };
}

function isExpectedStorageBarrierError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return candidate.name === "StorageApiError"
    && candidate.message === STORAGE_BARRIER_ERROR_MESSAGE
    && candidate.status === 500
    && (candidate.statusCode === 500 || candidate.statusCode === "500");
}

function sanitizeDiagnosticText(value: string, key: string): string {
  return value
    .replaceAll(key, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9._-]+\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED CONNECTION STRING]")
    .replace(
      /\b(password|(?:access|refresh)[_-]?token|token|api[_-]?key|service[_-]?role[_-]?key|secret|authorization)\s*([=:])\s*[^\s,;]+/gi,
      "$1$2[REDACTED]",
    );
}

function sanitizeStorageError(
  error: unknown,
  key: string,
  seen = new Set<object>(),
  depth = 0,
): unknown {
  if (typeof error === "string") return sanitizeDiagnosticText(error, key);
  if (typeof error === "number" || typeof error === "boolean" || error === null) return error;
  if (typeof error !== "object") return undefined;
  if (seen.has(error)) return "[CIRCULAR]";
  if (depth > 4) return "[MAX DEPTH]";
  seen.add(error);

  const candidate = error as Record<string, unknown>;
  const diagnostic: Record<string, unknown> = {};
  for (const field of [
    "name",
    "message",
    "status",
    "statusCode",
    "code",
    "error",
    "details",
    "cause",
  ] as const) {
    if (!(field in candidate)) continue;
    const sanitized = sanitizeStorageError(candidate[field], key, seen, depth + 1);
    if (sanitized !== undefined) diagnostic[field] = sanitized;
  }
  return diagnostic;
}

function formatStorageError(error: unknown, key: string): string {
  return JSON.stringify(sanitizeStorageError(error, key));
}

function runBarrierErrorValidationSelfTests() {
  const testKey = "test-service-role-secret-value";
  const expectedError = {
    name: "StorageApiError",
    message: STORAGE_BARRIER_ERROR_MESSAGE,
    status: 500,
    statusCode: "500",
  };
  assert.equal(isExpectedStorageBarrierError(expectedError), true);
  assert.equal(isExpectedStorageBarrierError({ ...expectedError, statusCode: 500 }), true);
  assert.equal(isExpectedStorageBarrierError({ ...expectedError, name: "StorageUnknownError" }), false);
  assert.equal(isExpectedStorageBarrierError({ ...expectedError, message: "Internal error" }), false);
  assert.equal(isExpectedStorageBarrierError({ ...expectedError, status: 403 }), false);
  assert.equal(isExpectedStorageBarrierError({ ...expectedError, statusCode: "400" }), false);
  assert.equal(isExpectedStorageBarrierError({ status: 500, statusCode: "500" }), false);
  assert.equal(isExpectedStorageBarrierError(new Error("Network timeout")), false);

  const sanitized = formatStorageError({
    name: "StorageApiError",
    message: `failure ${testKey} Bearer abc.def.ghi`,
    status: 500,
    statusCode: "500",
    code: "DatabaseError",
    error: "password=super-secret",
    details: "postgresql://user:password@example.invalid/postgres",
    cause: { message: "access_token=hidden-value" },
    ignored: testKey,
  }, testKey);
  assert.equal(sanitized.includes(testKey), false);
  assert.equal(sanitized.includes("super-secret"), false);
  assert.equal(sanitized.includes("hidden-value"), false);
  assert.equal(sanitized.includes("user:password"), false);
  assert.equal(sanitized.includes("ignored"), false);
  assert.match(sanitized, /StorageApiError/);
  assert.match(sanitized, /\[REDACTED\]/);
  assert.equal(formatStorageError({ cause: null }, testKey), '{"cause":null}');
}

async function expectStorageFailure(
  label: string,
  key: string,
  operation: () => Promise<{ error: unknown }>,
) {
  const result = await operation();
  assert.ok(result.error, `${label} unexpectedly succeeded while the barrier was active.`);
  if (!isExpectedStorageBarrierError(result.error)) {
    throw new Error(
      `${label} failed, but the error was not produced by the maintenance trigger: `
      + formatStorageError(result.error, key),
    );
  }
}

async function main() {
  assert.equal(process.cwd(), resolve("."), "Run from the repository root.");
  assert.notEqual(TEST_REF, LIVE_REF);
  const key = secret("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(TEST_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = randomUUID();
  const repairPathA = `${id}/maintenance-before.png`;
  const repairPathB = `${id}/maintenance-after.png`;
  const otherBucket = `maintenance-e2e-${id}`;
  const otherPath = "control.png";
  let barrierActive = false;
  let otherBucketCreated = false;
  let aUploaded = false;
  let bUploaded = false;
  let otherUploaded = false;
  const before = snapshot();
  assert.equal(before.eligible, 0, "Cleanup-eligible registry rows exist.");
  assert.equal(before.quarantinedCount, 6, "Expected six protected quarantined rows.");
  assert.equal(before.barrierCount, 0, "A maintenance barrier already exists.");

  try {
    const identityProbe = await client.storage.listBuckets();
    if (identityProbe.error) throw identityProbe.error;

    const createBucket = await client.storage.createBucket(otherBucket, { public: false });
    if (createBucket.error) throw createBucket.error;
    otherBucketCreated = true;

    const preUpload = await client.storage.from("repair-images").upload(
      repairPathA, PNG, { contentType: "image/png", upsert: false },
    );
    if (preUpload.error) throw preUpload.error;
    aUploaded = true;

    runFile("01_activate_storage_barrier_test.sql");
    barrierActive = true;
    const verification = runFile("02_verify_storage_barrier_test_readonly.sql");
    assert.equal((verification.match(/\tPASS\t/g) ?? []).length, 7);
    runPostgresBarrierProbe(repairPathA, repairPathB);

    const download = await client.storage.from("repair-images").download(
      repairPathA,
      { cacheNonce: `barrier-${Date.now()}` },
      { cache: "no-store" },
    );
    if (download.error || !download.data) throw download.error ?? new Error("Download failed.");

    await expectStorageFailure("repair-images INSERT", key, async () =>
      client.storage.from("repair-images").upload(
        repairPathB, PNG, { contentType: "image/png", upsert: false },
      ),
    );
    await expectStorageFailure("repair-images UPDATE", key, async () =>
      client.storage.from("repair-images").update(
        repairPathA, PNG, { contentType: "image/png", upsert: true },
      ),
    );
    await expectStorageFailure("repair-images DELETE", key, async () =>
      client.storage.from("repair-images").remove([repairPathA]),
    );

    const otherInsert = await client.storage.from(otherBucket).upload(
      otherPath, PNG, { contentType: "image/png", upsert: false },
    );
    if (otherInsert.error) throw otherInsert.error;
    otherUploaded = true;
    const otherUpdate = await client.storage.from(otherBucket).update(
      otherPath, PNG, { contentType: "image/png", upsert: true },
    );
    if (otherUpdate.error) throw otherUpdate.error;
    const otherDownload = await client.storage.from(otherBucket).download(otherPath);
    if (otherDownload.error || !otherDownload.data) throw otherDownload.error ?? new Error("Control download failed.");
    const otherDelete = await client.storage.from(otherBucket).remove([otherPath]);
    if (otherDelete.error) throw otherDelete.error;
    otherUploaded = false;

    runFile("03_remove_storage_barrier_test.sql");
    barrierActive = false;

    const restoredUpload = await client.storage.from("repair-images").upload(
      repairPathB, PNG, { contentType: "image/png", upsert: false },
    );
    if (restoredUpload.error) throw restoredUpload.error;
    bUploaded = true;

    for (const path of [repairPathA, repairPathB]) {
      const removal = await client.storage.from("repair-images").remove([path]);
      if (removal.error) throw removal.error;
    }
    aUploaded = false;
    bUploaded = false;
    const deleteBucket = await client.storage.deleteBucket(otherBucket);
    if (deleteBucket.error) throw deleteBucket.error;
    otherBucketCreated = false;

    const after = snapshot();
    assert.deepEqual(after, before, "Pre-existing Storage/registry state changed.");
    console.log("TEST STORAGE BARRIER E2E PASS");
  } catch (error) {
    throw new Error(`TEST barrier E2E failed: ${redact(error, key)}`);
  } finally {
    if (barrierActive) {
      try { runFile("03_remove_storage_barrier_test.sql"); barrierActive = false; }
      catch (error) {
        console.error(`CRITICAL: barrier removal failed: ${redact(error, key)}`);
      }
    }
    if (!barrierActive) {
      if (aUploaded || bUploaded) {
        const paths = [aUploaded ? repairPathA : null, bUploaded ? repairPathB : null]
          .filter((path): path is string => path !== null);
        const result = await client.storage.from("repair-images").remove(paths);
        if (result.error) console.error(`Synthetic repair cleanup failed: ${redact(result.error, key)}`);
      }
      if (otherBucketCreated) {
        if (otherUploaded) await client.storage.from(otherBucket).remove([otherPath]);
        const result = await client.storage.deleteBucket(otherBucket);
        if (result.error) console.error(`Synthetic bucket cleanup failed: ${redact(result.error, key)}`);
      }
    }
  }
}

if (process.argv.includes("--self-test-error-validation")) {
  runBarrierErrorValidationSelfTests();
  console.log("BARRIER ERROR VALIDATION SELF-TEST PASS");
} else {
  await main();
}
