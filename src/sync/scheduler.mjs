const FIRST_RUN_DELAY_MS = 10_000;

/** Runs the sync engine shortly after startup, then every `intervalMinutes`. */
export function createScheduler({ engine, intervalMinutes, log = () => {}, timers = globalThis }) {
  const intervalMs = intervalMinutes * 60_000;
  let timer = null;
  let nextRunAt = null;

  function schedule(delayMs) {
    nextRunAt = new Date(Date.now() + delayMs);
    timer = timers.setTimeout(tick, delayMs);
    timer?.unref?.();
  }

  async function tick() {
    try {
      const result = await engine.runOnce({ trigger: 'schedule' });
      if (result.status === 'skipped') log(`sync skipped: ${result.reason}`);
    } catch (error) {
      log(`sync crashed: ${error.message}`);
    } finally {
      if (timer !== null) schedule(intervalMs);
    }
  }

  return {
    start() {
      if (timer === null) schedule(FIRST_RUN_DELAY_MS);
    },
    stop() {
      timers.clearTimeout(timer);
      timer = null;
      nextRunAt = null;
    },
    nextRunAt: () => nextRunAt,
  };
}
