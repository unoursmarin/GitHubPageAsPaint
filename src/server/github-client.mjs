import { levelFromGraphql } from '../sync/reconcile.js';

const API_ROOT = 'https://api.github.com';
const REPO_PAGE_SIZE = 100;
const MAX_REPO_PAGES = 10;

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

export function createGitHubClient({ fetchImpl = fetch } = {}) {
  async function request(token, pathname, { method = 'GET', body, operation }) {
    const response = await fetchImpl(`${API_ROOT}${pathname}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GitHubPageAsPaint/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new GitHubError(await describeFailure(response, operation), response.status);
    }

    return { data: response.status === 204 ? null : await response.json(), headers: response.headers };
  }

  return {
    async getViewer(token) {
      const { data, headers } = await request(token, '/user', { operation: 'load your profile' });
      return {
        id: data.id,
        login: data.login,
        name: data.name || data.login,
        avatarUrl: data.avatar_url,
        scopes: headers.get('x-oauth-scopes') ?? '',
      };
    },

    async getContributionDays(token, login, { from, to }) {
      const { data } = await request(token, '/graphql', {
        method: 'POST',
        operation: 'load your contribution calendar',
        body: { query: CONTRIBUTIONS_QUERY, variables: { login, from: from.toISOString(), to: to.toISOString() } },
      });

      const weeks = data?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
      if (data?.errors?.length || !weeks) {
        throw new GitHubError(`GitHub could not load the contribution calendar for ${login}.`, 502);
      }

      return weeks.flatMap((week) =>
        week.contributionDays.map((day) => ({
          date: day.date,
          count: day.contributionCount,
          level: levelFromGraphql(day.contributionLevel),
        })),
      );
    },

    async listWritableRepos(token) {
      const repos = [];
      for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
        const { data } = await request(
          token,
          `/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=${REPO_PAGE_SIZE}&page=${page}`,
          { operation: 'list your repositories' },
        );
        repos.push(...data);
        if (data.length < REPO_PAGE_SIZE) break;
      }

      return repos
        .filter((repo) => repo.permissions?.push && !repo.archived && !repo.fork)
        .map((repo) => ({
          owner: repo.owner.login,
          repo: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          defaultBranch: repo.default_branch,
        }));
    },

    async getBranchSha(token, owner, repo, branch) {
      try {
        const { data } = await request(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
          operation: 'read the target branch',
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

    async createBlob(token, owner, repo, content) {
      const { data } = await request(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        operation: 'upload a file',
        body: { content, encoding: 'utf-8' },
      });
      return data.sha;
    },

    async createTree(token, owner, repo, { baseTree, path, blobSha }) {
      const { data } = await request(token, `/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        operation: 'add the file to the repository tree',
        body: { base_tree: baseTree, tree: [{ path, mode: '100644', type: 'blob', sha: blobSha }] },
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
        operation: 'move the branch to the new commits',
        body: { sha, force: false },
      });
    },
  };
}

/**
 * Classic and OAuth tokens list their scopes; fine-grained tokens send no header,
 * so their write access is checked per repository through `permissions.push`.
 */
export function hasRepoWriteScope(scopeHeader) {
  if (!scopeHeader) return true;
  const scopes = scopeHeader.split(',').map((scope) => scope.trim());
  return scopes.includes('repo') || scopes.includes('public_repo');
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
