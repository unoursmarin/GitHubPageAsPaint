// The server rejects state-changing requests without this header (CSRF guard).
const CLIENT_HEADERS = { 'X-Requested-With': 'GitHubPageAsPaint' };

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** JSON call to the local server. Non-GET requests always send a JSON body. */
export async function api(method, path, body) {
  const hasBody = method !== 'GET';
  const response = await fetch(path, {
    method,
    headers: hasBody ? { ...CLIENT_HEADERS, 'Content-Type': 'application/json' } : CLIENT_HEADERS,
    body: hasBody ? JSON.stringify(body ?? {}) : undefined,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Keep the empty payload; the status code below still describes the failure.
  }
  if (!response.ok) {
    throw new ApiError(payload.error || `Request failed (${response.status}).`, response.status);
  }
  return payload;
}
