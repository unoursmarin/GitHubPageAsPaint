import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../worker/proxy.js';

const ORIGIN = 'https://unoursmarin.github.io';
const ENV = { ALLOWED_ORIGIN: ORIGIN, GITHUB_CLIENT_ID: 'client-1' };
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

function call(path, { method = 'POST', origin = ORIGIN, body = {}, env = ENV, upstream } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    return upstream ?? new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const headers = origin ? { Origin: origin } : {};
  const request = new Request(`https://relay.test${path}`, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
  return handleRequest(request, env, fetchImpl).then((response) => ({ response, calls }));
}

test('rejects other origins and never forwards', async () => {
  const { response, calls } = await call('/device/code', { origin: 'https://evil.test', body: { client_id: 'client-1', scope: 'public_repo' } });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('answers the preflight for the page origin only', async () => {
  const { response } = await call('/device/code', { method: 'OPTIONS' });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('forwards the device code request with only whitelisted fields', async () => {
  const { response, calls } = await call('/device/code', { body: { client_id: 'client-1', scope: 'public_repo workflow', extra: 'x' } });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://github.com/login/device/code');
  assert.equal(calls[0].body.get('extra'), null);
  assert.equal(calls[0].body.get('scope'), 'public_repo workflow');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('refuses another client id and unexpected scopes', async () => {
  const other = await call('/device/code', { body: { client_id: 'someone-else', scope: 'public_repo' } });
  const scope = await call('/device/code', { body: { client_id: 'client-1', scope: 'delete_repo' } });
  assert.equal(other.response.status, 400);
  assert.equal(scope.response.status, 400);
  assert.equal(other.calls.length + scope.calls.length, 0);
});

test('forwards the token poll and requires the device grant', async () => {
  const ok = await call('/device/token', { body: { client_id: 'client-1', device_code: 'dc', grant_type: GRANT } });
  const bad = await call('/device/token', { body: { client_id: 'client-1', device_code: 'dc', grant_type: 'authorization_code' } });
  assert.equal(ok.calls[0].url, 'https://github.com/login/oauth/access_token');
  assert.equal(bad.response.status, 400);
});

test('unknown paths, wrong methods and unconfigured relays fail closed', async () => {
  assert.equal((await call('/other')).response.status, 404);
  assert.equal((await call('/device/code', { method: 'GET' })).response.status, 405);
  assert.equal((await call('/device/code', { env: { ALLOWED_ORIGIN: ORIGIN, GITHUB_CLIENT_ID: '' } })).response.status, 500);
});
