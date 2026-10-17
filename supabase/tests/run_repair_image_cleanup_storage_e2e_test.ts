import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
// Node's built-in TypeScript runner requires the source extension.
// @ts-expect-error TS5097 is intentionally limited to this no-emit test import.
import { runRepairImageCleanup } from "../../lib/supabase/repair-image-cleanup-worker.ts";

const TEST_PROJECT_REF = "bstjobvvxxfqqwyjoimx";
const LIVE_PROJECT_REF = "ouoiykudvcoqbkybkqvs";
const TEST_SUPABASE_URL = `https://${TEST_PROJECT_REF}.supabase.co`;
const TEST_DATABASE_HOST = `db.${TEST_PROJECT_REF}.supabase.co`;
const TEST_SYSTEM_IDENTIFIER = "7692131729119822239";
const PSQL = "/opt/homebrew/opt/libpq/bin/psql";
const BUCKET = "repair-images";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0rQAAAAASUVORK5CYII=",
  "base64",
);

type RegistrySnapshot = {
  eligibleCount: number;
  eligiblePaths: string[];
  quarantinedCount: number;
  quarantinedHash: string;
};

type TargetSnapshot = {
  lifecycleState: string;
  referenceCount: number;
  storageMetadataCount: number;
};

type TestDatabaseConnection = {
  host: string;
  port: "5432";
  user: string;
};

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required server-side environment variable ${name} is missing.`);
  return value;
}

function testDatabaseConnection(): TestDatabaseConnection {
  const mode = process.env.REPAIR_IMAGE_TEST_DB_MODE;

  if (mode === "direct") {
    return { host: TEST_DATABASE_HOST, port: "5432", user: "postgres" };
  }

  if (mode === "session_pooler") {
    const host = process.env.REPAIR_IMAGE_TEST_POOLER_HOST?.toLowerCase();
    if (
      !host ||
      !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) ||
      host.includes(TEST_PROJECT_REF) ||
      host.includes(LIVE_PROJECT_REF)
    ) {
      throw new Error("A valid Supabase Session Pooler hostname is required.");
    }

    return {
      host,
      port: "5432",
      user: `postgres.${TEST_PROJECT_REF}`,
    };
  }

  throw new Error(
    "REPAIR_IMAGE_TEST_DB_MODE must be direct or session_pooler.",
  );
}

function psqlEnvironment(): NodeJS.ProcessEnv {
  const passFile = requireSecret("PGPASSFILE");
  const connection = testDatabaseConnection();
  const passFileMode = statSync(passFile).mode & 0o777;
  if ((passFileMode & 0o077) !== 0) {
    throw new Error("PGPASSFILE must not be accessible by group or other users.");
  }

  return {
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "C",
    PGPASSFILE: passFile,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGDATABASE: "postgres",
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "10",
  };
}

function safeErrorMessage(error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return secret === "" ? message : message.replaceAll(secret, "[REDACTED]");
}

function runReadOnlySql(sql: string): string {
  const result = spawnSync(
    PSQL,
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t"],
    { input: sql, encoding: "utf8", env: psqlEnvironment() },
  );
  if (result.status !== 0) {
    throw new Error(`Read-only PostgreSQL check failed.\n${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function runMutationSql(sql: string): void {
  const result = spawnSync(
    PSQL,
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At"],
    { input: sql, encoding: "utf8", env: psqlEnvironment() },
  );
  if (result.status !== 0) {
    throw new Error(`Synthetic registry setup failed.\n${result.stderr.trim()}`);
  }
}

const eligiblePredicate = `
  registry.lifecycle_state = 'tombstoned'
  or (
    registry.lifecycle_state = 'delete_claimed'
    and registry.delete_lease_expires_at <= pg_catalog.clock_timestamp()
  )
  or (
    registry.lifecycle_state = 'reserved'
    and registry.upload_lease_expires_at <=
      pg_catalog.clock_timestamp() - interval '1 hour'
    and not exists (
      select 1
      from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = registry.bucket_id
        and reference.object_path = registry.object_path
    )
  )
  or (
    registry.lifecycle_state = 'uploaded'
    and registry.uploaded_at <=
      pg_catalog.clock_timestamp() - interval '1 hour'
    and not exists (
      select 1
      from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = registry.bucket_id
        and reference.object_path = registry.object_path
    )
  )`;

function readRegistrySnapshot(): RegistrySnapshot {
  const output = runReadOnlySql(`
begin read only;
do $identity$
begin
  if pg_catalog.current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or (
      select control.system_identifier::text
      from pg_catalog.pg_control_system() control
    ) is distinct from '${TEST_SYSTEM_IDENTIFIER}'
  then
    raise exception using errcode = '55000', message = 'Expected isolated TEST database.';
  end if;
end;
$identity$;
select
  pg_catalog.count(*) filter (where ${eligiblePredicate}),
  coalesce(
    pg_catalog.string_agg(
      registry.object_path,
      ',' order by registry.object_path collate "C"
    ) filter (where ${eligiblePredicate}),
    ''
  ),
  pg_catalog.count(*) filter (
    where registry.lifecycle_state = 'quarantined'
  ),
  pg_catalog.md5(coalesce(
    pg_catalog.string_agg(
      pg_catalog.to_jsonb(registry)::text,
      E'\\n' order by registry.object_path collate "C"
    ) filter (where registry.lifecycle_state = 'quarantined'),
    ''
  ))
from repair_image_private.repair_image_objects registry;
rollback;
`);

  const [eligibleCount, eligiblePaths, quarantinedCount, quarantinedHash] =
    output.split("\t");
  if (
    eligibleCount === undefined ||
    eligiblePaths === undefined ||
    quarantinedCount === undefined ||
    quarantinedHash === undefined
  ) {
    throw new Error("Unexpected PostgreSQL snapshot output.");
  }

  return {
    eligibleCount: Number(eligibleCount),
    eligiblePaths: eligiblePaths === "" ? [] : eligiblePaths.split(","),
    quarantinedCount: Number(quarantinedCount),
    quarantinedHash,
  };
}

function prepareSyntheticReferencedObject(
  ownerId: string,
  requestId: string,
  objectPath: string,
): void {
  assert.match(ownerId, /^[0-9a-f-]{36}$/);
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  assert.equal(objectPath, `${ownerId}/cleanup-e2e.png`);

  runMutationSql(`
begin;
do $identity$
begin
  if pg_catalog.current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or (
      select control.system_identifier::text
      from pg_catalog.pg_control_system() control
    ) is distinct from '${TEST_SYSTEM_IDENTIFIER}'
  then
    raise exception using errcode = '55000', message = 'Expected isolated TEST database.';
  end if;

  if exists (
    select 1
    from repair_image_private.repair_image_objects registry
    where ${eligiblePredicate}
  ) then
    raise exception using errcode = '55000', message = 'Another cleanup-eligible object exists.';
  end if;
end;
$identity$;
do $setup$
begin
insert into repair_image_private.repair_image_objects (
  object_path,
  owner_user_id,
  lifecycle_state,
  origin,
  uploaded_at
) values (
  '${objectPath}',
  '${ownerId}'::uuid,
  'discovered',
  'reconciliation',
  pg_catalog.clock_timestamp()
);
update repair_image_private.repair_image_objects
set lifecycle_state = 'uploaded'
where bucket_id = '${BUCKET}' and object_path = '${objectPath}';

perform pg_catalog.set_config('request.jwt.claim.sub', '${ownerId}', true);
perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

insert into auth.users (id, aud, role)
values ('${ownerId}'::uuid, 'authenticated', 'authenticated');

insert into public.repair_requests (
  id,
  user_id,
  car_brand,
  car_model,
  car_year,
  city,
  damage_type,
  images
) values (
  '${requestId}'::uuid,
  '${ownerId}'::uuid,
  'Synthetic cleanup E2E',
  'Synthetic cleanup E2E',
  '2026',
  'Test',
  'synthetic_cleanup_e2e',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'name', 'cleanup-e2e.png',
      'path', '${objectPath}',
      'url', '${TEST_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}',
      'fingerprint', pg_catalog.repeat('a', 64),
      'fingerprintVersion', 'sha256-prepared-v1'
    )
  )
);

if (
  select registry.lifecycle_state
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = '${BUCKET}'
    and registry.object_path = '${objectPath}'
) is distinct from 'attached'
or (
  select pg_catalog.count(*)
  from repair_image_private.repair_image_object_references reference
  where reference.bucket_id = '${BUCKET}'
    and reference.object_path = '${objectPath}'
    and reference.reference_id = '${requestId}'::uuid
) is distinct from 1::bigint
then
  raise exception using errcode = '55000', message = 'Synthetic image was not attached by the sync trigger.';
end if;

update public.repair_requests
set images = '[]'::jsonb
where id = '${requestId}'::uuid
  and user_id = '${ownerId}'::uuid;

if (
  select registry.lifecycle_state
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = '${BUCKET}'
    and registry.object_path = '${objectPath}'
) is distinct from 'tombstoned'
or exists (
  select 1
  from repair_image_private.repair_image_object_references reference
  where reference.bucket_id = '${BUCKET}'
    and reference.object_path = '${objectPath}'
)
then
  raise exception using errcode = '55000', message = 'Removing the final image reference did not tombstone the object.';
end if;

delete from public.repair_requests
where id = '${requestId}'::uuid
  and user_id = '${ownerId}'::uuid
  and images = '[]'::jsonb;

delete from auth.users
where id = '${ownerId}'::uuid
  and not exists (
    select 1 from public.repair_requests request
    where request.user_id = '${ownerId}'::uuid
  );

if exists (
  select 1 from public.repair_requests
  where id = '${requestId}'::uuid
) or exists (
  select 1 from auth.users
  where id = '${ownerId}'::uuid
) then
  raise exception using errcode = '55000', message = 'Synthetic business rows were not removed.';
end if;
end;
$setup$;

set constraints all immediate;
commit;
`);
}

function readTargetSnapshot(objectPath: string): TargetSnapshot {
  assert.match(objectPath, /^[0-9a-f-]{36}\/cleanup-e2e\.png$/);
  const output = runReadOnlySql(`
begin read only;
do $identity$
begin
  if pg_catalog.current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or (
      select control.system_identifier::text
      from pg_catalog.pg_control_system() control
    ) is distinct from '${TEST_SYSTEM_IDENTIFIER}'
  then
    raise exception using errcode = '55000', message = 'Expected isolated TEST database.';
  end if;
end;
$identity$;
select
  coalesce(pg_catalog.max(registry.lifecycle_state), 'MISSING'),
  (
    select pg_catalog.count(*)
    from repair_image_private.repair_image_object_references reference
    where reference.bucket_id = '${BUCKET}'
      and reference.object_path = '${objectPath}'
  ),
  (
    select pg_catalog.count(*)
    from storage.objects storage_object
    where storage_object.bucket_id = '${BUCKET}'
      and storage_object.name = '${objectPath}'
  )
from repair_image_private.repair_image_objects registry
where registry.bucket_id = '${BUCKET}'
  and registry.object_path = '${objectPath}';
rollback;
`);

  const [lifecycleState, referenceCount, storageMetadataCount] = output.split("\t");
  if (
    lifecycleState === undefined ||
    referenceCount === undefined ||
    storageMetadataCount === undefined
  ) {
    throw new Error("Unexpected PostgreSQL target snapshot output.");
  }
  return {
    lifecycleState,
    referenceCount: Number(referenceCount),
    storageMetadataCount: Number(storageMetadataCount),
  };
}

async function main(): Promise<void> {
  if (String(TEST_PROJECT_REF) === String(LIVE_PROJECT_REF)) {
    throw new Error("TEST and LIVE project refs must remain distinct.");
  }

  const serviceRoleKey = requireSecret("SUPABASE_SERVICE_ROLE_KEY");
  const before = readRegistrySnapshot();
  assert.equal(before.eligibleCount, 0, "Cleanup-eligible registry rows already exist.");
  assert.equal(before.quarantinedCount, 6, "Expected exactly six protected quarantined rows.");

  const ownerId = randomUUID();
  const requestId = randomUUID();
  const objectPath = `${ownerId}/cleanup-e2e.png`;
  const client = createClient(TEST_SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let registryPrepared = false;
  let storageUploaded = false;
  try {
    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(objectPath, PNG_BYTES, { contentType: "image/png", upsert: false });
    if (uploadError) throw uploadError;
    storageUploaded = true;

    const { data: beforeDownload, error: beforeDownloadError } =
      await client.storage.from(BUCKET).download(
        objectPath,
        { cacheNonce: `cleanup-e2e-before-${Date.now()}` },
        { cache: "no-store" },
      );
    if (beforeDownloadError || !beforeDownload) {
      throw new Error("Synthetic Storage object could not be verified after upload.");
    }
    assert.equal(beforeDownload.size, PNG_BYTES.byteLength);

    prepareSyntheticReferencedObject(ownerId, requestId, objectPath);
    registryPrepared = true;

    const ready = readRegistrySnapshot();
    assert.equal(ready.eligibleCount, 1);
    assert.deepEqual(ready.eligiblePaths, [objectPath]);
    assert.equal(ready.quarantinedCount, before.quarantinedCount);
    assert.equal(ready.quarantinedHash, before.quarantinedHash);
    assert.deepEqual(readTargetSnapshot(objectPath), {
      lifecycleState: "tombstoned",
      referenceCount: 0,
      storageMetadataCount: 1,
    });

    const result = await runRepairImageCleanup(
      client,
      TEST_SUPABASE_URL,
      TEST_PROJECT_REF,
    );
    assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });

    const { data: remaining, error: listError } = await client.storage
      .from(BUCKET)
      .list(ownerId, { search: "cleanup-e2e.png", limit: 100 });
    if (listError) throw listError;
    assert.equal(remaining.some((entry) => entry.name === "cleanup-e2e.png"), false);

    const { data: afterDownload, error: afterDownloadError } =
      await client.storage.from(BUCKET).download(
        objectPath,
        { cacheNonce: `cleanup-e2e-after-${Date.now()}` },
        { cache: "no-store" },
      );
    assert.equal(afterDownload, null);
    assert.ok(afterDownloadError, "Deleted Storage object remained downloadable.");

    assert.deepEqual(readTargetSnapshot(objectPath), {
      lifecycleState: "deleted",
      referenceCount: 0,
      storageMetadataCount: 0,
    });

    const after = readRegistrySnapshot();
    assert.equal(after.eligibleCount, 0);
    assert.equal(after.quarantinedCount, before.quarantinedCount);
    assert.equal(after.quarantinedHash, before.quarantinedHash);

    console.log(
      "CONTROLLED TEST PASS — final reference removed; one synthetic TEST image deleted; registry=deleted",
    );
    console.log(`Synthetic object path: ${objectPath}`);
  } catch (error) {
    const initialError = safeErrorMessage(error, serviceRoleKey);
    if (storageUploaded && !registryPrepared) {
      let cleanupError: unknown = null;
      try {
        const cleanupResult = await client.storage
          .from(BUCKET)
          .remove([objectPath]);
        cleanupError = cleanupResult.error;
      } catch (cleanupException) {
        cleanupError = cleanupException;
      }
      if (cleanupError) {
        throw new Error(
          `Controlled test failed: ${initialError}. Compensating Storage cleanup also failed: ${safeErrorMessage(cleanupError, serviceRoleKey)}.`,
        );
      }
    }
    throw new Error(`Controlled test failed: ${initialError}.`);
  }
}

await main();
