import test from 'node:test';
import assert from 'node:assert/strict';

import { dailyCronForLocalTime, dateInZone, isValidTimeZone, offsetMinutes, shiftDate, zonedTimeToUtc } from '../src/shared/zone.js';

const SUMMER = new Date('2026-07-01T12:00:00Z');
const WINTER = new Date('2026-01-15T12:00:00Z');

test('dateInZone returns the local calendar date', () => {
  const lateUtc = new Date('2026-07-01T23:30:00Z');
  assert.equal(dateInZone(lateUtc, 'UTC'), '2026-07-01');
  assert.equal(dateInZone(lateUtc, 'Europe/Paris'), '2026-07-02');
  assert.equal(dateInZone(lateUtc, 'America/Los_Angeles'), '2026-07-01');
});

test('offsetMinutes follows daylight saving', () => {
  assert.equal(offsetMinutes(SUMMER, 'Europe/Paris'), 120);
  assert.equal(offsetMinutes(WINTER, 'Europe/Paris'), 60);
  assert.equal(offsetMinutes(WINTER, 'America/New_York'), -300);
  assert.equal(offsetMinutes(WINTER, 'Asia/Kolkata'), 330);
  assert.equal(offsetMinutes(WINTER, 'UTC'), 0);
});

test('zonedTimeToUtc converts a local wall-clock time', () => {
  assert.equal(zonedTimeToUtc('2026-07-01', 12 * 60, 'Europe/Paris').toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-01-15', 0, 'America/New_York').toISOString(), '2026-01-15T05:00:00.000Z');
});

test('dailyCronForLocalTime maps 12:20 local to UTC cron fields', () => {
  const localTime = 12 * 60 + 20;
  assert.equal(dailyCronForLocalTime(localTime, 'Europe/Paris', SUMMER), '20 10 * * *');
  assert.equal(dailyCronForLocalTime(localTime, 'Europe/Paris', WINTER), '20 11 * * *');
  assert.equal(dailyCronForLocalTime(localTime, 'America/New_York', WINTER), '20 17 * * *');
  assert.equal(dailyCronForLocalTime(localTime, 'Asia/Kolkata', WINTER), '50 6 * * *');
  assert.equal(dailyCronForLocalTime(30, 'Pacific/Auckland', WINTER), '30 11 * * *');
});

test('shiftDate and isValidTimeZone', () => {
  assert.equal(shiftDate('2026-03-01', -7), '2026-02-22');
  assert.equal(isValidTimeZone('Europe/Paris'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  assert.equal(isValidTimeZone(''), false);
});
