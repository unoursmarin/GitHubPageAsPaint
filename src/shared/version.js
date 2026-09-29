// Bump when the engine or the workflow template changes; the app then offers an update.
export const ENGINE_VERSION = '1.0.0';
export const ENGINE_BANNER_PREFIX = '// git-to-paint-engine v';

export function readEngineVersion(source) {
  const firstLine = String(source).split('\n', 1)[0];
  return firstLine.startsWith(ENGINE_BANNER_PREFIX) ? firstLine.slice(ENGINE_BANNER_PREFIX.length).trim() : null;
}
