// Everything GitToPaint stores in the user's repository: the drawing config, the
// daily workflow and the engine script. Shared by the Pages app and the engine.

import { addDays, toIsoDate } from '../core.js';
import { PLAN_PAST_DAYS, ValidationError, validateFolder, validatePlanPayload } from './validation.js';
import { dailyCronForLocalTime, isValidTimeZone } from './zone.js';

export const CONFIG_VERSION = 1;
export const CONFIG_PATH = '.github-art-config.json';
export const WORKFLOW_FILE = 'draw-contributions.yml';
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;
export const ENGINE_PATH = '.github/git-to-paint/draw.mjs';
export const RUNNER_SECRET_NAME = 'GIT_TO_PAINT_TOKEN';
export const DEFAULT_REPO_NAME = 'gitToPaint';
export const DEFAULT_FOLDER = 'paint';
export const APP_URL = 'https://unoursmarin.github.io/GitHubPageAsPaint/';
// Local noon plus a margin: the day has started everywhere the commits may be read from.
export const RUN_MINUTES_LOCAL = 12 * 60 + 20;

// Setup commits (config, workflow, engine) are signed by the app author, never by the
// user, so saving a drawing does not add a contribution to the user's own wall.
export const SETUP_AUTHOR = Object.freeze({ name: 'unoursmarin', email: '20300991+unoursmarin@users.noreply.github.com' });

// actions/checkout v4.2.2, pinned by commit so a moved tag cannot change what runs in user repositories.
const CHECKOUT_ACTION = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683';
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function buildArtConfig({ user, timeZone, folder, futureWeeks, plan, now = new Date() }) {
  return {
    version: CONFIG_VERSION,
    user: { id: user.id, login: user.login, name: user.name || user.login },
    timeZone,
    folder,
    futureWeeks,
    plan: Object.fromEntries(Object.entries(plan).sort(([left], [right]) => left.localeCompare(right))),
    updatedAt: now.toISOString(),
  };
}

export function serializeArtConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Parses and validates a stored config. Days older than the paintable year are dropped
 * rather than rejected, so an old drawing still loads.
 */
export function parseArtConfig(text, now = new Date()) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationError(`${CONFIG_PATH} is not valid JSON.`);
  }
  if (raw?.version !== CONFIG_VERSION) {
    throw new ValidationError(`${CONFIG_PATH} has an unsupported version (${String(raw?.version).slice(0, 10)}).`);
  }

  const user = raw.user ?? {};
  if (!Number.isInteger(user.id) || user.id <= 0 || typeof user.login !== 'string' || !LOGIN_PATTERN.test(user.login)) {
    throw new ValidationError(`${CONFIG_PATH} does not name a valid GitHub user.`);
  }
  if (!isValidTimeZone(raw.timeZone)) {
    throw new ValidationError(`${CONFIG_PATH} has an unknown time zone.`);
  }

  const earliest = toIsoDate(addDays(now, -PLAN_PAST_DAYS));
  const recentPlan = Object.fromEntries(Object.entries(raw.plan ?? {}).filter(([date]) => date >= earliest));
  const { plan, futureWeeks } = validatePlanPayload({ plan: recentPlan, futureWeeks: raw.futureWeeks }, now);

  return {
    version: CONFIG_VERSION,
    user: { id: user.id, login: user.login, name: typeof user.name === 'string' ? user.name.slice(0, 100) : user.login },
    timeZone: raw.timeZone,
    folder: validateFolder(raw.folder),
    futureWeeks,
    plan,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

/** The engine only paints for the account that owns the repository it runs in. */
export function assertConfigOwner(config, repositoryOwner) {
  if (config.user.login.toLowerCase() !== String(repositoryOwner).toLowerCase()) {
    throw new ValidationError(
      `This drawing belongs to @${config.user.login} but the repository is owned by @${repositoryOwner}. Open ${APP_URL} to set it up again.`,
    );
  }
}

export function buildWorkflowYaml({ timeZone, now = new Date() }) {
  const cron = dailyCronForLocalTime(RUN_MINUTES_LOCAL, timeZone, now);
  return `# Installed by GitToPaint. Edit your drawing at ${APP_URL}
# Runs daily around 12:20 in ${timeZone}, and on demand from the Actions tab.
name: Draw contributions

on:
  schedule:
    - cron: '${cron}'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: draw-contributions
  cancel-in-progress: false

jobs:
  draw:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: ${CHECKOUT_ACTION} # v4.2.2
        with:
          persist-credentials: false
          sparse-checkout: |
            ${CONFIG_PATH}
            ${ENGINE_PATH}
          sparse-checkout-cone-mode: false
      - name: Paint the planned days
        run: node ${ENGINE_PATH}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          ${RUNNER_SECRET_NAME}: \${{ secrets.${RUNNER_SECRET_NAME} }}
`;
}
