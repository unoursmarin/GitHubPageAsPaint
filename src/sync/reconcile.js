// Pure reconciliation between the painted plan (target color level per day) and
// the contribution calendar GitHub currently renders. No network access here.

export const MAX_LEVEL = 4;

const GRAPHQL_LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

export function levelFromGraphql(value) {
  return GRAPHQL_LEVELS[value] ?? 0;
}

/**
 * Estimates the minimum daily count GitHub needs to render each level.
 * GitHub buckets non-zero days by quartiles, so thresholds are inferred from
 * what the calendar already shows, with a quartile fallback for unseen levels.
 * Returns [0, t1, t2, t3, t4], strictly increasing.
 */
export function estimateLevelThresholds(days) {
  const minCountAtLevel = Array(MAX_LEVEL + 1).fill(Infinity);
  const maxCountAtLevel = Array(MAX_LEVEL + 1).fill(0);

  for (const day of days) {
    if (day.level > 0 && day.level <= MAX_LEVEL) {
      minCountAtLevel[day.level] = Math.min(minCountAtLevel[day.level], day.count);
      maxCountAtLevel[day.level] = Math.max(maxCountAtLevel[day.level], day.count);
    }
  }

  const nonZeroCounts = days.map((day) => day.count).filter((count) => count > 0).sort((a, b) => a - b);
  const thresholds = [0];

  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const observed = minCountAtLevel[level];
    const fallback = Math.max(
      level === 1 ? 1 : quantile(nonZeroCounts, (level - 1) / MAX_LEVEL) + 1,
      maxCountAtLevel[level - 1] + 1,
    );
    const estimate = Number.isFinite(observed) ? observed : fallback;
    thresholds.push(Math.max(estimate, thresholds[level - 1] + 1));
  }

  return thresholds;
}

function quantile(sortedValues, ratio) {
  if (!sortedValues.length) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.floor(ratio * sortedValues.length));
  return sortedValues[index];
}

/**
 * Compares each planned day with what GitHub shows.
 * plan: { 'YYYY-MM-DD': targetLevel }, days: [{ date, count, level }], today: 'YYYY-MM-DD'.
 * Status: 'scheduled' (future), 'ok', 'pending' (needs commits), 'above' (darker than planned).
 */
export function reconcilePlan({ plan, days, today }) {
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const thresholds = estimateLevelThresholds(days);

  return Object.entries(plan)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, target]) => {
      if (date > today) {
        return { date, target, status: 'scheduled', actualLevel: null, count: null, commitsToAdd: 0 };
      }

      const actual = dayByDate.get(date) ?? { count: 0, level: 0 };
      const base = { date, target, actualLevel: actual.level, count: actual.count };

      if (actual.level === target) {
        return { ...base, status: 'ok', commitsToAdd: 0 };
      }
      if (actual.level > target) {
        return { ...base, status: 'above', commitsToAdd: 0 };
      }
      return { ...base, status: 'pending', commitsToAdd: Math.max(1, thresholds[target] - actual.count) };
    });
}

export function summarizeResults(results) {
  return results.reduce(
    (summary, result) => ({ ...summary, [result.status]: summary[result.status] + 1 }),
    { scheduled: 0, ok: 0, pending: 0, above: 0 },
  );
}

/** Turns pending results into individual commits, oldest day first, within a budget. */
export function allocateCommits(results, budget) {
  const commits = [];

  for (const result of results) {
    if (result.status !== 'pending') continue;
    const take = Math.min(result.commitsToAdd, budget - commits.length);
    for (let sequence = 1; sequence <= take; sequence += 1) {
      commits.push({ date: result.date, sequence });
    }
    if (commits.length >= budget) break;
  }

  return commits;
}
