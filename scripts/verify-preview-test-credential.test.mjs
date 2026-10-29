import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createTransport, run } from './verify-preview-test-credential.mjs';

const key = 'synthetic-service-credential';
const env = {
  VERCEL: '1', VERCEL_ENV: 'preview', VERIFY_TEST_SERVER_CREDENTIAL: 'true',
  VERCEL_GIT_COMMIT_REF: 'codex/hybrid-autorepair-stable-rebuild', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  EXPECTED_PREVIEW_COMMIT_SHA: 'a'.repeat(40),
  SUPABASE_URL: 'https://bstjobvvxxfqqwyjoimx.supabase.co',
  NEXT_PUBLIC_SUPABASE_URL: 'https://bstjobvvxxfqqwyjoimx.supabase.co',
  NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: 'bstjobvvxxfqqwyjoimx',
  SUPABASE_SERVICE_ROLE_KEY: key,
};
function mockTransport({ status = 200, type = 'application/json', body = '{"users":[],"aud":"authenticated"}', complete = true, failure = false } = {}) {
  let calls = 0;
  const transport = createTransport((options, callback) => {
    calls++;
    assert.equal(options.hostname, 'bstjobvvxxfqqwyjoimx.supabase.co');
    assert.equal(options.protocol, 'https:'); assert.equal(options.port, 443);
    assert.equal(options.path, '/auth/v1/admin/users?page=1&per_page=1');
    assert.equal(options.method, 'GET'); assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent, false); assert.equal(options.headers.apikey, key);
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.ok(!options.path.includes(key));
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      if (failure) { request.emit('error', new Error(key)); return; }
      const response = Readable.from([Buffer.from(body)]);
      response.statusCode = status;
      response.complete = complete;
      response.headers = { 'content-type': type, location: 'https://ouoiykudvcoqbkybkqvs.supabase.co' };
      callback(response);
    });
    return request;
  });
  return { transport, calls: () => calls };
}
for (const [label, overrides, expected] of [
  ['Production', { VERCEL_ENV: 'production' }, 'BLOCKED_ENVIRONMENT'],
  ['missing flag', { VERIFY_TEST_SERVER_CREDENTIAL: undefined }, 'BLOCKED_NOT_ENABLED'],
  ['local only', { VERCEL: undefined }, 'BLOCKED_DEPLOYMENT_IDENTITY'],
  ['wrong branch', { VERCEL_GIT_COMMIT_REF: 'main' }, 'BLOCKED_DEPLOYMENT_IDENTITY'],
  ['missing commit', { VERCEL_GIT_COMMIT_SHA: undefined }, 'BLOCKED_DEPLOYMENT_IDENTITY'],
  ['missing expected SHA', { EXPECTED_PREVIEW_COMMIT_SHA: undefined }, 'BLOCKED_EXPECTED_COMMIT'],
  ['short expected SHA', { EXPECTED_PREVIEW_COMMIT_SHA: 'aaaaaaa' }, 'BLOCKED_EXPECTED_COMMIT'],
  ['non-hex expected SHA', { EXPECTED_PREVIEW_COMMIT_SHA: 'g'.repeat(40) }, 'BLOCKED_EXPECTED_COMMIT'],
  ['whitespace expected SHA', { EXPECTED_PREVIEW_COMMIT_SHA: 'a'.repeat(40) + ' ' }, 'BLOCKED_EXPECTED_COMMIT'],
  ['different authorized SHA', { EXPECTED_PREVIEW_COMMIT_SHA: 'b'.repeat(40) }, 'BLOCKED_COMMIT_MISMATCH'],
  ['different actual SHA', { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }, 'BLOCKED_COMMIT_MISMATCH'],
  ['missing credential', { SUPABASE_SERVICE_ROLE_KEY: undefined }, 'BLOCKED_MISSING_CREDENTIAL'],
  ['header injection', { SUPABASE_SERVICE_ROLE_KEY: 'bad\r\nheader' }, 'BLOCKED_CREDENTIAL_FORMAT'],
  ['wrong ref', { NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: 'other' }, 'BLOCKED_PROJECT'],
  ['TLS disabled', { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, 'BLOCKED_TLS_CONFIGURATION'],
  ['HTTP debugging', { NODE_DEBUG: 'https' }, 'BLOCKED_TLS_CONFIGURATION'],
]) test(`gate: ${label}`, async () => {
  const m = mockTransport(); const lines = [];
  assert.equal(await run({ ...env, ...overrides }, m.transport, x => lines.push(x)), 1);
  assert.deepEqual(lines, [expected]); assert.equal(m.calls(), 0);
});
for (const field of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  for (const value of [undefined, 'https://ouoiykudvcoqbkybkqvs.supabase.co', 'https://unknown.supabase.co',
    'http://bstjobvvxxfqqwyjoimx.supabase.co', 'https://bstjobvvxxfqqwyjoimx.supabase.co.evil.invalid',
    'https://bstjobvvxxfqqwyjoimx.supabase.co?token=x', 'https://user@bstjobvvxxfqqwyjoimx.supabase.co']) {
    test(`reject ${field}: ${value}`, async () => {
      const m = mockTransport(); const lines = [];
      assert.equal(await run({ ...env, [field]: value }, m.transport, x => lines.push(x)), 1);
      assert.deepEqual(lines, ['BLOCKED_PROJECT']); assert.equal(m.calls(), 0);
    });
  }
}
for (const [label, reply, code] of [
  ['valid empty list', {}, 'TEST_SERVER_CREDENTIAL_ACCEPTED'],
  ['valid user', { body: JSON.stringify({ users: [{ id: '11111111-1111-4111-8111-111111111111', email: 'private@example.invalid' }], aud: 'authenticated' }) }, 'TEST_SERVER_CREDENTIAL_ACCEPTED'],
  ['unauthorized', { status: 401, body: key }, 'BLOCKED_UNAUTHORIZED'],
  ['forbidden', { status: 403 }, 'BLOCKED_UNAUTHORIZED'],
  ['redirect LIVE never followed', { status: 302 }, 'BLOCKED_REDIRECT'],
  ['server error', { status: 500 }, 'BLOCKED_HTTP'],
  ['empty success', { status: 204 }, 'BLOCKED_HTTP'],
  ['HTML success', { type: 'text/html' }, 'BLOCKED_RESPONSE'],
  ['invalid JSON', { body: key }, 'BLOCKED_RESPONSE'],
  ['public-looking JSON', { body: '{}' }, 'BLOCKED_RESPONSE'],
  ['null', { body: 'null' }, 'BLOCKED_RESPONSE'],
  ['wrong users type', { body: '{"users":{},"aud":"authenticated"}' }, 'BLOCKED_RESPONSE'],
  ['invalid user', { body: '{"users":[null],"aud":"authenticated"}' }, 'BLOCKED_RESPONSE'],
  ['too many users', { body: '{"users":[{},{}],"aud":"authenticated"}' }, 'BLOCKED_RESPONSE'],
  ['oversized response', { body: 'x'.repeat(65537) }, 'BLOCKED_RESPONSE'],
  ['truncated response', { complete: false }, 'BLOCKED_TRANSPORT'],
  ['transport error contains secret', { failure: true }, 'BLOCKED_TRANSPORT'],
]) test(`HTTP: ${label}`, async () => {
  const m = mockTransport(reply); const lines = [];
  const result = await run(env, m.transport, x => lines.push(x));
  assert.equal(result, code === 'TEST_SERVER_CREDENTIAL_ACCEPTED' ? 0 : 1);
  assert.deepEqual(lines, [code]); assert.equal(m.calls(), 1);
  assert.ok(!JSON.stringify(lines).includes(key)); assert.ok(!JSON.stringify(lines).includes('private@example.invalid'));
});

test('deadline aborts exactly one request without retry or raw errors', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0; let destroyed = 0;
  const transport = createTransport(() => {
    calls++;
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => { destroyed++; };
    return req;
  });
  const lines = [];
  const pending = run(env, transport, code => lines.push(code));
  t.mock.timers.tick(10000);
  assert.equal(await pending, 1);
  assert.deepEqual(lines, ['BLOCKED_TRANSPORT']);
  assert.equal(calls, 1); assert.equal(destroyed, 1);
});
