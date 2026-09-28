import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlannerGrid,
  buildSchedulePayload,
  cycleFutureIntensity,
  expandScheduleEntries,
  HISTORICAL_WEEKS,
  serializePlan,
} from '../src/core.js';
import { buildCommitDate } from '../src/publisher.js';

test('cycleFutureIntensity wraps after the darkest level', () => {
  assert.equal(cycleFutureIntensity(0), 1);
  assert.equal(cycleFutureIntensity(4), 0);
});

test('buildPlannerGrid marks dates after today as future and keeps past counts', () => {
  const weeks = buildPlannerGrid({
    today: new Date('2026-01-07T00:00:00Z'),
    futureWeeks: 1,
    pastEntries: [{ date: '2026-01-07', count: 5 }],
  });
  const flatDays = weeks.flatMap((week) => week.days);
  const todayCell = flatDays.find((day) => day.date === '2026-01-07');
  const futureCell = flatDays.find((day) => day.date === '2026-01-08');

  assert.equal(todayCell.kind, 'past');
  assert.equal(todayCell.count, 5);
  assert.equal(futureCell.kind, 'future');
  assert.equal(futureCell.level, 0);
});

test('buildPlannerGrid uses futureWeeks as the number of week columns with future days', () => {
  const weeks = buildPlannerGrid({
    today: new Date('2026-01-07T00:00:00Z'),
    futureWeeks: 2,
  });
  const futureWeekColumns = weeks.filter((week) => week.days.some((day) => day.isFuture));

  assert.equal(weeks.length, HISTORICAL_WEEKS + 1);
  assert.equal(futureWeekColumns.length, 2);
});

test('serializePlan sorts days and removes empty selections', () => {
  const plan = new Map([
    ['2026-03-01', 0],
    ['2026-02-14', 3],
    ['2026-02-01', 1],
  ]);

  assert.deepEqual(serializePlan(plan), [
    { date: '2026-02-01', count: 1 },
    { date: '2026-02-14', count: 3 },
  ]);
});

test('buildSchedulePayload keeps repository metadata and serialized entries', () => {
  const payload = buildSchedulePayload({
    username: 'octocat',
    owner: 'octocat',
    repo: 'paint',
    branch: 'main',
    plan: new Map([
      ['2026-02-14', 3],
      ['2026-02-01', 1],
    ]),
  });

  assert.equal(payload.username, 'octocat');
  assert.deepEqual(payload.repository, {
    owner: 'octocat',
    repo: 'paint',
    branch: 'main',
  });
  assert.deepEqual(payload.entries, [
    { date: '2026-02-01', count: 1 },
    { date: '2026-02-14', count: 3 },
  ]);
});

test('expandScheduleEntries repeats each day according to the requested count', () => {
  assert.deepEqual(expandScheduleEntries([
    { date: '2026-02-01', count: 2 },
    { date: '2026-02-02', count: 1 },
  ]), [
    { date: '2026-02-01', sequence: 1 },
    { date: '2026-02-01', sequence: 2 },
    { date: '2026-02-02', sequence: 1 },
  ]);
});

test('buildCommitDate starts at 09:00Z and increments by seven minutes', () => {
  assert.equal(buildCommitDate('2026-02-14', 1), '2026-02-14T09:00:00Z');
  assert.equal(buildCommitDate('2026-02-14', 2), '2026-02-14T09:07:00Z');
  assert.equal(buildCommitDate('2026-02-14', 10), '2026-02-14T10:03:00Z');
});
