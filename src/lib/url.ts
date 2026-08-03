/**
 * Normalize a URL for deduplication and consistent storage.
 * - Converts Instagram deep links to web URLs
 * - Forces https://
 * - Strips www.
 * - Removes trailing slashes from pathname
 * - Strips tracking / query params
 */
export function normalizeUrl(raw: string): string {
  let url = raw.trim();

  // Convert instagram:// deep links to web URLs
  // instagram://reel/CODE → https://www.instagram.com/reel/CODE/
  const deepLinkMatch = url.match(/^instagram:\/\/(?:media\?id=\d+|(reel|p|tv|stories)\/([A-Za-z0-9_-]+))/i);
  if (deepLinkMatch) {
    const type = deepLinkMatch[1] || 'p';
    const code = deepLinkMatch[2];
    if (code) {
      url = `https://www.instagram.com/${type}/${code}/`;
    }
  }

  try {
    const u = new URL(url);

    // Force https
    u.protocol = 'https:';

    // Strip www.
    u.hostname = u.hostname.replace(/^www\./, '');

    // Remove trailing slashes from pathname (keep root "/")
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';

    // Strip tracking / query params
    const trackingParams = [
      'igsh', 'igshid',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'ref', 'si',
    ];
    let changed = false;
    for (const p of trackingParams) {
      if (u.searchParams.has(p)) {
        u.searchParams.delete(p);
        changed = true;
      }
    }
    if (changed) url = u.toString();
  } catch {
    /* not a valid URL, return as-is */
  }

  return url;
}
