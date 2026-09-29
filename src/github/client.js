// Thin GitHub REST/GraphQL client used by both the Pages app (browser) and the engine (Actions).

import { levelFromGraphql } from '../sync/reconcile.js';

const API_ROOT = 'https://api.github.com';
const REPO_PAGE_SIZE = 100;
const MAX_REPO_PAGES = 10;
const IS_BROWSER = typeof window !== 'undefined';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const CONTRIBUTIONS_QUERY = `
  query ContributionDays($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays { date contributionCount contributionLevel }
          }
        }
      }
    }
  }
`;

const CONFIG_SEARCH_QUERY = `
  query ArtConfigRepos($expression: String!) {
    viewer {
      repositories(first: 100, ownerAffiliations: OWNER, orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes {
          name
          isFork
          isArchived
          owner { login }
          config: object(expression: $expression) { ... on Blob { text } }
        }
      }
    }
  }
`;

function toRepoSummary(repo) {
  return {
    owner: repo.owner.login,
    repo: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    fork: repo.fork,
    archived: repo.archived,
    defaultBranch: repo.default_branch,
    canPush: Boolean(repo.permissions?.push),
    htmlUrl: repo.html_url,
  };
}

function base64ToUtf8(value) {
  const binary = atob(value.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function createGitHubClient({ fetchImpl = (...args) => fetch(...args) } = {}) {
  async function request(token, pathname, { method = 'GET', body, operation, allow404 = false }) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // Browsers set their own User-Agent; the API requires one from Node.
      ...(IS_BROWSER ? {} : { 'User-Agent': 'GitToPaint' }),
    };
    const response = await fetchImpl(`${API_ROOT}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (allow404 && response.status === 404) return { data: null, headers: response.headers };
    if (!response.ok) {
      throw new GitHubError(await describeFailure(response, operation), response.status);
    }
    return { data: response.status === 204 ? null : await response.json(), headers: response.headers };
  }

  async function graphql(token, query, variables, operation) {
    const { data } = await request(token, '/graphql', { method: 'POST', operation, body: { query, variables } });
    if (data?.errors?.length) {
      throw new GitHubError(`GitHub could not ${operation}: ${String(data.errors[0]?.message).slice(0, 160)}`, 502);
    }
    return data.data;
  }

  return {
    async getViewer(token) {
      const { data, headers } = await request(token, '/user', { operation: 'load your profile' });
      return {
        id: data.id,
        login: data.login,
        name: data.name || data.login,
        avatarUrl: data.avatar_url,
        scopes: headers.get('x-oauth-scopes'),
      };
    },

    async getContributionDays(token, login, { from, to }) {
      const result = await graphql(
        token,
        CONTRIBUTIONS_QUERY,
        { login, from: from.toISOString(), to: to.toISOString() },
        'load the contribution calendar',
      );
      const weeks = result?.user?.contributionsCollection?.contributionCalendar?.weeks;
      if (!weeks) {
        throw new GitHubError(`GitHub returned no contribution calendar for ${login}.`, 502);
      }
      return weeks.flatMap((week) =>
        week.contributionDays.map((day) => ({
          date: day.date,
          count: day.contributionCount,
          level: levelFromGraphql(day.contributionLevel),
        })),
      );
    },

    /** Owned, non-fork repositories that contain `path` on their default branch, most recently pushed first. */
    async findReposWithFile(token, path) {
      const result = await graphql(token, CONFIG_SEARCH_QUERY, { expression: `HEAD:${path}` }, 'search your repositories');
      return (result?.viewer?.repositories?.nodes ?? [])
        .filter((node) => node.config?.text && !node.isFork && !node.isArchived)
        .map((node) => ({ owner: node.owner.login, repo: node.name, text: node.config.text }));
    },

    async getRepo(token, owner, repo) {
      const { data } = await request(token, `/repos/${owner}/${repo}`, { operation: 'read the repository', allow404: true });
      return data ? toRepoSummary(data) : null;
    },

    async listOwnedRepos(token) {
      const repos = [];
      for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
        const { data } = await request(
          token,
          `/user/repos?affiliation=owner&sort=pushed&per_page=${REPO_PAGE_SIZE}&page=${page}`,
          { operation: 'list your repositories' },
        );
        repos.push(...data);
        if (data.length < REPO_PAGE_SIZE) break;
      }
      return repos.map(toRepoSummary).filter((repo) => repo.canPush && !repo.fork && !repo.archived);
    },

    async createRepo(token, { name, description }) {
      const { data } = await request(token, '/user/repos', {
        method: 'POST',
        operation: `create the ${name} repository`,
        body: { name, description, private: false, auto_init: true, has_issues: false, has_wiki: false, has_projects: false },
      });
      return toRepoSummary(data);
    },

    async getFileText(token, owner, repo, path) {
      const { data } = await request(token, `/repos/${owner}/${repo}/contents/${path}`, {
        operation: `read ${path}`,
        allow404: true,
      });
      if (!data) return null;
      if (Array.isArray(data) || data.type !== 'file') {
        throw new GitHubError(`${path} in ${owner}/${repo} is not a file.`, 409);
      }
      return { text: base64ToUtf8(data.content), sha: data.sha };
    },

    async getBranchSha(token, owner, repo, branch) {
      try {
        const { data } = await request(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
          operation: 'read the default branch',
        });
        return data.object.sha;
      } catch (error) {
        if (error.status === 404 || error.status === 409) {
          throw new GitHubError(`${owner}/${repo} has no "${branch}" branch yet. Push an initial commit first.`, error.status);
        }
        throw error;
      }
    },

    async getCommitTree(token, owner, repo, sha) {
      const { data } = await request(token, `/repos/${owner}/${repo}/git/commits/${sha}`, { operation: 'read the latest commit' });
      return data.tree.sha;
    },

    async listTreePaths(token, owner, repo, treeSha) {
      const { data } = await request(token, `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, {
        operation: 'list the repository files',
      });
      return data.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
    },

    /** entries: [{ path, content }] to add or replace a file, [{ path, remove: true }] to delete one. */
    async createTree(token, owner, repo, { baseTree, entries }) {
      const tree = entries.map((entry) =>
        entry.remove
          ? { path: entry.path, mode: '100644', type: 'blob', sha: null }
          : { path: entry.path, mode: '100644', type: 'blob', content: entry.content },
      );
      const { data } = await request(token, `/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        operation: 'write files to the repository',
        body: { base_tree: baseTree, tree },
      });
      return data.sha;
    },

    async createCommit(token, owner, repo, commit) {
      const { data } = await request(token, `/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        operation: 'create a commit',
        body: commit,
      });
      return data.sha;
    },

    async updateBranch(token, owner, repo, branch, sha) {
      await request(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: 'PATCH',
        operation: 'move the branch to the new commit',
        body: { sha, force: false },
      });
    },

    async getRepoPublicKey(token, owner, repo) {
      const { data } = await request(token, `/repos/${owner}/${repo}/actions/secrets/public-key`, {
        operation: 'read the repository encryption key',
      });
      return { keyId: data.key_id, key: data.key };
    },

    async putRepoSecret(token, owner, repo, name, { encryptedValue, keyId }) {
      await request(token, `/repos/${owner}/${repo}/actions/secrets/${name}`, {
        method: 'PUT',
        operation: `save the ${name} secret`,
        body: { encrypted_value: encryptedValue, key_id: keyId },
      });
    },

    async hasRepoSecret(token, owner, repo, name) {
      const { data } = await request(token, `/repos/${owner}/${repo}/actions/secrets/${name}`, {
        operation: `read the ${name} secret`,
        allow404: true,
      });
      return Boolean(data);
    },

    async deleteRepoSecret(token, owner, repo, name) {
      await request(token, `/repos/${owner}/${repo}/actions/secrets/${name}`, {
        method: 'DELETE',
        operation: `delete the ${name} secret`,
        allow404: true,
      });
    },

    async getWorkflow(token, owner, repo, file) {
      const { data } = await request(token, `/repos/${owner}/${repo}/actions/workflows/${file}`, {
        operation: 'read the workflow',
        allow404: true,
      });
      return data ? { id: data.id, state: data.state, htmlUrl: data.html_url } : null;
    },

    async listWorkflowRuns(token, owner, repo, file, perPage = 5) {
      const { data } = await request(token, `/repos/${owner}/${repo}/actions/workflows/${file}/runs?per_page=${perPage}`, {
        operation: 'list the workflow runs',
        allow404: true,
      });
      return (data?.workflow_runs ?? []).map((run) => ({
        id: run.id,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        htmlUrl: run.html_url,
      }));
    },

    async dispatchWorkflow(token, owner, repo, file, ref) {
      await request(token, `/repos/${owner}/${repo}/actions/workflows/${file}/dispatches`, {
        method: 'POST',
        operation: 'start the workflow',
        body: { ref },
      });
    },

    async enableWorkflow(token, owner, repo, file) {
      await request(token, `/repos/${owner}/${repo}/actions/workflows/${file}/enable`, {
        method: 'PUT',
        operation: 'enable the workflow',
      });
    },
  };
}

// Only GitHub's short "message" field is surfaced; raw bodies can be large or echo request data.
async function describeFailure(response, operation) {
  let detail = '';
  try {
    const payload = await response.json();
    if (typeof payload?.message === 'string') detail = `: ${payload.message.slice(0, 160)}`;
  } catch {
    // Non-JSON error body, keep the status only.
  }
  return `GitHub could not ${operation} (${response.status}${detail}).`;
}
