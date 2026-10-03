import React, { useState } from 'react';

const CLASSIC_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=public_repo,workflow&description=GitToPaint';
const FINE_GRAINED_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** Sign in with GitHub (device flow) or with a personal access token. Tokens only go to api.github.com. */
export function SignInPanel({ viewer, busy, error, onSignIn, onSignOut, oauth }) {
  const [token, setToken] = useState('');

  if (viewer) {
    return (
      <div className="account">
        <img className="avatar" src={viewer.avatarUrl} alt="" width="40" height="40" />
        <div className="account-meta">
          <strong>{viewer.name}</strong>
          <span className="mono muted">@{viewer.login}</span>
        </div>
        <button className="secondary" type="button" onClick={onSignOut}>Sign out</button>
      </div>
    );
  }

  function submit(event) {
    event.preventDefault();
    onSignIn(token);
    setToken('');
  }

  const tokenForm = (
    <>
      <form className="token-form" onSubmit={submit}>
        <label>
          Personal access token
          <input
            type="password"
            autoComplete="off"
            spellCheck="false"
            placeholder="github_pat_… or ghp_…"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
      </form>
      <details className="token-option">
        <summary>Which token do I need?</summary>
        <div className="token-help">
          <p>
            <a href={FINE_GRAINED_TOKEN_URL} target="_blank" rel="noreferrer">Fine-grained token</a> (recommended), on the
            repository that will hold your drawing:
          </p>
          <ul>
            <li><strong>Contents</strong> and <strong>Workflows</strong>: read and write (required)</li>
            <li><strong>Actions</strong>: read and write, to see runs and start one now</li>
            <li><strong>Secrets</strong>: read and write, only to count private contributions</li>
            <li><strong>Administration</strong>: read and write on all repositories, only to create <code>gitToPaint</code> for you</li>
          </ul>
          <p>
            Or a <a href={CLASSIC_TOKEN_URL} target="_blank" rel="noreferrer">classic token</a> with <code>public_repo</code> and{' '}
            <code>workflow</code>.
          </p>
          <p className="muted">
            The token stays in this tab and is only sent to api.github.com. Closing the tab forgets it. Your drawing and its daily
            job live in your own repository.
          </p>
        </div>
      </details>
    </>
  );

  return (
    <div className="signin">
      {oauth?.available && (
        <div className="oauth">
          {oauth.pending ? (
            <div className="device-code" role="status">
              <p>
                Enter this code on <a href={oauth.pending.verificationUri} target="_blank" rel="noreferrer">github.com/login/device</a>:
              </p>
              <strong className="mono code">{oauth.pending.userCode}</strong>
              <p className="muted">Waiting for your approval…</p>
              <button className="secondary" type="button" onClick={oauth.onCancel}>Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={oauth.onStart} disabled={busy}>Sign in with GitHub</button>
          )}
        </div>
      )}
      {error && <p className="status inline" data-tone="error" role="alert">{error}</p>}
      {oauth?.available ? (
        <details className="token-option">
          <summary>Use a personal access token instead</summary>
          {tokenForm}
        </details>
      ) : tokenForm}
    </div>
  );
}
