import React, { useState } from 'react';

import { DEFAULT_REPO_NAME } from '../shared/art-config.js';

/**
 * Where the drawing lives. Shows the located repository, or offers to create the default
 * gitToPaint repository or to pick one of the user's own repositories.
 */
export function RepoPanel({ repo, others, hasConfig, folder, onFolderChange, busy, onCreateDefault, onChooseRepo, onListRepos }) {
  const [repos, setRepos] = useState(null);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState('');
  const [listError, setListError] = useState('');

  async function openPicker() {
    setPicking(true);
    setListError('');
    try {
      setRepos(await onListRepos());
    } catch (error) {
      setListError(error.message);
    }
  }

  function choose(event) {
    event.preventDefault();
    const chosen = repos?.find((candidate) => candidate.fullName === selected);
    if (chosen) {
      onChooseRepo(chosen);
      setPicking(false);
    }
  }

  const picker = picking && (
    <form className="repo-picker" onSubmit={choose}>
      <label>
        Your repositories
        <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={!repos} required>
          <option value="" disabled>{repos ? 'Choose a repository' : 'Loading…'}</option>
          {repos?.map((candidate) => (
            <option key={candidate.fullName} value={candidate.fullName}>
              {candidate.fullName}{candidate.private ? ' (private)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit" disabled={!selected}>Use this repository</button>
        <button className="ghost" type="button" onClick={() => setPicking(false)}>Cancel</button>
      </div>
      {listError && <p className="status inline" data-tone="error" role="alert">{listError}</p>}
      {repos && !repos.length && <p className="muted small">No repository you own and can push to. Create gitToPaint instead.</p>}
    </form>
  );

  if (!repo) {
    return (
      <div className="repo-panel">
        <p>
          You have no drawing yet. GitToPaint stores it, with the job that paints it every day, in a repository of yours.
        </p>
        <div className="actions">
          <button type="button" onClick={onCreateDefault} disabled={busy}>Create {DEFAULT_REPO_NAME}</button>
          <button className="secondary" type="button" onClick={openPicker} disabled={busy || picking}>Use an existing repository</button>
        </div>
        <p className="muted small">
          {DEFAULT_REPO_NAME} is created public, so its commits show on your wall without any profile setting.
        </p>
        {picker}
      </div>
    );
  }

  return (
    <div className="repo-panel">
      <p>
        {hasConfig ? 'Drawing found in ' : 'Your drawing will be saved in '}
        <a href={repo.htmlUrl ?? `https://github.com/${repo.fullName}`} target="_blank" rel="noreferrer"><code>{repo.fullName}</code></a>
        {' '}on <code>{repo.defaultBranch}</code>.
      </p>
      {others.length > 0 && (
        <p className="muted small">Other repositories also hold a drawing and are ignored: {others.join(', ')}.</p>
      )}
      <label className="folder-field">
        Folder for the generated files
        <input
          type="text"
          autoComplete="off"
          spellCheck="false"
          value={folder}
          onChange={(event) => onFolderChange(event.target.value)}
          required
        />
      </label>
      {repo.private && (
        <p className="muted small">
          This repository is private: its commits only show on your wall if "Private contributions" is enabled on your profile.
        </p>
      )}
      {!picking && !hasConfig && (
        <button className="ghost" type="button" onClick={openPicker} disabled={busy}>Use another repository</button>
      )}
      {picker}
    </div>
  );
}
