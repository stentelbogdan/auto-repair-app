# Temporary Preview TEST credential check — 5B.25

Status: integrated locally in vercel.json (5B.25B), not published or executed against Supabase.

## Contract

Exactly one GET to the literal HTTPS host `bstjobvvxxfqqwyjoimx.supabase.co`,
path `/auth/v1/admin/users?page=1&per_page=1`. This is the Auth admin listUsers
operation, not a public health endpoint. It reads at most one user; no mutations,
Storage operations, SQL, RPC, pagination follow-up, redirect or retry are used.
The same `SUPABASE_SERVICE_ROLE_KEY` environment variable used by the targeted
server adapter supplies `apikey` and `Authorization: Bearer` headers. No separate
manually entered key, decoded-JWT assertion or secret export is used.

Official references (reviewed 2026-10-29):
- https://supabase.com/docs/reference/javascript/auth-admin-listusers
- https://github.com/supabase/auth/blob/master/internal/api/api.go
- https://github.com/supabase/auth/blob/master/internal/api/middleware.go
- https://github.com/supabase/auth/blob/master/internal/api/admin.go

Acceptance requires all gates followed by HTTP exactly 200, JSON Content-Type,
identity/no Content-Encoding, a complete response of at most 65,536 bytes, and
an object with `users` array (0 or 1 entries) and string `aud`. Each returned user
must be an object with a UUID `id`. Extra administrative fields are not logged.
An empty list is valid: authorization is enforced by the admin endpoint, not by
whether the project has users. Unrecognized responses fail closed.

The body is held only in process memory for validation and is never printed or
written. A legitimate large user-metadata response can exceed the limit and
block this check; that does not prove a bad key. No raw errors or HTTP headers
are printed. Output is exactly one fixed code, with exit 0 only for
`TEST_SERVER_CREDENTIAL_ACCEPTED`; every block exits 1.

TLS certificate verification is explicit. node:https does not follow redirects;
all 3xx are rejected without following Location. Host/path/method are literals,
not configurable inputs. A 10-second total deadline prevents a stalled build;
there is no retry. Debug/TLS-disable environment settings are refused. Do not
run Node with injected preload/inspection agents or shell tracing of secrets.

## Local integration — NOT published

The local vercel.json now contains this command; publication/activation still requires approval:

```sh
if [ "$VERCEL_ENV" = "preview" ]; then node scripts/verify-preview-test-credential.mjs && npm run build -- --webpack; else npm run build; fi
```

Production retains its ordinary build and never invokes the script. The script
itself also refuses non-Preview execution. Preview additionally requires:

- `VERIFY_TEST_SERVER_CREDENTIAL=true` (temporary, scoped to HYBRID Preview)
- `VERCEL=1`
- `VERCEL_GIT_COMMIT_REF=codex/hybrid-autorepair-stable-rebuild`
- `VERCEL_GIT_COMMIT_SHA` exposed by Vercel and a 40-digit lowercase hex SHA
- `EXPECTED_PREVIEW_COMMIT_SHA` set independently by the operator to the complete
  explicitly approved NEW commit SHA (40 lowercase hex characters); exact equality required
- both `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` exactly the TEST HTTPS URL
  (optional trailing slash only)
- `NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF=bstjobvvxxfqqwyjoimx`
- the existing `SUPABASE_SERVICE_ROLE_KEY`, unchanged and secret

Do not hardcode the old SHA: adding these files creates a new commit. Before
activation, the operator must set EXPECTED_PREVIEW_COMMIT_SHA to the newly approved
commit, scoped only to the HYBRID Preview branch. Set it after the local commit is
created/approved but before pushing, because push can trigger deployment. Never
set it dynamically from VERCEL_GIT_COMMIT_SHA: that would remove the authorization
check. No old SHA is hardcoded.
After publication, associate the successful code with that deployment's ID,
commit and build logs, and verify the environment variable is available unchanged
at runtime. Do not treat a pasted/copied success message as deployment evidence.
This confirms administrative acceptance in TEST at build time, not exclusive
provenance, future key validity, database system ID, or an earlier deployment.
No change is made to the current app, package.json or Vercel settings. Only the local vercel.json integration changes the build command.

After diagnosis, remove the temporary invocation, flag and EXPECTED_PREVIEW_COMMIT_SHA together. Merely
turning off the flag while leaving the invocation will correctly block Preview
builds. Do not promote to Production.

## Local tests only

```sh
node --test scripts/verify-preview-test-credential.test.mjs
```

Tests inject a fake HTTPS request function. They never call the live transport,
load .env files, read real credentials, or send network requests. Importing the
module does not invoke the probe. Do NOT execute the script CLI in this stage.

## Vercel Git metadata (5B.25B)

Official reference: https://vercel.com/docs/environment-variables/system-environment-variables
Vercel documents VERCEL, VERCEL_ENV, VERCEL_GIT_COMMIT_REF and
VERCEL_GIT_COMMIT_SHA as available at build time when system variables are exposed.
Confirm “Enable access to System Environment Variables” under Project >
Environment Variables (older UI: “Automatically expose System Environment Variables”)
before publication; this local stage does not inspect or modify the Dashboard.
Missing metadata blocks before any HTTPS request. Both SHA variables must have
the complete 40-character lowercase hex format and must match exactly. A missing
or malformed expected SHA returns BLOCKED_EXPECTED_COMMIT; a different actual SHA
returns BLOCKED_COMMIT_MISMATCH. No HTTPS request occurs in either case. Also match
the actual deployment ID/commit in Vercel when recording evidence. No local git
fallback, system-variable override or hardcoded old commit is used. CLI uploads without Git metadata will intentionally block.

The flag is not set by the build command. Only the authorized HYBRID Preview with
its explicit flag and TEST environment can pass. Other Preview configurations fail
closed; Production still executes exactly `npm run build`.

Local integration tests execute this exact shell command with temporary fake node
and npm executables. They verify ordering, failure propagation, unchanged Production
behavior and inherited synthetic credentials without invoking the real probe.
The offline Next build is run separately, with network denied and synthetic TEST
configuration; it is NOT evidence that the real credential check passed.
