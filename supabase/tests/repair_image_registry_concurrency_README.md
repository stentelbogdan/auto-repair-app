# Repair image registry concurrency tests

These tests exercise `repair_image_private` with independent PostgreSQL
connections. They do not call Supabase Storage and must never target the LIVE
project.

## Preconditions

1. Use the isolated Supabase project `autorepair-sql-test`.
2. Apply the final local versions of:
   - `20261003100000_add_repair_image_reference_normalizer.sql`
   - `20261003110000_add_private_repair_image_registry.sql`
3. Install `psql` locally. The runner installs no dependencies.
4. Ensure the connecting role can access the private registry. The browser
   roles intentionally cannot run these tests.
5. Do not use Supabase SQL Editor. The runner needs persistent, independently
   controlled sessions.

## Safe invocation

Provide the isolated connection string through the environment. Do not place it
in shell history, files, command-line arguments, screenshots, or reports.
The URI must use `postgres://` or `postgresql://`, include an explicit host,
port, user, and database, and must not contain a password. The only permitted
query parameter is `sslmode=require`; when omitted, the runner still enforces
that mode. Supply authentication through `PGPASSWORD`, the standard `.pgpass`
file, or an external file named by `PGPASSFILE`.

The runner parses the URI and passes only explicit `PGHOST`, `PGPORT`, `PGUSER`,
`PGDATABASE`, and `PGSSLMODE` values to `psql`. It removes inherited libpq
settings other than `PGPASSWORD` and `PGPASSFILE`, and invokes `psql` with
`--no-password`, so an incomplete configuration fails instead of prompting or
falling back to a local PostgreSQL socket.

Provision an identity manifest outside the repository before running the test.
Obtain `project_ref` independently from the Supabase Dashboard page for the
isolated project, not from the PostgreSQL connection string. Then obtain the
database name and cluster identifier through a separate read-only connection:

```bash
read -rs REPAIR_IMAGE_TEST_DATABASE_URL
export REPAIR_IMAGE_TEST_DATABASE_URL
export PGDATABASE="$REPAIR_IMAGE_TEST_DATABASE_URL"

psql -X -qAt -c \
  "select current_database() || '|' || system_identifier::text from pg_catalog.pg_control_system();"

unset PGDATABASE
```

The result contains the database name and PostgreSQL cluster system identifier,
for example `postgres|1234567890123456789`. These values and the project ref are
non-secret identity attributes. Store the verified values outside the repository:

```json
{
  "purpose": "autorepair-sql-test",
  "project_ref": "replacewithtestref00",
  "database": "postgres",
  "system_identifier": "1234567890123456789"
}
```

Protect the file from modification by other OS users:

```bash
chmod 600 ~/.config/autorepair/autorepair-sql-test-identity.json
```

Then run:

```bash
python3 supabase/tests/repair_image_registry_concurrency.py \
  --confirm-isolated autorepair-sql-test \
  --identity-manifest \
  ~/.config/autorepair/autorepair-sql-test-identity.json

unset REPAIR_IMAGE_TEST_DATABASE_URL
```

To run every identity, target-schema, constraint-trigger, and psql protocol
check without generating a run ID or executing DML, add `--preflight-only`:

```bash
python3 supabase/tests/repair_image_registry_concurrency.py \
  --confirm-isolated autorepair-sql-test \
  --identity-manifest \
  ~/.config/autorepair/autorepair-sql-test-identity.json \
  --preflight-only
```

A successful preflight exits with status `0` and prints exactly:

```text
PREFLIGHT PASS — NO DML EXECUTED
```

Any failed check exits nonzero without printing that message. The preflight
opens only the existing read-only identity, catalog, and psql protocol checks;
it exits before run ID generation, synthetic data setup, scenarios, or cleanup.

The runner requires the manifest to be a regular, non-symlink file outside the
repository, owned by the current OS user, and not group- or world-writable. It
requires the DSN hostname or username to contain the exact test `project_ref`
as a complete dot-delimited component. DSN forms that hide the project ref are
rejected. It independently reads `supabase/.temp/project-ref` and rejects both
a manifest and a DSN naming the LIVE project linked by this repository.

It additionally queries `current_database()` and
`pg_control_system().system_identifier` from the server and compares them with
the independently provisioned manifest. If the function is unavailable, the
result is ambiguous, or any identity component differs, it refuses all
mutations. Every actor repeats the server check inside its own backend. Each
mutation group starts a transaction and runs the identity guard inside that
same transaction before its first DML. The label `autorepair-sql-test` and
values read only from the active connection are never treated as sufficient
proof.

## Independent-session guarantee

Each actor is a separate persistent `psql` process. After `BEGIN`, each actor
captures `pg_backend_pid()` from inside its active transaction. The runner
requires the two simultaneous transactions to have different backend PIDs, so
the check remains valid even when a connection pool assigned a different
backend before the transaction began. A third, one-shot observer connection
queries `pg_stat_activity` and requires the waiting actor to report
`wait_event_type = 'Lock'` before the first actor may commit or roll back.

Every actor uses:

```sql
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '30s';
```

