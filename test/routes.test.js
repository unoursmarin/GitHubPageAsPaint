import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../src/server/http.mjs';
import { createApiHandler } from '../src/server/routes.mjs';
import { createStaticHandler } from '../src/server/static.mjs';
import { createStore, deriveKey } from '../src/server/store.mjs';
import { createSyncEngine } from '../src/sync/engine.mjs';
import { createFakeGitHub } from './helpers/fake-github.mjs';

const KEY = deriveKey('routes-test');
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
const NOW = new Date('2026-06-10T15:00:00Z');

async function startApp({ github = createFakeGitHub({ counts: { '2026-05-01': 1, '2026-05-04': 10 } }) } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghpp-routes-'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghpp-root-'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html>');
  await fs.mkdir(path.join(root, '.data'));
  await fs.writeFile(path.join(root, '.data', 'secret.key'), 'nope');

  const store = await createStore({ dataDir });
  const config = { maxCommitsPerRun: 60, maxChecksPerRun: 6, recheckDelaySeconds: 0 };
  const engine = createSyncEngine({ store, client: github, key: KEY, config, now: () => NOW });
  const deviceFlow = {
    isEnabled: () => true,
    start: async () => ({ flowId: '123e4567-e89b-12d3-a456-426614174000', userCode: 'ABCD-1234' }),
    poll: async () => ({ status: 'complete', token: TOKEN }),
    cancel: () => {},
  };
  const handleApi = createApiHandler({ store, key: KEY, client: github, deviceFlow, engine, now: () => NOW });
  const serveStatic = createStaticHandler(root);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (!(await handleApi(request, response, url))) await serveStatic(url.pathname, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, pathname, body, headers = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE }) {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  return { call, base, store, github, close: () => server.close() };
}

test('signing in with a token stores it encrypted and never returns it', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const { status, body } = await app.call('POST', '/api/auth/token', { token: TOKEN });

  assert.equal(status, 200);
  assert.equal(body.session.account.login, 'octo');
  assert.ok(!JSON.stringify(body).includes(TOKEN));
  assert.ok(!JSON.stringify(app.store.get()).includes(TOKEN));
});

test('state-changing routes require the client header and reject other origins', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const missingHeader = await app.call('POST', '/api/auth/token', { token: TOKEN }, {});
  assert.equal(missingHeader.status, 403);

  const crossOrigin = await app.call('POST', '/api/auth/token', { token: TOKEN }, {
    [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
    Origin: 'https://evil.example',
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(app.store.get().account, null);
});

test('tokens without repository write scope are refused', async (t) => {
  const github = createFakeGitHub();
  github.getViewer = async () => ({ id: 1, login: 'octo', name: 'Octo', scopes: 'read:user' });
  const app = await startApp({ github });
  t.after(app.close);

  const { status } = await app.call('POST', '/api/auth/token', { token: TOKEN });
  assert.equal(status, 403);
});

test('device flow completion signs the user in', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const started = await app.call('POST', '/api/auth/device/start', {});
  const polled = await app.call('POST', '/api/auth/device/poll', { flowId: started.body.flowId });

  assert.equal(polled.body.status, 'complete');
  assert.equal(polled.body.session.account.method, 'oauth');
});

test('full flow: repos, target, plan, contributions and a manual sync', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await app.call('POST', '/api/auth/token', { token: TOKEN });

  const repos = await app.call('GET', '/api/repos');
  assert.deepEqual(repos.body.repos.map((repo) => repo.fullName), ['octo/art']);

  const target = await app.call('PUT', '/api/target', { owner: 'octo', repo: 'art', folder: 'paint' });
  assert.equal(target.status, 200);
  assert.deepEqual(target.body.target, { owner: 'octo', repo: 'art', folder: 'paint', branch: 'main', private: false });

  const plan = await app.call('PUT', '/api/plan', { plan: { '2026-06-09': 2 }, futureWeeks: 20 });
  assert.deepEqual(plan.body, { saved: 1 });

  const contributions = await app.call('GET', '/api/contributions');
  assert.ok(contributions.body.entries.length >= 2);

  const run = await app.call('POST', '/api/sync/run', {});
  assert.equal(run.body.started, true);

  let status;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    status = await app.call('GET', '/api/sync/status');
    if (status.body.lastSync) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(status.body.lastSync.error, null);
  assert.equal(status.body.lastSync.days['2026-06-09'].status, 'ok');
  assert.ok(app.github.commits.length > 0);
});

test('choosing a repository without push access is refused', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await app.call('POST', '/api/auth/token', { token: TOKEN });

  const { status } = await app.call('PUT', '/api/target', { owner: 'someone', repo: 'else', folder: 'paint' });
  assert.equal(status, 404);
});

test('invalid folders and plans are rejected with 400', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await app.call('POST', '/api/auth/token', { token: TOKEN });

  assert.equal((await app.call('PUT', '/api/target', { owner: 'octo', repo: 'art', folder: '../x' })).status, 400);
  assert.equal((await app.call('PUT', '/api/plan', { plan: { nope: 1 } })).status, 400);
});

test('logout forgets the account and the target', async (t) => {
  const app = await startApp();
  t.after(app.close);
  await app.call('POST', '/api/auth/token', { token: TOKEN });
  await app.call('PUT', '/api/target', { owner: 'octo', repo: 'art', folder: 'paint' });

  const { body } = await app.call('POST', '/api/auth/logout', {});
  assert.equal(body.account, null);
  assert.equal(body.target, null);
  assert.equal((await app.call('GET', '/api/repos')).status, 401);
});

test('static handler serves the page but never the data directory', async (t) => {
  const app = await startApp();
  t.after(app.close);

  assert.equal((await fetch(`${app.base}/`)).status, 200);
  assert.equal((await fetch(`${app.base}/.data/secret.key`)).status, 404);
  assert.equal((await fetch(`${app.base}/%2e%2e/etc/passwd`)).status, 404);
});
