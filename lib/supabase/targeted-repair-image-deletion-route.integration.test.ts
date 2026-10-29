import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error TS5097: local Node test import.
import { handleTargetedImageDeletionRequest } from "./targeted-repair-image-deletion-route.ts";

// Real route helper + real adapter + real claim engine, entirely mocked HTTP.
const url = 'https://bstjobvvxxfqqwyjoimx.supabase.co';
const user = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const claim = '33333333-3333-4333-8333-333333333333';
const path = `${user}/photo.jpg`;
const payload = { requestId: operationId, operationId, image: { path, name: 'Photo' } };
for (const scenario of ['invalid-token','forbidden','deleted','still-present','delete-failed'] as const) {
  test(`real adapter HTTP contract: ${scenario}`, async () => {
    const env = { ...process.env }; const originalFetch = globalThis.fetch;
    const calls: string[] = []; let exists = true;
    try {
      process.env.VERCEL_ENV = 'preview'; process.env.SUPABASE_URL = url;
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF = 'bstjobvvxxfqqwyjoimx';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service';
      globalThis.fetch = async (target, init) => {
        const endpoint = String(target); assert.ok(endpoint.startsWith(`${url}/`));
        calls.push(endpoint); assert.equal(init?.redirect, 'manual');
        const headers = new Headers(init?.headers);
        if (endpoint.endsWith('/auth/v1/user')) {
          assert.equal(headers.get('Authorization'), 'Bearer synthetic-session');
          return scenario === 'invalid-token' ? Response.json({ message: 'private raw auth details' }, { status: 401 }) : Response.json({ id: user });
        }
        if (endpoint.endsWith('/detach_own_repair_request_image')) {
          assert.equal(headers.get('Authorization'), 'Bearer synthetic-session');
          assert.equal(headers.get('apikey'), 'synthetic-anon');
          assert.deepEqual(JSON.parse(String(init?.body)), { p_request_id: payload.requestId, p_selected_image: payload.image, p_operation_id: operationId });
          return scenario === 'forbidden' ? Response.json({ code: '42501', message: 'private raw SQL details' }, { status: 403 }) : Response.json([{ operation_id: operationId, outcome: 'detached' }]);
        }
        assert.equal(headers.get('Authorization'), 'Bearer synthetic-service');
        if (endpoint.endsWith('/claim_authorized_repair_image_deletion')) return Response.json([{ outcome: 'claimed', object_path: path, delete_claim_id: claim }]);
        if (endpoint.endsWith('/revalidate_repair_image_deletion_claim')) return Response.json([{ object_path: path, delete_claim_id: claim, storage_object_exists: exists, delete_lease_expires_at: new Date(Date.now()+300000).toISOString() }]);
        if (endpoint.endsWith('/complete_repair_image_deletion')) { assert.equal(exists, false); return Response.json(null); }
        if (init?.method === 'DELETE') {
          assert.equal(endpoint, `${url}/storage/v1/object/repair-images`);
          assert.deepEqual(JSON.parse(String(init.body)), { prefixes: [path] });
          if (scenario === 'delete-failed') return Response.json({ message: 'private storage error' }, { status: 500 });
          if (scenario !== 'still-present') exists = false;
          return Response.json([]);
        }
        const objectUrl = new URL(endpoint);
        assert.equal(objectUrl.origin + objectUrl.pathname, `${url}/storage/v1/object/authenticated/repair-images/${path}`);
        if (calls.includes(`${url}/storage/v1/object/repair-images`)) {
          assert.deepEqual([...objectUrl.searchParams.keys()], ['cacheNonce']);
          assert.match(objectUrl.searchParams.get('cacheNonce')!, /^[0-9a-f-]{36}$/);
        } else assert.equal(objectUrl.search, '');
        return exists ? new Response('x', { status: 206 }) : Response.json({ code: 'NoSuchKey' }, { status: 404 });
      };
      const response = await handleTargetedImageDeletionRequest(new Request('https://preview.invalid/api/repair-requests/images/delete', {
        method: 'POST', headers: { Authorization: 'Bearer synthetic-session', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }));
      const body = await response.json();
      const expected = scenario === 'invalid-token' ? [401,'unauthenticated'] : scenario === 'forbidden' ? [403,'forbidden'] : scenario === 'deleted' ? [200,'deleted'] : [503,'recovery_required'];
      assert.equal(response.status, expected[0]); assert.equal(body.status, expected[1]);
      assert.equal(body.operationId, operationId); assert.equal(body.physicalDeletionConfirmed, scenario === 'deleted');
      assert.ok(!JSON.stringify(body).includes('private')); assert.ok(!JSON.stringify(body).includes('synthetic-'));
      if (scenario === 'invalid-token') assert.equal(calls.length, 1);
      if (scenario === 'forbidden') assert.equal(calls.length, 2);
      assert.ok(calls.filter(x => x === `${url}/storage/v1/object/repair-images`).length <= 1);
    } finally { process.env = env; globalThis.fetch = originalFetch; }
  });
}
