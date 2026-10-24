#!/usr/bin/env python3
"""Multi-session PostgreSQL concurrency tests for the repair image registry.

This runner intentionally uses independent persistent psql processes. It must
only target an isolated database where migration 20261003110000 is installed.
It never calls Supabase Storage and only creates synthetic registry rows.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse


DSN_ENV = "REPAIR_IMAGE_TEST_DATABASE_URL"
CONFIRMATION = "autorepair-sql-test"
BUCKET = "repair-images"
OWNER = "33333333-3333-4333-8333-333333333333"
PATH_PREFIX = f"{OWNER}/registry-concurrency-4c"
LOCK_TIMEOUT = "15s"
STATEMENT_TIMEOUT = "30s"
LOCK_OBSERVATION_BUDGET_SECONDS = 10.0
MARKER_PROBE_SECONDS = 0.2
OP_OK = "__REGISTRY_OP_OK__"
OP_FAILED = "__REGISTRY_OP_FAILED__"
TX_COMMITTED = "__REGISTRY_TX_COMMITTED__"
TX_COMMIT_FAILED = "__REGISTRY_TX_COMMIT_FAILED__"
TX_PRECOMMIT_ABORTED = "__REGISTRY_TX_PRECOMMIT_ABORTED__"
TX_ROLLED_BACK = "__REGISTRY_TX_ROLLED_BACK__"
EXPECTED_DATABASE: str | None = None
EXPECTED_SYSTEM_IDENTIFIER: str | None = None
EXPECTED_PROJECT_REF: str | None = None


class TestFailure(RuntimeError):
    pass


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def parse_connection_uri(dsn: str) -> dict[str, str]:
    if re.search(r"%(?![0-9A-Fa-f]{2})", dsn):
        raise TestFailure("PostgreSQL connection URI contains invalid percent encoding.")

    try:
        parsed = urlparse(dsn)
        port = parsed.port
        password = parsed.password
    except ValueError as error:
        raise TestFailure("PostgreSQL connection URI is malformed.") from error

    if parsed.scheme not in {"postgres", "postgresql"}:
        raise TestFailure("PostgreSQL connection URI must use postgres:// or postgresql://.")
    if parsed.params or parsed.fragment:
        raise TestFailure("PostgreSQL connection URI contains unsupported components.")
    if password is not None:
        raise TestFailure(
            "PostgreSQL connection URI must not contain a password; use external authentication."
        )

    host = parsed.hostname or ""
    username = unquote(parsed.username or "")
    raw_database = parsed.path[1:] if parsed.path.startswith("/") else ""
    database = unquote(raw_database)
    if not host or not username or not database or port is None:
        raise TestFailure(
            "PostgreSQL connection URI must include host, port, user, and database."
        )
    if not 1 <= port <= 65535:
        raise TestFailure("PostgreSQL connection URI port is out of range.")

    dns_labels = host.split(".")
    if (
        len(host) > 253
        or any(
            re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
            is None
            for label in dns_labels
        )
    ):
        raise TestFailure("PostgreSQL connection URI host is not a valid DNS name.")
    if re.fullmatch(r"[A-Za-z0-9._-]+", username) is None:
        raise TestFailure("PostgreSQL connection URI user is invalid.")
    if re.fullmatch(r"[A-Za-z0-9._-]+", database) is None:
        raise TestFailure("PostgreSQL connection URI database is invalid.")

    try:
        query_items = (
            parse_qsl(
                parsed.query,
                keep_blank_values=True,
                strict_parsing=True,
                max_num_fields=1,
            )
            if parsed.query
            else []
        )
    except ValueError as error:
        raise TestFailure("PostgreSQL connection URI query is malformed.") from error
    if query_items and query_items != [("sslmode", "require")]:
        raise TestFailure(
            "PostgreSQL connection URI only permits the query parameter sslmode=require."
        )

    return {
        "PGHOST": host,
        "PGPORT": str(port),
        "PGUSER": username,
        "PGDATABASE": database,
        "PGSSLMODE": "require",
    }


def psql_environment(dsn: str, application_name: str) -> dict[str, str]:
    connection_environment = parse_connection_uri(dsn)
    env = os.environ.copy()
    # Keep only external authentication from inherited libpq settings. All
    # connection routing is rebuilt from the validated URI so psql cannot fall
    # back to a local socket or an inherited service/host configuration.
    for key in tuple(env):
        if key.startswith("PG") and key not in {"PGPASSWORD", "PGPASSFILE"}:
            env.pop(key)
    env.update(connection_environment)
    env["PGAPPNAME"] = application_name
    env["PGCONNECT_TIMEOUT"] = "10"
    return env


def redact_connection_error(message: str) -> str:
    lines = []
    for line in message.splitlines():
        if "postgresql://" in line or "postgres://" in line:
            lines.append("[connection detail redacted]")
        else:
            lines.append(line)
    return "\n".join(lines)


def run_psql(
    dsn: str,
    sql: str,
    *,
    application_name: str = "repair-image-concurrency-observer",
    tuples_only: bool = False,
    timeout_seconds: float = 30,
) -> str:
    command = ["psql", "-X", "-w", "-v", "ON_ERROR_STOP=1"]
    if tuples_only:
        command.extend(["-qAt"])
    command.extend(["-c", sql])
    result = subprocess.run(
        command,
        env=psql_environment(dsn, application_name),
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
        check=False,
    )
    if result.returncode != 0:
        details = redact_connection_error((result.stdout + result.stderr).strip())
        raise TestFailure(f"psql failed ({result.returncode}):\n{details}")
    return result.stdout.strip()


def expected_identity() -> tuple[str, str]:
    if EXPECTED_DATABASE is None or EXPECTED_SYSTEM_IDENTIFIER is None:
        raise TestFailure("Expected database identity was not configured.")
    return EXPECTED_DATABASE, EXPECTED_SYSTEM_IDENTIFIER


def identity_guard_sql() -> str:
    expected_database, expected_system_identifier = expected_identity()
    return f"""
        do $identity_guard$
        declare
          actual_system_identifier text;
        begin
          select control.system_identifier::text
          into actual_system_identifier
          from pg_catalog.pg_control_system() control;

          if pg_catalog.current_database() is distinct from {sql_literal(expected_database)}
            or actual_system_identifier is distinct from
              {sql_literal(expected_system_identifier)}
          then
            raise exception using
              errcode = '42501',
              message = 'Database identity changed; registry test mutation refused.';
          end if;
        end;
        $identity_guard$;
    """


def run_mutation_psql(
    dsn: str, sql: str, *, application_name: str = "repair-image-concurrency-setup"
) -> str:
    stripped_sql = sql.lstrip()
    if re.match(r"begin\s*;", stripped_sql, flags=re.IGNORECASE) is None:
        raise TestFailure("One-shot mutation groups must start with an explicit transaction.")
    guarded_sql = re.sub(
        r"^begin\s*;",
        "begin;\n" + identity_guard_sql(),
        stripped_sql,
        count=1,
        flags=re.IGNORECASE,
    )
    return run_psql(
        dsn,
        guarded_sql,
        application_name=application_name,
    )


class PsqlSession:
    def __init__(self, dsn: str, name: str):
        self.name = name
        self.process = subprocess.Popen(
            ["psql", "-X", "-w", "-q", "-v", "ON_ERROR_STOP=0"],
            env=psql_environment(dsn, name),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if self.process.stdin is None or self.process.stdout is None:
            raise TestFailure(f"Could not open psql pipes for {name}.")

        self._lines: queue.Queue[str] = queue.Queue()
        self._outputs: dict[str, list[str]] = {}
        self.active_backend_pid: int | None = None
        self._reader = threading.Thread(target=self._read_output, daemon=True)
        self._reader.start()

        try:
            ready = self.send(
                """
                \n\\set VERBOSITY verbose
                \\pset pager off
                \\pset format unaligned
                \\pset tuples_only on
                select 'BACKEND_ID=' || pg_catalog.pg_backend_pid() || '|'
                  || pg_catalog.current_database() || '|'
                  || control.system_identifier::text
                from pg_catalog.pg_control_system() control;
                """,
                "ready",
            )
            completed, output = self.wait(ready, timeout=10)
            if not completed:
                raise TestFailure(f"Timed out starting {name}.")
            identity_lines = [
                line for line in output.splitlines() if line.startswith("BACKEND_ID=")
            ]
            if len(identity_lines) != 1:
                raise TestFailure(f"Could not determine backend identity for {name}.")
            identity_parts = identity_lines[0].split("=", 1)[1].split("|")
            if len(identity_parts) != 3:
                raise TestFailure(f"Backend identity was ambiguous for {name}.")
            backend_pid, database_name, system_identifier = identity_parts
            expected_database, expected_system_identifier = expected_identity()
            if (
                database_name != expected_database
                or system_identifier != expected_system_identifier
            ):
                raise TestFailure(
                    f"Backend identity mismatch for {name}; refusing mutations."
                )
            self.backend_pid = int(backend_pid)
        except Exception:
            self.close()
            raise

    def _read_output(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self._lines.put(line.rstrip("\n"))

    def send(self, sql: str, label: str) -> str:
        if self.process.poll() is not None:
            raise TestFailure(f"psql session {self.name} exited unexpectedly.")
        marker = f"__REGISTRY_TEST_{label}_{uuid.uuid4().hex}__"
        self._outputs[marker] = []
        assert self.process.stdin is not None
        self.process.stdin.write(sql.strip() + "\n")
        self.process.stdin.write(f"\\echo {marker}\n")
        self.process.stdin.flush()
        return marker

    def wait(self, marker: str, timeout: float) -> tuple[bool, str]:
        deadline = time.monotonic() + timeout
        output = self._outputs.setdefault(marker, [])
        while time.monotonic() < deadline:
            remaining = max(0.01, deadline - time.monotonic())
            try:
                line = self._lines.get(timeout=remaining)
            except queue.Empty:
                break
            if line == marker:
                return True, "\n".join(output)
            if line.startswith("TX_BACKEND_PID="):
                try:
                    self.active_backend_pid = int(line.split("=", 1)[1])
                except ValueError as error:
                    raise TestFailure(
                        f"Invalid transaction backend PID from {self.name}."
                    ) from error
            output.append(line)
        return False, "\n".join(output)

    def execute(self, sql: str, label: str, timeout: float = 10) -> str:
        marker = self.send(sql, label)
        completed, output = self.wait(marker, timeout)
        if not completed:
            raise TestFailure(f"Timed out executing {label} in {self.name}.")
        return output

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                assert self.process.stdin is not None
                self.process.stdin.write("\\quit\n")
                self.process.stdin.flush()
                self.process.wait(timeout=3)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.process.terminate()
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.process.kill()


def transaction_prefix() -> str:
    return f"""
        begin;
        {identity_guard_sql()}
        set local lock_timeout = {sql_literal(LOCK_TIMEOUT)};
        set local statement_timeout = {sql_literal(STATEMENT_TIMEOUT)};
        select 'TX_BACKEND_PID=' || pg_catalog.pg_backend_pid();
    """


def checked_operation_sql(sql: str, label: str) -> str:
    if re.fullmatch(r"[a-z0-9_]+", label) is None:
        raise TestFailure(f"Unsafe operation label: {label!r}.")
    normalized_sql = sql.strip()
    if not normalized_sql.endswith(";") or normalized_sql.count(";") != 1:
        raise TestFailure(
            "Each checked concurrent operation must contain exactly one SQL statement."
        )
    return f"""
        {normalized_sql}
        \\if :ERROR
          \\echo {OP_FAILED} LABEL={label} SQLSTATE=:SQLSTATE
        \\else
          \\echo {OP_OK} LABEL={label} SQLSTATE=:SQLSTATE
        \\endif
    """


def commit_outcome_sql() -> str:
    return f"""
        select 1;
        \\if :ERROR
          \\echo {TX_PRECOMMIT_ABORTED} SQLSTATE=:SQLSTATE
          rollback;
        \\else
          commit;
          \\if :ERROR
            \\echo {TX_COMMIT_FAILED} SQLSTATE=:SQLSTATE
          \\else
            \\echo {TX_COMMITTED} SQLSTATE=:SQLSTATE
          \\endif
        \\endif
    """


def rollback_outcome_sql() -> str:
    return f"""
        rollback;
        \\if :ERROR
          \\echo __REGISTRY_TX_ROLLBACK_FAILED__ SQLSTATE=:SQLSTATE
        \\else
          \\echo {TX_ROLLED_BACK} SQLSTATE=:SQLSTATE
        \\endif
    """


def sqlstates(output: str) -> set[str]:
    return set(re.findall(r"(?:ERROR:\s+|SQLSTATE=)([0-9A-Z]{5})", output))


def assert_no_timeout_or_deadlock(output: str, context: str) -> None:
    states = sqlstates(output)
    if "40P01" in states:
        raise TestFailure(f"Deadlock detected in {context}:\n{output}")
    timeout_states = states.intersection({"55P03", "57014"})
    if timeout_states:
        raise TestFailure(
            f"PostgreSQL timeout {sorted(timeout_states)} in {context}:\n{output}"
        )


def assert_operation_succeeded(output: str, label: str, context: str) -> None:
    assert_no_timeout_or_deadlock(output, context)
    expected_marker = f"{OP_OK} LABEL={label} SQLSTATE=00000"
    if expected_marker not in output or OP_FAILED in output or sqlstates(output) != {"00000"}:
        raise TestFailure(
            f"PostgreSQL operation did not complete cleanly in {context}:\n{output}"
        )


def assert_operation_rejected(
    output: str, label: str, sqlstate: str, context: str
) -> None:
    assert_no_timeout_or_deadlock(output, context)
    expected_marker = f"{OP_FAILED} LABEL={label} SQLSTATE={sqlstate}"
    observed_states = sqlstates(output)
    if expected_marker not in output or OP_OK in output or observed_states != {sqlstate}:
        raise TestFailure(
            f"Expected operation rejection {sqlstate} in {context}:\n{output}"
        )


def assert_transaction_committed(output: str, context: str) -> None:
    assert_no_timeout_or_deadlock(output, context)
    unexpected_states = sqlstates(output).difference({"00000"})
    if (
        TX_COMMITTED not in output
        or TX_COMMIT_FAILED in output
        or TX_PRECOMMIT_ABORTED in output
        or unexpected_states
    ):
        raise TestFailure(f"Transaction did not commit cleanly in {context}:\n{output}")


def assert_transaction_rolled_back(output: str, context: str) -> None:
    assert_no_timeout_or_deadlock(output, context)
    unexpected_states = sqlstates(output).difference({"00000"})
    if (
        TX_ROLLED_BACK not in output
        or "__REGISTRY_TX_ROLLBACK_FAILED__" in output
        or unexpected_states
    ):
        raise TestFailure(f"Transaction did not roll back cleanly in {context}:\n{output}")


def lock_observation_deadline() -> float:
    return time.monotonic() + LOCK_OBSERVATION_BUDGET_SECONDS


def backend_activity_snapshot(
    dsn: str, backend_pids: tuple[int, ...], *, timeout_seconds: float = 30
) -> dict[int, tuple[str, str, str, tuple[int, ...]]]:
    if not backend_pids or any(pid <= 0 for pid in backend_pids):
        raise TestFailure("Backend activity diagnostic received an invalid PID.")
    pid_list = ", ".join(str(pid) for pid in backend_pids)
    result = run_psql(
        dsn,
        f"""
        select pg_catalog.concat_ws(
          '|',
          activity.pid::text,
          activity.state,
          coalesce(activity.wait_event_type, ''),
          coalesce(activity.wait_event, ''),
          coalesce(pg_catalog.array_to_string(
            pg_catalog.pg_blocking_pids(activity.pid), ','
          ), '')
        )
        from pg_catalog.pg_stat_activity activity
        where activity.pid in ({pid_list})
        order by activity.pid;
        """,
        tuples_only=True,
        timeout_seconds=timeout_seconds,
    )
    snapshot: dict[int, tuple[str, str, str, tuple[int, ...]]] = {}
    for line in result.splitlines():
        parts = line.split("|")
        if len(parts) != 5:
            raise TestFailure(f"Malformed pg_stat_activity diagnostic row: {line!r}")
        pid_text, state, wait_event_type, wait_event, blockers_text = parts
        try:
            pid = int(pid_text)
            blockers = tuple(
                int(value) for value in blockers_text.split(",") if value
            )
        except ValueError as error:
            raise TestFailure(
                f"Malformed backend PID in pg_stat_activity diagnostic: {line!r}"
            ) from error
        snapshot[pid] = (state, wait_event_type, wait_event, blockers)
    return snapshot


def format_backend_diagnostics(
    snapshot: dict[int, tuple[str, str, str, tuple[int, ...]]]
) -> str:
    return "; ".join(
        f"pid={pid} state={state!r} wait={wait_event_type!r}/{wait_event!r} "
        f"blockers={list(blockers)}"
        for pid, (state, wait_event_type, wait_event, blockers) in sorted(
            snapshot.items()
        )
    )


def record_backend_diagnostics(
    dsn: str, actor_a_pid: int, actor_b_pid: int, context: str
) -> dict[int, tuple[str, str, str, tuple[int, ...]]]:
    snapshot = backend_activity_snapshot(dsn, (actor_a_pid, actor_b_pid))
    print(f"DIAGNOSTIC {context}: {format_backend_diagnostics(snapshot)}")
    return snapshot


def wait_until_lock_wait(
    dsn: str,
    backend_pid: int,
    expected_blocker_pid: int,
    deadline: float,
    context: str,
) -> None:
    last_snapshot: dict[int, tuple[str, str, str, tuple[int, ...]]] = {}
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        last_snapshot = backend_activity_snapshot(
            dsn,
            (expected_blocker_pid, backend_pid),
            timeout_seconds=max(0.1, min(2.0, remaining)),
        )
        waiter = last_snapshot.get(backend_pid)
        if (
            waiter is not None
            and waiter[1] == "Lock"
            and expected_blocker_pid in waiter[3]
        ):
            print(
                f"DIAGNOSTIC {context}: "
                f"{format_backend_diagnostics(last_snapshot)}"
            )
            return
        time.sleep(min(0.05, max(0.0, remaining)))
    raise TestFailure(
        f"Backend {backend_pid} did not report backend {expected_blocker_pid} as its "
        f"PostgreSQL blocker in {context}. Last activity: "
        f"{format_backend_diagnostics(last_snapshot)}"
    )


def assert_blocked(
    dsn: str,
    session: PsqlSession,
    marker: str,
    competing_session: PsqlSession,
    deadline: float,
    context: str,
) -> None:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TestFailure("Lock-observation deadline expired before verification.")
    completed, output = session.wait(
        marker,
        timeout=min(MARKER_PROBE_SECONDS, remaining),
    )
    if completed:
        diagnostics = "backend PIDs unavailable"
        if (
            session.active_backend_pid is not None
            and competing_session.active_backend_pid is not None
        ):
            diagnostics = format_backend_diagnostics(
                record_backend_diagnostics(
                    dsn,
                    competing_session.active_backend_pid,
                    session.active_backend_pid,
                    context,
                )
            )
        raise TestFailure(
            f"{session.name} completed before the competing lock was released "
            f"in {context}. Activity: {diagnostics}\n{output}"
        )
    if session.active_backend_pid is None or competing_session.active_backend_pid is None:
        raise TestFailure("Could not identify both active transaction backends.")
    if session.active_backend_pid == competing_session.active_backend_pid:
        raise TestFailure("Concurrent actors are not using independent transaction backends.")
    wait_until_lock_wait(
        dsn,
        session.active_backend_pid,
        competing_session.active_backend_pid,
        deadline,
        context,
    )


def finish_pending(session: PsqlSession, marker: str, context: str) -> str:
    completed, output = session.wait(marker, timeout=10)
    if not completed:
        raise TestFailure(f"Timed out waiting for {context}.")
    return output


def synthetic_path(run_id: str, scenario: str) -> str:
    return f"{PATH_PREFIX}-{run_id}-{scenario}.jpg"


def register_synthetic_path(dsn: str, path: str, paths: list[str]) -> None:
    existing = run_psql(
        dsn,
        f"""
        select pg_catalog.count(*)
        from repair_image_private.repair_image_objects
        where bucket_id = {sql_literal(BUCKET)}
          and object_path = {sql_literal(path)};
        """,
        tuples_only=True,
    )
    if existing != "0":
        raise TestFailure(
            "The generated run-specific path already exists; refusing to reuse or clean it."
        )
    paths.append(path)


def cleanup_sql(paths: list[str]) -> str:
    path_list = ", ".join(sql_literal(path) for path in paths)
    return f"""
        begin;
        delete from repair_image_private.repair_image_object_references
        where bucket_id = {sql_literal(BUCKET)}
          and object_path in ({path_list});

        update repair_image_private.repair_image_objects
        set lifecycle_state = 'quarantined',
            upload_lease_id = null,
            upload_lease_expires_at = null,
            tombstoned_at = null,
            tombstone_reason = null,
            delete_claim_id = null,
            delete_lease_expires_at = null,
            deleted_at = null
        where bucket_id = {sql_literal(BUCKET)}
          and object_path in ({path_list})
          and lifecycle_state <> 'deleted';

        set constraints all immediate;

        do $cleanup_check$
        begin
          if exists (
            select 1
            from repair_image_private.repair_image_object_references reference
            where reference.bucket_id = {sql_literal(BUCKET)}
              and reference.object_path in ({path_list})
          ) or exists (
            select 1
            from repair_image_private.repair_image_objects registry
            where registry.bucket_id = {sql_literal(BUCKET)}
              and registry.object_path in ({path_list})
              and registry.lifecycle_state not in ('quarantined', 'deleted')
          ) then
            raise exception using
              errcode = '23514',
              message = 'Synthetic registry teardown did not reach a retained terminal state.';
          end if;
        end;
        $cleanup_check$;

        commit;
    """


def seed_uploaded(dsn: str, path: str) -> None:
    run_mutation_psql(
        dsn,
        f"""
        begin;
        insert into repair_image_private.repair_image_objects (
          bucket_id, object_path, owner_user_id, lifecycle_state, origin
        ) values (
          {sql_literal(BUCKET)}, {sql_literal(path)}, {sql_literal(OWNER)}::uuid,
          'discovered', 'reconciliation'
        );
        update repair_image_private.repair_image_objects
        set lifecycle_state = 'uploaded', uploaded_at = pg_catalog.clock_timestamp()
        where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
        commit;
        """,
    )


def seed_tombstoned(dsn: str, path: str) -> None:
    seed_uploaded(dsn, path)
    run_mutation_psql(
        dsn,
        f"""
        begin;
        update repair_image_private.repair_image_objects
        set lifecycle_state = 'tombstoned',
            tombstoned_at = pg_catalog.clock_timestamp(),
            tombstone_reason = 'concurrency_test'
        where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
        commit;
        """,
    )


def seed_attached(dsn: str, path: str, reference_id: str) -> None:
    run_mutation_psql(
        dsn,
        f"""
        begin;
        insert into repair_image_private.repair_image_objects (
          bucket_id, object_path, owner_user_id, lifecycle_state, origin
        ) values (
          {sql_literal(BUCKET)}, {sql_literal(path)}, {sql_literal(OWNER)}::uuid,
          'discovered', 'legacy_import'
        );
        insert into repair_image_private.repair_image_object_references (
          bucket_id, object_path, reference_id
        ) values (
          {sql_literal(BUCKET)}, {sql_literal(path)}, {sql_literal(reference_id)}::uuid
        );
        update repair_image_private.repair_image_objects
        set lifecycle_state = 'attached'
        where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
        commit;
        """,
    )


def final_state(dsn: str, path: str) -> tuple[str, int]:
    result = run_psql(
        dsn,
        f"""
        select registry.lifecycle_state || '|' || (
          select pg_catalog.count(*)::text
          from repair_image_private.repair_image_object_references reference
          where reference.bucket_id = registry.bucket_id
            and reference.object_path = registry.object_path
        )
        from repair_image_private.repair_image_objects registry
        where registry.bucket_id = {sql_literal(BUCKET)}
          and registry.object_path = {sql_literal(path)};
        """,
        tuples_only=True,
    )
    parts = result.split("|")
    if len(parts) != 2:
        raise TestFailure(f"Unexpected final-state result for synthetic object: {result!r}")
    return parts[0], int(parts[1])


def assert_final_state(dsn: str, path: str, state: str, references: int) -> None:
    actual = final_state(dsn, path)
    expected = (state, references)
    if actual != expected:
        raise TestFailure(f"Expected final state {expected}, received {actual}.")


def sessions(dsn: str, scenario: str) -> tuple[PsqlSession, PsqlSession]:
    actor_a = PsqlSession(dsn, f"repair-image-{scenario}-actor-a")
    try:
        actor_b = PsqlSession(dsn, f"repair-image-{scenario}-actor-b")
    except Exception:
        actor_a.close()
        raise
    return actor_a, actor_b


def validate_psql_protocol(dsn: str) -> None:
    session = PsqlSession(dsn, "repair-image-protocol-preflight")
    try:
        success_output = session.execute(
            checked_operation_sql("select 1;", "protocol_success"),
            "protocol_success",
        )
        assert_operation_succeeded(
            success_output,
            "protocol_success",
            "psql protocol successful statement",
        )

        error_output = session.execute(
            checked_operation_sql("select 1 / 0;", "protocol_error"),
            "protocol_error",
        )
        assert_operation_rejected(
            error_output,
            "protocol_error",
            "22012",
            "psql protocol controlled error",
        )

        recovery_output = session.execute(
            checked_operation_sql("select 1;", "protocol_recovery"),
            "protocol_recovery",
        )
        assert_operation_succeeded(
            recovery_output,
            "protocol_recovery",
            "psql protocol recovery statement",
        )
    finally:
        session.close()


def scenario_two_attaches(dsn: str, run_id: str, paths: list[str]) -> None:
    path = synthetic_path(run_id, "01-two-attaches")
    register_synthetic_path(dsn, path, paths)
    seed_uploaded(dsn, path)
    actor_a, actor_b = sessions(dsn, "01")
    try:
        output_a = actor_a.execute(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            insert into repair_image_private.repair_image_object_references
              (bucket_id, object_path, reference_id)
            values ({sql_literal(BUCKET)}, {sql_literal(path)},
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid);
                """,
                "insert_reference_a",
            ),
            "actor_a_insert",
        )
        assert_operation_succeeded(
            output_a, "insert_reference_a", "scenario 1 actor A insert"
        )
        output_a = actor_a.execute(
            checked_operation_sql(
                f"""
            update repair_image_private.repair_image_objects
            set lifecycle_state = 'attached'
            where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
                """,
                "attach_object_a",
            ),
            "actor_a_attach",
        )
        assert_operation_succeeded(
            output_a, "attach_object_a", "scenario 1 actor A attach"
        )
        pending_b = actor_b.send(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            insert into repair_image_private.repair_image_object_references
              (bucket_id, object_path, reference_id)
            values ({sql_literal(BUCKET)}, {sql_literal(path)},
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid);
                """,
                "insert_reference_b",
            ),
            "actor_b_insert",
        )
        lock_deadline = lock_observation_deadline()
        assert_blocked(
            dsn,
            actor_b,
            pending_b,
            actor_a,
            lock_deadline,
            "scenario 1 before actor A commit",
        )
        assert_transaction_committed(
            actor_a.execute(commit_outcome_sql(), "actor_a_commit"),
            "scenario 1 actor A commit",
        )
        assert_operation_succeeded(
            finish_pending(actor_b, pending_b, "scenario 1 actor B insert"),
            "insert_reference_b",
            "scenario 1 actor B insert",
        )
        output_b = actor_b.execute(
            checked_operation_sql(
                f"""
                update repair_image_private.repair_image_objects
                set lifecycle_state = 'attached'
                where bucket_id = {sql_literal(BUCKET)}
                  and object_path = {sql_literal(path)};
                """,
                "attach_object_b",
            ),
            "actor_b_attach",
        )
        assert_operation_succeeded(
            output_b, "attach_object_b", "scenario 1 actor B attach"
        )
        assert_transaction_committed(
            actor_b.execute(commit_outcome_sql(), "actor_b_commit"),
            "scenario 1 actor B commit",
        )
        assert_final_state(dsn, path, "attached", 2)
    finally:
        actor_a.close()
        actor_b.close()


def scenario_attach_vs_tombstone(dsn: str, run_id: str, paths: list[str]) -> None:
    path = synthetic_path(run_id, "02-attach-vs-tombstone")
    register_synthetic_path(dsn, path, paths)
    seed_uploaded(dsn, path)
    actor_a, actor_b = sessions(dsn, "02")
    try:
        output_a = actor_a.execute(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            update repair_image_private.repair_image_objects
            set lifecycle_state = 'tombstoned',
                tombstoned_at = pg_catalog.clock_timestamp(),
                tombstone_reason = 'concurrency_test'
            where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
                """,
                "tombstone_object_a",
            ),
            "actor_a_tombstoned",
        )
        assert_operation_succeeded(
            output_a, "tombstone_object_a", "scenario 2 actor A tombstone"
        )
        pending_b = actor_b.send(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            insert into repair_image_private.repair_image_object_references
              (bucket_id, object_path, reference_id)
            values ({sql_literal(BUCKET)}, {sql_literal(path)},
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid);
                """,
                "insert_reference_b",
            ),
            "actor_b_attach",
        )
        lock_deadline = lock_observation_deadline()
        assert_blocked(
            dsn,
            actor_b,
            pending_b,
            actor_a,
            lock_deadline,
            "scenario 2 before actor A commit",
        )
        assert_transaction_committed(
            actor_a.execute(commit_outcome_sql(), "actor_a_commit"),
            "scenario 2 actor A commit",
        )
        assert_operation_rejected(
            finish_pending(actor_b, pending_b, "scenario 2 actor B"),
            "insert_reference_b",
            "23514",
            "scenario 2 actor B attach rejection",
        )
        assert_transaction_rolled_back(
            actor_b.execute(rollback_outcome_sql(), "actor_b_rollback"),
            "scenario 2 actor B rollback",
        )
        assert_final_state(dsn, path, "tombstoned", 0)
    finally:
        actor_a.close()
        actor_b.close()


def scenario_attach_vs_delete_claim(dsn: str, run_id: str, paths: list[str]) -> None:
    path = synthetic_path(run_id, "03-attach-vs-delete-claim")
    register_synthetic_path(dsn, path, paths)
    seed_tombstoned(dsn, path)
    actor_a, actor_b = sessions(dsn, "03")
    try:
        output_a = actor_a.execute(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            update repair_image_private.repair_image_objects
            set lifecycle_state = 'delete_claimed',
                delete_claim_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'::uuid,
                delete_lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes'
            where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
                """,
                "claim_object_a",
            ),
            "actor_a_claimed",
        )
        assert_operation_succeeded(
            output_a, "claim_object_a", "scenario 3 actor A claim"
        )
        pending_b = actor_b.send(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            insert into repair_image_private.repair_image_object_references
              (bucket_id, object_path, reference_id)
            values ({sql_literal(BUCKET)}, {sql_literal(path)},
              'cccccccc-cccc-4ccc-8ccc-cccccccccccb'::uuid);
                """,
                "insert_reference_b",
            ),
            "actor_b_attach",
        )
        lock_deadline = lock_observation_deadline()
        assert_blocked(
            dsn,
            actor_b,
            pending_b,
            actor_a,
            lock_deadline,
            "scenario 3 before actor A commit",
        )
        assert_transaction_committed(
            actor_a.execute(commit_outcome_sql(), "actor_a_commit"),
            "scenario 3 actor A commit",
        )
        assert_operation_rejected(
            finish_pending(actor_b, pending_b, "scenario 3 actor B"),
            "insert_reference_b",
            "23514",
            "scenario 3 actor B attach rejection",
        )
        assert_transaction_rolled_back(
            actor_b.execute(rollback_outcome_sql(), "actor_b_rollback"),
            "scenario 3 actor B rollback",
        )
        assert_final_state(dsn, path, "delete_claimed", 0)
    finally:
        actor_a.close()
        actor_b.close()


def scenario_remove_last_vs_new_reference(dsn: str, run_id: str, paths: list[str]) -> None:
    path = synthetic_path(run_id, "04-remove-last-vs-new")
    register_synthetic_path(dsn, path, paths)
    old_reference = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
    seed_attached(dsn, path, old_reference)
    actor_a, actor_b = sessions(dsn, "04")
    try:
        output_a = actor_a.execute(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            delete from repair_image_private.repair_image_object_references
            where bucket_id = {sql_literal(BUCKET)}
              and object_path = {sql_literal(path)}
              and reference_id = {sql_literal(old_reference)}::uuid;
                """,
                "delete_last_reference_a",
            ),
            "actor_a_delete_reference",
        )
        assert_operation_succeeded(
            output_a,
            "delete_last_reference_a",
            "scenario 4 actor A delete reference",
        )
        output_a = actor_a.execute(
            checked_operation_sql(
                f"""
            update repair_image_private.repair_image_objects
            set lifecycle_state = 'tombstoned',
                tombstoned_at = pg_catalog.clock_timestamp(),
                tombstone_reason = 'concurrency_test'
            where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
                """,
                "tombstone_object_a",
            ),
            "actor_a_tombstone",
        )
        assert_operation_succeeded(
            output_a, "tombstone_object_a", "scenario 4 actor A tombstone"
        )
        pending_b = actor_b.send(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            insert into repair_image_private.repair_image_object_references
              (bucket_id, object_path, reference_id)
            values ({sql_literal(BUCKET)}, {sql_literal(path)},
              'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'::uuid);
                """,
                "insert_reference_b",
            ),
            "actor_b_new_reference",
        )
        lock_deadline = lock_observation_deadline()
        assert_blocked(
            dsn,
            actor_b,
            pending_b,
            actor_a,
            lock_deadline,
            "scenario 4 before actor A commit",
        )
        assert_transaction_committed(
            actor_a.execute(commit_outcome_sql(), "actor_a_commit"),
            "scenario 4 actor A commit",
        )
        assert_operation_rejected(
            finish_pending(actor_b, pending_b, "scenario 4 actor B"),
            "insert_reference_b",
            "23514",
            "scenario 4 actor B rejection",
        )
        assert_transaction_rolled_back(
            actor_b.execute(rollback_outcome_sql(), "actor_b_rollback"),
            "scenario 4 actor B rollback",
        )
        assert_final_state(dsn, path, "tombstoned", 0)
    finally:
        actor_a.close()
        actor_b.close()


def scenario_two_state_changes(dsn: str, run_id: str, paths: list[str]) -> None:
    path = synthetic_path(run_id, "05-two-state-changes")
    register_synthetic_path(dsn, path, paths)
    seed_uploaded(dsn, path)
    actor_a, actor_b = sessions(dsn, "05")
    try:
        output_a = actor_a.execute(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            update repair_image_private.repair_image_objects
            set lifecycle_state = 'orphan_candidate',
                unreferenced_since = pg_catalog.clock_timestamp() - interval '25 hours',
                last_reference_scan_at = pg_catalog.clock_timestamp(),
                consecutive_unreferenced_scans = 2
            where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
                """,
                "mark_orphan_a",
            ),
            "actor_a_orphan",
        )
        assert_operation_succeeded(
            output_a, "mark_orphan_a", "scenario 5 actor A state change"
        )
        pending_b = actor_b.send(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            update repair_image_private.repair_image_objects
            set lifecycle_state = 'quarantined'
            where bucket_id = {sql_literal(BUCKET)} and object_path = {sql_literal(path)};
                """,
                "quarantine_object_b",
            ),
            "actor_b_quarantine",
        )
        lock_deadline = lock_observation_deadline()
        assert_blocked(
            dsn,
            actor_b,
            pending_b,
            actor_a,
            lock_deadline,
            "scenario 5 before actor A commit",
        )
        assert_transaction_committed(
            actor_a.execute(commit_outcome_sql(), "actor_a_commit"),
            "scenario 5 actor A commit",
        )
        assert_operation_succeeded(
            finish_pending(actor_b, pending_b, "scenario 5 actor B"),
            "quarantine_object_b",
            "scenario 5 actor B state change",
        )
        assert_transaction_committed(
            actor_b.execute(commit_outcome_sql(), "actor_b_commit"),
            "scenario 5 actor B commit",
        )
        assert_final_state(dsn, path, "quarantined", 0)
    finally:
        actor_a.close()
        actor_b.close()


def scenario_deferred_failure_releases_waiter(
    dsn: str, run_id: str, paths: list[str]
) -> None:
    path = synthetic_path(run_id, "06-deferred-rollback")
    register_synthetic_path(dsn, path, paths)
    old_reference = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
    seed_attached(dsn, path, old_reference)
    actor_a, actor_b = sessions(dsn, "06")
    try:
        output_a = actor_a.execute(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            with deleted_reference as (
              delete from repair_image_private.repair_image_object_references
              where bucket_id = {sql_literal(BUCKET)}
                and object_path = {sql_literal(path)}
                and reference_id = {sql_literal(old_reference)}::uuid
              returning 1
            )
            select 'DELETE_COUNT=' || pg_catalog.count(*)::text
            from deleted_reference;
                """,
                "delete_last_reference_a",
            ),
            "actor_a_removed_only",
        )
        assert_operation_succeeded(
            output_a,
            "delete_last_reference_a",
            "scenario 6 actor A delete",
        )
        if output_a.splitlines().count("DELETE_COUNT=1") != 1:
            raise TestFailure(
                "Scenario 6 actor A did not delete exactly one reference:\n"
                + output_a
            )
        pending_b = actor_b.send(
            transaction_prefix()
            + checked_operation_sql(
                f"""
            insert into repair_image_private.repair_image_object_references
              (bucket_id, object_path, reference_id)
            values ({sql_literal(BUCKET)}, {sql_literal(path)},
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid);
                """,
                "insert_reference_b",
            ),
            "actor_b_waiting_attach",
        )
        lock_deadline = lock_observation_deadline()
        assert_blocked(
            dsn,
            actor_b,
            pending_b,
            actor_a,
            lock_deadline,
            "scenario 6 before deferred constraint check",
        )

        constraint_output = actor_a.execute(
            checked_operation_sql(
                "set constraints all immediate;",
                "force_deferred_constraints_a",
            ),
            "actor_a_force_constraints",
        )
        assert_operation_rejected(
            constraint_output,
            "force_deferred_constraints_a",
            "23514",
            "scenario 6 deferred trigger rejection",
        )
        if actor_a.active_backend_pid is None or actor_b.active_backend_pid is None:
            raise TestFailure(
                "Scenario 6 could not identify both backends after deferred failure."
            )
        actor_b_output = finish_pending(
            actor_b,
            pending_b,
            "scenario 6 actor B release after actor A abort",
        )
        assert_operation_succeeded(
            actor_b_output,
            "insert_reference_b",
            "scenario 6 actor B insert after actor A abort",
        )
        activity = record_backend_diagnostics(
            dsn,
            actor_a.active_backend_pid,
            actor_b.active_backend_pid,
            "scenario 6 after deferred constraint error",
        )
        actor_a_activity = activity.get(actor_a.active_backend_pid)
        actor_b_activity = activity.get(actor_b.active_backend_pid)
        if actor_a_activity is None or actor_a_activity[0] != "idle in transaction (aborted)":
            raise TestFailure(
                "Scenario 6 actor A was not idle in transaction (aborted) after "
                "the deferred constraint error: "
                + format_backend_diagnostics(activity)
            )
        if (
            actor_b_activity is None
            or actor_b_activity[1] == "Lock"
            or actor_b_activity[3]
        ):
            raise TestFailure(
                "Scenario 6 actor B remained blocked after actor A's transaction "
                "aborted: "
                + format_backend_diagnostics(activity)
            )

        # PostgreSQL aborts actor A's transaction when the deferred constraint
        # trigger raises 23514. That abort rolls back the deleted reference and
        # releases actor A's locks, allowing actor B to finish before this
        # explicit ROLLBACK resets actor A's failed transaction block.
        assert_transaction_rolled_back(
            actor_a.execute(rollback_outcome_sql(), "actor_a_rollback"),
            "scenario 6 actor A rollback",
        )
        output_b = actor_b.execute(
            checked_operation_sql(
                f"""
                update repair_image_private.repair_image_objects
                set lifecycle_state = 'attached'
                where bucket_id = {sql_literal(BUCKET)}
                  and object_path = {sql_literal(path)};
                """,
                "attach_object_b",
            ),
            "actor_b_attach",
        )
        assert_operation_succeeded(
            output_b, "attach_object_b", "scenario 6 actor B attach"
        )
        assert_transaction_committed(
            actor_b.execute(commit_outcome_sql(), "actor_b_commit"),
            "scenario 6 actor B commit",
        )
        assert_final_state(dsn, path, "attached", 2)
    finally:
        actor_a.close()
        actor_b.close()


