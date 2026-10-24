import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  "../../migrations/20261024010000_add_repair_image_deletion_claim_revalidation.sql",
);
const verifierPath = resolve(
  here,
  "verify_repair_image_cleanup_revalidation_readonly.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const verifier = readFileSync(verifierPath, "utf8");

function assertCoreContract(sql: string): void {
  assert.match(
    sql,
    /create function public\.revalidate_repair_image_deletion_claim\(\s*p_object_path text,\s*p_delete_claim_id uuid\s*\)/i,
  );
  assert.match(
    sql,
    /returns table \(\s*object_path text,\s*delete_claim_id uuid,\s*delete_lease_expires_at timestamptz,\s*storage_object_exists boolean\s*\)/i,
  );
  assert.match(sql, /language plpgsql\s+security definer\s+set search_path = ''/i);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/i);
  assert.match(
    sql,
    /revoke all on function public\.revalidate_repair_image_deletion_claim\(text, uuid\)\s+from public, anon, authenticated, service_role;/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.revalidate_repair_image_deletion_claim\(text, uuid\)\s+to service_role;/i,
  );
  assert.match(sql, /where registry\.bucket_id = 'repair-images'\s+and registry\.object_path = p_object_path\s+for update;/i);
  assert.match(sql, /locked_object\.lifecycle_state is distinct from 'delete_claimed'/i);
  assert.match(sql, /locked_object\.delete_claim_id is distinct from p_delete_claim_id/i);
  assert.match(sql, /locked_object\.delete_lease_expires_at <= pg_catalog\.clock_timestamp\(\)/i);
  assert.match(sql, /repair_image_private\.repair_image_object_references reference/i);
  assert.match(sql, /locked_object\.owner_user_id::text/i);
  assert.match(sql, /from storage\.objects storage_object/i);
  assert.match(sql, /storage_owner_id is distinct from locked_object\.owner_user_id::text/i);
  assert.match(sql, /set delete_lease_expires_at = renewed_lease_expires_at/i);
}

test("migration defines the exact revalidation RPC contract", () => {
  assertCoreContract(migration);
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
});

test("migration fails closed before creating an existing RPC", () => {
  const guard = migration.indexOf("Repair image deletion claim revalidation already exists.");
  const creation = migration.indexOf(
    "create function public.revalidate_repair_image_deletion_claim",
  );
  assert.ok(guard >= 0 && creation > guard);
  assert.doesNotMatch(migration, /create or replace function public\.revalidate/i);
});

test("arguments, exact bucket, claim, and live lease are required", () => {
  assert.match(migration, /p_object_path is null\s+or p_delete_claim_id is null/i);
  assert.match(migration, /where registry\.bucket_id = 'repair-images'/i);
  assert.match(migration, /registry\.delete_claim_id = p_delete_claim_id/i);
  assert.match(migration, /registry\.delete_lease_expires_at > pg_catalog\.clock_timestamp\(\)/i);
  assert.doesNotMatch(migration, /delete_lease_expires_at\s*=\s*null/i);
});

test("owner and active references are checked while the target row is locked", () => {
  const lock = migration.indexOf("for update;");
  const owner = migration.indexOf("Repair image deletion claim owner is invalid.");
  const references = migration.indexOf("Referenced repair image cannot be revalidated");
  const renewal = migration.indexOf("set delete_lease_expires_at = renewed_lease_expires_at");
  assert.ok(lock >= 0 && owner > lock && references > owner && renewal > references);
});

test("Storage ownership is checked without requiring an existing object", () => {
  assert.match(migration, /select pg_catalog\.count\(\*\), pg_catalog\.min\(storage_object\.owner_id\)/i);
  assert.match(migration, /if storage_object_count > 1/i);
  assert.match(migration, /if storage_object_count = 1[\s\S]*storage_owner_id is distinct from locked_object\.owner_user_id::text/i);
  assert.match(migration, /storage_object_count = 1;/i);
  assert.doesNotMatch(migration, /storage_object_count <> 1/i);
});

test("the RPC exposes no target-specific TEST dependency", () => {
  assert.doesNotMatch(migration, /claim_repair_image_deletion\s*\(/i);
  assert.doesNotMatch(migration, /approved_run_id|protected_objects|targeted/i);
});

test("negative contract mutations are rejected", () => {
  const mutations = [
    migration.replace("security definer", "security invoker"),
    migration.replace("set search_path = ''", "set search_path = 'public'"),
    migration.replace("auth.role() is distinct from 'service_role'", "false"),
    migration.replace("for update;", ";"),
    migration.replace("locked_object.delete_lease_expires_at <=", "locked_object.delete_lease_expires_at >="),
    migration.replaceAll("repair_image_private.repair_image_object_references", "public.repair_image_object_references"),
    migration.replace("storage_owner_id is distinct from", "storage_owner_id is not distinct from"),
    migration.replace("to service_role;", "to authenticated;"),
  ];
  for (const mutation of mutations) {
    assert.throws(() => assertCoreContract(mutation));
  }
});

test("verifier is strictly read-only and never invokes the RPC", () => {
  assert.match(verifier, /^begin transaction read only;/i);
  assert.match(verifier, /rollback;\s*$/i);
  assert.doesNotMatch(
    verifier,
    /select\s+\*\s+from\s+public\.revalidate_repair_image_deletion_claim/i,
  );
  assert.doesNotMatch(
    verifier,
    /^\s*(?:create|alter|drop|grant|revoke|insert|update|delete|truncate)\b/gim,
  );
  assert.match(verifier, /test_identity/i);
  assert.match(verifier, /direct_acl_exact/i);
  assert.match(verifier, /service_role_execute_allowed/i);
});
