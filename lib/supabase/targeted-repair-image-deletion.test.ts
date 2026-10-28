import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error TS5097: Node test source import.
import { targetedDeletionProtocol, deleteTargetedRepairImage } from "./targeted-repair-image-deletion.ts";
const user = "11111111-1111-4111-8111-111111111111";
const op = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const path = `${user}/photo.jpg`;
const input = { requestId: op, operationId: op, image: { path } };
function fixture(options: { unauth?: boolean; forbidden?: boolean; retained?: boolean; claim?: string; badPath?: boolean; expired?: boolean; badClaim?: boolean; deleteError?: boolean; stillPresent?: boolean; network?: boolean; finalError?: boolean; missingInitially?: boolean; conflict?: boolean; preDeleteExpired?: boolean } = {}) {
  const calls: string[] = []; let gets = 0; let revalidations = 0;
  const deps = {
    authenticate: async () => { calls.push('auth'); return options.unauth ? null : user; },
    userRpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name); assert.equal(args.p_operation_id, op); assert.deepEqual(args.p_selected_image, input.image);
      return options.forbidden ? { data: null, error: { code: '42501' } } : { data: [{ operation_id: op, outcome: options.retained ? 'retained' : 'detached' }], error: null };
    },
    admin: {
      rpc: async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
        calls.push(name);
        if (name === 'claim_authorized_repair_image_deletion') {
          assert.deepEqual(args, { p_operation_id: op });
          if (options.conflict) return { data: null, error: { code: '55P03' } };
          const outcome = options.claim ?? 'claimed';
          return { data: [{ outcome, object_path: outcome === 'claimed' ? (options.badPath ? `${user}/other.jpg` : path) : null, delete_claim_id: outcome === 'claimed' ? claimId : null }], error: null };
        }
        assert.equal(args.p_object_path, path); assert.equal(args.p_delete_claim_id, claimId);
        if (name === 'revalidate_repair_image_deletion_claim') {
          revalidations++;
          return { data: [{ object_path: path, delete_claim_id: options.badClaim ? op : claimId, delete_lease_expires_at: new Date(Date.now() + (options.expired || (options.preDeleteExpired && revalidations === 2) ? -1000 : 300000)).toISOString(), storage_object_exists: !options.missingInitially && revalidations < 3 }], error: null };
        }
        assert.equal(name, 'complete_repair_image_deletion'); assert.equal(args.p_deleted, true);
        return { data: null, error: options.finalError ? { code: '40001' } : null };
      },
      storage: { from: (bucket: string) => {
        assert.equal(bucket, 'repair-images');
        return { remove: async (paths: string[]) => {
          calls.push('DELETE'); assert.deepEqual(paths, [path]);
          if (options.network) throw new Error('network');
          return { data: null, error: options.deleteError ? { status: 403 } : null };
        } };
      } },
    },
    getObject: async (p: string) => {
      assert.equal(p, path); calls.push('GET'); gets++;
      return !options.missingInitially && (gets === 1 || options.stillPresent) ? new Response('x', { status: 206 }) : Response.json({ code: 'NoSuchKey' }, { status: 404 });
    },
  };
  return { deps, calls };
}
for (const [name, options, status, deletes] of [
  ['unauthenticated', { unauth: true }, 'unauthenticated', 0],
  ['not owner', { forbidden: true }, 'forbidden', 0],
  ['shared image retained', { retained: true }, 'retained', 0],
  ['claim retained', { claim: 'retained' }, 'retained', 0],
  ['completed replay is not physical proof', { claim: 'already_completed' }, 'already_completed_unverified', 0],
  ['active claim conflict', { conflict: true }, 'conflict', 0],
  ['different authorized object rejected', { badPath: true }, 'recovery_required', 0],
  ['expired lease', { expired: true }, 'recovery_required', 0],
  ['invalid claim', { badClaim: true }, 'recovery_required', 0],
  ['lease expires during GET', { preDeleteExpired: true }, 'recovery_required', 0],
  ['delete rejected', { deleteError: true }, 'recovery_required', 1],
  ['network error never retries', { network: true }, 'recovery_required', 1],
  ['object still present', { stillPresent: true }, 'recovery_required', 1],
  ['finalization failure', { finalError: true }, 'recovery_required', 1],
  ['confirmed delete', {}, 'deleted', 1],
  ['already absent object', { missingInitially: true }, 'deleted', 0],
] as const) {
  test(name, async () => {
    const f = fixture(options); const result = await targetedDeletionProtocol(input, f.deps);
    assert.equal(result.status, status); assert.equal(result.physicalDeletionConfirmed, status === 'deleted');
    assert.equal(f.calls.filter(x => x === 'DELETE').length, deletes);
    if (status === 'deleted') assert.equal(f.calls.at(-1), 'complete_repair_image_deletion');
  });
}
test('successful ordering and same-operation replay never deletes again', async () => {
  const f = fixture(); await targetedDeletionProtocol(input, f.deps);
  assert.deepEqual(f.calls, ['auth','detach_own_repair_request_image','claim_authorized_repair_image_deletion','revalidate_repair_image_deletion_claim','GET','revalidate_repair_image_deletion_claim','DELETE','GET','revalidate_repair_image_deletion_claim','complete_repair_image_deletion']);
  const replay = fixture({ claim: 'already_completed' });
  const r = await targetedDeletionProtocol(input, replay.deps);
  assert.equal(r.operationId, op); assert.equal(r.physicalDeletionConfirmed, false); assert.ok(!replay.calls.includes('DELETE'));
});
test('top-level owner/bucket overrides and traversal rejected before auth', async () => {
  for (const value of [{ ...input, bucket: 'other' }, { ...input, image: { path: `${user}/../other` } }]) {
    const f = fixture(); assert.equal((await targetedDeletionProtocol(value, f.deps)).status, 'invalid_input'); assert.equal(f.calls.length, 0);
  }
});
test('server entrypoint checks TEST before network and separates user/service credentials', async () => {
  const oldEnv = { ...process.env }; const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string; token: string }[] = [];
  try {
    process.env.SUPABASE_URL = 'https://ouoiykudvcoqbkybkqvs.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; delete process.env.VERCEL_ENV;
    globalThis.fetch = async (url, init) => {
      const u = String(url); const token = new Headers(init?.headers).get('Authorization')!;
      calls.push({ url: u, method: init?.method ?? 'GET', token });
      if (u.endsWith('/auth/v1/user')) return Response.json({ id: user });
      if (u.endsWith('/detach_own_repair_request_image')) return Response.json([{ operation_id: op, outcome: 'detached' }]);
      return Response.json([{ outcome: 'already_completed', object_path: null, delete_claim_id: null }]);
    };
    assert.equal((await deleteTargetedRepairImage(input, 'user-token')).status, 'configuration_error'); assert.equal(calls.length, 0);
    process.env.SUPABASE_URL = 'https://bstjobvvxxfqqwyjoimx.supabase.co';
    assert.equal((await deleteTargetedRepairImage(input, 'user-token')).status, 'already_completed_unverified');
    assert.deepEqual(calls.map(x => x.token), ['Bearer user-token','Bearer user-token','Bearer service']);
    assert.ok(calls.every(x => x.url.startsWith(process.env.SUPABASE_URL!)));
  } finally { globalThis.fetch = originalFetch; process.env = oldEnv; }
});
test('full server transport uses exactly one scoped DELETE and verifies absence', async () => {
  const oldEnv = { ...process.env }; const oldFetch = globalThis.fetch;
  let exists = true; let deletes = 0; let completed = false; const calls: string[] = [];
  try {
    process.env.SUPABASE_URL = 'https://bstjobvvxxfqqwyjoimx.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; delete process.env.VERCEL_ENV;
    globalThis.fetch = async (url, init) => {
      const u = String(url); calls.push(u); assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
      if (u.endsWith('/auth/v1/user')) return Response.json({ id: user });
      if (u.endsWith('/detach_own_repair_request_image')) return Response.json([{ operation_id: op, outcome: 'detached' }]);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer service');
      if (u.endsWith('/claim_authorized_repair_image_deletion')) return Response.json([{ outcome: 'claimed', object_path: path, delete_claim_id: claimId }]);
      if (u.endsWith('/revalidate_repair_image_deletion_claim')) return Response.json([{ object_path: path, delete_claim_id: claimId, storage_object_exists: exists, delete_lease_expires_at: new Date(Date.now()+300000).toISOString() }]);
      if (u.endsWith('/complete_repair_image_deletion')) { assert.equal(exists, false); completed = true; return Response.json(null); }
      if (init?.method === 'DELETE') {
        assert.equal(u, `${process.env.SUPABASE_URL}/storage/v1/object/repair-images`);
        assert.deepEqual(JSON.parse(String(init.body)), { prefixes: [path] }); deletes++; exists = false; return Response.json([]);
      }
      assert.equal(u, `${process.env.SUPABASE_URL}/storage/v1/object/authenticated/repair-images/${path}`);
      return exists ? new Response('x', { status: 206 }) : Response.json({ code: 'NoSuchKey' }, { status: 404 });
    };
    assert.equal((await deleteTargetedRepairImage(input, 'user-token')).physicalDeletionConfirmed, true);
    assert.equal(deletes, 1); assert.equal(completed, true); assert.equal(calls.length, 10);
  } finally { globalThis.fetch = oldFetch; process.env = oldEnv; }
});
test('ambiguous GET, detach transport failure and post-delete reference change never report success', async () => {
  const ambiguous = fixture(); ambiguous.deps.getObject = async () => new Response('missing', { status: 404 });
  assert.equal((await targetedDeletionProtocol(input, ambiguous.deps)).physicalDeletionConfirmed, false);
  assert.ok(!ambiguous.calls.includes('DELETE'));
  const transport = fixture(); transport.deps.userRpc = async () => { throw new Error('lost reply'); };
  const uncertain = await targetedDeletionProtocol(input, transport.deps);
  assert.equal(uncertain.detached, 'unknown'); assert.equal(uncertain.physicalDeletionConfirmed, false);
  const references = fixture(); const rpc = references.deps.admin.rpc; let n = 0;
  references.deps.admin.rpc = async (name, args) => {
    if (name === 'revalidate_repair_image_deletion_claim' && ++n === 3) throw new Error('reference conflict');
    return rpc(name, args);
  };
  assert.equal((await targetedDeletionProtocol(input, references.deps)).physicalDeletionConfirmed, false);
  assert.ok(!references.calls.includes('complete_repair_image_deletion'));
});
test('existing batch core retains its original sequence (mock only)', async () => {
  // @ts-expect-error TS5097: Node test source import.
  const { runRepairImageCleanupCore } = await import('./repair-image-cleanup-core.ts');
  const f = fixture(); const rpc = f.deps.admin.rpc;
  let validations = 0;
  f.deps.admin.rpc = async (name, args) => {
    if (name === 'claim_repair_image_deletions') return { data: [{ object_path: path, delete_claim_id: claimId }], error: null };
    if (name === 'revalidate_repair_image_deletion_claim') {
      validations++;
      return { data: [{ object_path: path, delete_claim_id: claimId, delete_lease_expires_at: new Date(Date.now()+300000).toISOString(), storage_object_exists: validations === 1 }], error: null };
    }
    return rpc(name, args);
  };
  assert.deepEqual(await runRepairImageCleanupCore({ client: f.deps.admin, dependencies: { getObject: f.deps.getObject } }), { claimed: 1, deleted: 1, failed: 0 });
  assert.equal(validations, 2);
});

