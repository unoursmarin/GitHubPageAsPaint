import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ValidationError,
  validateFlowPayload,
  validateFolder,
  validatePlanPayload,
  validateTargetPayload,
  validateTokenPayload,
} from '../src/server/validation.mjs';

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

test('validateTokenPayload trims tokens and rejects garbage', () => {
  assert.equal(validateTokenPayload({ token: '  ghp_abcdefghijklmnopqrstuvwxyz  ' }), 'ghp_abcdefghijklmnopqrstuvwxyz');
  assert.throws(() => validateTokenPayload({ token: 'not a token' }), ValidationError);
  assert.throws(() => validateTokenPayload(null), ValidationError);
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

test('validateTargetPayload returns owner, repo and folder', () => {
  assert.deepEqual(validateTargetPayload({ owner: 'octo', repo: 'art', folder: 'paint' }), {
    owner: 'octo',
    repo: 'art',
    folder: 'paint',
  });
  assert.throws(() => validateTargetPayload({ owner: 'octo/x', repo: 'art', folder: 'paint' }), ValidationError);
});

test('validateFlowPayload only accepts UUIDs', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(validateFlowPayload({ flowId: id }), id);
  assert.throws(() => validateFlowPayload({ flowId: 'nope' }), ValidationError);
});
