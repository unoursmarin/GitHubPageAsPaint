import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (url.pathname === '/api/contributions') {
      await handleContributionRequest(url, response);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`GitHubPageAsPaint listening on http://127.0.0.1:${port}`);
});

async function handleContributionRequest(url, response) {
  const username = url.searchParams.get('username')?.trim();
  if (!username) {
    sendJson(response, 400, { error: 'username is required' });
    return;
  }

  const upstream = await fetch(`https://github.com/users/${encodeURIComponent(username)}/contributions`, {
    headers: {
      'User-Agent': 'GitHubPageAsPaint/1.0',
    },
  });
  if (!upstream.ok) {
    sendJson(response, upstream.status, { error: `GitHub responded with ${upstream.status}` });
    return;
  }

  const html = await upstream.text();
  const entries = parseContributionHtml(html);
  if (!entries.length) {
    sendJson(response, 502, { error: 'Unable to parse contribution data from GitHub.' });
    return;
  }

  sendJson(response, 200, { entries });
}

function parseContributionHtml(html) {
  const tooltipById = new Map(
    [...html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]+)<\/tool-tip>/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const titleById = new Map(
    [...html.matchAll(/<(?:rect|td)[^>]*id="([^"]+)"[^>]*>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<\/(?:rect|td)>/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const pattern = /<(?:rect|td)[^>]*data-date="([^"]+)"[^>]*id="([^"]+)"[^>]*data-level="(\d)"[^>]*>/g;
  const entries = [];

  for (const match of html.matchAll(pattern)) {
    const [, date, id, levelText] = match;
    const tooltip = tooltipById.get(id) || titleById.get(id) || '';
    const countMatch = tooltip.match(/([\d,]+)\s+contribution/i);
    const count = countMatch ? Number(countMatch[1].replaceAll(',', '')) : 0;

    entries.push({
      date,
      count,
      level: Number(levelText),
    });
  }

  return entries;
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = requestedPath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(root, safePath);
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (resolvedPath !== root && !resolvedPath.startsWith(normalizedRoot)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  const extension = path.extname(resolvedPath);
  let content;

  try {
    content = await fs.readFile(resolvedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    throw error;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}
