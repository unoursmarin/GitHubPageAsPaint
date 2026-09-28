import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);

    if (url.pathname === '/api/contributions') {
      await handleContributionRequest(url, response);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Method not allowed' });
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

  const upstream = await fetch(`https://github.com/users/${encodeURIComponent(username)}/contributions`);
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
  const pattern =
    /<td[^>]*data-date="([^"]+)"[^>]*id="([^"]+)"[^>]*data-level="(\d)"[^>]*><\/td>\s*<tool-tip[^>]*for="\2"[^>]*>([^<]+)<\/tool-tip>/g;
  const entries = [];

  for (const match of html.matchAll(pattern)) {
    const [, date, , levelText, tooltip] = match;
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

  if (!resolvedPath.startsWith(root)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  const extension = path.extname(resolvedPath);
  const content = await fs.readFile(resolvedPath);
  response.writeHead(200, {
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
  });
  response.end(content);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}
