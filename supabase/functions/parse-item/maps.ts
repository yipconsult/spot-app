// Google Maps and OpenRice URL resolvers
import type { GmapsExtracted } from './types.ts';

export function extractFromGoogleMapsUrl(url: string): GmapsExtracted {
  const result: GmapsExtracted = { placeName: null, lat: null, lng: null, resolvedUrl: url };
  try {
    const decoded = decodeURIComponent(url);
    const placeMatch = decoded.match(/\/place\/([^/@]+?)(?:\/@|$|\/data=)/);
    if (placeMatch) {
      result.placeName = placeMatch[1].replace(/\+/g, ' ').trim();
    }
    const coordsMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+),\d+z/);
    if (coordsMatch) {
      result.lat = parseFloat(coordsMatch[1]);
      result.lng = parseFloat(coordsMatch[2]);
    }
    if (!result.placeName) {
      const searchMatch = decoded.match(/\/search\/([^/@]+?)(?:\/@|$|\/data=)/);
      if (searchMatch) {
        result.placeName = searchMatch[1].replace(/\+/g, ' ').trim();
      }
    }
    if (!result.placeName) {
      const qMatch = decoded.match(/[?&]q=([^&]+)/);
      if (qMatch) {
        result.placeName = decodeURIComponent(qMatch[1]).replace(/\+/g, ' ').trim();
      }
    }
  } catch { /* URL parsing failed */ }
  return result;
}

export async function resolveGoogleMapsShortLink(shortUrl: string): Promise<string> {
  try {
    const res = await fetch(shortUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
      redirect: "follow",
    });

    if (res.url && res.url !== shortUrl && res.url.includes('google.com/maps')) {
      console.log(`[GoogleMaps] Short link resolved to: ${res.url}`);
      return res.url;
    }

    try {
      const expandRes = await fetch(`https://unshorten.me/json/${encodeURIComponent(shortUrl)}`);
      if (expandRes.ok) {
        const expandData = await expandRes.json() as { resolved_url?: string };
        if (expandData.resolved_url && expandData.resolved_url.includes('google.com/maps')) {
          console.log(`[GoogleMaps] Short link resolved via expander: ${expandData.resolved_url}`);
          return expandData.resolved_url;
        }
      }
    } catch { /* ignore */ }

    return shortUrl;
  } catch (err) {
    console.log(`[GoogleMaps] Short link resolution failed:`, err);
    return shortUrl;
  }
}

export async function resolveOpenRiceShortLink(shortUrl: string): Promise<string> {
  try {
    console.log(`[OpenRice] Resolving short link: ${shortUrl}`);
    const res1 = await fetch(shortUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-HK,en;q=0.9,zh-HK;q=0.8,zh;q=0.7",
      },
      redirect: "manual",
    });

    if ([301, 302, 303, 307, 308].includes(res1.status)) {
      const location = res1.headers.get("Location");
      if (location && location.includes('openrice.com') && !location.includes('s.openrice.com')) {
        console.log(`[OpenRice] Resolved via HTTP ${res1.status} redirect to: ${location}`);
        return location;
      }
    }

    const res2 = await fetch(shortUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-HK,en;q=0.9,zh-HK;q=0.8,zh;q=0.7",
      },
      redirect: "follow",
    });

    if (res2.url && res2.url !== shortUrl && !res2.url.includes('s.openrice.com')) {
      console.log(`[OpenRice] Resolved via redirect-follow to: ${res2.url}`);
      return res2.url;
    }

    const html = await res2.text();
    console.log(`[OpenRice] Page length: ${html.length} chars`);

    const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1];
    if (canonical && canonical.includes('openrice.com') && !canonical.includes('s.openrice.com')) {
      console.log(`[OpenRice] Resolved via canonical: ${canonical}`);
      return canonical;
    }

    const allLinks = [...html.matchAll(/https?:\/\/(?:www\.)?openrice\.com\/[^\s"'<>\]]+/gi)];
    if (allLinks.length > 0) {
      const detailLink = allLinks.find(m => m[0].includes('/r-') || m[0].includes('/restaurant/'));
      const bestLink = detailLink?.[0] || allLinks[0][0];
      console.log(`[OpenRice] Resolved via page link: ${bestLink}`);
      return bestLink;
    }

    const jsRedirect = html.match(/(?:window\.location|location\.href|location\.replace)\s*[=]\s*["']([^"']+)["']/i)?.[1];
    if (jsRedirect && jsRedirect.includes('openrice.com') && !jsRedirect.includes('s.openrice.com')) {
      const fullUrl = jsRedirect.startsWith('http') ? jsRedirect : `https://www.openrice.com${jsRedirect}`;
      console.log(`[OpenRice] Resolved via JS redirect: ${fullUrl}`);
      return fullUrl;
    }

    try {
      const expandRes = await fetch(`https://unshorten.me/json/${encodeURIComponent(shortUrl)}`);
      if (expandRes.ok) {
        const expandData = await expandRes.json() as { resolved_url?: string };
        if (expandData.resolved_url && expandData.resolved_url.includes('openrice.com') && !expandData.resolved_url.includes('s.openrice.com')) {
          console.log(`[OpenRice] Resolved via unshorten.me: ${expandData.resolved_url}`);
          return expandData.resolved_url;
        }
      }
    } catch { /* expander service unavailable */ }

    console.log(`[OpenRice] Could not resolve short link, using original URL`);
    return shortUrl;
  } catch (err) {
    console.log(`[OpenRice] Short link resolution failed:`, err);
    return shortUrl;
  }
}
