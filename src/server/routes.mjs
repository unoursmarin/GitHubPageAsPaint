import { addDays, toIsoDate } from '../core.js';
import { DeviceFlowError } from './device-flow.mjs';
import { GitHubError, hasRepoWriteScope } from './github-client.mjs';
import { assertSameOriginWrite, HttpError, readJson, sendJson } from './http.mjs';
import { fetchPublicContributions } from './public-contributions.mjs';
import { decryptSecret, encryptSecret } from './store.mjs';
import {
  validateFlowPayload,
  validatePlanPayload,
  validateTargetPayload,
  validateTokenPayload,
  ValidationError,
} from './validation.mjs';

const CALENDAR_DAYS = 364;
const USERNAME_PATTERN = /^[A-Za-z0-9-]{1,39}$/;

/**
 * JSON API for the single local user. Returns an async handler that resolves to
 * true when it answered the request, false when the path is not an API route.
 */
export function createApiHandler({ store, key, client, deviceFlow, engine, scheduler, now = () => new Date(), log = () => {} }) {
  const routes = {
    'GET /api/session': async () => sessionView(),

    'POST /api/auth/device/start': async () => deviceFlow.start(),

    'POST /api/auth/device/poll': async (body) => {
      const result = await deviceFlow.poll(validateFlowPayload(body));
      if (result.status !== 'complete') return result;
      return { status: 'complete', session: await signIn(result.token, 'oauth') };
    },

    'POST /api/auth/device/cancel': async (body) => {
      deviceFlow.cancel(validateFlowPayload(body));
      return { status: 'cancelled' };
    },

    'POST /api/auth/token': async (body) => ({ session: await signIn(validateTokenPayload(body), 'token') }),

    'POST /api/auth/logout': async () => {
      await store.update((state) => ({ ...state, account: null, target: null, lastSync: null }));
      return sessionView();
    },

    'GET /api/contributions': async (body, url) => ({ entries: await loadContributions(url.searchParams.get('username')) }),

    'GET /api/repos': async () => ({ repos: await client.listWritableRepos(requireToken()) }),

    'PUT /api/target': async (body) => {
      const { owner, repo, folder } = validateTargetPayload(body);
      const repos = await client.listWritableRepos(requireToken());
      const match = repos.find((candidate) => candidate.owner === owner && candidate.repo === repo);
      if (!match) {
        throw new HttpError(404, `You cannot push to ${owner}/${repo}, or it is archived or a fork.`);
      }
      // Commits only count toward the calendar on the default branch.
      const target = { owner, repo, folder, branch: match.defaultBranch, private: match.private };
      await store.update((state) => ({ ...state, target }));
      return sessionView();
    },

    'PUT /api/plan': async (body) => {
      const { plan, futureWeeks } = validatePlanPayload(body, now());
      await store.update((state) => ({ ...state, plan, futureWeeks }));
      return { saved: Object.keys(plan).length };
    },

    'GET /api/sync/status': async () => syncView(),

    'POST /api/sync/run': async () => {
      if (engine.isRunning()) return { started: false, reason: 'A sync is already running.' };
      // Runs can take minutes (re-check pauses), so answer now and let the UI poll the status.
      engine.runOnce({ trigger: 'manual' }).catch((error) => log(`manual sync crashed: ${error.message}`));
      return { started: true };
    },
  };

  async function signIn(token, method) {
    const viewer = await client.getViewer(token);
    if (!hasRepoWriteScope(viewer.scopes)) {
      throw new HttpError(403, 'This token cannot write to repositories. Grant the "public_repo" or "repo" scope.');
    }

    await store.update((state) => {
      const sameUser = state.account?.id === viewer.id;
      return {
        ...state,
        account: {
          token: encryptSecret(token, key),
          method,
          id: viewer.id,
          login: viewer.login,
          name: viewer.name,
          avatarUrl: viewer.avatarUrl,
          scopes: viewer.scopes,
          connectedAt: now().toISOString(),
        },
        target: sameUser ? state.target : null,
        lastSync: sameUser ? state.lastSync : null,
      };
    });
    return sessionView();
  }

  function requireToken() {
    const { account } = store.get();
    if (!account?.token) throw new HttpError(401, 'Connect a GitHub account first.');
    return decryptSecret(account.token, key);
  }

  async function loadContributions(requested) {
    const { account } = store.get();
    const username = requested?.trim() || account?.login;
    if (!username || !USERNAME_PATTERN.test(username)) {
      throw new ValidationError('A valid GitHub username is required.');
    }

    if (account && username.toLowerCase() === account.login.toLowerCase()) {
      const from = new Date(`${toIsoDate(addDays(now(), -CALENDAR_DAYS))}T00:00:00Z`);
      return client.getContributionDays(requireToken(), account.login, { from, to: now() });
    }
    return fetchPublicContributions(username);
  }

  function sessionView() {
    const { account, target, plan, futureWeeks } = store.get();
    return {
      oauthEnabled: deviceFlow.isEnabled(),
      account: account
        ? { login: account.login, name: account.name, avatarUrl: account.avatarUrl, method: account.method, scopes: account.scopes }
        : null,
      target,
      plan,
      futureWeeks,
      sync: syncView(),
    };
  }

  function syncView() {
    const { lastSync, syncLog } = store.get();
    return {
      running: engine.isRunning(),
      nextRunAt: scheduler?.nextRunAt()?.toISOString() ?? null,
      lastSync,
      log: syncLog ?? [],
    };
  }

  return async function handleApi(request, response, url) {
    if (!url.pathname.startsWith('/api/')) return false;

    const route = routes[`${request.method} ${url.pathname}`];
    if (!route) {
      sendJson(response, 404, { error: 'Unknown API route.' });
      return true;
    }

    try {
      let body = null;
      if (request.method !== 'GET') {
        assertSameOriginWrite(request);
        body = await readJson(request);
      }
      sendJson(response, 200, await route(body, url));
    } catch (error) {
      const { status, message } = describeError(error);
      if (status >= 500) log(`${request.method} ${url.pathname} failed: ${error.stack || error.message}`);
      sendJson(response, status, { error: message });
    }
    return true;
  };
}

function describeError(error) {
  if (error instanceof ValidationError) return { status: 400, message: error.message };
  if (error instanceof HttpError) return { status: error.status, message: error.message };
  if (error instanceof DeviceFlowError) return { status: 502, message: error.message };
  if (error instanceof GitHubError) {
    if (error.status === 401) return { status: 401, message: 'GitHub rejected the token. Connect your account again.' };
    return { status: error.status === 404 ? 404 : 502, message: error.message };
  }
  return { status: 500, message: 'Unexpected server error.' };
}
