// In-memory GitHub: commits added through the git API immediately show up in the
// contribution calendar, with fixed level thresholds [0, 1, 3, 6, 10].
export const THRESHOLDS = [0, 1, 3, 6, 10];

export function levelForCount(count) {
  let level = 0;
  THRESHOLDS.forEach((threshold, index) => {
    if (count >= threshold) level = index;
  });
  return level;
}

export function createFakeGitHub({ counts = {}, repos, viewer } = {}) {
  const calendar = new Map(Object.entries(counts));
  const commits = [];
  const blobs = new Map();
  const trees = new Map([['tree-0', []]]);
  const commitTrees = new Map([['sha-0', 'tree-0']]);
  let head = 'sha-0';
  let seq = 0;
  const next = (prefix) => `${prefix}-${(seq += 1)}`;

  return {
    commits,
    head: () => head,
    files: () => trees.get(commitTrees.get(head)),

    async getViewer() {
      return viewer ?? { id: 42, login: 'octo', name: 'Octo Cat', avatarUrl: 'https://example.test/a.png', scopes: 'public_repo, read:user' };
    },
    async getContributionDays() {
      return [...calendar.entries()].map(([date, count]) => ({ date, count, level: levelForCount(count) }));
    },
    async listWritableRepos() {
      return repos ?? [{ owner: 'octo', repo: 'art', fullName: 'octo/art', private: false, defaultBranch: 'main' }];
    },
    async getBranchSha() {
      return head;
    },
    async getCommitTree(token, owner, repo, sha) {
      return commitTrees.get(sha);
    },
    async createBlob(token, owner, repo, content) {
      const sha = next('blob');
      blobs.set(sha, content);
      return sha;
    },
    async createTree(token, owner, repo, { baseTree, path, blobSha }) {
      const sha = next('tree');
      trees.set(sha, [...trees.get(baseTree), { path, blobSha }]);
      return sha;
    },
    async createCommit(token, owner, repo, commit) {
      const sha = next('sha');
      commitTrees.set(sha, commit.tree);
      commits.push({ sha, ...commit });
      return sha;
    },
    async updateBranch(token, owner, repo, branch, sha) {
      const added = commits.filter((commit) => !commit.counted);
      for (const commit of added) {
        const date = commit.author.date.slice(0, 10);
        calendar.set(date, (calendar.get(date) ?? 0) + 1);
        commit.counted = true;
      }
      head = sha;
    },
  };
}
