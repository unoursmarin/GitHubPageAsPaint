import React, { useEffect, useState } from 'react';

import { api } from '../api.js';

const DEFAULT_FOLDER = '.github-page-as-paint';

/** Picks the repository and folder the sync publishes into. */
export function TargetPanel({ session, onSessionChange }) {
  const target = session?.target;
  const [repos, setRepos] = useState(null);
  const [selected, setSelected] = useState(target ? `${target.owner}/${target.repo}` : '');
  const [folder, setFolder] = useState(target?.folder ?? DEFAULT_FOLDER);
  const [message, setMessage] = useState({ text: '', tone: 'neutral' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('GET', '/api/repos')
      .then(({ repos: list }) => {
        if (!cancelled) setRepos(list);
      })
      .catch((error) => {
        if (!cancelled) setMessage({ text: error.message, tone: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [session?.account?.login]);

  async function save(event) {
    event.preventDefault();
    const [owner, repo] = selected.split('/');
    setBusy(true);
    try {
      onSessionChange(await api('PUT', '/api/target', { owner, repo, folder }));
      setMessage({ text: 'Target saved.', tone: 'success' });
    } catch (error) {
      setMessage({ text: error.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const isDirty = !target || selected !== `${target.owner}/${target.repo}` || folder.trim() !== target.folder;

  return (
    <form className="target-form" onSubmit={save}>
      <label>
        Repository
        <select value={selected} onChange={(event) => setSelected(event.target.value)} required disabled={!repos}>
          <option value="" disabled>{repos ? 'Choose a repository' : 'Loading your repositories…'}</option>
          {repos?.map((repo) => (
            <option key={repo.fullName} value={repo.fullName}>
              {repo.fullName}{repo.private ? ' (private)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Folder for the generated files
        <input
          type="text"
          autoComplete="off"
          spellCheck="false"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder={DEFAULT_FOLDER}
          required
        />
      </label>
      <div className="actions">
        <button type="submit" disabled={busy || !selected || !isDirty}>Save target</button>
      </div>
      <p className="muted small target-note">
        {target
          ? <>Publishing to <code>{target.owner}/{target.repo}</code> on <code>{target.branch}</code> in <code>{target.folder}/</code>.</>
          : 'Only repositories you can push to are listed. Forks and archived repositories are hidden.'}
        {' '}Commits always go to the default branch, the only one GitHub counts.
        {target?.private && ' Private repositories only show on your wall if "Private contributions" is enabled on your profile.'}
      </p>
      {message.text && <p className="status inline" data-tone={message.tone} role="status">{message.text}</p>}
    </form>
  );
}
