# Supabase TEST — repair-images maintenance barrier E2E

This directory validates the temporary Storage barrier against the existing
post-`130000` TEST database. It never accepts the LIVE system identifier or URL.
Nothing here is a migration.

## Files

- `01_activate_storage_barrier_test.sql` validates the post-`130000` TEST
  baseline and atomically creates the temporary trigger/function.
- `02_verify_storage_barrier_test_readonly.sql` returns exactly seven checks;
  all must be `PASS`.
- `03_remove_storage_barrier_test.sql` removes only the exact temporary
  trigger/function and refuses drifted objects.
- `run_storage_barrier_e2e_test.ts` orchestrates synthetic Storage operations.

The trigger body is byte-identical to the reviewed LIVE trigger body and has
`prosrc_md5 = b0559e204ecc97fcc5438bad0a833396`.

## Preconditions

1. Vercel Cron is disabled and no cleanup worker or other maintenance test is
   running.
2. `PGPASSFILE` points to TEST and has mode `0600` or stricter.
3. `SUPABASE_SERVICE_ROLE_KEY` is the TEST key and exists only in the local
   server-side shell.
4. Set either:
   - `REPAIR_IMAGE_TEST_DB_MODE=direct`, or
   - `REPAIR_IMAGE_TEST_DB_MODE=session_pooler` together with the official
     regional `REPAIR_IMAGE_TEST_POOLER_HOST`.
5. Run from the repository root. Do not run individual mutating SQL scripts in
   SQL Editor while the orchestrated test is running.

The runner verifies PostgreSQL system identifier `7692131729119822239`, rejects
LIVE identifier `7623125441096521075`, calls only
`https://bstjobvvxxfqqwyjoimx.supabase.co`, requires zero cleanup-eligible
registry rows, exactly six quarantined rows, and no existing barrier.

## Approved execution

After explicit approval, from `/Users/bogdan/auto-repair-app`:

```bash
node --experimental-strip-types \
  supabase/tests/test_repair_image_maintenance/run_storage_barrier_e2e_test.ts
```

The runner performs this order:

1. Captures a hash/count snapshot of all existing Storage metadata and the six
   quarantined registry rows.
2. Creates one uniquely named private control bucket.
3. Uploads one synthetic 1×1 PNG to `repair-images` before the barrier.
4. Activates and verifies the barrier (7/7 PASS).
5. In a separate transaction, verifies the exact trigger contract and proves
   that direct PostgreSQL INSERT, UPDATE and DELETE each return SQLSTATE `55000`
   with the exact maintenance message. The transaction always ends in
   `ROLLBACK`; no diagnostic function or object is created. Before DELETE it
   also verifies the exact built-in `protect_objects_delete` contract and sets
   `storage.allow_delete_query=true` transaction-locally, matching the Storage
   service's protected deletion path so the row-level maintenance trigger is
   reached. The setting disappears with the diagnostic transaction rollback.
6. Confirms download remains possible.
7. Confirms service-role INSERT, UPDATE and DELETE in `repair-images` each
   return the exact masked Storage response: `StorageApiError`, message
   `database error, code: 55000`, HTTP status `500` and status code `500`.
   Other HTTP, RLS, authentication, timeout or network errors are rejected.
8. Confirms INSERT, UPDATE, download and DELETE still work in the synthetic
   control bucket.
9. Removes the barrier with the fail-closed remover.
10. Confirms a new upload to `repair-images` works again.
11. Removes only the two synthetic repair images and the synthetic bucket.
12. Requires the final Storage and quarantined snapshots to equal the initial
    snapshots exactly.

## PASS / FAIL

PASS requires the final line `TEST STORAGE BARRIER E2E PASS`, all seven SQL
checks passing, all three direct PostgreSQL probes returning the exact trigger
SQLSTATE/message, all three Storage operations returning the exact masked
`55000` response, control-bucket operations succeeding, download succeeding
during maintenance, restored upload succeeding, and exact before/after
snapshots.

Any unexpected success, missing error, catalog drift, nonzero eligible count,
quarantined-row change, cleanup failure, wrong identity, or snapshot mismatch
is FAIL.

## Recovery

The runner always attempts `03_remove_storage_barrier_test.sql` in `finally`.
Only after confirmed barrier removal does it attempt removal of its UUID-scoped
objects and bucket. If barrier removal fails, it deliberately leaves synthetic
objects untouched and prints `CRITICAL`; run the read-only verifier, inspect the
exact trigger/function contract, and execute the remover manually only after
the mismatch is understood.

Never use a broad Storage cleanup, bucket emptying operation, worker run, or
registry mutation as recovery. Existing objects and the six quarantined rows
must remain untouched.

## Scope limitation

This validates the barrier on the current post-`130000` TEST installation. It
does not retest installation of migration `130000` while the barrier is active.
That exact scenario needs a separate pre-`130000` isolated environment; the
current validated TEST database must not be dismantled to reproduce it.
