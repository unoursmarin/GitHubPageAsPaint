import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'react-activity-calendar/tooltips.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';

import { Board } from './components/Board.js';
import { RepoPanel } from './components/RepoPanel.js';
import { RunsPanel } from './components/RunsPanel.js';
import { SignInPanel } from './components/SignInPanel.js';
import { cycleFutureIntensity } from './core.js';
import { createGitHubClient } from './github/client.js';
import { CONFIG_PATH, DEFAULT_FOLDER, ENGINE_PATH, buildArtConfig, parseArtConfig } from './shared/art-config.js';
import { validateFolder, validateToken } from './shared/validation.js';
import { ENGINE_VERSION, readEngineVersion } from './shared/version.js';
import { dateInZone } from './shared/zone.js';
import { createDefaultRepo, installArtRepo, locateArtRepo, uninstallArtRepo } from './setup/repo-setup.js';
import { reconcilePlan } from './sync/reconcile.js';
import { loadRememberedRepo, loadToken, rememberRepo, saveToken } from './ui/storage.js';

const client = createGitHubClient();
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DEFAULT_FUTURE_WEEKS = 20;
const CALENDAR_DAYS = 364;
const EMPTY_DRAFT = { plan: new Map(), futureWeeks: DEFAULT_FUTURE_WEEKS, folder: DEFAULT_FOLDER, timeZone: DEVICE_TIME_ZONE };

function draftFromConfig(config) {
  return { plan: new Map(Object.entries(config.plan)), futureWeeks: config.futureWeeks, folder: config.folder, timeZone: config.timeZone };
}

function snapshot(draft) {
  return JSON.stringify([[...draft.plan].sort(), draft.futureWeeks, draft.folder.trim(), draft.timeZone]);
}

async function fetchEngineSource() {
  const response = await fetch(new URL('./dist/engine/draw.mjs', document.baseURI));
  if (!response.ok) throw new Error(`Could not load the engine (${response.status}).`);
  const source = await response.text();
  if (readEngineVersion(source) !== ENGINE_VERSION) throw new Error('The engine file does not match this app version. Reload the page.');
  return source;
}

