import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlannerGrid, cycleFutureIntensity, HISTORICAL_WEEKS } from '../src/core.js';

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
