import React, { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityCalendar } from 'react-activity-calendar';
import 'react-activity-calendar/tooltips.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';

import { api } from './api.js';
import { AccountPanel } from './components/AccountPanel.js';
import { SyncPanel } from './components/SyncPanel.js';
import { TargetPanel } from './components/TargetPanel.js';
import { addDays, buildPlannerGrid, buildSchedulePayload, cycleFutureIntensity, HISTORICAL_WEEKS, toIsoDate } from './core.js';

// Fills resolve through CSS custom properties so the grid follows the page theme.
const LEVELS = [0, 1, 2, 3, 4];
const PAST_COLORS = LEVELS.map((level) => `var(--past-${level})`);
const PLANNED_COLORS = LEVELS.map((level) => `var(--future-${level})`);
// Must match PLAN_PAST_DAYS on the server.
const PAINTABLE_PAST_DAYS = 364;
const AUTOSAVE_DELAY_MS = 600;
const DEFAULT_FUTURE_WEEKS = 20;
const STATUS_TEXT = {
  ok: 'reached on GitHub',
  pending: 'commits still needed',
  above: 'already darker than planned, nothing will be published',
};

function App() {
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState('');
  const [pastEntries, setPastEntries] = useState([]);
  const [plan, setPlan] = useState(() => new Map());
  const [futureWeeks, setFutureWeeks] = useState(DEFAULT_FUTURE_WEEKS);
  const [status, setStatusState] = useState({ text: '', tone: 'neutral' });
  const [loading, setLoading] = useState(false);
  const planDirty = useRef(false);
  const signedInLogin = useRef(null);

  const account = session?.account;
  const setStatus = (text, tone = 'neutral') => setStatusState({ text, tone });

  const loadHistory = useCallback(async (login) => {
    setLoading(true);
    setStatus('Loading contribution history…');
    try {
      const { entries } = await api('GET', `/api/contributions${login ? `?username=${encodeURIComponent(login)}` : ''}`);
      setPastEntries(entries);
      setStatus('History loaded. Click any cell to paint it.', 'success');
    } catch (error) {
      setPastEntries([]);
      setStatus(`Unable to load contributions: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  // A newly connected account brings its saved plan and its own history.
  const applySession = useCallback((next) => {
    const login = next.account?.login ?? null;
    if (login && login !== signedInLogin.current) {
      setPlan(new Map(Object.entries(next.plan ?? {})));
      setFutureWeeks(next.futureWeeks ?? DEFAULT_FUTURE_WEEKS);
      loadHistory();
    }
    signedInLogin.current = login;
    setSession(next);
  }, [loadHistory]);

  const applySync = useCallback((sync) => setSession((previous) => previous && { ...previous, sync }), []);

  useEffect(() => {
    api('GET', '/api/session')
      .then(applySession)
      .catch((error) => setStatus(`Unable to reach the local server: ${error.message}`, 'error'));
  }, [applySession]);

  // Signed-in plans are saved on the server, which is what the scheduler publishes from.
  useEffect(() => {
    if (!account || !planDirty.current) return undefined;
    const timer = setTimeout(async () => {
      try {
        await api('PUT', '/api/plan', { plan: Object.fromEntries(plan), futureWeeks });
        planDirty.current = false;
        setStatus(`Saved · ${plan.size} painted day${plan.size === 1 ? '' : 's'}.`, 'success');
      } catch (error) {
        setStatus(`Not saved: ${error.message}`, 'error');
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [account, plan, futureWeeks]);

  const earliestPaintable = useMemo(() => toIsoDate(addDays(new Date(), -PAINTABLE_PAST_DAYS)), []);
  const dayStatus = session?.sync?.lastSync?.days ?? {};

  const calendarData = useMemo(
    () => buildPlannerGrid({ futureWeeks, pastEntries })
      .flatMap((week) => week.days)
      .map((day) => {
        const planned = plan.get(day.date) ?? 0;
        return {
          ...day,
          planned,
          paintable: day.date >= earliestPaintable,
          level: planned || (day.isFuture ? 0 : day.level),
        };
      }),
    [futureWeeks, pastEntries, plan, earliestPaintable],
  );

  function paint(date) {
    planDirty.current = true;
    setPlan((current) => {
      const next = new Map(current);
      const level = cycleFutureIntensity(next.get(date) ?? 0);
      if (level === 0) next.delete(date);
      else next.set(date, level);
      return next;
    });
  }

  function changeFutureWeeks(event) {
    const value = Math.min(52, Math.max(4, Number(event.target.value) || DEFAULT_FUTURE_WEEKS));
    planDirty.current = true;
    setFutureWeeks(value);
  }

  function exportSchedule() {
    const owner = session?.target?.owner;
    if (!owner) {
      setStatus('Choose a target repository before exporting.', 'error');
      return;
    }
    const payload = buildSchedulePayload({
      username: account?.login ?? username,
      owner,
      repo: session.target.repo,
      branch: session.target.branch,
      plan,
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'schedule.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  const summary = account
    ? `@${account.login}: last ${HISTORICAL_WEEKS} weeks in grey, painted days in green.`
    : 'Preview any public profile, or connect GitHub to save and publish your drawing.';

  return (
    <main className="layout">
      <header className="intro">
        <span className="wordmark">GitHubPageAsPaint</span>
        <h1>Paint your contribution map</h1>
        <p className="lede">
          Connect GitHub, pick a repository and a folder, then paint the wall. The server checks every
          painted day against your real calendar and commits until each one reaches its color, never beyond.
        </p>
      </header>

      <section className="section split" aria-labelledby="account-heading">
        <div className="section-intro">
          <span className="step-index">01</span>
          <h2 id="account-heading">Account</h2>
          <p>Sign in with GitHub, or paste a token.</p>
        </div>
        <AccountPanel session={session} onSessionChange={applySession} />
      </section>

      {account && (
        <section className="section split" aria-labelledby="target-heading">
          <div className="section-intro">
            <span className="step-index">02</span>
            <h2 id="target-heading">Target</h2>
            <p>Where the generated text files are committed.</p>
          </div>
          <TargetPanel key={account.login} session={session} onSessionChange={applySession} />
        </section>
      )}

      <section className="section board" aria-labelledby="board-heading">
        <div className="section-head">
          <div>
            <span className="step-index">{account ? '03' : '02'}</span>
            <h2 id="board-heading">Drawing</h2>
            <p>{summary}</p>
          </div>
          <div className="status" data-tone={status.tone} role="status" aria-live="polite">{status.text}</div>
        </div>

        <form
          className="board-controls"
          onSubmit={(event) => {
            event.preventDefault();
            loadHistory(account ? null : username.trim());
          }}
        >
          {!account && (
            <label>
              GitHub username
              <input type="text" placeholder="octocat" autoComplete="off" required value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
          )}
          <label className="narrow">
            Future weeks
            <input type="number" min="4" max="52" value={futureWeeks} onChange={changeFutureWeeks} />
          </label>
          <button className="secondary" type="submit" disabled={loading}>{loading ? 'Loading…' : account ? 'Refresh history' : 'Load history'}</button>
        </form>

        <div className="grid-wrapper">
          <ActivityCalendar
            blockMargin={3}
            blockRadius={2}
            blockSize={11}
            data={calendarData}
            fontSize={12}
            loading={loading}
            renderBlock={(block, activity) => renderCell(block, activity, dayStatus[activity.date]?.status, paint)}
            showColorLegend={false}
            showTotalCount={false}
            showWeekdayLabels
            theme={{ dark: PAST_COLORS, light: PAST_COLORS }}
            tooltips={{ activity: { text: (activity) => describeCell(activity, dayStatus[activity.date]?.status) } }}
          />
        </div>

        <div className="legend">
          <span className="legend-item">
            History
            <span className="chips" aria-hidden="true">{LEVELS.map((level) => <span key={level} className={`chip past level-${level}`}></span>)}</span>
          </span>
          <span className="legend-item">
            Painted
            <span className="chips" aria-hidden="true">{LEVELS.map((level) => <span key={level} className={`chip future level-${level}`}></span>)}</span>
          </span>
          <span className="legend-item"><span className="ring" data-status="pending" aria-hidden="true"></span>in progress</span>
          <span className="legend-item"><span className="ring" data-status="above" aria-hidden="true"></span>too dark</span>
          <span className="hint">Click a cell again to darken it, a fifth time to clear it.</span>
        </div>
      </section>

      {account && (
        <section className="section split" aria-labelledby="sync-heading">
          <div className="section-intro">
            <span className="step-index">04</span>
            <h2 id="sync-heading">Sync</h2>
            <p>Runs on a schedule while the server is up.</p>
          </div>
          <SyncPanel
            sync={session.sync}
            canSync={Boolean(session.target) && plan.size > 0}
            onSyncChange={applySync}
            onExport={exportSchedule}
          />
        </section>
      )}
    </main>
  );
}

function renderCell(block, activity, syncStatus, paint) {
  const interactive = activity.paintable;
  const color = activity.planned ? PLANNED_COLORS[activity.planned] : activity.isFuture ? 'var(--future-0)' : PAST_COLORS[activity.level];

  return cloneElement(block, {
    ...block.props,
    'aria-label': describeCell(activity, syncStatus),
    'aria-pressed': interactive ? String(activity.planned > 0) : undefined,
    'data-paintable': interactive ? 'true' : 'false',
    'data-status': activity.planned ? syncStatus : undefined,
    onClick: interactive ? () => paint(activity.date) : undefined,
    onKeyDown: interactive
      ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            paint(activity.date);
          }
        }
      : undefined,
    role: interactive ? 'button' : 'img',
    style: { ...block.props.style, fill: color, cursor: interactive ? 'pointer' : 'default' },
    tabIndex: interactive ? 0 : -1,
  });
}

function describeCell(activity, syncStatus) {
  const history = activity.isFuture ? '' : `${activity.count} contribution${activity.count === 1 ? '' : 's'}`;
  if (!activity.planned) return [activity.date, history].filter(Boolean).join(', ');
  const state = STATUS_TEXT[syncStatus] ?? (activity.isFuture ? 'upcoming' : 'not checked yet');
  return [activity.date, `painted level ${activity.planned}`, history, state].filter(Boolean).join(', ');
}

createRoot(document.getElementById('app')).render(<App />);
