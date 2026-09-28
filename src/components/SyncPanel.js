import React, { useEffect, useState } from 'react';

import { api } from '../api.js';

const POLL_RUNNING_MS = 3000;
const POLL_IDLE_MS = 60_000;
const STATUS_LABELS = { ok: 'reached', pending: 'in progress', above: 'too dark', scheduled: 'upcoming' };

/** Shows the scheduler state and lets the user trigger a run. Keeps `sync` fresh through polling. */
export function SyncPanel({ sync, canSync, onSyncChange, onExport }) {
  const [message, setMessage] = useState('');
  const running = sync?.running;

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        onSyncChange(await api('GET', '/api/sync/status'));
      } catch {
        // A missed refresh is harmless; the next tick retries.
      }
    }, running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => clearTimeout(timer);
  }, [sync, running, onSyncChange]);

  async function runNow() {
    setMessage('');
    try {
      const result = await api('POST', '/api/sync/run');
      if (!result.started) setMessage(result.reason);
      onSyncChange(await api('GET', '/api/sync/status'));
    } catch (error) {
      setMessage(error.message);
    }
  }

  const last = sync?.lastSync;

  return (
    <div className="sync">
      <dl className="sync-stats">
        <div>
          <dt>State</dt>
          <dd>{running ? <span className="pulse">Publishing…</span> : 'Idle'}</dd>
        </div>
        <div>
          <dt>Next check</dt>
          <dd>{sync?.nextRunAt ? formatTime(sync.nextRunAt) : '—'}</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>{last ? `${formatTime(last.finishedAt ?? last.startedAt)} · ${last.commits} commit${last.commits === 1 ? '' : 's'}` : 'Never'}</dd>
        </div>
      </dl>

      {last?.summary && (
        <ul className="day-summary" aria-label="Painted days by state">
          {Object.entries(last.summary).map(([status, count]) => (
            <li key={status} data-status={status}>
              <span className="swatch" aria-hidden="true"></span>
              <strong>{count}</strong> {STATUS_LABELS[status]}
            </li>
          ))}
        </ul>
      )}
      {last?.error && <p className="status inline" data-tone="error" role="alert">Last run failed: {last.error}</p>}

      <div className="actions">
        <button type="button" onClick={runNow} disabled={!canSync || running}>Sync now</button>
        <button className="secondary" type="button" onClick={onExport}>Export schedule.json</button>
      </div>
      {!canSync && <p className="muted small">Connect GitHub, choose a target and paint at least one day to enable syncing.</p>}
      {message && <p className="status inline" role="status">{message}</p>}

      {sync?.log?.length > 1 && (
        <details className="sync-log">
          <summary>Recent runs</summary>
          <ol>
            {sync.log.map((entry) => (
              <li key={entry.startedAt}>
                <span className="mono">{formatTime(entry.startedAt)}</span>
                <span>{entry.trigger}</span>
                <span>{entry.error ? `failed: ${entry.error}` : `${entry.commits} commit${entry.commits === 1 ? '' : 's'}`}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
