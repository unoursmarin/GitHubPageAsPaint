import React, { useCallback, useEffect, useState } from 'react';

import { RUNNER_SECRET_NAME, WORKFLOW_FILE } from '../shared/art-config.js';
import { saveRunnerSecret } from '../setup/repo-setup.js';

const REFRESH_AFTER_DISPATCH_MS = 4000;
const RESULT_TEXT = { success: 'succeeded', failure: 'failed', cancelled: 'cancelled', skipped: 'skipped' };

/** State of the daily job in the user's repository, read through the Actions API. */
export function RunsPanel({ client, token, repo, onUninstall, busy }) {
  const [workflow, setWorkflow] = useState(null);
  const [runs, setRuns] = useState([]);
  const [hasSecret, setHasSecret] = useState(null);
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState({ text: '', tone: 'neutral' });
  const [removeFiles, setRemoveFiles] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextWorkflow, nextRuns] = await Promise.all([
        client.getWorkflow(token, repo.owner, repo.repo, WORKFLOW_FILE),
        client.listWorkflowRuns(token, repo.owner, repo.repo, WORKFLOW_FILE),
      ]);
      setWorkflow(nextWorkflow);
      setRuns(nextRuns);
    } catch (error) {
      setMessage({ text: `Cannot read the runs: ${error.message} Give your token "Actions: read" to see them.`, tone: 'error' });
    }
    client.hasRepoSecret(token, repo.owner, repo.repo, RUNNER_SECRET_NAME).then(setHasSecret, () => setHasSecret(null));
  }, [client, token, repo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(action, success) {
    setMessage({ text: '', tone: 'neutral' });
    try {
      await action();
      setMessage({ text: success, tone: 'success' });
    } catch (error) {
      setMessage({ text: error.message, tone: 'error' });
    }
  }

  const runNow = () => act(async () => {
    await client.dispatchWorkflow(token, repo.owner, repo.repo, WORKFLOW_FILE, repo.defaultBranch);
    setTimeout(refresh, REFRESH_AFTER_DISPATCH_MS);
  }, 'Run started. It shows up below in a few seconds.');

  const enable = () => act(async () => {
    await client.enableWorkflow(token, repo.owner, repo.repo, WORKFLOW_FILE);
    await refresh();
  }, 'Daily job enabled again.');

  const storeSecret = (event) => {
    event.preventDefault();
    act(async () => {
      await saveRunnerSecret({ client, token, repo, secretValue: secret.trim() });
      setSecret('');
      setHasSecret(true);
    }, 'Saved. The next run also counts your private contributions.');
  };

  const removeSecret = () => act(async () => {
    await client.deleteRepoSecret(token, repo.owner, repo.repo, RUNNER_SECRET_NAME);
    setHasSecret(false);
  }, 'Secret removed. Runs now read your public contributions only.');

  const uninstall = () => {
    const what = removeFiles ? 'the drawing, its daily job and every generated file' : 'the drawing and its daily job';
    if (window.confirm(`Remove ${what} from ${repo.fullName}? Commits already made stay in the history.`)) {
      onUninstall({ removeGeneratedFiles: removeFiles });
    }
  };

  const disabled = workflow && workflow.state !== 'active';
  const lastRun = runs[0];

  return (
    <div className="runs">
      <dl className="sync-stats">
        <div>
          <dt>Daily job</dt>
          <dd>{workflow ? (disabled ? 'Disabled' : 'Active') : 'Not found yet'}</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>
            {lastRun
              ? <a href={lastRun.htmlUrl} target="_blank" rel="noreferrer">{formatTime(lastRun.createdAt)}, {lastRun.status === 'completed' ? RESULT_TEXT[lastRun.conclusion] ?? lastRun.conclusion : 'running'}</a>
              : 'None yet'}
          </dd>
        </div>
        <div>
          <dt>Private contributions</dt>
          <dd>{hasSecret === null ? 'Unknown' : hasSecret ? 'Counted' : 'Not counted'}</dd>
        </div>
      </dl>

      <div className="actions">
        <button type="button" onClick={runNow} disabled={!workflow || disabled}>Run now</button>
        {disabled && <button className="secondary" type="button" onClick={enable}>Enable the daily job</button>}
        {workflow && <a className="button secondary" href={workflow.htmlUrl} target="_blank" rel="noreferrer">Open in Actions</a>}
      </div>
      {disabled && <p className="muted small">GitHub disables scheduled jobs after 60 days without activity in a repository.</p>}
      {message.text && <p className="status inline" data-tone={message.tone} role="status">{message.text}</p>}

      <details className="token-option">
        <summary>Count private contributions</summary>
        <form className="token-form" onSubmit={storeSecret}>
          <label>
            Read-only token
            <input type="password" autoComplete="off" spellCheck="false" value={secret} onChange={(event) => setSecret(event.target.value)} required />
          </label>
          <button type="submit" disabled={!secret.trim()}>Save as secret</button>
          {hasSecret && <button className="ghost" type="button" onClick={removeSecret}>Remove</button>}
        </form>
        <p className="muted small">
          Without it, the daily job only sees public contributions and may misjudge colors if you work a lot in private
          repositories. Use a separate token that can only read your profile (classic token with <code>read:user</code>).
          It is encrypted in this browser and stored as the <code>{RUNNER_SECRET_NAME}</code> secret of your repository.
        </p>
      </details>

      <details className="token-option danger-zone">
        <summary>Remove GitToPaint from {repo.repo}</summary>
        <label className="checkbox">
          <input type="checkbox" checked={removeFiles} onChange={(event) => setRemoveFiles(event.target.checked)} />
          Also delete the generated text files
        </label>
        <button className="danger" type="button" onClick={uninstall} disabled={busy}>Remove</button>
      </details>
    </div>
  );
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
