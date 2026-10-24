import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  here,
  "../../migrations/20261024000000_add_get_own_profile_rpc.sql",
);
const verifierPath = resolve(here, "verify_get_own_profile_readonly.sql");
const migration = readFileSync(migrationPath, "utf8");
const verifier = readFileSync(verifierPath, "utf8");

const expectedColumns = [
  "id uuid",
  "email text",
  "full_name text",
  "created_at timestamp with time zone",
  "role text[]",
  "workshop_name text",
  "workshop_phone text",
  "workshop_address text",
  "workshop_city text",
  "workshop_hours text",
  "workshop_description text",
  "workshop_logo_url text",
  "workshop_gallery_urls text[]",
  "workshop_slug text",
  "workshop_specializations text[]",
  "display_name text",
  "city text",
  "gdpr_accepted boolean",
  "gdpr_accepted_at timestamp with time zone",
];

test("migration defines the exact no-argument frontend return contract", () => {
  assert.match(migration, /function public\.get_own_profile\(\)/i);
  let cursor = -1;
  for (const column of expectedColumns) {
    const next = migration.indexOf(column, cursor + 1);
    assert.ok(next > cursor, `missing or out-of-order return column: ${column}`);
    cursor = next;
  }
});

test("embedded body hash matches the exact PostgreSQL function body", () => {
  const bodyStart = migration.indexOf("as $function$") + "as $function$".length;
  const bodyEnd = migration.indexOf("$function$;", bodyStart);
  assert.ok(bodyStart >= "as $function$".length && bodyEnd > bodyStart);
  const bodyHash = createHash("md5")
    .update(migration.slice(bodyStart, bodyEnd), "utf8")
    .digest("hex");
  assert.equal(bodyHash, "1a1f88e142a40c3226a0d8dd53191214");
  assert.match(migration, new RegExp(bodyHash, "g"));
});

test("RPC is a stable security definer with an empty search_path", () => {
  assert.match(migration, /language plpgsql\s+stable\s+security definer\s+set search_path = ''/i);
  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /where profile\.id = current_user_id/i);
  assert.doesNotMatch(migration, /\bfrom\s+profiles\b/i);
});

test("migration fails closed before replacing an incompatible function", () => {
  const guard = migration.indexOf("Existing public.get_own_profile() has an incompatible contract.");
  const replacement = migration.indexOf("create or replace function public.get_own_profile()");
  assert.ok(guard >= 0 && replacement > guard);
  assert.match(migration, /pg_catalog\.md5\(procedure\.prosrc\) = expected_body_md5/i);
  assert.match(migration, /public\.profiles does not satisfy the get_own_profile column contract/i);
});

test("only authenticated receives EXECUTE", () => {
  assert.match(
    migration,
    /revoke all on function public\.get_own_profile\(\)\s+from public, anon, authenticated, service_role;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_own_profile\(\)\s+to authenticated;/i,
  );
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:public|anon|service_role)/i);
});

test("migration is one explicit transaction and changes no policies or tables", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+(?:table|policy|trigger)\b/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b/i);
});

test("verifier is read-only and never invokes the RPC", () => {
  assert.match(verifier, /^begin transaction read only;/i);
  assert.match(verifier, /rollback;\s*$/i);
  assert.doesNotMatch(verifier, /select\s+\*\s+from\s+public\.get_own_profile/i);
  assert.doesNotMatch(verifier, /\b(?:create|alter|drop|grant|revoke|insert|update|delete|truncate)\b/i);
  assert.match(verifier, /direct_acl_exact/i);
  assert.match(verifier, /authenticated_execute_allowed/i);
  assert.match(verifier, /service_role_execute_denied/i);
});
