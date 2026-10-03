import test from 'node:test';
import assert from 'node:assert/strict';

import { DeviceFlowError, createDeviceFlow } from '../src/github/device-flow.js';

const CODE = { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 };

function flowWith(responses) {
  const queue = [...responses];
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  const waits = [];
  const flow = createDeviceFlow({ clientId: 'client-1', relayUrl: 'https://relay.test/', scopes: 'public_repo', fetchImpl, wait: async (ms) => waits.push(ms) });
  return { flow, requests, waits };
}

test('start asks the relay for a code with the client id and scopes', async () => {
  const { flow, requests } = flowWith([{ body: CODE }]);
  const started = await flow.start();
  assert.equal(requests[0].url, 'https://relay.test/device/code');
  assert.deepEqual(requests[0].body, { client_id: 'client-1', scope: 'public_repo' });
  assert.equal(started.userCode, 'ABCD-1234');
});

test('waitForToken keeps polling while pending and slows down when asked', async () => {
  const { flow, waits } = flowWith([
    { body: CODE },
    { body: { error: 'authorization_pending' } },
    { body: { error: 'slow_down', interval: 10 } },
    { body: { access_token: 'gho_token' } },
  ]);
  const token = await flow.waitForToken(await flow.start());
  assert.equal(token, 'gho_token');
  assert.deepEqual(waits, [5000, 5000, 10000]);
});

test('denied and expired authorizations raise a readable error', async () => {
  for (const [error, pattern] of [['access_denied', /denied/], ['expired_token', /expired/]]) {
    const { flow } = flowWith([{ body: CODE }, { body: { error } }]);
    await assert.rejects(async () => flow.waitForToken(await flow.start()), (caught) => caught instanceof DeviceFlowError && pattern.test(caught.message));
  }
});

test('an unreachable relay explains the fallback', async () => {
  const { flow } = flowWith([new TypeError('network')]);
  await assert.rejects(() => flow.start(), /personal access token/);
});
