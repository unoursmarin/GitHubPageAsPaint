import crypto from 'node:crypto';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SLOW_DOWN_STEP_SECONDS = 5;

export class DeviceFlowError extends Error {}

/**
 * GitHub OAuth Device Flow. The device_code never leaves the server: the browser
 * only gets an opaque flowId plus the short user code to type on github.com.
 */
export function createDeviceFlow({ clientId, scopes, fetchImpl = fetch, now = () => Date.now() }) {
  const flows = new Map();

  async function post(url, params) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GitHubPageAsPaint/1.0',
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!response.ok) {
      throw new DeviceFlowError(`GitHub sign-in failed (${response.status}).`);
    }
    return response.json();
  }

  function pruneExpired() {
    for (const [flowId, flow] of flows) {
      if (flow.expiresAt <= now()) flows.delete(flowId);
    }
  }

  return {
    isEnabled: () => Boolean(clientId),

    async start() {
      if (!clientId) {
        throw new DeviceFlowError('GITHUB_CLIENT_ID is not set. Add your OAuth App client id to .env.');
      }
      pruneExpired();

      const data = await post(DEVICE_CODE_URL, { client_id: clientId, scope: scopes });
      if (data.error) {
        throw new DeviceFlowError(data.error_description || `GitHub sign-in failed (${data.error}).`);
      }

      const flowId = crypto.randomUUID();
      flows.set(flowId, {
        deviceCode: data.device_code,
        interval: data.interval,
        expiresAt: now() + data.expires_in * 1000,
      });

      return {
        flowId,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        interval: data.interval,
        expiresIn: data.expires_in,
      };
    },

    async poll(flowId) {
      const flow = flows.get(flowId);
      if (!flow || flow.expiresAt <= now()) {
        flows.delete(flowId);
        return { status: 'expired' };
      }

      const data = await post(ACCESS_TOKEN_URL, {
        client_id: clientId,
        device_code: flow.deviceCode,
        grant_type: DEVICE_GRANT,
      });

      if (data.access_token) {
        flows.delete(flowId);
        return { status: 'complete', token: data.access_token };
      }

      switch (data.error) {
        case 'authorization_pending':
          return { status: 'pending', interval: flow.interval };
        case 'slow_down': {
          flow.interval = data.interval ?? flow.interval + SLOW_DOWN_STEP_SECONDS;
          return { status: 'pending', interval: flow.interval };
        }
        case 'expired_token':
          flows.delete(flowId);
          return { status: 'expired' };
        case 'access_denied':
          flows.delete(flowId);
          return { status: 'denied' };
        default:
          flows.delete(flowId);
          throw new DeviceFlowError(data.error_description || 'GitHub sign-in failed.');
      }
    },

    cancel(flowId) {
      flows.delete(flowId);
    },
  };
}