for (const mode of ['empty204', 'empty200', 'null', 'http-null', 'http-empty', 'transport', 'object', 'array', 'invalid-json', 'ambiguous-get', 'failed-revalidation', 'empty-claim'] as const) {
  test(`absent object recovery transport: ${mode}`, async () => {
    const oldEnv = { ...process.env }; const oldFetch = globalThis.fetch;
    const oldInfo = console.info; const logs: unknown[][] = [];
    const calls: string[] = []; let completions = 0;
    const recoveredClaim = '44444444-4444-4444-8444-444444444444';
    try {
      console.info = (...args) => { logs.push(args); };
      Object.assign(process.env, {
        TARGETED_IMAGE_DIAGNOSTICS_ENABLED: 'true', NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF: 'bstjobvvxxfqqwyjoimx',
        NEXT_PUBLIC_SUPABASE_URL: 'https://bstjobvvxxfqqwyjoimx.supabase.co',
        VERCEL_ENV: 'preview', SUPABASE_URL: 'https://bstjobvvxxfqqwyjoimx.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon', SUPABASE_SERVICE_ROLE_KEY: 'mock-service',
      });
      globalThis.fetch = async (url, init) => {
        const u = String(url); calls.push(u);
        assert.notEqual(init?.method, 'DELETE', 'Already absent object must not be deleted again');
        assert.ok(!u.includes('audi.jpg'), 'Other photo must remain untouched');
        if (u.endsWith('/auth/v1/user')) return Response.json({ id: user });
        const args = init?.body ? JSON.parse(String(init.body)) : null;
        if (u.endsWith('/detach_own_repair_request_image')) {
          assert.equal(args.p_operation_id, op); assert.deepEqual(args.p_selected_image, input.image);
          return Response.json([{ operation_id: op, outcome: 'detached' }]);
        }
        if (u.endsWith('/claim_authorized_repair_image_deletion')) {
          assert.equal(args.p_operation_id, op);
          if (mode === 'empty-claim') return new Response(null, { status: 204 });
          // Models SQL granting a new claim for the same operation after expiry.
          return Response.json([{ outcome: 'claimed', object_path: path, delete_claim_id: recoveredClaim }]);
        }
        if (u.endsWith('/revalidate_repair_image_deletion_claim')) {
          assert.equal(args.p_delete_claim_id, recoveredClaim); assert.equal(args.p_object_path, path);
          if (mode === 'failed-revalidation') return Response.json({ code: '55000' }, { status: 409 });
          return Response.json([{ object_path: path, delete_claim_id: recoveredClaim,
            delete_lease_expires_at: new Date(Date.now() + 300000).toISOString(), storage_object_exists: false }]);
        }
        if (u.endsWith('/complete_repair_image_deletion')) {
          completions++; assert.equal(args.p_deleted, true); assert.equal(args.p_delete_claim_id, recoveredClaim);
          if (mode === 'transport') throw new Error('Lost completion response');
          if (mode === 'http-null') return Response.json(null, { status: 500 });
          if (mode === 'http-empty') return new Response(null, { status: 503 });
          if (mode === 'empty204') return new Response(null, { status: 204 });
          if (mode === 'empty200') return new Response('');
          if (mode === 'object') return Response.json({});
          if (mode === 'array') return Response.json([]);
          if (mode === 'invalid-json') return new Response('not json');
          return Response.json(null);
        }
        assert.equal(u, `${process.env.SUPABASE_URL}/storage/v1/object/authenticated/repair-images/${path}`);
        return mode === 'ambiguous-get'
          ? Response.json({ message: 'not found' }, { status: 404 })
          : Response.json({ code: 'NoSuchKey' }, { status: 404 });
      };
      const result = await deleteTargetedRepairImage(input, 'mock-user-token');
      const success = ['empty204', 'empty200', 'null'].includes(mode);
      assert.equal(result.operationId, op);
      assert.equal(result.status, success ? 'deleted' : 'recovery_required');
      assert.equal(result.physicalDeletionConfirmed, success);
      assert.equal(completions, ['ambiguous-get', 'failed-revalidation', 'empty-claim'].includes(mode) ? 0 : 1);
      if (success) assert.equal(calls.filter(u => u.endsWith('/revalidate_repair_image_deletion_claim')).length, 2);
      const codes = logs.map(line => line[0]);
      const expected = success ? 'COMPLETE_OK' : mode === 'transport' ? 'COMPLETE_TRANSPORT_FAILED'
        : mode.startsWith('http-') ? 'COMPLETE_HTTP_FAILED'
        : ['object', 'array', 'invalid-json'].includes(mode) ? 'COMPLETE_BODY_INVALID' : null;
      if (expected) assert.ok(codes.includes(expected));
      for (const line of logs) {
        assert.match(String(line[0]), /^[A-Z_]+$/);
        assert.ok(line.length === 1 || (line.length === 2 && typeof line[1] === 'number'));
      }
    } finally { console.info = oldInfo; globalThis.fetch = oldFetch; process.env = oldEnv; }
  });
}