def validate_target(dsn: str) -> None:
    result = run_psql(
        dsn,
        """
        select
          pg_catalog.to_regclass('repair_image_private.repair_image_objects') is not null
          and pg_catalog.to_regclass('repair_image_private.repair_image_object_references') is not null
          and exists (
            select 1 from pg_catalog.pg_trigger
            where tgname = 'enforce_repair_image_object_consistency'
              and tgconstraint <> 0
              and tgdeferrable
              and tginitdeferred
          )
          and exists (
            select 1 from pg_catalog.pg_trigger
            where tgname = 'enforce_repair_image_reference_consistency'
              and tgconstraint <> 0
              and tgdeferrable
              and tginitdeferred
          )
          and exists (
            select 1
            from pg_catalog.pg_trigger registry_trigger
            join pg_catalog.pg_class relation
              on relation.oid = registry_trigger.tgrelid
            join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
            where registry_trigger.tgname = 'prevent_repair_image_object_delete'
              and namespace.nspname = 'repair_image_private'
              and relation.relname = 'repair_image_objects'
              and not registry_trigger.tgisinternal
              and (registry_trigger.tgtype & 2) = 2
              and (registry_trigger.tgtype & 8) = 8
          );
        """,
        tuples_only=True,
    )
    if result != "t":
        raise TestFailure(
            "The isolated target does not contain the hardened registry migration."
        )


