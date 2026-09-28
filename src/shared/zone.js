// Time zone helpers built on Intl only, so they run the same in the browser and in Actions.

const MINUTES_PER_DAY = 24 * 60;

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date ('YYYY-MM-DD') of an instant as seen in the given time zone. */
export function dateInZone(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** UTC offset of the time zone at that instant, in minutes (Paris in summer: 120). */
export function offsetMinutes(instant, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** The UTC instant of a local wall-clock time (minutes after midnight) on a local date. */
export function zonedTimeToUtc(date, minutesOfDay, timeZone) {
  const wallClock = Date.parse(`${date}T00:00:00Z`) + minutesOfDay * 60_000;
  const firstGuess = wallClock - offsetMinutes(new Date(wallClock), timeZone) * 60_000;
  // A second pass settles instants close to a daylight-saving switch.
  return new Date(wallClock - offsetMinutes(new Date(firstGuess), timeZone) * 60_000);
}

export function shiftDate(date, days) {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * MINUTES_PER_DAY * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Daily cron expression (Actions cron is UTC) for a local time, using the offset in force at `now`.
 * Daylight saving later moves the run by one hour, which the catch-up window absorbs.
 */
export function dailyCronForLocalTime(minutesOfDay, timeZone, now = new Date()) {
  const utcMinutes = (((minutesOfDay - offsetMinutes(now, timeZone)) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${utcMinutes % 60} ${Math.floor(utcMinutes / 60)} * * *`;
}
