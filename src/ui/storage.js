// The token lives in sessionStorage (gone when the tab closes); only the repository name
// is remembered across visits. Storage can be unavailable (private mode, blocked site data).

const TOKEN_KEY = 'gitToPaint.token';
const REPO_KEY = 'gitToPaint.repo';

function read(storage, key) {
  try {
    return globalThis[storage]?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value === null) globalThis[storage]?.removeItem(key);
    else globalThis[storage]?.setItem(key, value);
  } catch {
    // Not persisted; the app still works for this visit.
  }
}

export const loadToken = () => read('sessionStorage', TOKEN_KEY);
export const saveToken = (token) => write('sessionStorage', TOKEN_KEY, token);
export const loadRememberedRepo = () => read('localStorage', REPO_KEY);
export const rememberRepo = (name) => write('localStorage', REPO_KEY, name);
