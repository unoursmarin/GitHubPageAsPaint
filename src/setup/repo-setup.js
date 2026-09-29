// What the Pages app does in the user's repository, with the user's own token.

import {
  CONFIG_PATH,
  DEFAULT_REPO_NAME,
  ENGINE_PATH,
  RUNNER_SECRET_NAME,
  SETUP_AUTHOR,
  WORKFLOW_PATH,
  buildWorkflowYaml,
  serializeArtConfig,
} from '../shared/art-config.js';
import { GitHubError } from '../github/client.js';
import { sealSecret } from './secret.js';

const INSTALLED_PATHS = [CONFIG_PATH, WORKFLOW_PATH, ENGINE_PATH];

function belongsTo(repo, login) {
  return repo && repo.owner.toLowerCase() === login.toLowerCase() && !repo.fork && !repo.archived;
}

/**
 * Finds where this user's drawing lives: the default gitToPaint repository, then the
 * repository remembered by this browser, then any owned repository holding the config.
 * Returns { repo, configText, others } where repo may be a gitToPaint without a config yet.
 */
export async function locateArtRepo({ client, token, viewer, rememberedRepo }) {
  const names = [...new Set([DEFAULT_REPO_NAME, rememberedRepo].filter(Boolean).map((name) => name.toLowerCase()))];
  let emptyDefault = null;

  for (const name of names) {
    const repo = await client.getRepo(token, viewer.login, name);
    if (!belongsTo(repo, viewer.login)) continue;
    const file = await client.getFileText(token, repo.owner, repo.repo, CONFIG_PATH);
    if (file) return { repo, configText: file.text, others: [] };
    if (name === DEFAULT_REPO_NAME.toLowerCase()) emptyDefault = repo;
  }

  const hits = await client.findReposWithFile(token, CONFIG_PATH);
  if (hits.length) {
    const repo = await client.getRepo(token, hits[0].owner, hits[0].repo);
    if (belongsTo(repo, viewer.login)) {
      return { repo, configText: hits[0].text, others: hits.slice(1).map((hit) => `${hit.owner}/${hit.repo}`) };
    }
  }

  return { repo: emptyDefault, configText: null, others: [] };
}

export function createDefaultRepo({ client, token }) {
  return client.createRepo(token, {
    name: DEFAULT_REPO_NAME,
    description: 'My contribution drawing, painted daily by GitToPaint.',
  });
}

/** Writes several files (or deletions) as one commit signed by the app, then fast-forwards the branch. */
async function commitFiles({ client, token, repo, entries, message }) {
  const { owner, repo: name, defaultBranch } = repo;
  try {
    const headSha = await client.getBranchSha(token, owner, name, defaultBranch);
    const baseTree = await client.getCommitTree(token, owner, name, headSha);
    const tree = await client.createTree(token, owner, name, { baseTree, entries });
    const signature = { ...SETUP_AUTHOR, date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
    const commitSha = await client.createCommit(token, owner, name, {
      message,
      tree,
      parents: [headSha],
      author: signature,
      committer: signature,
    });
    await client.updateBranch(token, owner, name, defaultBranch, commitSha);
    return commitSha;
  } catch (error) {
    throw explainSetupError(error);
  }
}

function explainSetupError(error) {
  if (!(error instanceof GitHubError)) return error;
  if (/workflow/i.test(error.message)) {
    return new GitHubError('Your token cannot write workflow files. Add the "workflow" scope (classic) or "Workflows: Read and write" (fine-grained).', error.status);
  }
  if (error.status === 422 && /fast.?forward/i.test(error.message)) {
    return new GitHubError('The repository changed while saving. Reload and save again.', 409);
  }
  if (error.status === 403 || error.status === 404) {
    return new GitHubError(`${error.message} Check that your token has "Contents: Read and write" on this repository.`, error.status);
  }
  return error;
}

/** Saves the drawing and (re)installs the workflow and the engine, in one commit. */
export function installArtRepo({ client, token, repo, config, engineSource, now = new Date() }) {
  return commitFiles({
    client,
    token,
    repo,
    message: 'GitToPaint: save drawing',
    entries: [
      { path: CONFIG_PATH, content: serializeArtConfig(config) },
      { path: WORKFLOW_PATH, content: buildWorkflowYaml({ timeZone: config.timeZone, now }) },
      { path: ENGINE_PATH, content: engineSource },
    ],
  });
}

/** Removes the config, workflow and engine; optionally every generated file in the drawing folder. */
export async function uninstallArtRepo({ client, token, repo, folder, removeGeneratedFiles }) {
  const { owner, repo: name, defaultBranch } = repo;
  const headSha = await client.getBranchSha(token, owner, name, defaultBranch);
  const paths = await client.listTreePaths(token, owner, name, await client.getCommitTree(token, owner, name, headSha));
  const existing = new Set(paths);
  const generated = removeGeneratedFiles && folder ? paths.filter((path) => path.startsWith(`${folder}/`)) : [];
  const entries = [...INSTALLED_PATHS.filter((path) => existing.has(path)), ...generated].map((path) => ({ path, remove: true }));

  if (entries.length) {
    await commitFiles({ client, token, repo, entries, message: 'GitToPaint: remove drawing' });
  }
  await client.deleteRepoSecret(token, owner, name, RUNNER_SECRET_NAME);
  return entries.length;
}

/**
 * Stores a separate read-only token as an Actions secret so the engine can see private
 * contributions. It is sealed in the browser; the write token used here is never stored.
 */
export async function saveRunnerSecret({ client, token, repo, secretValue }) {
  const { keyId, key } = await client.getRepoPublicKey(token, repo.owner, repo.repo);
  await client.putRepoSecret(token, repo.owner, repo.repo, RUNNER_SECRET_NAME, { keyId, encryptedValue: sealSecret(secretValue, key) });
}
