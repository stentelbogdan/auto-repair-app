import assert from "node:assert/strict";
import { test, mock, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const TEST = "https://bstjobvvxxfqqwyjoimx.supabase.co";
const id = "11111111-1111-4111-8111-111111111111";
const op = "22222222-2222-4222-8222-222222222222";
const payload = { requestId: id, operationId: op, image: { path: `${id}/photo.jpg`, name: "Photo", url: `${TEST}/storage/v1/object/public/repair-images/${id}/photo.jpg`, fingerprint: "a".repeat(64), fingerprintVersion: "sha256-prepared-v1" } };
const originalEnv = { ...process.env }; const originalFetch = globalThis.fetch;
let result: Record<string, unknown>;
let throws = false;
const calls: unknown[][] = [];
mock.module(new URL('./targeted-repair-image-deletion.ts', import.meta.url).href, {
  namedExports: { deleteTargetedRepairImage: async (...args: unknown[]) => {
    calls.push(args);
    if (throws) throw new Error('SECRET service token SQL private object');
    return result;
  } },
});
// @ts-expect-error TS5097: local Node test import.
const { handleTargetedImageDeletionRequest: handle } = await import('./targeted-repair-image-deletion-route.ts');
// Exercise actual route exports without installing Next.js or resolving its alias.
const routeSource = readFileSync(new URL('../../app/api/repair-requests/images/delete/route.ts', import.meta.url), 'utf8');
const routeJs = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('"@/lib/supabase/targeted-repair-image-deletion-route"', JSON.stringify(new URL('./targeted-repair-image-deletion-route.ts', import.meta.url).href));
const route = await import(`data:text/javascript;base64,${Buffer.from(routeJs).toString('base64')}`);
beforeEach(() => {
  calls.length = 0; throws = false;
  result = { operationId: op, status: 'deleted', detached: true, physicalDeletionConfirmed: true };
  process.env.VERCEL_ENV = 'preview'; process.env.SUPABASE_URL = TEST;
  process.env.NEXT_PUBLIC_SUPABASE_URL = TEST;
  process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF = 'bstjobvvxxfqqwyjoimx';
  globalThis.fetch = async () => { throw new Error('Real network prohibited'); };
});
after(() => { process.env = originalEnv; globalThis.fetch = originalFetch; mock.restoreAll(); });
function request(body: unknown = payload, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://preview.invalid/api/repair-requests/images/delete', {
    method, headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json', ...headers },
    ...(!['GET','HEAD'].includes(method) ? { body: JSON.stringify(body) } : {}),
  });
}
async function check(response: Response, code: number, status: string) {
  assert.equal(response.status, code); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json(); assert.equal(body.status, status);
  assert.equal(body.physicalDeletionConfirmed, status === 'deleted');
  assert.deepEqual(Object.keys(body).sort(), ['detached','operationId','physicalDeletionConfirmed','status']);
  return body;
}
for (const authorization of ['', 'Basic token', 'Bearer', 'Bearer a,b', 'Bearer a Bearer b', `Bearer ${'x'.repeat(8193)}`]) {
  test(`reject malformed/missing bearer ${authorization.slice(0,25)}`, async () => {
    const req = request(); if (authorization) req.headers.set('Authorization', authorization); else req.headers.delete('Authorization');
    await check(await handle(req), 401, 'unauthenticated'); assert.equal(calls.length, 0);
  });
}
for (const environment of ['production','development','test','',undefined]) {
  test(`reject environment ${environment}`, async () => {
    if (environment === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = environment;
    await check(await handle(request()), 404, 'unavailable'); assert.equal(calls.length, 0);
  });
}
for (const field of ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL']) {
  for (const value of ['https://ouoiykudvcoqbkybkqvs.supabase.co','https://unknown.supabase.co',`${TEST}/other`,undefined]) {
    test(`reject ${field} ${value}`, async () => {
      if (value === undefined) delete process.env[field]; else process.env[field] = value;
      await check(await handle(request()), 404, 'unavailable'); assert.equal(calls.length, 0);
    });
  }
}
test('reject mismatched bundled project', async () => {
  process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF = 'ouoiykudvcoqbkybkqvs';
  await check(await handle(request()), 404, 'unavailable'); assert.equal(calls.length, 0);
});
for (const body of [null, [], {}, { ...payload, operationId: '' }, { ...payload, operationId: 'not-uuid' }, { ...payload, requestId: 1 },
  { ...payload, userId: id }, { ...payload, bucket: 'repair-images' }, { ...payload, object_path: payload.image.path },
  { ...payload, image: { url: payload.image.url } }, { ...payload, image: [payload.image] },
  { ...payload, image: { ...payload.image, owner: id } }, { ...payload, image: { ...payload.image, name: 1 } },
  { ...payload, image: { path: `${id}/../other` } }, { ...payload, image: { path: `${id}/photo.jpg`, name: 'a'.repeat(513) } },
]) {
  test(`invalid body ${JSON.stringify(body).slice(0,100)}`, async () => {
    await check(await handle(request(body)), 400, 'invalid_input'); assert.equal(calls.length, 0);
  });
}
test('invalid JSON and invalid UTF-8', async () => {
  for (const body of ['{bad', new Uint8Array([0xff])]) {
    const req = new Request('https://preview.invalid', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body });
    await check(await handle(req), 400, 'invalid_input');
  }
  assert.equal(calls.length, 0);
});
test('content type and compressed bodies refused', async () => {
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }] as Record<string, string>[]) {
    await check(await handle(request(payload, headers)), 415, 'unsupported_media_type');
  }
  assert.equal(calls.length, 0);
});
test('both declared and actual body size are bounded', async () => {
  await check(await handle(request(payload, { 'Content-Length': '16385' })), 413, 'payload_too_large');
  await check(await handle(request('x'.repeat(16385), { 'Content-Length': '1' })), 413, 'payload_too_large');
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8192)); c.enqueue(new Uint8Array(8193)); c.close(); } });
  const init = { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: stream, duplex: 'half' };
  await check(await handle(new Request('https://preview.invalid', init)), 413, 'payload_too_large');
  assert.equal(calls.length, 0);
});
for (const [status, code, detached] of [['deleted',200,true],['retained',200,true],['already_completed_unverified',200,true],['unauthenticated',401,false],['forbidden',403,false],['conflict',409,'unknown'],['recovery_required',503,true],['configuration_error',503,false]] as const) {
  test(`adapter result ${status}`, async () => {
    result = { operationId: op, status, detached, physicalDeletionConfirmed: status === 'deleted', privateDetail: 'secret' };
    const body = await check(await route.POST(request()), code, status);
    assert.equal(body.operationId, op); assert.equal(body.detached, detached);
    assert.deepEqual(calls, [[payload, 'session-token']]);
  });
}
for (const change of [{ physicalDeletionConfirmed: false }, { detached: false }, { operationId: id }, { status: 'retained' }, { status: 'unexpected' }]) {
  test(`inconsistent adapter result ${JSON.stringify(change)}`, async () => {
    Object.assign(result, change);
    const body = await check(await handle(request()), 503, 'recovery_required');
    assert.equal(body.operationId, op); assert.equal(body.detached, 'unknown');
  });
}
test('adapter exception is sanitized and never retried', async () => {
  throws = true;
  const response = await handle(request()); const body = await check(response, 503, 'recovery_required');
  assert.equal(body.operationId, op); assert.equal(body.detached, 'unknown'); assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(body).includes('SECRET'));
});
test('same operation identifier and exact image JSON preserved on explicit recovery', async () => {
  result = { operationId: op, status: 'recovery_required', detached: 'unknown', physicalDeletionConfirmed: false };
  await handle(request()); await handle(request());
  assert.deepEqual(calls, [[payload, 'session-token'], [payload, 'session-token']]);
});
for (const method of ['GET','HEAD','PUT','PATCH','DELETE','OPTIONS']) {
  test(`route ${method} cannot mutate`, async () => {
    const response = await route[method](request(payload, {}, method));
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (method === 'HEAD') assert.equal(await response.text(), '');
    assert.equal(calls.length, 0);
  });
}
test('stalled body times out before adapter invocation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const init = { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: stream, duplex: 'half' };
  const response = handle(new Request('https://preview.invalid', init));
  t.mock.timers.tick(5000);
  await check(await response, 408, 'request_timeout');
  assert.equal(cancelled, true); assert.equal(calls.length, 0);
});
