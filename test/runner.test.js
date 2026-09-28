import test from 'node:test';
import assert from 'node:assert/strict';

import { commitAuthor, commitTimestamp, duePlan, runDrawing } from '../src/sync/runner.js';
import { createFakeGitHub, levelForCount } from './helpers/fake-github.mjs';

// 17:00 in Paris on 2026-06-10.
const NOW = new Date('2026-06-10T15:00:00Z');
const LIMITS = { maxCommits: 120, maxChecks: 6, recheckDelayMs: 0 };
// A realistic history so the estimated thresholds match the fake GitHub ones.
const HISTORY = { '2026-05-01': 1, '2026-05-02': 3, '2026-05-03': 6, '2026-05-04': 10 };
const USER = { id: 42, login: 'octo', name: 'Octo Cat' };

async function run({ plan, counts = HISTORY, limits = LIMITS, timeZone = 'Europe/Paris' }) {
  const github = createFakeGitHub({ counts });
  const config = { user: USER, timeZone, folder: 'paint/2026', plan };
  const result = await runDrawing({
    client: github,
    token: 'actions-token',
    owner: 'octo',
    repo: 'gitToPaint',
    branch: 'main',
    config,
    readCalendar: () => github.getContributionDays(),
    now: () => NOW,
    limits,
  });
  const days = await github.getContributionDays();
  const levelOn = (date) => levelForCount(days.find((day) => day.date === date)?.count ?? 0);
  return { github, result, levelOn };
}

test('paints today and the 7-day catch-up window, and nothing older or later', async () => {
  const { result, levelOn } = await run({
    plan: { '2026-06-01': 4, '2026-06-03': 3, '2026-06-09': 2, '2026-06-10': 1, '2026-06-20': 3 },
  });

  assert.equal(levelOn('2026-06-01'), 0, 'older than the catch-up window');
  assert.equal(levelOn('2026-06-03'), 3);
  assert.equal(levelOn('2026-06-09'), 2);
  assert.equal(levelOn('2026-06-10'), 1);
  assert.equal(levelOn('2026-06-20'), 0, 'future day');
  assert.deepEqual(result.summary, { scheduled: 0, ok: 3, pending: 0, above: 0 });
});

test('commits are random files in the chosen folder, authored as the user', async () => {
  const { github } = await run({ plan: { '2026-06-09': 1 } });

  assert.equal(github.commits.length, 1);
  const [commit] = github.commits;
  assert.deepEqual({ name: commit.author.name, email: commit.author.email }, commitAuthor(USER));
  assert.equal(commit.author.email, '42+octo@users.noreply.github.com');
  assert.deepEqual(commit.committer, commit.author);
  const [path] = Object.keys(github.files());
  assert.match(path, /^paint\/2026\/2026-06-09-[0-9a-f]{8}\.txt$/);
});

test('never publishes on a day already darker than planned', async () => {
  const { github, result } = await run({ plan: { '2026-06-05': 1 }, counts: { ...HISTORY, '2026-06-05': 7 } });
  assert.equal(github.commits.length, 0);
  assert.equal(result.results[0].status, 'above');
});

test('does nothing when no painted day falls in the window', async () => {
  const { github, result } = await run({ plan: { '2026-07-01': 2 } });
  assert.equal(github.commits.length, 0);
  assert.equal(result.commits, 0);
});

test('stops at the commit budget', async () => {
  const { result } = await run({ plan: { '2026-06-08': 4, '2026-06-09': 4 }, limits: { ...LIMITS, maxCommits: 5 } });
  assert.equal(result.commits, 5);
});

test('duePlan uses the local date of the user', () => {
  const plan = { '2026-06-02': 1, '2026-06-03': 1, '2026-06-10': 1, '2026-06-11': 1 };
  assert.deepEqual(Object.keys(duePlan(plan, '2026-06-10')), ['2026-06-03', '2026-06-10']);
});

test('commitTimestamp dates past days at local noon and today never in the future', () => {
  assert.equal(commitTimestamp('2026-06-09', 'Europe/Paris', 0, NOW), '2026-06-09T10:00:00Z');
  assert.equal(commitTimestamp('2026-06-09', 'Europe/Paris', 3, NOW), '2026-06-09T10:00:03Z');
  // 08:00 in Paris: local noon is still ahead, so the commit goes five minutes back.
  const morning = new Date('2026-06-10T06:00:00Z');
  assert.equal(commitTimestamp('2026-06-10', 'Europe/Paris', 0, morning), '2026-06-10T05:55:00Z');
  // Just after local midnight the commit is clamped to the start of the local day.
  const midnight = new Date('2026-06-09T22:01:00Z');
  assert.equal(commitTimestamp('2026-06-10', 'Europe/Paris', 0, midnight), '2026-06-09T22:00:00Z');
});
