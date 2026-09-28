import {
  DAY_LABELS,
  buildPlannerGrid,
  buildSchedulePayload,
  cycleFutureIntensity,
} from './core.js';

const form = document.getElementById('planner-form');
const gridWrapper = document.getElementById('grid-wrapper');
const summary = document.getElementById('summary');
const status = document.getElementById('status');
const downloadButton = document.getElementById('download-plan');

const plan = new Map();
let plannerState = {
  username: '',
  owner: '',
  repo: '',
  branch: 'main',
};

renderGrid(buildPlannerGrid());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  plannerState = {
    username: String(data.get('username') || '').trim(),
    owner: String(data.get('owner') || '').trim(),
    repo: String(data.get('repo') || '').trim(),
    branch: String(data.get('branch') || 'main').trim() || 'main',
  };

  const futureWeeks = Number(data.get('futureWeeks') || 20);
  plan.clear();
  setStatus('Loading contribution history…');

  try {
    const pastEntries = await fetchContributionCalendar(plannerState.username);
    const weeks = buildPlannerGrid({ futureWeeks, pastEntries });
    renderGrid(weeks);
    summary.textContent = `${plannerState.username}'s last 53 weeks are shown in purple, with ${futureWeeks} paintable weeks ahead in green.`;
    setStatus('Grid loaded. Click future cells to set 1–4 planned commits.');
  } catch (error) {
    renderGrid(buildPlannerGrid({ futureWeeks }));
    summary.textContent = 'Load your profile to see the last 53 weeks and paint the weeks ahead.';
    setStatus(`Unable to load contributions: ${error.message}`);
  }
});

downloadButton.addEventListener('click', () => {
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
});

async function fetchContributionCalendar(username) {
  const response = await fetch(`/api/contributions?username=${encodeURIComponent(username)}`);

  if (!response.ok) {
    throw new Error(`Contribution API responded with ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error);
  }
  const days = payload.entries;

  if (!days?.length) {
    throw new Error('No contribution data returned. Check the username.');
  }

  return days;
}

function renderGrid(weeks) {
  gridWrapper.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'grid';

  const labels = document.createElement('div');
  labels.className = 'day-labels';
  DAY_LABELS.forEach((label) => {
    const element = document.createElement('span');
    element.textContent = label;
    labels.appendChild(element);
  });

  const columns = document.createElement('div');
  columns.className = 'week-columns';

  const monthRow = document.createElement('div');
  monthRow.className = 'month-row';
  weeks.forEach((week, index) => {
    const month = document.createElement('span');
    month.textContent = index === 0 || week.month !== weeks[index - 1].month ? week.month : '';
    monthRow.appendChild(month);
  });

  const weekRow = document.createElement('div');
  weekRow.className = 'week-row';
  weeks.forEach((week) => {
    const weekColumn = document.createElement('div');
    weekColumn.className = 'week';

    week.days.forEach((day) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `cell ${day.kind} level-${day.level}`;
      button.setAttribute(
        'aria-label',
        day.isFuture
          ? `${day.date}, planned commits: ${plan.get(day.date) ?? 0}`
          : `${day.date}, ${day.count} past contribution${day.count === 1 ? '' : 's'}`,
      );
      button.title = button.getAttribute('aria-label');

      if (day.isFuture) {
        button.addEventListener('click', () => {
          const nextLevel = cycleFutureIntensity(plan.get(day.date) ?? 0);
          if (nextLevel === 0) {
            plan.delete(day.date);
          } else {
            plan.set(day.date, nextLevel);
          }
          button.className = `cell future level-${nextLevel}`;
          button.setAttribute('aria-label', `${day.date}, planned commits: ${nextLevel}`);
          button.title = button.getAttribute('aria-label');
          setStatus(`${day.date} now has ${nextLevel} planned commit${nextLevel === 1 ? '' : 's'}.`);
        });
      } else {
        button.disabled = true;
      }

      weekColumn.appendChild(button);
    });

    weekRow.appendChild(weekColumn);
  });

  columns.append(monthRow, weekRow);
  grid.append(labels, columns);
  gridWrapper.appendChild(grid);
}

function setStatus(message) {
  status.textContent = message;
}