def verify_database_identity(
    dsn: str, expected_database: str, expected_system_identifier: str
) -> None:
    if not expected_database or not expected_system_identifier.isdecimal():
        raise TestFailure("Expected database identity is incomplete or malformed.")

    result = run_psql(
        dsn,
        """
        select pg_catalog.current_database() || '|' || control.system_identifier::text
        from pg_catalog.pg_control_system() control;
        """,
        application_name="repair-image-identity-check",
        tuples_only=True,
    )
    parts = result.split("|")
    if len(parts) != 2 or not parts[1].isdecimal():
        raise TestFailure(
            "Could not verify the database identity unambiguously; refusing all mutations."
        )
    actual_database, actual_system_identifier = parts
    if (
        actual_database != expected_database
        or actual_system_identifier != expected_system_identifier
    ):
        raise TestFailure(
            "Database identity mismatch; refusing all mutations "
            f"(connected database={actual_database!r}, system identifier mismatch="
            f"{actual_system_identifier != expected_system_identifier})."
        )


def load_identity_manifest(path_value: str) -> tuple[str, str, str]:
    path = Path(path_value).expanduser()
    if path.is_symlink() or not path.is_file():
        raise TestFailure("Identity manifest must be a regular, non-symlink file.")
    resolved = path.resolve()
    repository_root = Path(__file__).resolve().parents[2]
    if resolved == repository_root or repository_root in resolved.parents:
        raise TestFailure("Identity manifest must be stored outside the repository.")
    file_stat = resolved.stat()
    if file_stat.st_uid != os.getuid():
        raise TestFailure("Identity manifest must be owned by the current OS user.")
    if file_stat.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise TestFailure("Identity manifest must not be group- or world-writable.")

    try:
        manifest = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise TestFailure(f"Could not read identity manifest: {error}") from error
    if not isinstance(manifest, dict):
        raise TestFailure("Identity manifest must contain a JSON object.")
    if manifest.get("purpose") != CONFIRMATION:
        raise TestFailure("Identity manifest purpose is not the isolated test project.")
    project_ref = manifest.get("project_ref")
    database = manifest.get("database")
    system_identifier = manifest.get("system_identifier")
    if not isinstance(project_ref, str) or re.fullmatch(r"[a-z0-9]{20}", project_ref) is None:
        raise TestFailure("Identity manifest project_ref is malformed.")
    if not isinstance(database, str) or not database:
        raise TestFailure("Identity manifest database is missing.")
    if not isinstance(system_identifier, str) or not system_identifier.isdecimal():
        raise TestFailure("Identity manifest system_identifier is malformed.")
    return project_ref, database, system_identifier


