# GitHubPageAsPaint

Paint your GitHub contribution wall. Connect your account, pick one of your repositories and a folder, paint
the days you want, and a local server commits small random text files until each painted day reaches its color.

## What it does

- signs in with GitHub (OAuth device flow) or a personal access token, stored encrypted on your machine
- loads the last 53 weeks of your real contributions and lists the repositories you can push to
- lets you paint any day of the last year or of the weeks ahead, from level 1 (lightest) to 4 (darkest)
- on a schedule, re-reads your real calendar before every batch of commits and publishes only what is
  still missing; a day that is already darker than planned is left alone
- shows, for every painted day, whether it is reached, in progress or too dark

## Run locally

```bash
npm install
cp .env.example .env   # then fill in GITHUB_CLIENT_ID (optional, see below)
npm run serve
```

Open **http://localhost:4173**. On WSL, use `localhost` rather than `127.0.0.1` from the Windows browser.

1. **Account**: *Connect with GitHub*, type the code shown on github.com, or paste a token instead.
2. **Target**: choose a repository and the folder the text files go into.
3. **Drawing**: click cells to paint them; the plan is saved automatically.
4. **Sync**: the server checks every `SYNC_INTERVAL_MINUTES`; *Sync now* runs it immediately.

The scheduler only runs while the server is running. To keep painting while your computer is off, run the
same command on an always-on machine.

## GitHub sign-in (optional)

Without `GITHUB_CLIENT_ID` only personal access tokens work. To enable *Connect with GitHub*:

1. GitHub → Settings → Developer settings → **OAuth Apps** → *New OAuth App*
   (any homepage and callback URL, e.g. `http://localhost:4173`).
2. Tick **Enable Device Flow** and save.
3. Copy the **Client ID** into `.env` as `GITHUB_CLIENT_ID`. No client secret is needed.

The default scopes are `read:user public_repo`. Set `GITHUB_SCOPES=read:user repo` to use private repositories.

## Tokens

- **Classic token**: `public_repo` scope, or `repo` for private repositories.
- **Fine-grained token**: *Contents: read and write* on the target repository.

Tokens are encrypted with AES-256-GCM in `.data/state.json`. The key comes from `APP_SECRET`, or from a random
`.data/secret.key` created on first start. `.data/` is git-ignored and never served over HTTP.

## Will the commits count?

GitHub only counts a commit on your wall when:

- it is on the repository's **default branch** (the app always uses it), in a repository that is not a fork;
- its author email belongs to your account (the app uses your `ID+login@users.noreply.github.com` address);
- for private repositories, *Private contributions* is enabled on your profile.

Colors are relative: GitHub splits your non-zero days into quartiles over the whole year. Adding commits can
therefore shift the thresholds of other days, which is why the server approaches each target in small steps
and re-checks the real calendar in between. It cannot remove commits, so a day that ends up darker than
planned stays that way.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GITHUB_CLIENT_ID` | none | OAuth App client id, enables *Connect with GitHub* |
| `GITHUB_SCOPES` | `read:user public_repo` | Scopes requested at sign-in |
| `APP_SECRET` | random key file | Secret used to encrypt the stored token |
| `PORT` / `HOST` | `4173` / `127.0.0.1` | Where the server listens |
| `DATA_DIR` | `.data` | Where state and the key file live |
| `SYNC_INTERVAL_MINUTES` | `60` | Time between scheduled runs (5 to 1440) |
| `MAX_COMMITS_PER_RUN` | `60` | Commit budget for one run (1 to 200) |
| `MAX_CHECKS_PER_RUN` | `6` | Calendar checks per run (2 to 20) |
| `RECHECK_DELAY_SECONDS` | `90` | Pause before re-reading the calendar |

## Command-line publisher

*Export schedule.json* still produces a file for the standalone script, which treats each level as a commit
count:

```bash
node ./scripts/publish-schedule.mjs --schedule ./schedule.json --username <username> --token <token>
```

## Tests

```bash
npm test
```
