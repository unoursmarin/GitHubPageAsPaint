import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, decryptSecret, deriveKey, encryptSecret, resolveEncryptionKey } from '../src/server/store.mjs';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ghpp-store-'));
}

test('encryptSecret round-trips and never stores the plaintext', () => {
  const key = deriveKey('test-secret');
  const payload = encryptSecret('ghp_example', key);

  assert.ok(!payload.includes('ghp_example'));
  assert.equal(decryptSecret(payload, key), 'ghp_example');
});

test('decryptSecret rejects a payload encrypted with another key', () => {
  const payload = encryptSecret('ghp_example', deriveKey('one'));
  assert.throws(() => decryptSecret(payload, deriveKey('two')));
});

test('resolveEncryptionKey persists a random key when APP_SECRET is missing', async () => {
  const dataDir = await tempDir();
  const first = await resolveEncryptionKey({ appSecret: null, dataDir });
  const second = await resolveEncryptionKey({ appSecret: null, dataDir });
  assert.deepEqual(first, second);
});

test('createStore persists updates and reloads them', async () => {
  const dataDir = await tempDir();
  const store = await createStore({ dataDir });
  await store.update((state) => ({ ...state, plan: { '2026-01-01': 2 } }));

  const reloaded = await createStore({ dataDir });
  assert.deepEqual(reloaded.get().plan, { '2026-01-01': 2 });
  assert.equal(reloaded.get().account, null);
});

test('createStore keeps the previous state when an updater throws', async () => {
  const store = await createStore({ dataDir: await tempDir() });
  await assert.rejects(store.update(() => {
    throw new Error('boom');
  }));
  await store.update((state) => ({ ...state, futureWeeks: 12 }));
  assert.equal(store.get().futureWeeks, 12);
});