def dsn_contains_exact_project_ref(dsn: str, project_ref: str) -> bool:
    parsed = urlparse(dsn)
    hostname_parts = (parsed.hostname or "").lower().split(".")
    username_parts = unquote(parsed.username or "").lower().split(".")
    return project_ref.lower() in set(hostname_parts + username_parts)


def refuse_linked_live_project(dsn: str, expected_project_ref: str) -> None:
    live_ref_file = Path(__file__).resolve().parents[1] / ".temp" / "project-ref"
    if not live_ref_file.is_file():
        raise TestFailure(
            "Linked project ref is unavailable; cannot independently exclude LIVE."
        )
    live_ref = live_ref_file.read_text(encoding="utf-8").strip()
    if not live_ref:
        raise TestFailure("Linked project ref is empty; cannot independently exclude LIVE.")
    if expected_project_ref == live_ref.lower():
        raise TestFailure("Identity manifest names the LIVE project linked by this repository.")
    if dsn_contains_exact_project_ref(dsn, live_ref.lower()):
        raise TestFailure("Refusing to run against the project linked by this repository.")
    if not dsn_contains_exact_project_ref(dsn, expected_project_ref):
        raise TestFailure(
            "DSN does not expose the exact isolated project ref from the independent manifest."
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run independent-session repair image registry concurrency tests."
    )
    parser.add_argument(
        "--confirm-isolated",
        required=True,
        help=f"Must be exactly {CONFIRMATION!r}.",
    )
    parser.add_argument(
        "--identity-manifest",
        required=True,
        help="Path to the independently provisioned isolated-target JSON manifest.",
    )
    parser.add_argument(
        "--preflight-only",
        action="store_true",
        help="Run all safety and protocol checks, then exit before run ID generation or DML.",
    )
    return parser.parse_args()


