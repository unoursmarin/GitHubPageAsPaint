import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './src/server/config.mjs';
import { createDeviceFlow } from './src/server/device-flow.mjs';
import { createGitHubClient } from './src/server/github-client.mjs';
import { sendJson } from './src/server/http.mjs';
import { createApiHandler } from './src/server/routes.mjs';
import { createStaticHandler } from './src/server/static.mjs';
import { createStore, resolveEncryptionKey } from './src/server/store.mjs';
import { createSyncEngine } from './src/sync/engine.mjs';
import { createScheduler } from './src/sync/scheduler.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const config = loadConfig(process.env, root);
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

const key = await resolveEncryptionKey(config);
const store = await createStore(config);
const client = createGitHubClient();
const deviceFlow = createDeviceFlow({ clientId: config.clientId, scopes: config.scopes });
const engine = createSyncEngine({ store, client, key, config, log });
const scheduler = createScheduler({ engine, intervalMinutes: config.syncIntervalMinutes, log });

const handleApi = createApiHandler({ store, key, client, deviceFlow, engine, scheduler, log });
const serveStatic = createStaticHandler(root);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (await handleApi(request, response, url)) return;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    log(`request failed: ${error.stack || error.message}`);
    if (!response.headersSent) sendJson(response, 400, { error: 'Bad request' });
  }
});

server.listen(config.port, config.host, () => {
  const shownHost = config.host === '127.0.0.1' ? 'localhost' : config.host;
  log(`GitHubPageAsPaint listening on http://${shownHost}:${config.port}`);
  log(config.clientId ? 'GitHub OAuth sign-in enabled.' : 'GITHUB_CLIENT_ID not set: only personal access tokens can be used.');
  log(`Sync runs every ${config.syncIntervalMinutes} min.`);
  scheduler.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
}
