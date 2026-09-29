// One daily run of the engine, inside the user's own repository.
// Reads the real calendar, then commits random text files, as the user, on every
// painted day of the catch-up window that is still lighter than planned.

import { dateInZone, shiftDate, zonedTimeToUtc } from '../shared/zone.js';
import { allocateCommits, cautiousStep, reconcilePlan, summarizeResults } from './reconcile.js';

export const CATCH_UP_DAYS = 7;
export const DEFAULT_LIMITS = Object.freeze({ maxCommits: 120, maxChecks: 6, recheckDelayMs: 60_000 });
// GraphQL's contributionsCollection spans at most one year.
const CALENDAR_DAYS = 364;
const NOON_MINUTES = 12 * 60;
const TODAY_BACKDATE_MS = 5 * 60_000;

/** The id-prefixed noreply address is always linked to the account, so the commits count. */
export function commitAuthor(user) {
  return { name: user.name || user.login, email: `${user.id}+${user.login}@users.noreply.github.com` };
}

/**
 * Local noon keeps the commit on the same calendar day in the user's zone and in UTC.
 * Today's commits are never dated in the future. One second apart keeps the order stable.
 */
export function commitTimestamp(date, timeZone, index, now) {
  const noon = zonedTimeToUtc(date, NOON_MINUTES, timeZone);
  const dayStart = zonedTimeToUtc(date, 0, timeZone);
  const base = noon.getTime() + index * 1000 <= now.getTime()
    ? noon.getTime()
    : Math.max(dayStart.getTime(), now.getTime() - TODAY_BACKDATE_MS);
  return new Date(base + index * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Painted days from `today - CATCH_UP_DAYS` to `today`, in the user's time zone. */
export function duePlan(plan, today) {
  const earliest = shiftDate(today, -CATCH_UP_DAYS);
  return Object.fromEntries(Object.entries(plan).filter(([date]) => date >= earliest && date <= today));
}

function randomText() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  return `${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}\n`;
}

export async function runDrawing({
  client,
  token,
  owner,
  repo,
  branch,
  config,
  readCalendar,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
  limits = DEFAULT_LIMITS,
}) {
  const today = dateInZone(now(), config.timeZone);
  const due = duePlan(config.plan, today);
  if (!Object.keys(due).length) {
    log(`Nothing painted between ${shiftDate(today, -CATCH_UP_DAYS)} and ${today}.`);
    return { today, commits: 0, results: [], summary: summarizeResults([]) };
  }

  const author = commitAuthor(config.user);
  let published = 0;
  let results = [];

  for (let check = 1; check <= limits.maxChecks; check += 1) {
    const current = now();
    const days = await readCalendar({ from: new Date(current.getTime() - CALENDAR_DAYS * 86_400_000), to: current });
    results = reconcilePlan({ plan: due, days, today });

    const budget = limits.maxCommits - published;
    const pending = results.some((result) => result.status === 'pending');
    if (!pending || budget <= 0 || check === limits.maxChecks) break;

    const batch = allocateCommits(cautiousStep(results), budget);
    await publishBatch({ client, token, owner, repo, branch, folder: config.folder, timeZone: config.timeZone, author, batch, now: current });
    published += batch.length;
    log(`Check ${check}: committed ${batch.length} file(s), re-reading the calendar.`);

    if (limits.recheckDelayMs > 0) await sleep(limits.recheckDelayMs);
  }

  return { today, commits: published, results, summary: summarizeResults(results) };
}

// Chains the whole batch locally, then fast-forwards the branch once.
async function publishBatch({ client, token, owner, repo, branch, folder, timeZone, author, batch, now }) {
  let headSha = await client.getBranchSha(token, owner, repo, branch);
  let treeSha = await client.getCommitTree(token, owner, repo, headSha);

  for (const [index, { date }] of batch.entries()) {
    const path = `${folder}/${date}-${globalThis.crypto.randomUUID().slice(0, 8)}.txt`;
    treeSha = await client.createTree(token, owner, repo, { baseTree: treeSha, entries: [{ path, content: randomText() }] });

    const signature = { ...author, date: commitTimestamp(date, timeZone, index, now) };
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