test('expired claim fails closed; manual same-operation recovery confirms absence without DELETE', async () => {
  const expired = fixture({ expired: true, missingInitially: true });
  const failed = await targetedDeletionProtocol(input, expired.deps);
  assert.equal(failed.status, 'recovery_required');
  assert.ok(!expired.calls.includes('DELETE'));
  const recovered = fixture({ missingInitially: true });
  const result = await targetedDeletionProtocol(input, recovered.deps);
  assert.equal(result.operationId, failed.operationId);
  assert.equal(result.status, 'deleted');
  assert.ok(!recovered.calls.includes('DELETE'));
  assert.equal(recovered.calls.at(-1), 'complete_repair_image_deletion');
});

for (const [options, expected] of [
  [{}, 'COMPLETE_OK'], [{ deleteError: true }, 'STORAGE_DELETE_REJECTED'],
  [{ network: true }, 'STORAGE_DELETE_AMBIGUOUS'], [{ missingInitially: true }, 'STORAGE_DELETE_SKIPPED'],
  [{ finalError: true }, 'COMPLETE_FAILED'], [{ preDeleteExpired: true }, 'PRE_DELETE_REVALIDATION_FAILED'],
] as const) test(`diagnostic outcome ${expected} preserves protocol`, async () => {
  const f = fixture(options); const codes: string[] = [];
  const result = await targetedDeletionProtocol(input, { ...f.deps, diagnostic: code => { codes.push(code); } });
  assert.ok(codes.includes(expected));
  assert.ok(codes.includes('AUTH_OK')); assert.ok(codes.includes('DETACH_OK')); assert.ok(codes.includes('CLAIM_OK'));
  if (result.status === 'deleted') {
    for (const code of ['INITIAL_REVALIDATION_OK', 'POST_DELETE_GET_ABSENT', 'FINAL_REVALIDATION_OK', 'TARGETED_DELETION_DELETED']) assert.ok(codes.includes(code));
    assert.ok(codes.indexOf('FINAL_REVALIDATION_OK') < codes.indexOf('COMPLETE_OK'));
  }
  assert.ok(codes.every(code => /^[A-Z_]+$/.test(code)));
});
test('post-delete GET ambiguity and final revalidation failure are distinguishable', async () => {
  for (const fail of ['get', 'revalidate']) {
    const f = fixture(); const codes: string[] = []; const rpc = f.deps.admin.rpc;
    let gets = 0; let validations = 0;
    if (fail === 'get') f.deps.getObject = async () => ++gets === 1 ? new Response('x', { status: 206 }) : Response.json({ message: 'sensitive raw message' }, { status: 404 });
    else f.deps.admin.rpc = async (name, args) => {
      if (name === 'revalidate_repair_image_deletion_claim' && ++validations === 3) throw Error('sensitive SQL');
      return rpc(name, args);
    };
    const result = await targetedDeletionProtocol(input, { ...f.deps, diagnostic: code => { codes.push(code); } });
    assert.equal(result.status, 'recovery_required');
    assert.ok(codes.includes(fail === 'get' ? 'POST_DELETE_GET_AMBIGUOUS' : 'FINAL_REVALIDATION_FAILED'));
    assert.ok(!codes.includes('COMPLETE_STARTED'));
    assert.ok(!codes.join().includes('sensitive'));
  }
});
test('diagnostic sink exceptions cannot change successful deletion', async () => {
  const f = fixture();
  assert.equal((await targetedDeletionProtocol(input, { ...f.deps, diagnostic: () => { throw Error('sink'); } })).status, 'deleted');
});
