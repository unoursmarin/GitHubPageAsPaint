import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG_PATH,
  ENGINE_PATH,
  RUNNER_SECRET_NAME,
  assertConfigOwner,
  buildArtConfig,
  buildWorkflowYaml,
  parseArtConfig,
  serializeArtConfig,
} from '../src/shared/art-config.js';
import { ValidationError } from '../src/shared/validation.js';
import { readEngineVersion } from '../src/shared/version.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const USER = { id: 42, login: 'octo', name: 'Octo Cat' };

function config(overrides = {}) {
  return buildArtConfig({ user: USER, timeZone: 'Europe/Paris', folder: 'paint', futureWeeks: 20, plan: { '2026-06-10': 2, '2026-06-02': 4 }, now: NOW, ...overrides });
}

test('a built config survives a serialize/parse round trip with sorted days', () => {
  const parsed = parseArtConfig(serializeArtConfig(config()), NOW);
  assert.deepEqual(Object.keys(parsed.plan), ['2026-06-02', '2026-06-10']);
  assert.deepEqual(parsed.user, USER);
  assert.equal(parsed.timeZone, 'Europe/Paris');
  assert.equal(parsed.folder, 'paint');
});

test('parseArtConfig drops days older than a year instead of failing', () => {
  const text = serializeArtConfig(config({ plan: { '2025-01-01': 3, '2026-06-10': 1 } }));
  assert.deepEqual(parseArtConfig(text, NOW).plan, { '2026-06-10': 1 });
});

test('parseArtConfig rejects broken or hostile content', () => {
  const valid = config();
  const cases = [
    'not json',
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, user: { id: 'x', login: 'octo' } }),
    JSON.stringify({ ...valid, user: { id: 1, login: 'bad login' } }),
    JSON.stringify({ ...valid, timeZone: 'Mars/Olympus' }),
    JSON.stringify({ ...valid, folder: '../escape' }),
    JSON.stringify({ ...valid, folder: '.github/workflows' }),
    JSON.stringify({ ...valid, plan: { '2026-06-10': 9 } }),
  ];
  for (const text of cases) {
    assert.throws(() => parseArtConfig(text, NOW), ValidationError, text.slice(0, 60));
  }
});

test('assertConfigOwner only accepts the repository owner, case-insensitively', () => {
  assertConfigOwner(config(), 'Octo');
  assert.throws(() => assertConfigOwner(config(), 'someone-else'), ValidationError);
});

test('the workflow runs the local engine daily with contents write only', () => {
  const yaml = buildWorkflowYaml({ timeZone: 'Europe/Paris', now: NOW });
  assert.match(yaml, /cron: '20 10 \* \* \*'/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /permissions:\n {2}contents: write\n/);
  assert.match(yaml, /actions\/checkout@[0-9a-f]{40}/);
  assert.ok(yaml.includes(`node ${ENGINE_PATH}`));
  assert.ok(yaml.includes(CONFIG_PATH));
  assert.ok(yaml.includes(`${RUNNER_SECRET_NAME}: \${{ secrets.${RUNNER_SECRET_NAME} }}`));
});

test('readEngineVersion reads the banner of a bundled engine only', () => {
  assert.equal(readEngineVersion('// git-to-paint-engine v1.2.3\nconsole.log(1)'), '1.2.3');
  assert.equal(readEngineVersion('console.log(1)'), null);
});
