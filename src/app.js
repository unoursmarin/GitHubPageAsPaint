import React, { cloneElement, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityCalendar } from 'react-activity-calendar';
import 'react-activity-calendar/tooltips.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';

import {
  HISTORICAL_WEEKS,
  buildPlannerGrid,
  buildSchedulePayload,
  cycleFutureIntensity,
} from './core.js';

// Fills resolve through CSS custom properties so the grid follows the page theme.
const LEVELS = [0, 1, 2, 3, 4];
const PAST_COLORS = LEVELS.map((level) => `var(--past-${level})`);
const FUTURE_COLORS = LEVELS.map((level) => `var(--future-${level})`);
const EMPTY_PLANNER_STATE = {
  username: '',
  owner: '',
  repo: '',
  branch: 'main',
};
const INITIAL_FORM_STATE = {
  username: '',
  owner: '',
  repo: '',
  branch: 'main',
  futureWeeks: '20',
};

function App() {
  const [formState, setFormState] = useState(INITIAL_FORM_STATE);
  const [plannerState, setPlannerState] = useState(EMPTY_PLANNER_STATE);
  const [pastEntries, setPastEntries] = useState([]);
  const [plan, setPlan] = useState(() => new Map());
  const [status, setStatusState] = useState({ text: '', tone: 'neutral' });
  const [loading, setLoading] = useState(false);

  function setStatus(text, tone = 'neutral') {
    setStatusState({ text, tone });
  }

  const futureWeeks = Number(formState.futureWeeks || 20);
  const weeks = useMemo(
    () => buildPlannerGrid({ futureWeeks, pastEntries }),
    [futureWeeks, pastEntries],
  );
  const calendarData = useMemo(
    () => weeks.flatMap((week) => week.days).map((day) => ({
      ...day,
      count: day.isFuture ? plan.get(day.date) ?? 0 : day.count,
      level: day.isFuture ? plan.get(day.date) ?? 0 : day.level,
    })),
    [plan, weeks],
  );
  const summary = plannerState.username
    ? `${plannerState.username}'s last ${HISTORICAL_WEEKS} weeks in grey, followed by ${futureWeeks} paintable weeks.`
    : `Load your profile to see the last ${HISTORICAL_WEEKS} weeks and paint the weeks ahead.`;

  async function handleSubmit(event) {
    event.preventDefault();

    const nextPlannerState = {
      username: formState.username.trim(),
      owner: formState.owner.trim(),
      repo: formState.repo.trim(),
      branch: formState.branch.trim() || 'main',
    };

    setPlan(new Map());
    setLoading(true);
    setStatus('Loading contribution history…');

    try {
      const entries = await fetchContributionCalendar(nextPlannerState.username);
      setPastEntries(entries);
      setPlannerState(nextPlannerState);
      setStatus('Grid loaded. Click future cells to plan 1 to 4 commits.', 'success');
    } catch (error) {
      setPastEntries([]);
      setPlannerState(EMPTY_PLANNER_STATE);
      setStatus(`Unable to load contributions: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!plannerState.username || !plannerState.owner || !plannerState.repo) {
      setStatus('Load the grid first so the schedule includes the repository details.', 'error');
      return;
    }

    const payload = buildSchedulePayload({
      username: plannerState.username,
      owner: plannerState.owner,
      repo: plannerState.repo,
      branch: plannerState.branch,
      plan,
    });

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'schedule.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded schedule with ${payload.entries.length} planned day(s).`, 'success');
  }

  function handleInputChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
  }

  function toggleFutureDate(date) {
    setPlan((current) => {
      const next = new Map(current);
      const nextLevel = cycleFutureIntensity(next.get(date) ?? 0);

      if (nextLevel === 0) {
        next.delete(date);
        setStatus(`${date} now has no planned commits.`);
      } else {
        next.set(date, nextLevel);
        setStatus(`${date} now has ${nextLevel} planned commit${nextLevel === 1 ? '' : 's'}.`);
      }

      return next;
    });
  }

  return (
    <main className="layout">
      <header className="intro">
        <span className="wordmark">GitHubPageAsPaint</span>
        <h1>Paint your next contribution map</h1>
        <p className="lede">
          Load your contribution history, paint the days ahead, and export a schedule
          you can publish later with a personal access token.
        </p>
      </header>

      <section className="section controls" aria-labelledby="controls-heading">
        <div className="section-head">
          <h2 id="controls-heading">Profile and repository</h2>
        </div>
        <form className="controls-grid" onSubmit={handleSubmit}>
          <label>
            GitHub username
            <input name="username" type="text" placeholder="octocat" autoComplete="off" required value={formState.username} onChange={handleInputChange} />
          </label>
          <label>
            Repository owner
            <input name="owner" type="text" placeholder="octocat" autoComplete="off" required value={formState.owner} onChange={handleInputChange} />
          </label>
          <label>
            Repository name
            <input name="repo" type="text" placeholder="portfolio-drawings" autoComplete="off" required value={formState.repo} onChange={handleInputChange} />
          </label>
          <label>
            Branch
            <input name="branch" type="text" autoComplete="off" value={formState.branch} onChange={handleInputChange} />
          </label>
          <label>
            Future weeks
            <input name="futureWeeks" type="number" min="4" max="52" value={formState.futureWeeks} onChange={handleInputChange} />
          </label>
          <div className="actions">
            <button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Load grid'}</button>
            <button id="download-plan" className="secondary" type="button" onClick={handleDownload}>Download schedule</button>
          </div>
        </form>
      </section>

      <section className="section board" aria-labelledby="board-heading">
        <div className="section-head">
          <div>
            <h2 id="board-heading">Contribution planner</h2>
            <p id="summary">{summary}</p>
          </div>
          <div id="status" className="status" data-tone={status.tone} role="status" aria-live="polite">{status.text}</div>
        </div>
        <div className="grid-wrapper">
          <ActivityCalendar
            blockMargin={3}
            blockRadius={2}
            blockSize={11}
            data={calendarData}
            fontSize={12}
            labels={{ totalCount: '{{count}} activities in {{year}}' }}
            loading={loading}
            renderBlock={(block, activity) => {
              const isFuture = activity.kind === 'future';
              const color = isFuture ? FUTURE_COLORS[activity.level] : PAST_COLORS[activity.level];
              const label = isFuture
                ? futureStatusLabel(activity.date, activity.count)
                : `${activity.date}, ${activity.count} past contribution${activity.count === 1 ? '' : 's'}`;

              return cloneElement(block, {
                ...block.props,
                'aria-label': label,
                'aria-pressed': isFuture ? String(activity.count > 0) : undefined,
                'data-future': isFuture ? 'true' : 'false',
                onClick: isFuture ? () => toggleFutureDate(activity.date) : undefined,
                onKeyDown: isFuture
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleFutureDate(activity.date);
                      }
                    }
                  : undefined,
                role: isFuture ? 'button' : 'img',
                style: {
                  ...block.props.style,
                  fill: color,
                  cursor: isFuture ? 'pointer' : 'default',
                },
                tabIndex: isFuture ? 0 : -1,
              });
            }}
            showColorLegend={false}
            showTotalCount={false}
            showWeekdayLabels
            theme={{ dark: PAST_COLORS, light: PAST_COLORS }}
            tooltips={{
              activity: {
                text: (activity) =>
                  activity.kind === 'future'
                    ? futureStatusLabel(activity.date, activity.count)
                    : `${activity.count} past contribution${activity.count === 1 ? '' : 's'} on ${activity.date}`,
              },
            }}
          />
        </div>

        <div className="legend">
          <span className="legend-item">
            Past
            <span className="chips" aria-hidden="true">
              {LEVELS.map((level) => <span key={level} className={`chip past level-${level}`}></span>)}
            </span>
          </span>
          <span className="legend-item">
            Planned
            <span className="chips" aria-hidden="true">
              {LEVELS.map((level) => <span key={level} className={`chip future level-${level}`}></span>)}
            </span>
          </span>
          <span className="hint">Click a future cell again to raise its commit count.</span>
        </div>
      </section>

      <section className="section automation" aria-labelledby="automation-heading">
        <div className="section-head">
          <h2 id="automation-heading">Publish the plan</h2>
        </div>
        <ol className="steps">
          <li><span>Load the grid and paint the future dates you want.</span></li>
          <li><span>Download the generated <code>schedule.json</code>.</span></li>
          <li>
            <span>Run the publisher to create text commits for the selected dates:</span>
            <pre><code>node ./scripts/publish-schedule.mjs --schedule ./schedule.json --owner &lt;owner&gt; --repo &lt;repo&gt; --branch &lt;branch&gt; --token &lt;token&gt;</code></pre>
          </li>
        </ol>
        <p className="note">
          The script creates tiny dated text files through the GitHub API. Future-dated commits
          depend on GitHub’s contribution rules for the target account.
        </p>
      </section>
    </main>
  );
}

async function fetchContributionCalendar(username) {
  const response = await fetch(`/api/contributions?username=${encodeURIComponent(username)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || `Contribution API responded with ${response.status}`);
  }
  if (payload.error) {
    throw new Error(payload.error);
  }
  if (!payload.entries?.length) {
    throw new Error('No contribution data returned. Check the username.');
  }

  return payload.entries;
}

function futureStatusLabel(date, count) {
  return count === 0 ? `${date}, no planned commits` : `${date}, planned commits: ${count}`;
}

createRoot(document.getElementById('app')).render(<App />);
