import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateCommits,
  cautiousStep,
  estimateLevelThresholds,
  levelFromGraphql,
  reconcilePlan,
  summarizeResults,
} from '../src/sync/reconcile.js';

const HISTORY = [
  { date: '2026-01-01', count: 1, level: 1 },
  { date: '2026-01-02', count: 3, level: 2 },
  { date: '2026-01-03', count: 6, level: 3 },
  { date: '2026-01-04', count: 10, level: 4 },
];

test('levelFromGraphql maps quartile names and defaults to 0', () => {
  assert.equal(levelFromGraphql('NONE'), 0);
  assert.equal(levelFromGraphql('THIRD_QUARTILE'), 3);
  assert.equal(levelFromGraphql('UNKNOWN'), 0);
});

test('estimateLevelThresholds uses the lowest count observed at each level', () => {
  assert.deepEqual(estimateLevelThresholds(HISTORY), [0, 1, 3, 6, 10]);
});

test('estimateLevelThresholds stays strictly increasing with an empty history', () => {
  const thresholds = estimateLevelThresholds([]);
  assert.equal(thresholds[0], 0);
  for (let level = 1; level < thresholds.length; level += 1) {
    assert.ok(thresholds[level] > thresholds[level - 1]);
  }
});

test('reconcilePlan classifies scheduled, ok, pending and above days', () => {
  const days = [...HISTORY, { date: '2026-01-05', count: 3, level: 2 }, { date: '2026-01-06', count: 6, level: 3 }];
  const plan = { '2026-01-05': 2, '2026-01-06': 1, '2026-01-07': 3, '2026-01-09': 4 };

  const results = reconcilePlan({ plan, days, today: '2026-01-08' });
  const byDate = Object.fromEntries(results.map((result) => [result.date, result]));

  assert.equal(byDate['2026-01-05'].status, 'ok');
  assert.equal(byDate['2026-01-06'].status, 'above');
  assert.equal(byDate['2026-01-06'].commitsToAdd, 0);
  assert.equal(byDate['2026-01-07'].status, 'pending');
  assert.equal(byDate['2026-01-07'].commitsToAdd, 6);
  assert.equal(byDate['2026-01-09'].status, 'scheduled');
  assert.deepEqual(summarizeResults(results), { scheduled: 1, ok: 1, pending: 1, above: 1 });
});

test('reconcilePlan never asks for enough commits to jump past the target level', () => {
  const days = [...HISTORY, { date: '2026-01-05', count: 1, level: 1 }];
  const [result] = reconcilePlan({ plan: { '2026-01-05': 2 }, days, today: '2026-01-05' });

  assert.equal(result.status, 'pending');
  assert.equal(result.commitsToAdd, 2);
  assert.ok(result.count + result.commitsToAdd < 6);
});

test('cautiousStep halves pending commits but always keeps at least one', () => {
  const stepped = cautiousStep([
    { status: 'pending', commitsToAdd: 5 },
    { status: 'pending', commitsToAdd: 1 },
    { status: 'ok', commitsToAdd: 0 },
  ]);
  assert.deepEqual(stepped.map((result) => result.commitsToAdd), [3, 1, 0]);
});

test('allocateCommits fills oldest days first and respects the budget', () => {
  const commits = allocateCommits(
    [
      { date: '2026-01-01', status: 'pending', commitsToAdd: 2 },
      { date: '2026-01-02', status: 'above', commitsToAdd: 0 },
      { date: '2026-01-03', status: 'pending', commitsToAdd: 5 },
    ],
    4,
  );
  assert.deepEqual(commits, [
    { date: '2026-01-01', sequence: 1 },
    { date: '2026-01-01', sequence: 2 },
    { date: '2026-01-03', sequence: 1 },
    { date: '2026-01-03', sequence: 2 },
  ]);
});
