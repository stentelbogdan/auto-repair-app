import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
// @ts-expect-error TS5097: Node source import.
import { createTargetedImageDiagnostic, targetedImageDiagnosticsEnabled } from './targeted-image-diagnostics.server.ts';
// @ts-expect-error TS5097: Node source import.
import { createImageDiagnostic, IMAGE_DIAGNOSTIC_CODES, type ImageDiagnosticCode } from '../repair-requests/image-deletion-diagnostics.ts';
const valid = {
  VERCEL_ENV: 'preview', TARGETED_IMAGE_DIAGNOSTICS_ENABLED: 'true',
  SUPABASE_URL: 'https://bstjobvvxxfqqwyjoimx.supabase.co',
  NEXT_PUBLIC_SUPABASE_URL: 'https://bstjobvvxxfqqwyjoimx.supabase.co',
  NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: 'bstjobvvxxfqqwyjoimx',
};
for (const overrides of [
  {}, { TARGETED_IMAGE_DIAGNOSTICS_ENABLED: undefined }, { TARGETED_IMAGE_DIAGNOSTICS_ENABLED: 'false' },
  { VERCEL_ENV: 'production' }, { VERCEL_ENV: undefined },
  { SUPABASE_URL: 'https://ouoiykudvcoqbkybkqvs.supabase.co' },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://unknown.supabase.co' },
  { NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: undefined },
  { SUPABASE_URL: undefined },
]) test(`diagnostic gate ${JSON.stringify(overrides)}`, () => {
  const env = { ...process.env }; const info = console.info; const logs: unknown[] = [];
  try {
    Object.assign(process.env, valid);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    console.info = (...args) => { logs.push(args); };
    const enabled = Object.keys(overrides).length === 0;
    assert.equal(targetedImageDiagnosticsEnabled(), enabled);
    createTargetedImageDiagnostic()('COMPLETE_HTTP_FAILED', 503);
    assert.deepEqual(logs, enabled ? [['COMPLETE_HTTP_FAILED', 503]] : []);
  } finally { console.info = info; process.env = env; }
});
test('logger never serializes untrusted codes, statuses, errors or identifiers', () => {
  const lines: unknown[][] = [];
  const log = createImageDiagnostic(true, (...args) => { lines.push(args); });
  for (const code of IMAGE_DIAGNOSTIC_CODES) log(code);
  const secret = 'secret.jwt /private/path user-uuid https://private.invalid';
  log(secret as ImageDiagnosticCode, 500);
  for (const status of [NaN, Infinity, 99, 600, 200.5, secret, { toString: () => secret }]) log('COMPLETE_FAILED', status as number);
  for (const line of lines) {
    assert.ok(IMAGE_DIAGNOSTIC_CODES.includes(line[0] as ImageDiagnosticCode));
    assert.equal(line.length, 1);
  }
  assert.ok(!JSON.stringify(lines).includes(secret));
  assert.doesNotThrow(() => createImageDiagnostic(true, () => { throw Error(secret); })('COMPLETE_OK'));
  const n = lines.length; createImageDiagnostic(false, (...args) => { lines.push(args); })('COMPLETE_OK');
  assert.equal(lines.length, n);
});
test('client permission comes from dynamic server gate, not public env or storage', () => {
  const layout = readFileSync(new URL('../../app/customer/my-requests/[id]/layout.tsx', import.meta.url), 'utf8');
  const provider = readFileSync(new URL('../repair-requests/ImageDiagnosticsProvider.tsx', import.meta.url), 'utf8');
  assert.ok(layout.includes("dynamic = 'force-dynamic'"));
  assert.ok(layout.includes('enabled={targetedImageDiagnosticsEnabled()}'));
  assert.doesNotMatch(provider, /process\.env|sessionStorage|localStorage|fetch\(/);
  assert.ok(provider.includes('createImageDiagnostic(enabled'));
});
