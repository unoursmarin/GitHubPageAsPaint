import test from 'node:test';
import assert from 'node:assert/strict';

import { ValidationError, validateFolder, validatePlanPayload, validateToken } from '../src/shared/validation.js';

const NOW = new Date('2026-06-01T12:00:00Z');

test('validatePlanPayload accepts past and future days within range', () => {
  const result = validatePlanPayload({ plan: { '2026-05-01': 2, '2026-07-01': 4 }, futureWeeks: 10 }, NOW);
  assert.deepEqual(result, { plan: { '2026-05-01': 2, '2026-07-01': 4 }, futureWeeks: 10 });
});

test('validatePlanPayload rejects bad dates, levels and ranges', () => {
  assert.throws(() => validatePlanPayload({ plan: { '2026-02-30': 1 } }, NOW), ValidationError);
  assert.throws(() => validatePlanPayload({ plan: { '2026-05-01': 5 } }, NOW), ValidationError);
  assert.throws(() => validatePlanPayload({ plan: { '2024-01-01': 1 } }, NOW), ValidationError);
  assert.throws(() => validatePlanPayload({ plan: {}, futureWeeks: 100 }, NOW), ValidationError);
  assert.throws(() => validatePlanPayload({ plan: [] }, NOW), ValidationError);
});

test('validateToken trims tokens and rejects garbage', () => {
  assert.equal(validateToken('  ghp_abcdefghijklmnopqrstuvwxyz  '), 'ghp_abcdefghijklmnopqrstuvwxyz');
  assert.throws(() => validateToken('not a token'), ValidationError);
  assert.throws(() => validateToken(null), ValidationError);
});

test('validateFolder normalizes slashes and keeps nested folders', () => {
  assert.equal(validateFolder(' /art/2026/ '), 'art/2026');
  assert.equal(validateFolder('.github-page-as-paint'), '.github-page-as-paint');
});

test('validateFolder blocks traversal, reserved folders and odd characters', () => {
  for (const bad of ['', '../x', 'a/../b', '.git', '.github/workflows', 'a b', 'a/./b', 'a/b/c/d/e/f', 42]) {
    assert.throws(() => validateFolder(bad), ValidationError, `expected "${bad}" to be rejected`);
  }
});
