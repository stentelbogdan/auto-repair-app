import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const command = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).buildCommand;
for (const [environment, probeExit, expectedExit, expectedCalls] of [
  ['preview', 0, 0, ['probe:scripts/verify-preview-test-credential.mjs', 'build:run build -- --webpack']],
  ['preview', 1, 1, ['probe:scripts/verify-preview-test-credential.mjs']],
  ['production', 1, 0, ['build:run build']],
  ['development', 1, 0, ['build:run build']],
]) test(`build command ${environment}, probe exit ${probeExit}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hybrid-build-test-'));
  try {
    const record = join(dir, 'calls');
    writeFileSync(join(dir, 'node'), `#!/bin/sh
[ "$SUPABASE_SERVICE_ROLE_KEY" = "synthetic-only" ] || exit 90
[ "$VERIFY_TEST_SERVER_CREDENTIAL" = "true" ] || exit 91
printf 'probe:%s\\n' "$*" >> "$CALL_RECORD"
exit "$PROBE_EXIT"
`, { mode: 0o700 });
    writeFileSync(join(dir, 'npm'), `#!/bin/sh
[ "$SUPABASE_SERVICE_ROLE_KEY" = "synthetic-only" ] || exit 92
printf 'build:%s\\n' "$*" >> "$CALL_RECORD"
`, { mode: 0o700 });
    const result = spawnSync('/bin/sh', ['-c', command], {
      env: { PATH: dir, VERCEL_ENV: environment, CALL_RECORD: record,
        PROBE_EXIT: String(probeExit), SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
        VERIFY_TEST_SERVER_CREDENTIAL: 'true' }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, expectedExit);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.deepEqual(readFileSync(record, 'utf8').trim().split('\n'), expectedCalls);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
