// CORS relay for GitHub's OAuth device flow. github.com/login/* sends no CORS headers, so a browser on
// GitHub Pages cannot call it directly. The device flow needs no client secret: this relay holds none,
// answers only the page's origin, and only forwards the two device-flow calls for our own client id.

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const ALLOWED_SCOPES = new Set(['read:user', 'public_repo', 'repo', 'workflow']);
const MAX_BODY_BYTES = 2048;

const ROUTES = {
  '/device/code': { url: DEVICE_CODE_URL, fields: ['client_id', 'scope'] },
  '/device/token': { url: ACCESS_TOKEN_URL, fields: ['client_id', 'device_code', 'grant_type'] },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

function scopesAreAllowed(scope) {
  const scopes = String(scope ?? '').split(/[\s,]+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((item) => ALLOWED_SCOPES.has(item));
}

function validate(route, fields, env) {
  if (fields.client_id !== env.GITHUB_CLIENT_ID) return 'Unknown client.';
  if (route === '/device/code' && !scopesAreAllowed(fields.scope)) return 'Scope not allowed.';
  if (route === '/device/token' && (typeof fields.device_code !== 'string' || fields.grant_type !== DEVICE_GRANT)) {
    return 'Invalid device grant.';
  }
  return null;
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('Origin');
  if (!env.ALLOWED_ORIGIN || !env.GITHUB_CLIENT_ID) return json({ error: 'Relay is not configured.' }, 500, 'null');
  if (origin !== env.ALLOWED_ORIGIN) return json({ error: 'Origin not allowed.' }, 403, 'null');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const route = ROUTES[new URL(request.url).pathname];
  if (!route) return json({ error: 'Not found.' }, 404, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Body too large.' }, 413, origin);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400, origin);
  }

  const fields = Object.fromEntries(route.fields.map((name) => [name, body?.[name]]));
  const problem = validate(new URL(request.url).pathname, fields, env);
  if (problem) return json({ error: problem }, 400, origin);

  const upstream = await fetchImpl(route.url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GitToPaint-relay' },
    body: new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== undefined)).toString(),
  });
  return json(await upstream.json().catch(() => ({ error: 'bad_upstream' })), upstream.ok ? 200 : 502, origin);
}

export default { fetch: (request, env) => handleRequest(request, env) };