Each blocked operation receives one explicit monotonic observation deadline of
10 seconds. The initial marker probe and all `pg_stat_activity` polling share
that deadline. Scenario 6 reuses the same deadline for its second lock check,
so repeated verification cannot silently extend beyond the lock budget. The
15-second database lock timeout leaves a five-second safety margin. A real
`55P03` or `57014` remains a test failure.

Before any synthetic row is created, a dedicated read-only psql session runs a
protocol preflight:

1. a successful `SELECT` must enter the `\if` success branch with SQLSTATE
   `00000`;
2. a controlled division-by-zero error must enter the `\if` error branch with
   SQLSTATE `22012`;
3. a second successful `SELECT` proves the autocommit session recovered.

This validates `:ERROR`, `:SQLSTATE`, `\if`, `\else`, and `\endif` in the actual
psql version connected to the isolated target. Any mismatch stops the runner
before DML.

Every SQL operation has an immediate `OP_OK`/`OP_FAILED` marker containing its
label and SQLSTATE; the Python controller validates that operation before it
sends the next one. Before COMMIT, the runner executes `SELECT 1` in the same
transaction. If the transaction is already aborted, the SELECT fails and the
runner performs an explicit ROLLBACK instead of issuing COMMIT. A commit marker
is accepted only after that pre-commit probe succeeds and COMMIT itself reports
success. Consequently PostgreSQL's `COMMIT` command returning the command tag
`ROLLBACK` for an aborted transaction cannot be mistaken for a commit.

The runner classifies `40P01` as a deadlock, `55P03`/`57014` as timeouts, and
expected `23514` errors as guard or constraint rejections. An unexpected
outcome, missing lock wait, or wrong final state fails the run.

## Scenarios and expected results

1. **Two simultaneous attaches** — actor B waits for actor A; both commit;
   final state `attached`, two references.
2. **Attach versus tombstone** — attach waits, then is rejected with `23514`;
   final state `tombstoned`, zero references.
3. **Attach versus delete claim** — actor A changes an already tombstoned row
   to `delete_claimed` while holding the parent-row lock. Actor B's reference
   insert waits, then re-reads the committed `delete_claimed` state and is
   rejected with `23514`; final state `delete_claimed`, zero references. This
   verifies lock serialization plus the reference guard after a claim commits.
   It does not test Storage deletion, claim ownership, lease renewal, or a
   worker's external side effects.
4. **Remove last reference versus add** — the new reference waits behind the
   removal/tombstone transaction and is rejected; final state `tombstoned`, zero
   references.
5. **Two state changes** — the second update waits, both legal transitions
   commit in serialization order; final state `quarantined`, zero references.
6. **Deferred failure and waiter release** — actor A removes the last reference
   without leaving `attached`; `SET CONSTRAINTS ALL IMMEDIATE` raises `23514`
   and aborts actor A's transaction. PostgreSQL releases actor A's locks at
   abort, so actor B completes before actor A's explicit session-reset
   `ROLLBACK`. Final state `attached`, two references because actor A's deletion
   rolled back.

All scenarios verify the final registry state from a separate observer
connection. A rejection alone is never considered a passing result.

## Synthetic data and teardown

Every invocation generates and prints a cryptographically random UUID run ID.
Only paths containing that exact run ID are used:

```text
33333333-3333-4333-8333-333333333333/registry-concurrency-4c-<RUN_ID>-
```

The runner first confirms that every generated path is absent. It never deletes
or reuses paths from an earlier run. Physical deletion of registry objects is
forbidden, including in tests. Its `finally` block removes references for only
the exact paths registered by the current process, transitions every non-deleted
object to `quarantined`, and retains already-`deleted` rows. It never touches
`storage.objects` or calls the Storage API.

If the runner is forcibly terminated before teardown, copy the printed `RUN_ID`,
reconnect only to the same verified isolated database, replace `<RUN_ID>` below,
review the matching rows with the first `SELECT`, and then execute the explicit
teardown transaction. Never use a partial run ID or remove the run-ID predicate.

```sql
select bucket_id, object_path, lifecycle_state
from repair_image_private.repair_image_objects
where bucket_id = 'repair-images'
  and object_path like
    '33333333-3333-4333-8333-333333333333/registry-concurrency-4c-<RUN_ID>-%';

begin;

delete from repair_image_private.repair_image_object_references
where bucket_id = 'repair-images'
  and object_path like
    '33333333-3333-4333-8333-333333333333/registry-concurrency-4c-<RUN_ID>-%';

update repair_image_private.repair_image_objects
set lifecycle_state = 'quarantined',
    upload_lease_id = null,
    upload_lease_expires_at = null,
    tombstoned_at = null,
    tombstone_reason = null,
    delete_claim_id = null,
    delete_lease_expires_at = null,
    deleted_at = null
where bucket_id = 'repair-images'
  and lifecycle_state <> 'deleted'
  and object_path like
    '33333333-3333-4333-8333-333333333333/registry-concurrency-4c-<RUN_ID>-%';

set constraints all immediate;

commit;
```

The object rows remain as permanent path reservations. Confirm the target is
isolated before running this teardown.
