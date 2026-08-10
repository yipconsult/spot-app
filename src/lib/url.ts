/**
 * Normalize a URL for deduplication and consistent storage.
 * - Converts Instagram deep links to web URLs
 * - Forces https://
 * - Strips www.
 * - Removes trailing slashes from pathname
 * - Strips ALL query params for social platforms (they're only tracking noise)
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

    // Strip known tracking params
    const trackingParams = [
      'igsh', 'igshid',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'ref', 'si',
    ];
    for (const p of trackingParams) {
      if (u.searchParams.has(p)) u.searchParams.delete(p);
    }

    // For social platforms, strip ALL remaining query params — they're only tracking noise
    const socialDomains = [
      'instagram.com', 'threads.net',
      'facebook.com', 'fb.com',
      'youtube.com', 'youtu.be',
      'xhslink.com', 'xiaohongshu.com',
    ];
    if (socialDomains.some(d => u.hostname.includes(d))) {
      u.search = '';
    }

    // ALWAYS update url — protocol/www/pathname changes must persist even without params
    url = u.toString();
  } catch {
    /* not a valid URL, return as-is */
  }

  return url;
}