def main() -> int:
    global EXPECTED_DATABASE, EXPECTED_PROJECT_REF, EXPECTED_SYSTEM_IDENTIFIER

    args = parse_args()
    if args.confirm_isolated != CONFIRMATION:
        print("Refusing to run without the exact isolated-project confirmation.", file=sys.stderr)
        return 2
    if shutil.which("psql") is None:
        print("psql is required but was not found.", file=sys.stderr)
        return 2
    dsn = os.environ.get(DSN_ENV, "")
    if not dsn:
        print(f"Set {DSN_ENV} without printing it to the terminal.", file=sys.stderr)
        return 2

    try:
        (
            EXPECTED_PROJECT_REF,
            EXPECTED_DATABASE,
            EXPECTED_SYSTEM_IDENTIFIER,
        ) = load_identity_manifest(args.identity_manifest)
    except TestFailure as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 2

    created_paths: list[str] = []
    exit_code = 0
    try:
        refuse_linked_live_project(dsn, EXPECTED_PROJECT_REF)
        verify_database_identity(
            dsn,
            EXPECTED_DATABASE,
            EXPECTED_SYSTEM_IDENTIFIER,
        )
        validate_target(dsn)
        validate_psql_protocol(dsn)
        if args.preflight_only:
            print("PREFLIGHT PASS — NO DML EXECUTED")
            return 0

        run_id = uuid.uuid4().hex
        print(f"RUN_ID={run_id}")
        scenarios = [
            ("01 two simultaneous attaches", scenario_two_attaches),
            ("02 attach versus tombstone", scenario_attach_vs_tombstone),
            ("03 attach versus delete claim", scenario_attach_vs_delete_claim),
            ("04 remove last reference versus add", scenario_remove_last_vs_new_reference),
            ("05 simultaneous state changes", scenario_two_state_changes),
            ("06 deferred failure and waiter release", scenario_deferred_failure_releases_waiter),
        ]
        for label, scenario in scenarios:
            print(f"RUN {label}")
            scenario(dsn, run_id, created_paths)
            print(f"PASS {label}")
        print("PASS all concurrency scenarios")
    except (TestFailure, subprocess.TimeoutExpired, ValueError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        exit_code = 1
    finally:
        if created_paths and dsn:
            try:
                run_mutation_psql(
                    dsn,
                    cleanup_sql(created_paths),
                    application_name="repair-image-cleanup",
                )
                print("Synthetic registry teardown: PASS (paths retained)")
            except Exception as cleanup_error:  # cleanup failure must be visible
                exit_code = 1
                print(
                    "Synthetic registry teardown: FAILED — rerun teardown from the README. "
                    + redact_connection_error(str(cleanup_error)),
                    file=sys.stderr,
                )
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
