import fs from 'node:fs/promises';
import path from 'node:path';

import { sendJson } from './http.mjs';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

// Only the page and its built assets are public; server code, .data and node_modules are not.
const PUBLIC_FILES = new Set(['index.html', 'styles.css']);
const PUBLIC_DIRS = ['dist/'];

export function createStaticHandler(root) {
  return async function serveStatic(pathname, response) {
    const requested = (pathname === '/' ? 'index.html' : decodeURIComponent(pathname)).replace(/^\/+/, '');
    const isPublic = PUBLIC_FILES.has(requested) || PUBLIC_DIRS.some((dir) => requested.startsWith(dir));
    const resolved = path.resolve(root, requested);

    if (!isPublic || !resolved.startsWith(path.join(root, path.sep))) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    let content;
    try {
      content = await fs.readFile(resolved);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
      throw error;
    }

    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  };
}
