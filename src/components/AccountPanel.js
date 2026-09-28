import React, { useEffect, useRef, useState } from 'react';

import { api } from '../api.js';

const MIN_POLL_SECONDS = 5;

/** GitHub sign-in: OAuth device flow first, personal access token as a fallback. */
export function AccountPanel({ session, onSessionChange }) {
  const [flow, setFlow] = useState(null);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState({ text: '', tone: 'neutral' });
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef(null);

  useEffect(() => () => clearTimeout(pollTimer.current), []);

  const account = session?.account;

  async function startDeviceFlow() {
    setBusy(true);
    setMessage({ text: '', tone: 'neutral' });
    try {
      const started = await api('POST', '/api/auth/device/start');
      setFlow(started);
      schedulePoll(started.flowId, started.interval);
    } catch (error) {
      setMessage({ text: error.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function schedulePoll(flowId, intervalSeconds) {
    clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(() => pollDeviceFlow(flowId), Math.max(MIN_POLL_SECONDS, intervalSeconds) * 1000);
  }

  async function pollDeviceFlow(flowId) {
    try {
      const result = await api('POST', '/api/auth/device/poll', { flowId });
      if (result.status === 'pending') {
        schedulePoll(flowId, result.interval);
        return;
      }
      setFlow(null);
      if (result.status === 'complete') {
        onSessionChange(result.session);
        setMessage({ text: 'Connected.', tone: 'success' });
      } else {
        setMessage({ text: result.status === 'denied' ? 'Authorization was denied on GitHub.' : 'The code expired, start again.', tone: 'error' });
      }
    } catch (error) {
      setFlow(null);
      setMessage({ text: error.message, tone: 'error' });
    }
  }

  async function cancelDeviceFlow() {
    clearTimeout(pollTimer.current);
    const flowId = flow?.flowId;
    setFlow(null);
    if (flowId) await api('POST', '/api/auth/device/cancel', { flowId }).catch(() => {});
  }

  async function submitToken(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { session: next } = await api('POST', '/api/auth/token', { token });
      setToken('');
      onSessionChange(next);
      setMessage({ text: 'Connected.', tone: 'success' });
    } catch (error) {
      setMessage({ text: error.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    onSessionChange(await api('POST', '/api/auth/logout'));
    setMessage({ text: 'Disconnected. The stored token was deleted.', tone: 'neutral' });
  }

  if (account) {
    return (
      <div className="account">
        <img className="avatar" src={account.avatarUrl} alt="" width="40" height="40" />
        <div className="account-meta">
          <strong>{account.name}</strong>
          <span className="mono muted">
            @{account.login} · {account.method === 'oauth' ? 'GitHub sign-in' : 'personal token'}
          </span>
        </div>
        <button className="secondary" type="button" onClick={logout}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className="signin">
      {flow ? (
        <div className="device-code" aria-live="polite">
          <p>Enter this code on GitHub, then come back here. This page updates on its own.</p>
          <output className="code">{flow.userCode}</output>
          <div className="actions">
            <a className="button" href={flow.verificationUri} target="_blank" rel="noreferrer">Open github.com/login/device</a>
            <button className="secondary" type="button" onClick={() => navigator.clipboard?.writeText(flow.userCode)}>Copy code</button>
            <button className="ghost" type="button" onClick={cancelDeviceFlow}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" onClick={startDeviceFlow} disabled={busy || !session?.oauthEnabled}>
            Connect with GitHub
          </button>
          {!session?.oauthEnabled && (
            <span className="muted small">GitHub sign-in needs <code>GITHUB_CLIENT_ID</code> in <code>.env</code>. Use a token meanwhile.</span>
          )}
        </div>
      )}

      <details className="token-option" open={session && !session.oauthEnabled}>
        <summary>Use a personal access token instead</summary>
        <form className="token-form" onSubmit={submitToken}>
          <label>
            Token
            <input
              type="password"
              autoComplete="off"
              spellCheck="false"
              placeholder="ghp_… or github_pat_…"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy || !token.trim()}>Connect</button>
        </form>
        <p className="muted small">
          Classic token with the <code>public_repo</code> scope (or <code>repo</code> for private repositories), or a
          fine-grained token with <em>Contents: read and write</em>. It is stored encrypted on this machine only.
        </p>
      </details>

      {message.text && <p className="status inline" data-tone={message.tone} role="status">{message.text}</p>}
    </div>
  );
}
