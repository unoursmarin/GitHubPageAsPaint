import React, { cloneElement, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityCalendar } from 'react-activity-calendar';
import 'react-activity-calendar/tooltips.css';

import {
  HISTORICAL_WEEKS,
  buildPlannerGrid,
  buildSchedulePayload,
  cycleFutureIntensity,
} from './core.js';

const PAST_COLORS = ['#f5f0ff', '#ddd6fe', '#c084fc', '#9333ea', '#581c87'];
const FUTURE_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
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
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

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
    ? `${plannerState.username}'s last ${HISTORICAL_WEEKS} weeks are shown in purple, with a ${futureWeeks}-week paintable range in green.`
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
      setStatus('Grid loaded. Click future cells to set 1–4 planned commits.');
    } catch (error) {
      setPastEntries([]);
      setPlannerState(EMPTY_PLANNER_STATE);
      setStatus(`Unable to load contributions: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!plannerState.username || !plannerState.owner || !plannerState.repo) {
      setStatus('Load the grid first so the schedule includes the repository details.');
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
    setStatus(`Downloaded schedule with ${payload.entries.length} planned day(s).`);
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
      <section className="panel intro">
        <p className="eyebrow">GitHubPageAsPaint</p>
        <h1>Paint your next contribution map</h1>
        <p>
          Load your GitHub contribution history in purple, paint future days in green,
          and export a schedule that can be published later with your personal access token.
        </p>
      </section>

      <section className="panel controls">
        <form className="controls-grid" onSubmit={handleSubmit}>
          <label>
            GitHub username
            <input name="username" type="text" placeholder="octocat" required value={formState.username} onChange={handleInputChange} />
          </label>
          <label>
            Repository owner
            <input name="owner" type="text" placeholder="octocat" required value={formState.owner} onChange={handleInputChange} />
          </label>
          <label>
            Repository name
            <input name="repo" type="text" placeholder="portfolio-drawings" required value={formState.repo} onChange={handleInputChange} />
          </label>
          <label>
            Branch
            <input name="branch" type="text" value={formState.branch} onChange={handleInputChange} />
          </label>
          <label>
            Future weeks to paint
            <input name="futureWeeks" type="number" min="4" max="52" value={formState.futureWeeks} onChange={handleInputChange} />
          </label>
          <div className="actions">
            <button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Load contribution grid'}</button>
            <button id="download-plan" type="button" onClick={handleDownload}>Download schedule</button>
          </div>
        </form>

        <div className="legend">
          <span>Past contributions</span>
          <div className="chips purple-scale" aria-hidden="true">
            <span className="chip level-0 purple"></span>
            <span className="chip level-1 purple"></span>
            <span className="chip level-2 purple"></span>
            <span className="chip level-3 purple"></span>
            <span className="chip level-4 purple"></span>
          </div>
          <span>Future plan</span>
          <div className="chips green-scale" aria-hidden="true">
            <span className="chip level-0 green"></span>
            <span className="chip level-1 green"></span>
            <span className="chip level-2 green"></span>
            <span className="chip level-3 green"></span>
            <span className="chip level-4 green"></span>
          </div>
          <p className="hint">Click a future cell several times to cycle the intensity and planned commit count.</p>
        </div>
      </section>

      <section className="panel board">
        <div className="board-header">
          <div>
            <h2>Contribution planner</h2>
            <p id="summary">{summary}</p>
          </div>
          <div id="status" className="status" role="status" aria-live="polite">{status}</div>
        </div>
        <div className="grid-wrapper">
          <ActivityCalendar
            blockMargin={4}
            blockRadius={3}
            blockSize={12}
            colorScheme="dark"
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
                fill: color,
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
      </section>

      <section className="panel automation">
        <h2>Automation</h2>
        <ol>
          <li>Load the grid and paint the future dates you want.</li>
          <li>Download the generated <code>schedule.json</code>.</li>
          <li>
            Run
            <code>node ./scripts/publish-schedule.mjs --schedule ./schedule.json --owner &lt;owner&gt; --repo &lt;repo&gt; --branch &lt;branch&gt; --token &lt;token&gt;</code>
            {' '}to publish random text commits for the selected dates.
          </li>
        </ol>
        <p className="hint">
          The script creates tiny text files with dated commits through the GitHub API.
          Future-dated commits depend on GitHub’s contribution rules for the target account.
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
