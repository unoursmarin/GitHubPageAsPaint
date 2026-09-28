export const FUTURE_LEVEL_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toIsoDate(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfWeek(date) {
  return addDays(date, -date.getUTCDay());
}

export function monthLabel(date) {
  return date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

export function cycleFutureIntensity(level) {
  return (level + 1) % FUTURE_LEVEL_COLORS.length;
}

export function purpleLevelForCount(count, maxCount) {
  if (!count || !maxCount) {
    return 0;
  }

  const ratio = count / maxCount;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

export function buildPlannerGrid({ today = new Date(), futureWeeks = 20, pastEntries = [] } = {}) {
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = addDays(startOfWeek(todayUtc), -52 * 7);
  const end = addDays(startOfWeek(todayUtc), futureWeeks * 7 + 6);
  const pastMap = new Map(pastEntries.map((entry) => [entry.date, entry]));
  const maxCount = Math.max(0, ...pastEntries.map((entry) => entry.count || 0));
  const weeks = [];

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 7)) {
    const days = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(cursor, offset);
      const iso = toIsoDate(date);
      const isFuture = date > todayUtc;
      const past = pastMap.get(iso);

      days.push({
        date: iso,
        dayIndex: offset,
        month: monthLabel(date),
        isFuture,
        count: past?.count ?? 0,
        level: isFuture ? 0 : purpleLevelForCount(past?.count ?? 0, maxCount),
        kind: isFuture ? 'future' : 'past',
      });
    }

    weeks.push({
      key: days[0].date,
      month: days[0].month,
      days,
    });
  }

  return weeks;
}

export function serializePlan(planMap) {
  return [...planMap.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }));
}

export function buildSchedulePayload({ username, owner, repo, branch, plan }) {
  return {
    username,
    repository: {
      owner,
      repo,
      branch,
    },
    generatedAt: new Date().toISOString(),
    entries: serializePlan(plan),
  };
}

export function expandScheduleEntries(entries) {
  return entries.flatMap((entry) =>
    Array.from({ length: entry.count }, (_, index) => ({
      date: entry.date,
      sequence: index + 1,
    })),
  );
}
