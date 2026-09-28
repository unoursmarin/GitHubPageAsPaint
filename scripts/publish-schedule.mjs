import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { expandScheduleEntries, subtractPublishedContributions } from '../src/core.js';
import { buildCommitDate } from '../src/publisher.js';

const args = parseArgs(process.argv.slice(2));

if (!args.schedule || !args.token) {
  console.error('Usage: node ./scripts/publish-schedule.mjs --schedule ./schedule.json --token <token> [--username <username>] [--owner <owner>] [--repo <repo>] [--branch <branch>] [--author-name <name>] [--author-email <email>]');
  process.exit(1);
}

const schedule = JSON.parse(await fs.readFile(args.schedule, 'utf8'));
const owner = args.owner || schedule.repository?.owner;
const repo = args.repo || schedule.repository?.repo;
const branch = args.branch || schedule.repository?.branch || 'main';
const username = args.username || schedule.username;

if (!owner || !repo) {
  console.error('The schedule must include repository owner/repo, or you must pass --owner and --repo.');
  process.exit(1);
}

const authorName = args['author-name'] || schedule.username || owner;
const authorEmail = args['author-email'] || `${owner}@users.noreply.github.com`;
const plannedEntries = schedule.entries || [];

if (!plannedEntries.length) {
  console.log('Schedule is empty, nothing to publish.');
  process.exit(0);
}

const publishedEntries = username ? await getContributionEntries({ username, token: args.token }) : [];
const remainingEntries = subtractPublishedContributions(plannedEntries, publishedEntries);
const entries = expandScheduleEntries(remainingEntries);

if (!username) {
  console.warn('Schedule username missing, skipping the existing-contribution check.');
}

if (!entries.length) {
  console.log('All scheduled contributions are already satisfied, nothing to publish.');
  process.exit(0);
}

let headSha = await getRefSha({ owner, repo, branch, token: args.token });
let { treeSha } = await getCommit({ owner, repo, sha: headSha, token: args.token });

for (const [index, entry] of entries.entries()) {
  const commitDate = buildCommitDate(entry.date, entry.sequence);
  const path = `.github-page-as-paint/${entry.date}-${String(entry.sequence).padStart(2, '0')}-${crypto.randomUUID().slice(0, 8)}.txt`;
  const blobSha = await createBlob({
    owner,
    repo,
    token: args.token,
    content: randomText(),
  });
  const nextTreeSha = await createTree({
    owner,
    repo,
    token: args.token,
    baseTree: treeSha,
    path,
    blobSha,
  });
  headSha = await createCommit({
    owner,
    repo,
    token: args.token,
    parentSha: headSha,
    treeSha: nextTreeSha,
    commitDate,
    authorName,
    authorEmail,
    index: index + 1,
    total: entries.length,
    path,
  });
  treeSha = nextTreeSha;
  console.log(`Created commit ${index + 1}/${entries.length} for ${entry.date} (${path})`);
}

await updateRef({
  owner,
  repo,
  branch,
  token: args.token,
  sha: headSha,
});

console.log(`Published ${entries.length} commit(s) to ${owner}/${repo}@${branch}.`);

function parseArgs(values) {
  return values.reduce((accumulator, value, index, all) => {
    if (!value.startsWith('--')) return accumulator;
    const next = all[index + 1];
    accumulator[value.slice(2)] = !next || next.startsWith('--') ? true : next;
    return accumulator;
  }, {});
}

function randomText() {
  return crypto.randomBytes(24).toString('base64url');
}

async function getContributionEntries({ username, token }) {
  const response = await fetch(`https://github.com/users/${encodeURIComponent(username)}/contributions`, {
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'GitHubPageAsPaint/1.0',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Unable to load contributions for ${username}: GitHub responded with ${response.status}: ${text}`);
  }

  return parseContributionHtml(await response.text());
}

function parseContributionHtml(html) {
  const tooltipById = new Map(
    [...html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]+)<\/tool-tip>/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const titleById = new Map(
    [...html.matchAll(/<(?:rect|td)[^>]*id="([^"]+)"[^>]*>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<\/(?:rect|td)>/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const pattern = /<(?:rect|td)[^>]*data-date="([^"]+)"[^>]*id="([^"]+)"[^>]*data-level="(\d)"[^>]*>/g;
  const entries = [];

  for (const match of html.matchAll(pattern)) {
    const [, date, id] = match;
    const tooltip = tooltipById.get(id) || titleById.get(id) || '';
    const countMatch = tooltip.match(/([\d,]+)\s+contributions?/i);
    const count = countMatch ? Number(countMatch[1].replaceAll(',', '')) : 0;

    entries.push({ date, count });
  }

  return entries;
}

async function getRefSha({ owner, repo, branch, token }) {
  const payload = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    operation: 'load branch ref',
    token,
  });
  return payload.object.sha;
}

async function getCommit({ owner, repo, sha, token }) {
  const payload = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/git/commits/${sha}`, {
    operation: 'load commit',
    token,
  });
  return { treeSha: payload.tree.sha };
}

async function createBlob({ owner, repo, token, content }) {
  const payload = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    operation: 'create blob',
    token,
    body: {
      content,
      encoding: 'utf-8',
    },
  });
  return payload.sha;
}

async function createTree({ owner, repo, token, baseTree, path, blobSha }) {
  const payload = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    operation: 'create tree',
    token,
    body: {
      base_tree: baseTree,
      tree: [
        {
          path,
          mode: '100644',
          type: 'blob',
          sha: blobSha,
        },
      ],
    },
  });
  return payload.sha;
}

async function createCommit({ owner, repo, token, parentSha, treeSha, commitDate, authorName, authorEmail, index, total, path }) {
  const payload = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    operation: 'create commit',
    token,
    body: {
      message: `Paint contribution ${index}/${total} for ${commitDate.slice(0, 10)}`,
      tree: treeSha,
      parents: [parentSha],
      author: {
        name: authorName,
        email: authorEmail,
        date: commitDate,
      },
      committer: {
        name: authorName,
        email: authorEmail,
        date: commitDate,
      },
    },
  });

  return payload.sha;
}

async function updateRef({ owner, repo, branch, token, sha }) {
  await githubRequest(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    operation: 'advance branch ref',
    token,
    body: {
      sha,
      force: false,
    },
  });
}

async function githubRequest(url, { method = 'GET', token, body, operation = 'call GitHub API' } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GitHubPageAsPaint/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${operation} failed with ${response.status}: ${text}`);
  }

  return response.json();
}
