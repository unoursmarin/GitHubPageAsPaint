import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, deriveKey, encryptSecret } from '../src/server/store.mjs';
import { commitAuthor, commitTimestamp, createSyncEngine } from '../src/sync/engine.mjs';
import { createFakeGitHub, levelForCount } from './helpers/fake-github.mjs';

const KEY = deriveKey('engine-test');
const NOW = new Date('2026-06-10T15:00:00Z');
const CONFIG = { maxCommitsPerRun: 60, maxChecksPerRun: 6, recheckDelaySeconds: 0 };
// A realistic history so the estimated thresholds match the fake GitHub ones.
const HISTORY = { '2026-05-01': 1, '2026-05-02': 3, '2026-05-03': 6, '2026-05-04': 10 };

async function setup({ plan, counts = HISTORY, config = CONFIG, target } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghpp-engine-'));
  const store = await createStore({ dataDir });
  await store.update((state) => ({
    ...state,
    account: { token: encryptSecret('gho_token', KEY), id: 42, login: 'octo', name: 'Octo Cat' },
    target: target ?? { owner: 'octo', repo: 'art', branch: 'main', folder: 'paint/2026' },
    plan,
  }));
  const github = createFakeGitHub({ counts });
  const engine = createSyncEngine({ store, client: github, key: KEY, config, now: () => NOW });
  return { store, github, engine };
}

test('publishes until each due day reaches its painted level, and leaves future days alone', async () => {
  const { github, engine, store } = await setup({
    plan: { '2026-06-01': 4, '2026-06-09': 2, '2026-06-10': 1, '2026-06-20': 3 },
  });

  const result = await engine.runOnce();
  const days = await github.getContributionDays();
  const levelOn = (date) => levelForCount(days.find((day) => day.date === date)?.count ?? 0);

  assert.equal(result.status, 'done');
  assert.equal(levelOn('2026-06-01'), 4);
  assert.equal(levelOn('2026-06-09'), 2);
  assert.equal(levelOn('2026-06-10'), 1);
  assert.equal(levelOn('2026-06-20'), 0);
  assert.deepEqual(result.summary, { scheduled: 1, ok: 3, pending: 0, above: 0 });
  assert.equal(store.get().lastSync.commits, result.commits);
  assert.equal(store.get().syncLog.length, 1);
});

test('never publishes on a day that is already darker than planned', async () => {
  const { github, engine } = await setup({ plan: { '2026-06-05': 1 }, counts: { ...HISTORY, '2026-06-05': 7 } });

  const result = await engine.runOnce();

  assert.equal(github.commits.length, 0);
  assert.equal(result.days['2026-06-05'].status, 'above');
});

test('does nothing when every due day already matches', async () => {
  const { github, engine } = await setup({ plan: { '2026-06-05': 2 }, counts: { ...HISTORY, '2026-06-05': 4 } });
  const result = await engine.runOnce();
  assert.equal(github.commits.length, 0);
  assert.equal(result.summary.ok, 1);
});

test('stops at the commit budget and reports the day as still pending', async () => {
  const { github, engine } = await setup({
    plan: { '2026-06-01': 4 },
    config: { ...CONFIG, maxCommitsPerRun: 3 },
  });

  const result = await engine.runOnce();

  assert.equal(github.commits.length, 3);
  assert.equal(result.days['2026-06-01'].status, 'pending');
});

test('writes one file per commit inside the chosen folder with the account noreply author', async () => {
  const { github, engine } = await setup({ plan: { '2026-06-09': 1 } });
  await engine.runOnce();

  assert.equal(github.commits.length, 1);
  const [commit] = github.commits;
  assert.equal(commit.author.email, '42+octo@users.noreply.github.com');
  assert.equal(commit.author.date, '2026-06-09T12:00:00Z');
  assert.match(github.files()[0].path, /^paint\/2026\/2026-06-09-[0-9a-f]{8}\.txt$/);
});

test('skips cleanly when the account, target or plan is missing', async () => {
  const { engine, store } = await setup({ plan: {} });
  assert.equal((await engine.runOnce()).status, 'skipped');

  await store.update((state) => ({ ...state, plan: { '2026-06-09': 1 }, target: null }));
  assert.equal((await engine.runOnce()).status, 'skipped');
});

test('records GitHub failures without throwing', async () => {
  const { engine, github, store } = await setup({ plan: { '2026-06-09': 1 } });
  github.getBranchSha = async () => {
    throw new Error('octo/art has no "main" branch yet.');
  };

  const result = await engine.runOnce();

  assert.equal(result.status, 'error');
  assert.match(store.get().lastSync.error, /no "main" branch/);
});

test('refuses to start a second run while one is in progress', async () => {
  const { engine, github } = await setup({ plan: { '2026-06-09': 1 } });
  let release;
  const original = github.getContributionDays;
  github.getContributionDays = () => new Promise((resolve) => {
    release = () => resolve(original());
  });

  const first = engine.runOnce();
  assert.deepEqual(await engine.runOnce(), { status: 'busy' });
  github.getContributionDays = original;
  release();
  assert.equal((await first).status, 'done');
});

test('commitAuthor falls back to the login as display name', () => {
  assert.deepEqual(commitAuthor({ id: 7, login: 'ada' }), { name: 'ada', email: '7+ada@users.noreply.github.com' });
});

test('commitTimestamp never dates today in the future nor before midnight', () => {
  assert.equal(commitTimestamp('2026-06-09', '2026-06-10', 2, NOW), '2026-06-09T12:00:02Z');
  assert.equal(commitTimestamp('2026-06-10', '2026-06-10', 0, new Date('2026-06-10T08:00:00Z')), '2026-06-10T07:55:00Z');
  assert.equal(commitTimestamp('2026-06-10', '2026-06-10', 0, new Date('2026-06-10T00:01:00Z')), '2026-06-10T00:00:00Z');
});
