import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const KEY_SALT = 'githubpageaspaint:v1';
const CIPHER = 'aes-256-gcm';

export const EMPTY_STATE = Object.freeze({
  account: null,
  target: null,
  plan: {},
  futureWeeks: 20,
  lastSync: null,
});

export function deriveKey(secret) {
  return crypto.scryptSync(secret, KEY_SALT, 32);
}

/** Uses APP_SECRET when set, otherwise a random key persisted next to the state file. */
export async function resolveEncryptionKey({ appSecret, dataDir }) {
  if (appSecret) {
    return deriveKey(appSecret);
  }

  const keyPath = path.join(dataDir, 'secret.key');
  await fs.mkdir(dataDir, { recursive: true });
  try {
    return deriveKey(await fs.readFile(keyPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  await fs.writeFile(keyPath, secret, { mode: 0o600, flag: 'wx' });
  return deriveKey(secret);
}

export function encryptSecret(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), encrypted].map((part) =>
    typeof part === 'string' ? part : part.toString('base64url'),
  ).join('.');
}

export function decryptSecret(payload, key) {
  const [version, iv, tag, encrypted] = String(payload).split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) {
    throw new Error('Stored secret has an unknown format.');
  }
  const decipher = crypto.createDecipheriv(CIPHER, key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * Single-user JSON state on disk. Updates are serialized and written atomically
 * (temp file + rename) so a crash never leaves a half-written file.
 */
export async function createStore({ dataDir }) {
  const statePath = path.join(dataDir, 'state.json');
  await fs.mkdir(dataDir, { recursive: true });

  let state = EMPTY_STATE;
  try {
    state = { ...EMPTY_STATE, ...JSON.parse(await fs.readFile(statePath, 'utf8')) };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`Unable to read ${statePath}: ${error.message}`);
    }
  }

  let queue = Promise.resolve();

  async function persist(nextState) {
    const tempPath = `${statePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(nextState, null, 2), { mode: 0o600 });
    await fs.rename(tempPath, statePath);
  }

  return {
    get: () => state,
    update(updater) {
      const run = queue.then(async () => {
        const nextState = updater(state);
        await persist(nextState);
        state = nextState;
        return state;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
