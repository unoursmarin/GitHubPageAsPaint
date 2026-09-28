// In-memory GitHub for one user. Commits authored by that user immediately show up in
// the contribution calendar, with fixed level thresholds [0, 1, 3, 6, 10].
export const THRESHOLDS = [0, 1, 3, 6, 10];

export function levelForCount(count) {
  let level = 0;
  THRESHOLDS.forEach((threshold, index) => {
    if (count >= threshold) level = index;
  });
  return level;
}

const DEFAULT_VIEWER = { id: 42, login: 'octo', name: 'Octo Cat', avatarUrl: 'https://example.test/a.png', scopes: 'public_repo, workflow' };

export function createFakeGitHub({ counts = {}, viewer = DEFAULT_VIEWER, repos = {}, files = {} } = {}) {
  const calendar = new Map(Object.entries(counts));
  const commits = [];
  const secrets = new Map();
  // One working tree for the repository under test: path -> content.
  const trees = new Map([['tree-0', new Map(Object.entries(files))]]);
  const commitTrees = new Map([['sha-0', 'tree-0']]);
  const repoMap = new Map(Object.entries(repos).map(([name, repo]) => [name.toLowerCase(), repo]));
  let head = 'sha-0';
  let seq = 0;
  const next = (prefix) => `${prefix}-${(seq += 1)}`;
  const currentFiles = () => trees.get(commitTrees.get(head));
  const authorEmail = `${viewer.id}+${viewer.login}@users.noreply.github.com`;

  return {
    commits,
    secrets,
    head: () => head,
    files: () => Object.fromEntries(currentFiles()),

    async getViewer() {
      return viewer;
    },
    async getContributionDays() {
      return [...calendar.entries()].map(([date, count]) => ({ date, count, level: levelForCount(count) }));
    },
    async getRepo(token, owner, name) {
      return repoMap.get(name.toLowerCase()) ?? null;
    },
    async createRepo(token, { name }) {
      const repo = { owner: viewer.login, repo: name, fullName: `${viewer.login}/${name}`, private: false, fork: false, archived: false, defaultBranch: 'main', canPush: true };
      repoMap.set(name.toLowerCase(), repo);
      return repo;
    },
    async listOwnedRepos() {
      return [...repoMap.values()];
    },
    async getFileText(token, owner, name, path) {
      const repo = repoMap.get(name.toLowerCase());
      const text = repo?.files?.[path] ?? (repo?.useWorkingTree ? currentFiles().get(path) : undefined);
      return text === undefined ? null : { text, sha: `file-${path}` };
    },
    async findReposWithFile(token, path) {
      return [...repoMap.values()]
        .filter((repo) => repo.files?.[path])
        .map((repo) => ({ owner: repo.owner, repo: repo.repo, text: repo.files[path] }));
    },
    async getBranchSha() {
      return head;
    },
    async getCommitTree(token, owner, name, sha) {
      return commitTrees.get(sha);
    },
    async listTreePaths(token, owner, name, treeSha) {
      return [...trees.get(treeSha).keys()];
    },
    async createTree(token, owner, name, { baseTree, entries }) {
      const sha = next('tree');
      const tree = new Map(trees.get(baseTree));
      for (const entry of entries) {
        if (entry.remove) tree.delete(entry.path);
        else tree.set(entry.path, entry.content);
      }
      trees.set(sha, tree);
      return sha;
    },
    async createCommit(token, owner, name, commit) {
      const sha = next('sha');
      commitTrees.set(sha, commit.tree);
      commits.push({ sha, ...commit });
      return sha;
    },
    async updateBranch(token, owner, name, branch, sha) {
      for (const commit of commits.filter((entry) => !entry.counted)) {
        commit.counted = true;
        if (commit.author.email !== authorEmail) continue;
        const date = commit.author.date.slice(0, 10);
        calendar.set(date, (calendar.get(date) ?? 0) + 1);
      }
      head = sha;
    },
    async getRepoPublicKey() {
      return { keyId: 'key-1', key: this.publicKey };
    },
    async putRepoSecret(token, owner, name, secretName, value) {
      secrets.set(secretName, value);
    },
    async deleteRepoSecret(token, owner, name, secretName) {
      secrets.delete(secretName);
    },
  };
}
