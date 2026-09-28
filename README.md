# GitToPaint

Paint your GitHub contribution wall from a static page. There is no server: the app on GitHub Pages talks to the
GitHub API with your own token, and **your own repository** keeps the drawing and paints it every day with
GitHub Actions.

## How it works

| Piece | Where it lives | What it does |
|---|---|---|
| The app | GitHub Pages (this repository) | Token sign-in, find or create your repository, edit the drawing, install the daily job |
| `.github-art-config.json` | Your repository | Your drawing: painted days and levels, folder, time zone, your GitHub id |
| `.github/workflows/draw-contributions.yml` | Your repository | Runs the engine every day around 12:20 in your time zone, and on demand |
| `.github/git-to-paint/draw.mjs` | Your repository | The engine: one self-contained file, no dependency |

Every day the engine checks today and the 7 days before, to catch up on late or skipped runs. For each painted day
that is still lighter on your wall than planned, it commits small random text files in your folder, **as you**
(`ID+login@users.noreply.github.com`), then re-reads the calendar and adjusts. Days already darker than planned are
left alone: commits are never removed.

The engine pushes with the `GITHUB_TOKEN` that Actions gives your repository. Your token is never stored, apart from
the optional read-only secret described below, which stays in your repository's Actions secrets.

The commit that installs or updates these files is signed by the app author (`unoursmarin`), not by you, so saving
a drawing does not add a contribution to your wall.

## Using it

1. Create a token (see below) and paste it in the app. It stays in the browser tab and is only sent to api.github.com.
2. The app looks for your drawing: first in `gitToPaint`, then in the repository this browser used last, then in any
   of your repositories that holds `.github-art-config.json`.
3. No drawing yet? Create `gitToPaint` (public, so its commits count without any profile setting) or pick a
   repository you own.
4. Paint the grid, then **Save drawing**. Saving again edits the drawing. **Clear drawing** then save empties it.
   *Remove GitToPaint* deletes the files, and optionally the generated ones.

## Tokens

Fine-grained token on the repository that holds the drawing:

| Permission | Access | Why |
|---|---|---|
| Contents | Read and write | Save the drawing |
| Workflows | Read and write | Install the daily job |
| Actions | Read and write | Show runs, *Run now*, re-enable a disabled job (optional) |
| Secrets | Read and write | Count private contributions (optional) |
| Administration | Read and write, all repositories | Create `gitToPaint` for you (optional) |

Or a classic token with `public_repo` and `workflow` (`repo` and `workflow` for a private repository).

### Private contributions (optional)

With only `GITHUB_TOKEN`, the engine sees your public contributions. If you work a lot in private repositories,
colors are judged against the wrong year. In *Daily job > Count private contributions*, paste a separate classic
token with only `read:user`. It is encrypted in the browser with your repository's public key and stored as the
`GIT_TO_PAINT_TOKEN` Actions secret.

## Will the commits count?

GitHub counts a commit on your wall when it is on the default branch of a repository that is not a fork, and its
author email belongs to you. For a private repository, *Private contributions* must be enabled on your profile.

Colors are relative: GitHub splits your non-zero days into quartiles over the year, so adding commits can shift the
thresholds. The engine approaches each target in small steps and re-checks the calendar in between.

Scheduled workflows can start late, and GitHub disables them after 60 days without activity in a repository. The
7-day catch-up covers late runs; the app shows a disabled job and can re-enable it.

## Development

```bash
npm install
npm run dev     # builds the engine, serves the app with live rebuild on http://localhost:4173
npm test
npm run build   # dist/app.js and dist/engine/draw.mjs
```

Pushing to `develop` publishes the app with `.github/workflows/pages.yml` (set *Settings > Pages > Source* to
*GitHub Actions*). Bump `ENGINE_VERSION` in `src/shared/version.js` whenever the engine or the workflow template
changes: users then see *Update the daily job*.

| Path | Role |
|---|---|
| `src/app.js`, `src/components/` | The Pages app |
| `src/setup/` | What the app does in the user's repository: locate, create, install, remove, secret |
| `src/shared/` | Config format, workflow template, validation, time zones, engine version |
| `src/sync/` | Color reconciliation and the daily run |
| `src/github/` | GitHub API client, public calendar fallback |
| `engine/draw.mjs` | Engine entry point, bundled into `dist/engine/draw.mjs` |
