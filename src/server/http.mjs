const MAX_BODY_BYTES = 256 * 1024;
export const CLIENT_HEADER = 'x-requested-with';
export const CLIENT_HEADER_VALUE = 'GitHubPageAsPaint';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

/**
 * Cross-site pages cannot set a custom header without a CORS preflight, which this
 * server never answers, so requiring it blocks CSRF on every state-changing route.
 */
export function assertSameOriginWrite(request) {
  if (request.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
    throw new HttpError(403, 'Missing client header.');
  }
  const origin = request.headers.origin;
  if (origin && new URL(origin).host !== request.headers.host) {
    throw new HttpError(403, 'Cross-origin requests are not allowed.');
  }
}

export async function readJson(request) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected a JSON body.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}
