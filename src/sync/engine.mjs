import crypto from 'node:crypto';

import { addDays, toIsoDate } from '../core.js';
import { decryptSecret } from '../server/store.mjs';
import { allocateCommits, cautiousStep, reconcilePlan, summarizeResults } from './reconcile.js';

// GraphQL's contributionsCollection spans at most one year.
const CALENDAR_DAYS = 364;
const COMMIT_HOUR_UTC = 12;
const MAX_LOG_ENTRIES = 20;
// Leaves room for a full batch (one second apart) before "now" on the current day.
const TODAY_BACKDATE_MS = 5 * 60_000;

/**
 * One sync run: read the real calendar, publish a cautious batch of commits for
 * every due day still below its painted level, wait, re-check, and repeat until
 * every due day is reached, the commit budget is spent or the checks run out.
 * Days already darker than planned are reported and never touched.
 */
export function createSyncEngine({
  store,
  client,
  key,
  config,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
}) {
  let running = false;

  async function runOnce({ trigger = 'schedule' } = {}) {
    if (running) return { status: 'busy' };

    const state = store.get();
    const skipReason = findSkipReason(state);
    if (skipReason) return { status: 'skipped', reason: skipReason };

    running = true;
    const startedAt = now().toISOString();
    try {
      const outcome = await reconcileAndPublish(state);
      const record = { ...outcome, trigger, startedAt, finishedAt: now().toISOString(), error: null };
      await saveRecord(record);
      log(`sync ${trigger}: ${record.commits} commit(s), ${JSON.stringify(record.summary)}`);
      return { status: 'done', ...record };
    } catch (error) {
      const record = { trigger, startedAt, finishedAt: now().toISOString(), commits: 0, error: error.message };
      await saveRecord(record);
      log(`sync ${trigger} failed: ${error.message}`);
      return { status: 'error', ...record };
    } finally {
      running = false;
    }
  }

  async function reconcileAndPublish({ account, target, plan }) {
    const token = decryptSecret(account.token, key);
    const today = toIsoDate(now());
    const range = { from: new Date(`${toIsoDate(addDays(now(), -CALENDAR_DAYS))}T00:00:00Z`), to: now() };
    const author = commitAuthor(account);

    let published = 0;
    let results = [];

    for (let check = 1; check <= config.maxChecksPerRun; check += 1) {
      const days = await client.getContributionDays(token, account.login, range);
      results = reconcilePlan({ plan, days, today });

      const budget = config.maxCommitsPerRun - published;
      const isLastCheck = check === config.maxChecksPerRun;
      if (!results.some((result) => result.status === 'pending') || budget <= 0 || isLastCheck) break;

      const batch = allocateCommits(cautiousStep(results), budget);
      await publishBatch({ token, target, author, batch, today });
      published += batch.length;

      if (config.recheckDelaySeconds > 0) await sleep(config.recheckDelaySeconds * 1000);
    }

    return {
      commits: published,
      summary: summarizeResults(results),
      days: Object.fromEntries(
        results.map(({ date, status, actualLevel, target: level }) => [date, { status, actualLevel, target: level }]),
      ),
    };
  }

  // Chains every commit of the batch locally, then moves the branch once (fast-forward only).
  async function publishBatch({ token, target, author, batch, today }) {
    const { owner, repo, branch, folder } = target;
    let headSha = await client.getBranchSha(token, owner, repo, branch);
    let treeSha = await client.getCommitTree(token, owner, repo, headSha);

    for (const [index, { date }] of batch.entries()) {
      const path = `${folder}/${date}-${crypto.randomUUID().slice(0, 8)}.txt`;
      const blobSha = await client.createBlob(token, owner, repo, `${crypto.randomBytes(24).toString('base64url')}\n`);
      treeSha = await client.createTree(token, owner, repo, { baseTree: treeSha, path, blobSha });

      const signature = { ...author, date: commitTimestamp(date, today, index, now()) };
      headSha = await client.createCommit(token, owner, repo, {
        message: `Paint ${date}`,
        tree: treeSha,
        parents: [headSha],
        author: signature,
        committer: signature,
      });
    }

    await client.updateBranch(token, owner, repo, branch, headSha);
  }

  async function saveRecord(record) {
    await store.update((current) => ({
      ...current,
      lastSync: record,
      syncLog: [summarizeRecord(record), ...(current.syncLog ?? [])].slice(0, MAX_LOG_ENTRIES),
    }));
  }

  return {
    runOnce,
    isRunning: () => running,
  };
}

function findSkipReason({ account, target, plan }) {
  if (!account?.token) return 'Connect a GitHub account first.';
  if (!target?.repo || !target?.folder) return 'Choose a repository and a folder first.';
  if (!plan || !Object.keys(plan).length) return 'Paint at least one day first.';
  return null;
}

function summarizeRecord({ trigger, startedAt, commits, summary, error }) {
  return { trigger, startedAt, commits, summary: summary ?? null, error };
}

/** The id-prefixed noreply address is always linked to the account, so the commits count. */
export function commitAuthor(account) {
  return {
    name: account.name || account.login,
    email: `${account.id}+${account.login}@users.noreply.github.com`,
  };
}

/**
 * Midday UTC keeps the commit on the same calendar day for most time zones.
 * Commits for today are never dated in the future. One second apart keeps the order stable.
 */
export function commitTimestamp(date, today, index, current) {
  const midday = new Date(`${date}T${String(COMMIT_HOUR_UTC).padStart(2, '0')}:00:00Z`);
  const dayStart = new Date(`${date}T00:00:00Z`);
  const earlierToday = new Date(Math.max(dayStart.getTime(), current.getTime() - TODAY_BACKDATE_MS));
  const base = date === today && current < midday ? earlierToday : midday;
  const stamp = new Date(base.getTime() + index * 1000);
  return stamp.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
