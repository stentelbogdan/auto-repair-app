# LIVE repair-images maintenance barrier

These files prepare a narrow maintenance window for migration
`20261003130000_add_repair_image_sync_and_cleanup.sql`. They are not migrations
and must be reviewed and run manually. Every SQL file rejects TEST and any
unknown PostgreSQL system identifier.

## Mechanism

The activation script validates the two legacy `repair-images` policies and
leaves every `storage.objects` policy intact. It adds one temporary `BEFORE
INSERT OR UPDATE OR DELETE` row trigger. The trigger rejects a write whenever
the old or new row belongs to `repair-images`; rows in other buckets pass
through unchanged. It therefore remains effective even when a permissive
alternative policy, a `PUBLIC` policy, or role membership authorizes the SQL
statement. It also covers overwrite/upsert paths that use UPDATE.

This trigger design is required because migration `130000` deliberately fails
if any API-role DELETE policy still exists after it replaces the legacy policy.
A temporary restrictive DELETE policy would make the validated migration roll
back. The trigger does not conflict with that policy postcheck and is removed
only after the migration markers have been verified.

SELECT remains available. The trigger also rejects ordinary service-role and
administrative writes, but a superuser can disable triggers and sessions using
`session_replication_role = replica` can bypass an origin trigger. Cron and the
cleanup worker must remain disabled, and no administrative writer may run.
Creating or dropping a trigger briefly requests a table-level lock on the
shared `storage.objects` table. The mutating scripts set a five-second local
lock timeout and roll back on failure rather than waiting indefinitely; this
brief lock request can still delay concurrent operations in other buckets.

## Approved order

1. Put the compatible application deployment in maintenance mode so no new UI
   workflows begin. This is operational protection; old browser sessions can
   still call Supabase directly.
2. Confirm Cron is disabled and no cleanup worker is running.
3. Install migrations `100000`, `110000`, and `120000` in order and verify each
   transaction completed. Do not install `130000` yet.
4. Run `03_inventory_storage_and_references_live_readonly.sql`; archive its 12
   aggregate rows as snapshot A. Missing objects, owner mismatches, or waiting
   locks are NO-GO.
5. Run `01_activate_storage_barrier_live.sql` once. It validates LIVE identity,
   the legacy upload/delete policy baseline, RLS, the bucket, and the absence
   of migration `130000` before adding the trigger atomically.
6. Run `02_verify_storage_barrier_live_readonly.sql`. Require exactly 8 PASS.
7. Allow already-started HTTP requests time to finish. Observe application and
   Supabase request telemetry outside these scripts. Then run inventory again
   as snapshot B. Require zero missing objects, zero owner mismatches, zero
   waiting locks, and no unexpected change between snapshots.
8. Install migration `130000` unchanged. Its transaction drops the two legacy
   policies. The temporary trigger remains and continues to block Storage
   INSERT/UPDATE/DELETE for `repair-images`.
9. Run `05_remove_storage_barrier_postinstall_live.sql`. It refuses unless the
   reserved policy, cleanup RPCs and all three synchronization triggers exist,
   the old policies are absent, and the exact temporary barrier is present.
10. Run the existing 30-control post-install verifier and require its documented
    PASS/INFO contract. Keep worker and Cron off.
11. Deploy/enable the compatible application and perform controlled functional
    checks. Keep Cron disabled until a separate cleanup activation approval.

## Abort before migration 130000

If activation succeeds but `130000` has not been installed, run
`04_restore_storage_barrier_live.sql`. It verifies LIVE identity, proves the
new policy and cleanup objects are absent, verifies the legacy policy metadata,
and drops only the temporary trigger and function. Activation never changes the
original policies, so their exact catalog state is retained throughout.

Never run the restore script after a successful `130000`. That migration
intentionally replaces the legacy policies; the restore script fails closed in
that state.

## In-flight operations and evidence limits

The trigger barrier is evaluated when Storage executes its database statement.
An INSERT or DELETE whose database statement committed before barrier creation
is already complete. A request accepted earlier but reaching PostgreSQL later
is rejected by the trigger. Multipart/network activity and cached
browser state cannot be proven absent from two database snapshots. Equal
snapshot hashes show only that the selected catalog metadata did not change
between observations.

Database lock counts are point-in-time observations. They do not prove that no
HTTP request exists between the edge and PostgreSQL, and they do not cover
sessions that bypass or disable triggers. GO therefore requires all of: frontend
maintenance, disabled Cron/worker, the trigger barrier, a drain interval,
request telemetry review, clean database lock metrics, and stable aggregate
snapshots.

## Files

- `01_activate_storage_barrier_live.sql`: mutating, transactional activation.
- `02_verify_storage_barrier_live_readonly.sql`: 8 fixed barrier checks.
- `03_inventory_storage_and_references_live_readonly.sql`: 12 aggregate metrics.
- `04_restore_storage_barrier_live.sql`: pre-130000 abort only.
- `05_remove_storage_barrier_postinstall_live.sql`: successful-130000 path only.

None of these scripts deletes Storage objects or calls Storage APIs.
