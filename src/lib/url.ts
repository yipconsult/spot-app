/**
 * Normalize a URL for deduplication and consistent storage.
 * - Converts deep links (instagram://, openrice://) to web URLs
 * - Forces https://
 * - Strips www.
 * - Removes trailing slashes from pathname
 * - Strips tracking params (all platforms)
 * - Strips ALL query params for platforms where they're only tracking noise
 */
export function normalizeUrl(raw: string): string {
  let url = raw.trim();

  // Convert deep links to web URLs
  const instagramDeep = url.match(/^instagram:\/\/(?:media\?id=\d+|(reel|p|tv|stories)\/([A-Za-z0-9_-]+))/i);
  if (instagramDeep) {
    const type = instagramDeep[1] || 'p';
    const code = instagramDeep[2];
    if (code) url = `https://www.instagram.com/${type}/${code}/`;
  }

  // openrice://r/ID → https://www.openrice.com/hongkong/restaurant/ID
  if (url.startsWith('openrice://')) {
    url = url.replace('openrice://', 'https://www.openrice.com/');
  }

  try {
    const u = new URL(url);

    // Force https
    u.protocol = 'https:';

    // Strip www.
    u.hostname = u.hostname.replace(/^www\./, '');

    // Remove trailing slashes from pathname (keep root "/")
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';

    // Strip known tracking params (all platforms)
    const trackingParams = [
      'igsh', 'igshid',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'ref', 'si',
    ];
    for (const p of trackingParams) {
      if (u.searchParams.has(p)) u.searchParams.delete(p);
    }

    // Platforms where ALL query params are tracking-only — safe to strip completely.
    // OpenRice and Google Maps intentionally excluded — they have meaningful params.
    const socialDomains = [
      'instagram.com', 'threads.net',
      'facebook.com', 'fb.com', 'fb.watch',
      'youtube.com', 'youtu.be',
      'xhslink.com', 'xiaohongshu.com',
      'pin.it', 'pinterest.com',
      'dianping.com', 'dpurl.cn',
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
