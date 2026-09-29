import test from 'node:test';
import assert from 'node:assert/strict';

import { createCalendarReader } from '../engine/draw.mjs';

const RANGE = { from: new Date('2025-06-01T00:00:00Z'), to: new Date('2026-06-01T00:00:00Z') };

test('the calendar reader uses the first token that works and sticks to it', async () => {
  const used = [];
  const client = {
    async getContributionDays(token) {
      used.push(token);
      if (token === 'secret') throw new Error('Bad credentials');
      return [{ date: '2026-05-01', count: 1, level: 1 }];
    },
  };
  const read = createCalendarReader({ client, login: 'octo', tokens: [['secret', 'secret'], ['actions', 'actions']], log: () => {} });

  assert.equal((await read(RANGE)).length, 1);
  await read(RANGE);
  assert.deepEqual(used, ['secret', 'actions', 'actions']);
});

test('the calendar reader falls back to the public profile page', async () => {
  const client = { getContributionDays: async () => { throw new Error('Forbidden'); } };
  const read = createCalendarReader({
    client,
    login: 'octo',
    tokens: [['actions', 'actions']],
    log: () => {},
    fetchPublic: async (login) => [{ date: '2026-05-01', count: 2, level: 2, login }],
  });

  const days = await read(RANGE);
  assert.equal(days[0].login, 'octo');
});
