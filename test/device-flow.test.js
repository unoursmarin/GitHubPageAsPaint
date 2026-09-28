import test from 'node:test';
import assert from 'node:assert/strict';

import { createDeviceFlow, DeviceFlowError } from '../src/server/device-flow.mjs';

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    const next = responses.shift();
    return { ok: true, status: 200, json: async () => next };
  };
  return { impl, calls };
}

const DEVICE_RESPONSE = {
  device_code: 'secret-device-code',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  interval: 5,
  expires_in: 900,
};

test('start refuses to run without a client id', async () => {
  const flow = createDeviceFlow({ clientId: null, scopes: 'public_repo' });
  assert.equal(flow.isEnabled(), false);
  await assert.rejects(flow.start(), DeviceFlowError);
});

test('start hides the device code and poll completes with a token', async () => {
  const { impl, calls } = fakeFetch([DEVICE_RESPONSE, { error: 'authorization_pending' }, { access_token: 'gho_token' }]);
  const flow = createDeviceFlow({ clientId: 'client', scopes: 'public_repo', fetchImpl: impl });

  const started = await flow.start();
  assert.equal(started.userCode, 'ABCD-1234');
  assert.ok(!JSON.stringify(started).includes('secret-device-code'));

  assert.deepEqual(await flow.poll(started.flowId), { status: 'pending', interval: 5 });
  assert.deepEqual(await flow.poll(started.flowId), { status: 'complete', token: 'gho_token' });
  assert.equal(calls[1].body.get('device_code'), 'secret-device-code');

  assert.deepEqual(await flow.poll(started.flowId), { status: 'expired' });
});

test('poll slows down and reports a denied authorization', async () => {
  const { impl } = fakeFetch([DEVICE_RESPONSE, { error: 'slow_down' }, { error: 'access_denied' }]);
  const flow = createDeviceFlow({ clientId: 'client', scopes: 'public_repo', fetchImpl: impl });
  const { flowId } = await flow.start();

  assert.deepEqual(await flow.poll(flowId), { status: 'pending', interval: 10 });
  assert.deepEqual(await flow.poll(flowId), { status: 'denied' });
});

test('poll expires flows past their lifetime', async () => {
  let clock = 0;
  const { impl } = fakeFetch([DEVICE_RESPONSE]);
  const flow = createDeviceFlow({ clientId: 'client', scopes: 'public_repo', fetchImpl: impl, now: () => clock });
  const { flowId } = await flow.start();

  clock = 901_000;
  assert.deepEqual(await flow.poll(flowId), { status: 'expired' });
});
