import React, { cloneElement, useMemo } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';

import { buildPlannerGrid } from '../core.js';
import { PLAN_PAST_DAYS } from '../shared/validation.js';
import { shiftDate } from '../shared/zone.js';

// Fills resolve through CSS custom properties so the grid follows the page theme.
const LEVELS = [0, 1, 2, 3, 4];
const HISTORY_COLORS = LEVELS.map((level) => `var(--past-${level})`);
const PAINT_COLORS = LEVELS.map((level) => `var(--future-${level})`);
const STATUS_TEXT = {
  ok: 'reached on GitHub',
  pending: 'still lighter than planned',
  above: 'already darker than planned, left alone',
};

/**
 * The contribution grid: real history in grey, painted days in GitHub greens.
 * Upcoming days start as empty grey cells, like the past.
 */
export function Board({ days, plan, statuses, futureWeeks, today, loading, onPaint }) {
  const earliest = useMemo(() => shiftDate(today, -PLAN_PAST_DAYS), [today]);

  const data = useMemo(
    () => buildPlannerGrid({ futureWeeks, pastEntries: days, today: new Date(`${today}T00:00:00Z`) })
      .flatMap((week) => week.days)
      .map((day) => {
        const planned = plan.get(day.date) ?? 0;
        return { ...day, planned, paintable: day.date >= earliest, isToday: day.date === today, level: planned || (day.isFuture ? 0 : day.level) };
      }),
    [days, plan, futureWeeks, today, earliest],
  );

  return (
    <>
      <div className="grid-wrapper">
        <ActivityCalendar
          blockMargin={3}
          blockRadius={2}
          blockSize={11}
          data={data}
          fontSize={12}
          loading={loading}
          renderBlock={(block, activity) => renderCell(block, activity, statuses[activity.date], onPaint)}
          showColorLegend={false}
          showTotalCount={false}
          showWeekdayLabels
          theme={{ dark: HISTORY_COLORS, light: HISTORY_COLORS }}
          tooltips={{ activity: { text: (activity) => describeCell(activity, statuses[activity.date]) } }}
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
        <span className="legend-item"><span className="ring" data-status="pending" aria-hidden="true"></span>not reached yet</span>
        <span className="legend-item"><span className="ring" data-status="above" aria-hidden="true"></span>too dark</span>
        <span className="hint">Click a cell to darken it; a fifth click clears it.</span>
      </div>
    </>
  );
}

function renderCell(block, activity, status, onPaint) {
  const interactive = activity.paintable;
  const fill = activity.planned ? PAINT_COLORS[activity.planned] : activity.isFuture ? 'var(--future-0)' : HISTORY_COLORS[activity.level];

  return cloneElement(block, {
    ...block.props,
    'aria-label': describeCell(activity, status),
    'aria-pressed': interactive ? String(activity.planned > 0) : undefined,
    'data-paintable': interactive ? 'true' : 'false',
    'data-today': activity.isToday ? 'true' : undefined,
    'data-status': activity.planned && !activity.isFuture ? status : undefined,
    onClick: interactive ? () => onPaint(activity.date) : undefined,
    onKeyDown: interactive
      ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onPaint(activity.date);
          }
        }
      : undefined,
    role: interactive ? 'button' : 'img',
    style: { ...block.props.style, fill, cursor: interactive ? 'pointer' : 'default' },
    tabIndex: interactive ? 0 : -1,
  });
}

function describeCell(activity, status) {
  const history = activity.isFuture ? '' : `${activity.count} contribution${activity.count === 1 ? '' : 's'}`;
  const day = activity.isToday ? `${activity.date} (today)` : activity.date;
  if (!activity.planned) return [day, history].filter(Boolean).join(', ');
  const state = activity.isFuture ? 'upcoming' : STATUS_TEXT[status] ?? '';
  return [day, `painted level ${activity.planned}`, history, state].filter(Boolean).join(', ');
}