function App() {
  const [token, setToken] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [phase, setPhase] = useState('signed-out');
  const [signInError, setSignInError] = useState('');
  const [location, setLocation] = useState({ repo: null, others: [], hasConfig: false, engineVersion: null });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [days, setDays] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: '', tone: 'neutral' });

  const say = (text, tone = 'neutral') => setMessage({ text, tone });
  const today = dateInZone(new Date(), draft.timeZone);
  const { repo } = location;

  const loadCalendar = useCallback(async (activeToken, login) => {
    setCalendarLoading(true);
    try {
      const to = new Date();
      setDays(await client.getContributionDays(activeToken, login, { from: new Date(to.getTime() - CALENDAR_DAYS * 86_400_000), to }));
    } catch (error) {
      say(`Could not load your contributions: ${error.message}`, 'error');
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  const openRepo = useCallback(async (activeToken, found) => {
    let nextDraft = EMPTY_DRAFT;
    let hasConfig = false;
    if (found.configText) {
      try {
        nextDraft = draftFromConfig(parseArtConfig(found.configText));
        hasConfig = true;
      } catch (error) {
        say(`The saved drawing could not be read (${error.message}). Saving will replace it.`, 'error');
      }
    }
    const engineFile = found.repo ? await client.getFileText(activeToken, found.repo.owner, found.repo.repo, ENGINE_PATH).catch(() => null) : null;
    setLocation({ repo: found.repo, others: found.others ?? [], hasConfig, engineVersion: readEngineVersion(engineFile?.text ?? '') });
    setDraft(nextDraft);
    setSavedSnapshot(hasConfig ? snapshot(nextDraft) : null);
    if (found.repo) rememberRepo(found.repo.repo);
    setPhase(found.repo ? 'ready' : 'no-repo');
  }, []);

  const signIn = useCallback(async (rawToken) => {
    setSignInError('');
    setBusy(true);
    try {
      const activeToken = validateToken(rawToken);
      const me = await client.getViewer(activeToken);
      saveToken(activeToken);
      setToken(activeToken);
      setViewer(me);
      setPhase('locating');
      loadCalendar(activeToken, me.login);
      await openRepo(activeToken, await locateArtRepo({ client, token: activeToken, viewer: me, rememberedRepo: loadRememberedRepo() }));
    } catch (error) {
      saveToken(null);
      setToken(null);
      setViewer(null);
      setPhase('signed-out');
      setSignInError(error.status === 401 ? 'GitHub rejected this token. Check that it is complete and not expired.' : error.message);
    } finally {
      setBusy(false);
    }
  }, [loadCalendar, openRepo]);

  useEffect(() => {
    const stored = loadToken();
    if (stored) signIn(stored);
  }, [signIn]);

  function signOut() {
    saveToken(null);
    setToken(null);
    setViewer(null);
    setDays([]);
    setDraft(EMPTY_DRAFT);
    setSavedSnapshot(null);
    setLocation({ repo: null, others: [], hasConfig: false, engineVersion: null });
    setPhase('signed-out');
    say('Signed out. The token was forgotten by this tab.');
  }

  async function withBusy(task) {
    setBusy(true);
    say('');
    try {
      await task();
    } catch (error) {
      say(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const createRepo = () => withBusy(async () => {
    const created = await createDefaultRepo({ client, token });
    await openRepo(token, { repo: created, configText: null });
    say(`Created ${created.fullName}. Paint your drawing, then save it.`, 'success');
  });

  const chooseRepo = (chosen) => withBusy(async () => {
    const file = await client.getFileText(token, chosen.owner, chosen.repo, CONFIG_PATH);
    await openRepo(token, { repo: chosen, configText: file?.text ?? null });
  });

  const save = () => withBusy(async () => {
    const folder = validateFolder(draft.folder);
    const config = buildArtConfig({ user: viewer, timeZone: draft.timeZone, folder, futureWeeks: draft.futureWeeks, plan: Object.fromEntries(draft.plan) });
    await installArtRepo({ client, token, repo, config, engineSource: await fetchEngineSource() });
    const saved = { ...draft, folder };
    setDraft(saved);
    setSavedSnapshot(snapshot(saved));
    setLocation((current) => ({ ...current, hasConfig: true, engineVersion: ENGINE_VERSION }));
    rememberRepo(repo.repo);
    say(`Saved in ${repo.fullName}. The daily job paints around 12:20 (${draft.timeZone}).`, 'success');
  });

  const uninstall = ({ removeGeneratedFiles }) => withBusy(async () => {
    const removed = await uninstallArtRepo({ client, token, repo, folder: draft.folder, removeGeneratedFiles });
    setLocation((current) => ({ ...current, hasConfig: false, engineVersion: null }));
    setDraft(EMPTY_DRAFT);
    setSavedSnapshot(null);
    say(`Removed ${removed} file${removed === 1 ? '' : 's'} from ${repo.fullName}.`, 'success');
  });

  function paint(date) {
    setDraft((current) => {
      const plan = new Map(current.plan);
      const level = cycleFutureIntensity(plan.get(date) ?? 0);
      if (level === 0) plan.delete(date);
      else plan.set(date, level);
      return { ...current, plan };
    });
  }

  const statuses = useMemo(
    () => Object.fromEntries(reconcilePlan({ plan: Object.fromEntries(draft.plan), days, today }).map((result) => [result.date, result.status])),
    [draft.plan, days, today],
  );

  const dirty = phase === 'ready' && snapshot(draft) !== savedSnapshot;
  const outdatedEngine = location.hasConfig && location.engineVersion !== ENGINE_VERSION;
  const signedIn = Boolean(viewer);

  return (
    <main className="layout">
      <header className="intro">
        <span className="wordmark">GitToPaint</span>
        <h1>Paint your contribution wall</h1>
        <p className="lede">
          Draw on your GitHub calendar. Your own repository keeps the drawing and commits it, as you, one day at a time.
        </p>
      </header>

      <section className="section split" aria-labelledby="account-heading">
        <div className="section-intro">
          <h2 id="account-heading">Account</h2>
          <p>Connect with a personal access token.</p>
        </div>
        <SignInPanel viewer={viewer} busy={busy} error={signInError} onSignIn={signIn} onSignOut={signOut} />
      </section>

      {signedIn && (
        <section className="section split" aria-labelledby="repo-heading">
          <div className="section-intro">
            <h2 id="repo-heading">Repository</h2>
            <p>Where the drawing, its daily job and the generated files live.</p>
          </div>
          {phase === 'locating'
            ? <p className="muted" role="status">Looking for your drawing…</p>
            : (
              <RepoPanel
                repo={repo}
                others={location.others}
                hasConfig={location.hasConfig}
                folder={draft.folder}
                onFolderChange={(folder) => setDraft((current) => ({ ...current, folder }))}
                busy={busy}
                onCreateDefault={createRepo}
                onChooseRepo={chooseRepo}
                onListRepos={() => client.listOwnedRepos(token)}
              />
            )}
        </section>
      )}

      {phase === 'ready' && (
        <section className="section board" aria-labelledby="board-heading">
          <div className="section-head">
            <div>
              <h2 id="board-heading">Drawing</h2>
              <p>Grey is your real history. Painted days go from light to dark green.</p>
            </div>
            <label className="narrow">
              Weeks ahead
              <input
                type="number"
                min="4"
                max="52"
                value={draft.futureWeeks}
                onChange={(event) => setDraft((current) => ({ ...current, futureWeeks: Math.min(52, Math.max(4, Number(event.target.value) || DEFAULT_FUTURE_WEEKS)) }))}
              />
            </label>
          </div>

          <Board days={days} plan={draft.plan} statuses={statuses} futureWeeks={draft.futureWeeks} today={today} loading={calendarLoading} onPaint={paint} />

          <div className="save-bar">
            <button type="button" onClick={save} disabled={busy || (!dirty && !outdatedEngine)}>
              {outdatedEngine && !dirty ? 'Update the daily job' : 'Save drawing'}
            </button>
            <button className="secondary" type="button" onClick={() => setDraft((current) => ({ ...current, plan: new Map() }))} disabled={busy || !draft.plan.size}>
              Clear drawing
            </button>
            <span className="muted small" aria-live="polite">
              {dirty ? 'Unsaved changes.' : location.hasConfig ? 'Saved.' : 'Not saved yet.'}
              {' '}{draft.plan.size} painted day{draft.plan.size === 1 ? '' : 's'}, time zone {draft.timeZone}.
            </span>
            {draft.timeZone !== DEVICE_TIME_ZONE && (
              <button className="ghost" type="button" onClick={() => setDraft((current) => ({ ...current, timeZone: DEVICE_TIME_ZONE }))}>
                Use {DEVICE_TIME_ZONE}
              </button>
            )}
          </div>
          {outdatedEngine && <p className="muted small">A newer version of the daily job is available. Saving installs it.</p>}
          {message.text && <p className="status inline" data-tone={message.tone} role="status">{message.text}</p>}
        </section>
      )}

      {phase !== 'ready' && message.text && <p className="status inline" data-tone={message.tone} role="status">{message.text}</p>}

      {phase === 'ready' && location.hasConfig && (
        <section className="section split" aria-labelledby="runs-heading">
          <div className="section-intro">
            <h2 id="runs-heading">Daily job</h2>
            <p>Runs in {repo.fullName} with GitHub Actions. It checks today and the 7 days before.</p>
          </div>
          <RunsPanel client={client} token={token} repo={repo} onUninstall={uninstall} busy={busy} />
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('app')).render(<App />);
