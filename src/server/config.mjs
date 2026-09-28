import path from 'node:path';

const DEFAULT_SCOPES = 'read:user public_repo';

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function loadConfig(env = process.env, rootDir = process.cwd()) {
  return {
    host: '127.0.0.1',
    port: boundedInt(env.PORT, 4173, 1, 65535),
    clientId: env.GITHUB_CLIENT_ID?.trim() || null,
    scopes: env.GITHUB_SCOPES?.trim() || DEFAULT_SCOPES,
    appSecret: env.APP_SECRET?.trim() || null,
    dataDir: path.resolve(rootDir, env.DATA_DIR?.trim() || '.data'),
    syncIntervalMinutes: boundedInt(env.SYNC_INTERVAL_MINUTES, 60, 5, 1440),
    maxCommitsPerRun: boundedInt(env.MAX_COMMITS_PER_RUN, 60, 1, 200),
  };
}
