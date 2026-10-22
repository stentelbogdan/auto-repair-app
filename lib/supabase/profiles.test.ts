import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  finalizeAuthenticatedRegistration,
  getAuthenticatedProfileDestination,
  type OwnProfile,
  type RegistrationRole,
  // Node's built-in TypeScript runner requires the source extension.
  // @ts-expect-error TS5097 is intentionally limited to this local test import.
} from "./profiles.ts";

type TestError = { code: string; message: string };
type ProfileResult = { data: OwnProfile | null; error: TestError | null };

function testUser(): User {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "customer@example.invalid",
    email_confirmed_at: "2026-10-22T00:00:00.000Z",
    phone: "",
    confirmed_at: "2026-10-22T00:00:00.000Z",
    last_sign_in_at: "2026-10-22T00:00:00.000Z",
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: "2026-10-22T00:00:00.000Z",
    updated_at: "2026-10-22T00:00:00.000Z",
    is_anonymous: false,
  };
}

function profile(id = testUser().id, roles: string[] = ["customer"]): OwnProfile {
  return {
    id,
    email: null,
    full_name: null,
    created_at: null,
    role: roles,
    workshop_name: null,
    workshop_phone: null,
    workshop_address: null,
    workshop_city: null,
    workshop_hours: null,
    workshop_description: null,
    workshop_logo_url: null,
    workshop_gallery_urls: null,
    workshop_slug: null,
    workshop_specializations: null,
    display_name: null,
    city: null,
    gdpr_accepted: null,
    gdpr_accepted_at: null,
  };
}

function mockSupabase(options: {
  profileResults: ProfileResult[];
  insertError?: TestError | null;
  updateError?: TestError | null;
}) {
  const calls: Array<{ operation: string; payload?: unknown; id?: string }> = [];
  const profileResults = [...options.profileResults];

  const client = {
    rpc(name: string) {
      assert.equal(name, "get_own_profile");
      calls.push({ operation: "rpc" });
      return {
        async maybeSingle() {
          const result = profileResults.shift();
          assert.ok(result, "Unexpected profile read");
          return result;
        },
      };
    },
    from(table: string) {
      assert.equal(table, "profiles");
      return {
        async insert(payload: unknown) {
          calls.push({ operation: "insert", payload });
          return { error: options.insertError ?? null };
        },
        update(payload: unknown) {
          calls.push({ operation: "update", payload });
          return {
            async eq(column: string, id: string) {
              assert.equal(column, "id");
              calls.at(-1)!.id = id;
              return { error: options.updateError ?? null };
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

test("missing profile uses INSERT with the implicit customer role", async () => {
  const { client, calls } = mockSupabase({
    profileResults: [{ data: null, error: null }],
  });

  const result = await finalizeAuthenticatedRegistration(client, testUser(), null);

  assert.deepEqual(result, { roles: ["customer"], error: null });
  assert.deepEqual(calls.map((call) => call.operation), ["rpc", "insert"]);
  assert.deepEqual(
    (calls[1].payload as { role: string[] }).role,
    ["customer"],
  );
});

test("existing profile updates only the role and never includes id in the payload", async () => {
  const { client, calls } = mockSupabase({
    profileResults: [{ data: profile(testUser().id, ["customer"]), error: null }],
  });

  const result = await finalizeAuthenticatedRegistration(
    client,
    testUser(),
    "workshop",
  );

  assert.deepEqual(result, {
    roles: ["customer", "workshop"],
    error: null,
  });
  assert.deepEqual(calls[1], {
    operation: "update",
    payload: { role: ["customer", "workshop"] },
    id: testUser().id,
  });
  assert.equal("id" in (calls[1].payload as object), false);
});

test("an invalid privileged requested role cannot assign admin", async () => {
  const { client, calls } = mockSupabase({
    profileResults: [{ data: null, error: null }],
  });

  const result = await finalizeAuthenticatedRegistration(
    client,
    testUser(),
    "admin" as RegistrationRole,
  );

  assert.deepEqual(result.roles, ["customer"]);
  assert.deepEqual(
    (calls[1].payload as { role: string[] }).role,
    ["customer"],
  );
});

test("a concurrent INSERT conflict re-reads and validates the own profile", async () => {
  const { client, calls } = mockSupabase({
    profileResults: [
      { data: null, error: null },
      { data: profile(), error: null },
    ],
    insertError: { code: "23505", message: "duplicate" },
  });

  const result = await finalizeAuthenticatedRegistration(client, testUser(), null);

  assert.deepEqual(result, { roles: ["customer"], error: null });
  assert.deepEqual(calls.map((call) => call.operation), [
    "rpc",
    "insert",
    "rpc",
  ]);
});

test("a SQL error is returned and is never reported as success", async () => {
  const sqlError = { code: "42501", message: "permission denied" };
  const { client } = mockSupabase({
    profileResults: [{ data: null, error: null }],
    insertError: sqlError,
  });

  const result = await finalizeAuthenticatedRegistration(client, testUser(), null);

  assert.deepEqual(result, { roles: [], error: sqlError });
});

test("redirect selection rejects an empty profile and accepts valid roles", () => {
  assert.equal(getAuthenticatedProfileDestination([], null), null);
  assert.equal(
    getAuthenticatedProfileDestination(["customer"], null),
    "/customer/dashboard",
  );
  assert.equal(
    getAuthenticatedProfileDestination(["workshop"], "workshop"),
    "/workshops/dashboard",
  );
});
