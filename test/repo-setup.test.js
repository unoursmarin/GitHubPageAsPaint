import test from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';

import { CONFIG_PATH, ENGINE_PATH, RUNNER_SECRET_NAME, SETUP_AUTHOR, WORKFLOW_PATH, buildArtConfig } from '../src/shared/art-config.js';
import { createDefaultRepo, installArtRepo, locateArtRepo, saveRunnerSecret, uninstallArtRepo } from '../src/setup/repo-setup.js';
import { openSealedSecret } from '../src/setup/secret.js';
import { createFakeGitHub } from './helpers/fake-github.mjs';

const VIEWER = { id: 42, login: 'octo', name: 'Octo Cat' };
const NOW = new Date('2026-06-01T12:00:00Z');

function repo(name, extra = {}) {
  return { owner: 'octo', repo: name, fullName: `octo/${name}`, private: false, fork: false, archived: false, defaultBranch: 'main', canPush: true, ...extra };
}

function artConfig() {
  return buildArtConfig({ user: VIEWER, timeZone: 'Europe/Paris', folder: 'paint', futureWeeks: 20, plan: { '2026-06-10': 2 }, now: NOW });
}

test('locateArtRepo prefers gitToPaint when it holds a config', async () => {
  const github = createFakeGitHub({
    repos: { gitToPaint: repo('gitToPaint', { files: { [CONFIG_PATH]: '{"a":1}' } }), other: repo('other', { files: { [CONFIG_PATH]: '{"b":2}' } }) },
  });
  const found = await locateArtRepo({ client: github, token: 't', viewer: VIEWER, rememberedRepo: 'other' });
  assert.equal(found.repo.repo, 'gitToPaint');
  assert.equal(found.configText, '{"a":1}');
});

test('locateArtRepo falls back to the remembered repository, then to the search', async () => {
  const remembered = createFakeGitHub({ repos: { mine: repo('mine', { files: { [CONFIG_PATH]: 'x' } }) } });
  assert.equal((await locateArtRepo({ client: remembered, token: 't', viewer: VIEWER, rememberedRepo: 'mine' })).repo.repo, 'mine');

  const searched = createFakeGitHub({ repos: { found: repo('found', { files: { [CONFIG_PATH]: 'y' } }) } });
  const result = await locateArtRepo({ client: searched, token: 't', viewer: VIEWER, rememberedRepo: null });
  assert.equal(result.repo.repo, 'found');
  assert.equal(result.configText, 'y');
});

test('locateArtRepo returns an empty gitToPaint, or nothing, when no config exists', async () => {
  const withDefault = createFakeGitHub({ repos: { gittopaint: repo('gitToPaint') } });
  const found = await locateArtRepo({ client: withDefault, token: 't', viewer: VIEWER });
  assert.equal(found.repo.repo, 'gitToPaint');
  assert.equal(found.configText, null);

  const empty = await locateArtRepo({ client: createFakeGitHub(), token: 't', viewer: VIEWER });
  assert.equal(empty.repo, null);
});

test('locateArtRepo ignores forks and repositories of other owners', async () => {
  const github = createFakeGitHub({
    repos: { gitToPaint: repo('gitToPaint', { fork: true, files: { [CONFIG_PATH]: 'x' } }) },
  });
  const found = await locateArtRepo({ client: github, token: 't', viewer: VIEWER });
  assert.equal(found.configText, null);
});

test('createDefaultRepo creates a public gitToPaint', async () => {
  const created = await createDefaultRepo({ client: createFakeGitHub(), token: 't' });
  assert.equal(created.repo, 'gitToPaint');
  assert.equal(created.private, false);
});

test('installArtRepo writes config, workflow and engine in one commit signed by the app author', async () => {
  const github = createFakeGitHub();
  await installArtRepo({ client: github, token: 't', repo: repo('gitToPaint'), config: artConfig(), engineSource: '// engine', now: NOW });

  assert.equal(github.commits.length, 1);
  assert.deepEqual({ name: github.commits[0].author.name, email: github.commits[0].author.email }, SETUP_AUTHOR);
  const files = github.files();
  assert.deepEqual(Object.keys(files).sort(), [CONFIG_PATH, ENGINE_PATH, WORKFLOW_PATH].sort());
  assert.equal(JSON.parse(files[CONFIG_PATH]).user.login, 'octo');
  assert.equal(files[ENGINE_PATH], '// engine');
  // Setup commits must not paint the user's wall.
  assert.deepEqual(await github.getContributionDays(), []);
});

test('uninstallArtRepo removes the installed files and, on request, the drawing folder', async () => {
  const github = createFakeGitHub({
    files: { [CONFIG_PATH]: '{}', [WORKFLOW_PATH]: 'yml', [ENGINE_PATH]: 'js', 'paint/a.txt': '1', 'paint/b.txt': '2', 'README.md': '#' },
  });
  github.secrets.set(RUNNER_SECRET_NAME, 'x');

  const removed = await uninstallArtRepo({ client: github, token: 't', repo: repo('gitToPaint'), folder: 'paint', removeGeneratedFiles: true });

  assert.equal(removed, 5);
  assert.deepEqual(Object.keys(github.files()), ['README.md']);
  assert.equal(github.secrets.has(RUNNER_SECRET_NAME), false);
});

test('saveRunnerSecret stores the read-only token sealed with the repository key', async () => {
  const keyPair = nacl.box.keyPair();
  const github = createFakeGitHub();
  github.publicKey = Buffer.from(keyPair.publicKey).toString('base64');

  await saveRunnerSecret({ client: github, token: 'ghp_write_token', repo: repo('gitToPaint'), secretValue: 'ghp_secret_value' });

  const stored = github.secrets.get(RUNNER_SECRET_NAME);
  assert.equal(stored.keyId, 'key-1');
  assert.notEqual(stored.encryptedValue, 'ghp_secret_value');
  assert.equal(openSealedSecret(stored.encryptedValue, keyPair), 'ghp_secret_value');
});
