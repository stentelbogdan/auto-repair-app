import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TEST_REF = 'bstjobvvxxfqqwyjoimx';
const TEST_HOST = `${TEST_REF}.supabase.co`;
const TEST_URL = `https://${TEST_HOST}`;
const BRANCH = 'codex/hybrid-autorepair-stable-rebuild';
const MAX_BYTES = 65536;
const ACCEPTED = 'TEST_SERVER_CREDENTIAL_ACCEPTED';
const codes = new Set([ACCEPTED, 'BLOCKED_ENVIRONMENT', 'BLOCKED_NOT_ENABLED',
  'BLOCKED_DEPLOYMENT_IDENTITY', 'BLOCKED_EXPECTED_COMMIT', 'BLOCKED_COMMIT_MISMATCH', 'BLOCKED_PROJECT', 'BLOCKED_MISSING_CREDENTIAL',
  'BLOCKED_CREDENTIAL_FORMAT', 'BLOCKED_TLS_CONFIGURATION', 'BLOCKED_REDIRECT',
  'BLOCKED_UNAUTHORIZED', 'BLOCKED_HTTP', 'BLOCKED_RESPONSE', 'BLOCKED_TRANSPORT',
  'BLOCKED_INTERNAL']);

// One fixed GET. No URL, method, headers or TLS overrides from the caller/env.
// requestImpl is a local-test seam; CLI always uses node:https.
export function createTransport(requestImpl = httpsRequest) {
  return key => new Promise((resolveResult, reject) => {
    let request;
    let timer;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new Error('BLOCKED_TRANSPORT'));
      else resolveResult(value);
    };
    try {
      request = requestImpl({
        protocol: 'https:', hostname: TEST_HOST, port: 443,
        path: '/auth/v1/admin/users?page=1&per_page=1', method: 'GET',
        rejectUnauthorized: true, agent: false,
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json',
          'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' },
      }, response => {
        const status = response.statusCode;
        if (status !== 200) {
          finish(null, { status });
          response.destroy(); // Do not read administrative/error bodies or redirects.
          return;
        }
        const type = response.headers['content-type'];
        if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
            (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
          finish(null, { status, invalid: true }); response.destroy(); return;
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            chunks.length = 0;
            finish(null, { status, invalid: true }); response.destroy(); return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (!response.complete) { finish(true); return; }
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { finish(null, { status, invalid: true }); return; }
          finally { chunks.length = 0; }
          // Inspect only structure. Never log, return, persist or enumerate users.
          const valid = body !== null && typeof body === 'object' && !Array.isArray(body) &&
            Array.isArray(body.users) && body.users.length <= 1 && typeof body.aud === 'string' &&
            body.users.every(user => user !== null && typeof user === 'object' && !Array.isArray(user) &&
              typeof user.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user.id));
          finish(null, { status, valid });
        });
        response.on('error', () => finish(true));
        response.on('aborted', () => finish(true));
        response.on('close', () => { if (!response.complete) finish(true); });
      });
      request.on('error', () => finish(true));
      timer = setTimeout(() => { finish(true); request.destroy(); }, 10000);
      request.end();
    } catch { finish(true); request?.destroy(); }
  });
}

export async function verifyPreviewCredential(env, transport = createTransport()) {
  if (env.VERCEL_ENV !== 'preview') return 'BLOCKED_ENVIRONMENT';
  if (env.VERIFY_TEST_SERVER_CREDENTIAL !== 'true') return 'BLOCKED_NOT_ENABLED';
  if (env.VERCEL !== '1' || env.VERCEL_GIT_COMMIT_REF !== BRANCH ||
      !/^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) return 'BLOCKED_DEPLOYMENT_IDENTITY';
  if (!/^[0-9a-f]{40}$/.test(env.EXPECTED_PREVIEW_COMMIT_SHA ?? '')) return 'BLOCKED_EXPECTED_COMMIT';
  if (env.VERCEL_GIT_COMMIT_SHA !== env.EXPECTED_PREVIEW_COMMIT_SHA) return 'BLOCKED_COMMIT_MISMATCH';
  if (![TEST_URL, `${TEST_URL}/`].includes(env.SUPABASE_URL) ||
      ![TEST_URL, `${TEST_URL}/`].includes(env.NEXT_PUBLIC_SUPABASE_URL) ||
      env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF !== TEST_REF) return 'BLOCKED_PROJECT';
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || env.NODE_DEBUG || env.NODE_DEBUG_NATIVE ||
      env.SSLKEYLOGFILE || /(?:tls-keylog|--require|--import|--inspect)/.test(env.NODE_OPTIONS ?? '')) return 'BLOCKED_TLS_CONFIGURATION';
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return 'BLOCKED_MISSING_CREDENTIAL';
  if (typeof key !== 'string' || key.length > 8192 || !/^[A-Za-z0-9._~-]+$/.test(key)) return 'BLOCKED_CREDENTIAL_FORMAT';
  try {
    const response = await transport(key);
    if (response.status >= 300 && response.status <= 399) return 'BLOCKED_REDIRECT';
    if (response.status === 401 || response.status === 403) return 'BLOCKED_UNAUTHORIZED';
    if (response.status !== 200) return 'BLOCKED_HTTP';
    return response.valid === true ? ACCEPTED : 'BLOCKED_RESPONSE';
  } catch { return 'BLOCKED_TRANSPORT'; }
}

export async function run(env = process.env, transport = createTransport(), output = code => process.stdout.write(`${code}\n`)) {
  let result;
  try { result = await verifyPreviewCredential(env, transport); }
  catch { result = 'BLOCKED_INTERNAL'; }
  if (!codes.has(result)) result = 'BLOCKED_INTERNAL';
  output(result);
  return result === ACCEPTED ? 0 : 1;
}

// Importing for mock tests never runs the probe.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run();
}
