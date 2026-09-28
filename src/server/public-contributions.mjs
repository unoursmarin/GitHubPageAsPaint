import { GitHubError } from './github-client.mjs';

/** Signed-out fallback: reads the public contribution fragment github.com renders for any user. */
export async function fetchPublicContributions(username, fetchImpl = fetch) {
  const upstream = await fetchImpl(`https://github.com/users/${encodeURIComponent(username)}/contributions`, {
    headers: { 'User-Agent': 'GitHubPageAsPaint/1.0' },
  });
  if (!upstream.ok) {
    throw new GitHubError(`GitHub responded with ${upstream.status}.`, upstream.status);
  }

  const entries = parseContributionHtml(await upstream.text());
  if (!entries.length) {
    throw new GitHubError('Unable to parse contribution data from GitHub.', 502);
  }
  return entries;
}

export function parseContributionHtml(html) {
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
