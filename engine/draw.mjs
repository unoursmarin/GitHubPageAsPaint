// Entry point of the engine that runs in the user's repository (GitHub Actions).
// Bundled into one dependency-free file and copied to .github/git-to-paint/draw.mjs.

import fs from 'node:fs/promises';

import { createGitHubClient } from '../src/github/client.js';
import { fetchPublicContributions } from '../src/github/public-contributions.js';
import { CONFIG_PATH, assertConfigOwner, parseArtConfig } from '../src/shared/art-config.js';
import { ENGINE_VERSION } from '../src/shared/version.js';
import { CATCH_UP_DAYS, runDrawing } from '../src/sync/runner.js';

const STATUS_LABELS = { ok: 'reached', pending: 'still lighter than planned', above: 'darker than planned (left alone)', scheduled: 'upcoming' };

/**
 * Reads the calendar with the first source that works: the optional personal token
 * (sees private contributions), then the Actions token, then the public profile page.
 */
export function createCalendarReader({ client, login, tokens, log, fetchPublic = fetchPublicContributions }) {
  let source = null;

  return async (range) => {
    if (source) return source(range);

    for (const [label, token] of tokens) {
      const candidate = (window) => client.getContributionDays(token, login, window);
      try {
        const days = await candidate(range);
        source = candidate;
        log(`Reading the calendar with ${label}.`);
        return days;
      } catch (error) {
        log(`Could not read the calendar with ${label}: ${error.message}`);
      }
    }

    source = () => fetchPublic(login);
    log('Reading the calendar from the public profile page.');
    return source(range);
  };
}

function formatSummary({ today, commits, results }, repository) {
  const rows = results.map(({ date, target, actualLevel, status }) =>
    `| ${date} | ${target} | ${actualLevel ?? '-'} | ${STATUS_LABELS[status] ?? status} |`);
  return [
    `## GitToPaint on ${repository}`,
    '',
    `Engine v${ENGINE_VERSION}. Checked the ${CATCH_UP_DAYS} days before ${today} and ${today} itself: ${commits} commit(s) added.`,
    '',
    ...(rows.length ? ['| Day | Planned level | Level on GitHub | State |', '|---|---|---|---|', ...rows] : ['No painted day in this window.']),
    '',
  ].join('\n');
}

async function main(env = process.env) {
  const repository = env.GITHUB_REPOSITORY ?? '';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo || !env.GITHUB_TOKEN) {
    throw new Error('Run this script from GitHub Actions: GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  }

  const config = parseArtConfig(await fs.readFile(CONFIG_PATH, 'utf8'));
  assertConfigOwner(config, owner);

  const client = createGitHubClient();
  const repoInfo = await client.getRepo(env.GITHUB_TOKEN, owner, repo);
  if (!repoInfo) throw new Error(`Cannot read ${repository} with the Actions token.`);

  const log = (message) => console.log(message);
  const tokens = [
    ['your GIT_TO_PAINT_TOKEN secret', env.GIT_TO_PAINT_TOKEN],
    ['the Actions token', env.GITHUB_TOKEN],
  ].filter(([, token]) => Boolean(token));

  const result = await runDrawing({
    client,
    token: env.GITHUB_TOKEN,
    owner,
    repo,
    branch: repoInfo.defaultBranch,
    config,
    readCalendar: createCalendarReader({ client, login: config.user.login, tokens, log }),
    log,
  });

  const summary = formatSummary(result, repository);
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) await fs.appendFile(env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
