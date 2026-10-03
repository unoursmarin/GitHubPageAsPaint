// GitHub OAuth device flow from the browser, through the CORS relay in worker/.
// The user types a short code on github.com; the page then receives an access token.

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SLOW_DOWN_STEP_SECONDS = 5;
const MIN_INTERVAL_SECONDS = 5;

export class DeviceFlowError extends Error {}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new DeviceFlowError('Sign-in cancelled.'));
  }, { once: true });
});

export function createDeviceFlow({ clientId, relayUrl, scopes, fetchImpl = fetch, wait = sleep }) {
  const base = relayUrl.replace(/\/+$/, '');

  async function post(path, body) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, ...body }),
      });
    } catch {
      throw new DeviceFlowError('Could not reach the sign-in relay. Check your connection, or use a personal access token.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !data.error) throw new DeviceFlowError(`GitHub sign-in failed (${response.status}).`);
    return data;
  }

  return {
    async start() {
      const data = await post('/device/code', { scope: scopes });
      if (data.error || !data.device_code) throw new DeviceFlowError(data.error_description || data.error || 'GitHub sign-in failed.');
      return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        interval: Math.max(data.interval ?? MIN_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS),
        expiresAt: Date.now() + data.expires_in * 1000,
      };
    },

    /** Polls until the user approves. Resolves with the access token. */
    async waitForToken(flow, { signal } = {}) {
      let interval = flow.interval;
      while (Date.now() < flow.expiresAt) {
        await wait(interval * 1000, signal);
        const data = await post('/device/token', { device_code: flow.deviceCode, grant_type: DEVICE_GRANT });
        if (data.access_token) return data.access_token;
        switch (data.error) {
          case 'authorization_pending':
            break;
          case 'slow_down':
            interval = data.interval ?? interval + SLOW_DOWN_STEP_SECONDS;
            break;
          case 'expired_token':
            throw new DeviceFlowError('The code expired. Start again.');
          case 'access_denied':
            throw new DeviceFlowError('Authorization was denied on GitHub.');
          default:
            throw new DeviceFlowError(data.error_description || 'GitHub sign-in failed.');
        }
      }
      throw new DeviceFlowError('The code expired. Start again.');
    },
  };
}
