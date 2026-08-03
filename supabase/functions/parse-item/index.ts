// Supabase Edge Function: parse-item
// Receives URL + optional text from Share Extension, calls Gemini for structured extraction.
// Caches result in saved_items (dedup by source_url).
//
// Extraction pipeline:
//   1. Check Supabase cache
//   2. If Share Extension text provided → use directly (best quality)
//   3. If no text → oEmbed (Instagram/Facebook/Threads) → HTML scrape (fallback)
//   4. Gemini 2.5 Flash extracts names/address/category/tags from text
//   5. Enrichment: Gemini knowledge + Nominatim geocoding (replaces broken DuckDuckGo)

import { createClient } from "jsr:@supabase/supabase-js@2";
import "jsr:@std/dotenv/load";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FB_APP_TOKEN = Deno.env.get("FB_APP_TOKEN") || ""; // optional, improves Facebook/Instagram oEmbed

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Platform detection ─────────────────────────────────────────

type Platform = 'instagram' | 'threads' | 'facebook' | 'red' | 'pinterest' | 'youtube' | 'openrice' | 'googlemaps' | 'dianping' | 'other';

function detectPlatform(url: string): Platform {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('facebook.com') || u.includes('fb.com')) return 'facebook';
  if (u.includes('xhslink.com') || u.includes('xiaohongshu.com')) return 'red';
  if (u.includes('pin.it') || u.includes('pinterest.com')) return 'pinterest';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('openrice.com') || u.startsWith('openrice://')) return 'openrice';
  if (u.includes('google.com/maps') || u.includes('maps.google.com') || u.includes('goo.gl/maps') || u.includes('maps.app.goo.gl')) return 'googlemaps';
  if (u.includes('dianping.com') || u.includes('dpurl.cn')) return 'dianping';
  return 'other';
}

// ── Instagram URL metadata extraction ─────────────────────────

function extractInstagramMeta(url: string): { username: string | null; postType: string | null } {
  try {
    const pathname = new URL(url).pathname;
    const userMatch = pathname.match(/^\/([^/]+)\/(p|reel|stories|tv)\//);
    return {
      username: userMatch?.[1] || null,
      postType: userMatch?.[2] || null,
    };
  } catch {
    return { username: null, postType: null };
  }
}

// ── Vision OCR: extract text from Instagram thumbnail ───────────

async function extractTextFromThumbnail(thumbnailUrl: string): Promise<string | null> {
  try {
    // Download the thumbnail image
    const imgRes = await fetch(thumbnailUrl);
    if (!imgRes.ok) {
      console.log(`[Vision] Failed to download thumbnail: ${imgRes.status}`);
      return null;
    }

    const imgBytes = await imgRes.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imgBytes)));
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    // Send to Gemini for text extraction
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "This is a thumbnail from a social media post about a place in Hong Kong (likely a restaurant, cafe, or shop). Read ALL visible text from this image — including any overlaid text, captions, location tags, usernames, and restaurant names. Return ONLY the text you can see, exactly as it appears. If no text is visible, return 'NO_TEXT'." },
            { inlineData: { mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      }),
    });

    if (!res.ok) {
      console.log(`[Vision] Gemini error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text || text === 'NO_TEXT') {
      console.log(`[Vision] No text found in thumbnail`);
      return null;
    }

    console.log(`[Vision] Extracted text (${text.length} chars): ${text.slice(0, 200)}`);
    return text;
  } catch (err) {
    console.log(`[Vision] Failed:`, err);
    return null;
  }
}

// ── oEmbed (lightweight, no JS rendering needed) ────────────────

interface OembedResult {
  text: string | null;
  thumbnailUrl: string | null;
}

async function fetchOembed(url: string, platform: Platform): Promise<OembedResult> {
  let oembedUrls: string[] = [];
  const result: OembedResult = { text: null, thumbnailUrl: null };
  try {
    switch (platform) {
      case 'instagram':
      case 'threads':
        if (FB_APP_TOKEN) {
          oembedUrls.push(`https://graph.facebook.com/v22.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${FB_APP_TOKEN}&fields=title,author_name,thumbnail_url`);
        }
        oembedUrls.push(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`);
        break;
      case 'facebook':
        if (FB_APP_TOKEN) {
          oembedUrls.push(`https://graph.facebook.com/v22.0/oembed_post?url=${encodeURIComponent(url)}&access_token=${FB_APP_TOKEN}`);
        }
        // Fallback: try unauthenticated public oEmbed (works for public posts/reels)
        oembedUrls.push(`https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`);
        // Also try the oEmbed video endpoint for reels/videos
        oembedUrls.push(`https://www.facebook.com/plugins/video/oembed.json/?url=${encodeURIComponent(url)}`);
        break;
      case 'youtube':
        // YouTube oEmbed is free and returns title, author_name, thumbnail_url
        oembedUrls.push(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        break;
    }

    for (const oembedUrl of oembedUrls) {
      const res = await fetch(oembedUrl, {
        headers: { "User-Agent": "Spot-App/1.0" },
      });
      if (!res.ok) {
        console.log(`[oEmbed] ${platform} returned ${res.status} for ${oembedUrl.slice(0, 80)}...`);
        continue;
      }

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        console.log(`[oEmbed] ${platform} returned non-JSON response (likely HTML block page)`);
        continue;
      }
      const parts: string[] = [];
      if (data.title) parts.push(`Post title: ${data.title}`);
      if (data.author_name) parts.push(`Author: ${data.author_name}`);
      if (data.description) parts.push(data.description);
      result.text = parts.join('\n') || null;

      // Capture thumbnail for vision-based OCR fallback
      if (data.thumbnail_url && typeof data.thumbnail_url === 'string') {
        result.thumbnailUrl = data.thumbnail_url;
      }

      if (result.text) return result;
    }
    return result;
  } catch (err) {
    console.log(`[oEmbed] ${platform} error:`, err);
    return result;
  }
}

// ── Google Maps URL parser ──────────────────────────────────────

interface GmapsExtracted {
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  resolvedUrl: string;
}

function extractFromGoogleMapsUrl(url: string): GmapsExtracted {
  const result: GmapsExtracted = { placeName: null, lat: null, lng: null, resolvedUrl: url };
  try {
    const decoded = decodeURIComponent(url);

    // Extract place name from /place/{name}/ or /place/{name}@
    const placeMatch = decoded.match(/\/place\/([^/@]+?)(?:\/@|$|\/data=)/);
    if (placeMatch) {
      result.placeName = placeMatch[1].replace(/\+/g, ' ').trim();
    }

    // Extract coordinates from @lat,lng,zoom
    const coordsMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+),\d+z/);
    if (coordsMatch) {
      result.lat = parseFloat(coordsMatch[1]);
      result.lng = parseFloat(coordsMatch[2]);
    }

    // Try to extract from /search/{query}
    if (!result.placeName) {
      const searchMatch = decoded.match(/\/search\/([^/@]+?)(?:\/@|$|\/data=)/);
      if (searchMatch) {
        result.placeName = searchMatch[1].replace(/\+/g, ' ').trim();
      }
    }

    // Try to extract from ?q= query param (Chrome mobile format)
    if (!result.placeName) {
      const qMatch = decoded.match(/[?&]q=([^&]+)/);
      if (qMatch) {
        result.placeName = decodeURIComponent(qMatch[1]).replace(/\+/g, ' ').trim();
      }
    }
  } catch { /* URL parsing failed */ }
  return result;
}

async function resolveGoogleMapsShortLink(shortUrl: string): Promise<string> {
  try {
    // Try HTTP redirect
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

    // Try to expand via a URL expander
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

// ── OpenRice short-link resolver ─────────────────────────────────

async function resolveOpenRiceShortLink(shortUrl: string): Promise<string> {
  try {
    // Attempt 1: Fetch WITHOUT following redirects — capture the Location header
    console.log(`[OpenRice] Resolving short link: ${shortUrl}`);
    const res1 = await fetch(shortUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-HK,en;q=0.9,zh-HK;q=0.8,zh;q=0.7",
      },
      redirect: "manual",
    });

    // Check for 301/302 redirect
    if ([301, 302, 303, 307, 308].includes(res1.status)) {
      const location = res1.headers.get("Location");
      if (location && location.includes('openrice.com') && !location.includes('s.openrice.com')) {
        console.log(`[OpenRice] Resolved via HTTP ${res1.status} redirect to: ${location}`);
        return location;
      }
    }

    // Attempt 2: Follow redirects with browser UA
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

    // Extract from the HTML
    // Pattern 1: canonical link
    const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1];
    if (canonical && canonical.includes('openrice.com') && !canonical.includes('s.openrice.com')) {
      console.log(`[OpenRice] Resolved via canonical: ${canonical}`);
      return canonical;
    }

    // Pattern 2: any www.openrice.com URL in the page
    const allLinks = [...html.matchAll(/https?:\/\/(?:www\.)?openrice\.com\/[^\s"'<>\]]+/gi)];
    if (allLinks.length > 0) {
      // Prefer restaurant detail pages
      const detailLink = allLinks.find(m => m[0].includes('/r-') || m[0].includes('/restaurant/'));
      const bestLink = detailLink?.[0] || allLinks[0][0];
      console.log(`[OpenRice] Resolved via page link: ${bestLink}`);
      return bestLink;
    }

    // Pattern 3: js redirect
    const jsRedirect = html.match(/(?:window\.location|location\.href|location\.replace)\s*[=(]\s*["']([^"']+)["']/i)?.[1];
    if (jsRedirect && jsRedirect.includes('openrice.com') && !jsRedirect.includes('s.openrice.com')) {
      const fullUrl = jsRedirect.startsWith('http') ? jsRedirect : `https://www.openrice.com${jsRedirect}`;
      console.log(`[OpenRice] Resolved via JS redirect: ${fullUrl}`);
      return fullUrl;
    }

    // Attempt 3: Try public URL expander service
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

// ── Dianping SSR data extractor ────────────────────────────────

function findDianpingShopData(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  // Direct match: Dianping shop data has shopId, shopName or name
  if ((o.shopId || o.shopID) && (o.shopName || o.name)) return o;

  // Also match by common Dianping fields
  if (o.shopName && o.address) return o;

  for (const key of Object.keys(o)) {
    if (key === '__proto__' || key === 'constructor') continue;
    const val = o[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findDianpingShopData(item);
        if (found) return found;
      }
    } else if (typeof val === 'object' && val !== null) {
      const found = findDianpingShopData(val);
      if (found) return found;
    }
  }
  return null;
}

// ── RED SSR data extractor ──────────────────────────────────────

function findNoteInNextData(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  // Direct match: RED note data has noteId, title, desc
  if (o.noteId && (o.title || o.desc)) return o;

  // Recurse into nested objects and arrays
  for (const key of Object.keys(o)) {
    if (key === '__proto__' || key === 'constructor') continue;
    const val = o[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findNoteInNextData(item);
        if (found) return found;
      }
    } else if (typeof val === 'object' && val !== null) {
      const found = findNoteInNextData(val);
      if (found) return found;
    }
  }
  return null;
}

// ── HTML scraping fallback (improved, platform-aware) ────────────

async function fetchAndScrapeHtml(url: string, platform?: Platform): Promise<string> {
  try {
    const pageRes = await fetch(url, {
      headers: {
        "User-Agent": "Spot-App/1.0 (compatible; +https://spot.app)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,zh-HK;q=0.8,zh-CN;q=0.7",
      },
      redirect: "follow",
    });
    if (!pageRes.ok) {
      console.log(`[Scrape] ${platform || 'page'} returned ${pageRes.status}`);
      return '';
    }

    const html = await pageRes.text();
    const parts: string[] = [];

    // 1. Open Graph tags (all of them)
    const ogTags = html.match(/<meta[^>]+property="og:([^"]+)"[^>]+content="([^"]*)"/gi) || [];
    for (const tag of ogTags) {
      const prop = tag.match(/property="og:([^"]+)"/i)?.[1];
      const content = tag.match(/content="([^"]*)"/i)?.[1];
      if (prop && content && !['image', 'url', 'type', 'site_name', 'locale'].includes(prop)) {
        parts.push(`og:${prop}: ${content}`);
      }
    }

    // 2. All JSON-LD blocks (not just the first)
    const jsonLdRegex = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let jsonLdMatch;
    while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        const ldParts: string[] = [];
        if (ld.name) ldParts.push(`Name: ${ld.name}`);
        if (ld.headline) ldParts.push(`Headline: ${ld.headline}`);
        if (ld.description) ldParts.push(`Description: ${ld.description}`);
        if (ld.address) {
          const a = ld.address;
          ldParts.push(`Address: ${[a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).join(', ')}`);
        }
        if (ld.servesCuisine) {
          ldParts.push(`Cuisine: ${Array.isArray(ld.servesCuisine) ? ld.servesCuisine.join(', ') : ld.servesCuisine}`);
        }
        if (ld.priceRange) ldParts.push(`Price: ${ld.priceRange}`);
        if (ldParts.length) parts.push(ldParts.join('. '));
      } catch { /* skip malformed JSON-LD */ }
    }

    // 3. Meta description
    const descMeta = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1];
    if (descMeta) parts.push(descMeta);

    // 4. Title tag — extract Instagram caption from title format
    const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
    if (titleTag) {
      parts.push(`Page title: ${titleTag}`);
      // Instagram format: "username on Instagram: "Caption text...""
      // Extract just the caption for better signal-to-noise ratio
      if (platform === 'instagram' || platform === 'threads') {
        const captionMatch = titleTag.match(/"([^"]+)"/);
        if (captionMatch && captionMatch[1].length > 5) {
          parts.push(`Post caption: ${captionMatch[1]}`);
        }
      }
    }

    // 5. H1 headings (max 3)
    const h1s = (html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || [])
      .slice(0, 3)
      .map(h => h.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    if (h1s.length) parts.push(`Headings: ${h1s.join(' | ')}`);

    // 6. URL path hints (e.g., Instagram usernames, Threads post IDs)
    try {
      const pathname = new URL(url).pathname;
      parts.push(`URL path: ${pathname}`);
    } catch { /* ignore */ }

    // 7. Platform-specific: extract Instagram username from URL
    if ((platform === 'instagram' || platform === 'threads') && !parts.some(p => p.includes('Author:'))) {
      try {
        const pathParts = new URL(url).pathname.split('/').filter(Boolean);
        if (platform === 'instagram' && pathParts.length >= 1) {
          // URL format: /p/SHORTCODE/ or /reel/SHORTCODE/ or /stories/USERNAME/ID/
          // The username isn't in the URL for posts/reels, but we can note it's an IG post
          parts.push(`Platform: Instagram post`);
        }
        if (platform === 'threads' && pathParts.length >= 2) {
          const username = pathParts[0]?.replace('@', '');
          if (username) parts.push(`Author: @${username} (Threads)`);
        }
      } catch { /* ignore */ }
    }

    // 8. Facebook-specific extraction
    if (platform === 'facebook') {
      // Facebook pages are JS-heavy but embed useful metadata in OG tags and title
      // Extract caption from og:description (FB reels/videos put captions here)
      const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1];
      if (ogDesc && ogDesc.length > 10) {
        parts.push(`Post caption: ${ogDesc}`);
      }

      // Extract from og:title (usually the page/channel name, sometimes contains post text)
      const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
      if (ogTitle && ogTitle !== ogDesc && !parts.some(p => p.includes(ogTitle!))) {
        parts.push(`Post title: ${ogTitle}`);
      }

      // Extract FB post ID from URL for context
      try {
        const pathname = new URL(url).pathname;
        // facebook.com/share/r/SOMETHING → reel redirect
        // facebook.com/reel/ID → direct reel
        // facebook.com/username/posts/ID → post
        // fb.watch/ID → video
        if (url.includes('reel') || url.includes('/share/r/') || url.includes('fb.watch')) {
          parts.push('Note: This is a Facebook Reel or video. Look for place mentions in the caption and title.');
        }
        if (pathname.includes('/posts/') || pathname.includes('/videos/')) {
          parts.push('Note: This is a Facebook post or video. Check the description for place mentions.');
        }
        // Try to extract page/group name from URL
        const pageMatch = pathname.match(/^\/([^/]+)\/(?:posts|videos|reels)\//);
        if (pageMatch) {
          parts.push(`Facebook page: @${pageMatch[1]}`);
        }
      } catch { /* ignore */ }

      parts.push('Platform: Facebook post — this is a social media post about a place in Hong Kong');
    }

    // 9. YouTube-specific extraction
    if (platform === 'youtube') {
      // YouTube is JS-rendered but reliably provides OG tags
      // og:title is the video title, og:description is available for many videos
      const ytTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
      const ytDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1];

      if (ytTitle) {
        // Strip the " - YouTube" suffix from title
        const cleanTitle = ytTitle.replace(/\s*-\s*YouTube\s*$/i, '').trim();
        parts.push(`Video title: ${cleanTitle}`);
      }
      if (ytDesc && ytDesc.length > 10) {
        parts.push(`Video description: ${ytDesc.slice(0, 500)}`);
      }

      // YouTube channel name from og:site_name or author meta
      const ogSiteName = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/i)?.[1];
      if (ogSiteName) parts.push(`Channel: ${ogSiteName}`);

      // Detect video type
      if (url.includes('/shorts/')) {
        parts.push('Note: This is a YouTube Short — a short video likely showcasing a Hong Kong restaurant, cafe, or attraction');
      } else {
        parts.push('Note: This is a YouTube video — likely a food/place review or recommendation in Hong Kong');
      }
    }

    // 10. OpenRice-specific extraction
    if (platform === 'openrice') {
      const pathname = new URL(url).pathname;

      // Detect OpenRice short link format: s.openrice.com/{shortCode}
      // These redirect to the full page — extract what we can from the URL itself
      const isShortLink = url.includes('s.openrice.com');

      // OpenRice URLs contain restaurant name slug: /hongkong/r-{name}-{id}
      const nameFromPath = pathname.match(/\/(?:r|restaurant)-([^/\s?]+)/i)?.[1];
      if (nameFromPath) {
        parts.push(`URL name hint: ${nameFromPath.replace(/-/g, ' ')}`);
      } else if (isShortLink) {
        // Short link — note it for Gemini, the scraped page should have the full data
        parts.push('Note: This is an OpenRice short link. The page redirects to the full restaurant page.');
      }

      // Extract anything useful from the page HTML
      // OpenRice uses these patterns (server-side rendered):

      // Cuisine types from links
      const cuisineMatches = html.match(/<a[^>]*href="[^"]*\/(?:cuisine|dish|type)[^"]*"[^>]*>([^<]+)<\/a>/gi) || [];
      const cuisines = [...new Set(cuisineMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean))];
      if (cuisines.length) parts.push(`Cuisine: ${cuisines.join(', ')}`);

      // Address — OpenRice often has it in meta or structured divs
      const addressBlock = html.match(/<div[^>]*class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (addressBlock) {
        const addressText = addressBlock[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (addressText && addressText.length > 5) parts.push(`Address from page: ${addressText}`);
      }

      // Phone number
      const phoneMatch = html.match(/(?:tel|phone|電話)[:\s]*[">]?\s*(\+?[\d\s-]{8,})/i);
      if (phoneMatch) parts.push(`Phone: ${phoneMatch[1].trim()}`);

      // Business hours
      const hoursMatch = html.match(/(?:opening|hours|營業|開放)[\s\S]{0,100}?(\d{1,2}[:.]\d{2}\s*[ap]m\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*[ap]m)/i);
      if (hoursMatch) parts.push(`Hours: ${hoursMatch[1]}`);

      // Price range from the page
      const priceMatch = html.match(/(?:人均|per head|average|消費)[\s\S]{0,50}?(H?K?\$\s*\d{2,4}\s*[-–—]\s*\d{2,4})/i);
      if (priceMatch) parts.push(`Price: ${priceMatch[1]}`);

      parts.push('Platform: OpenRice Hong Kong restaurant page');
    }

    // 11. RED / 小紅書 extraction
    if (platform === 'red') {
      // RED is JS-rendered, but sometimes embeds SSR data
      // Look for __NEXT_DATA__ or similar JSON blobs
      const nextData = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextData) {
        try {
          const parsed = JSON.parse(nextData[1]);
          const noteData = findNoteInNextData(parsed);
          if (noteData) {
            if (noteData.title) parts.push(`Post title: ${noteData.title}`);
            if (noteData.desc) parts.push(`Description: ${noteData.desc}`);
            if (noteData.tagList) parts.push(`Tags: ${noteData.tagList}`);
            if (noteData.ipLocation) parts.push(`Location: ${noteData.ipLocation}`);
            if (noteData.noteId) parts.push(`Note ID: ${noteData.noteId}`);
          }
        } catch { /* ignore */ }
      }

      // Try to extract from any embedded JSON or script data
      const scriptData = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})<\/script>/i);
      if (scriptData) {
        try {
          const state = JSON.parse(scriptData[1]);
          const noteInfo = state?.note?.noteDetailMap || state?.noteDetail || state?.note;
          if (noteInfo) {
            const note = Object.values(noteInfo)[0] as any;
            if (note?.note?.title) parts.push(`Post title: ${note.note.title}`);
            if (note?.note?.desc) parts.push(`Description: ${note.note.desc}`);
            if (note?.note?.tagList?.length) parts.push(`Tags: ${note.note.tagList.map((t: any) => t.name || t).join(', ')}`);
            if (note?.note?.ipLocation) parts.push(`Location: ${note.note.ipLocation}`);
          }
        } catch { /* ignore */ }
      }

      // Extract from URL: xhslink.com short links redirect, xiaohongshu.com/discovery/item/XXX has the post ID
      try {
        const pathname = new URL(url).pathname;
        const itemId = pathname.match(/\/item\/([a-zA-Z0-9]+)/i)?.[1];
        if (itemId) parts.push(`Post ID: ${itemId}`);
      } catch { /* ignore */ }

      parts.push('Platform: Xiaohongshu (RED) post — this is a social media post about a place in Hong Kong');
    }

    // 12. Google Maps — just note the platform, main extraction is from URL
    if (platform === 'googlemaps') {
      parts.push('Platform: Google Maps shared location');
    }

    // 13. Dianping / 大眾點評 extraction
    if (platform === 'dianping') {
      // Dianping is JS-rendered, but sometimes embeds SSR data
      // Check for __NEXT_DATA__, __NUXT__ or embedded JSON state
      const ssrData = html.match(/<script[^>]+id="__(?:NEXT_DATA__|NUXT__|INITIAL_STATE__)"[^>]*>([\s\S]*?)<\/script>/i);
      if (ssrData) {
        try {
          const parsed = JSON.parse(ssrData[1]);
          const shopData = findDianpingShopData(parsed);
          if (shopData) {
            if (shopData.shopName || shopData.name) parts.push(`Shop name: ${shopData.shopName || shopData.name}`);
            if (shopData.address) parts.push(`Address: ${shopData.address}`);
            if (shopData.phone) parts.push(`Phone: ${shopData.phone}`);
            if (shopData.categoryName || shopData.cuisine) parts.push(`Category: ${shopData.categoryName || shopData.cuisine}`);
            if (shopData.avgPrice || shopData.price) parts.push(`Avg price: ${shopData.avgPrice || shopData.price}`);
            if (shopData.shopId) parts.push(`Shop ID: ${shopData.shopId}`);
            if (shopData.regionName || shopData.district) parts.push(`District: ${shopData.regionName || shopData.district}`);
          }
        } catch { /* ignore */ }
      }

      // Extract shop ID from URL
      try {
        const pathname = new URL(url).pathname;
        const shopId = pathname.match(/\/shop\/(\d+)/i)?.[1] || pathname.match(/\/(\d{5,})/)?.[1];
        if (shopId) parts.push(`Shop ID: ${shopId}`);
      } catch { /* ignore */ }

      // Try to extract from any text content visible in static HTML
      const mainContent = html.match(/<div[^>]*class="[^"]*(?:main|content|shop|detail)[^"]*"[^>]*>([\s\S]{0,3000}?)<\/div>/i);
      if (mainContent) {
        const text = mainContent[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 20) parts.push(`Page content: ${text.slice(0, 500)}`);
      }

      parts.push('Platform: Dianping (大眾點評) — this is a mainland Chinese restaurant review page');
    }

    return parts.filter(Boolean).join('\n');
  } catch (err) {
    console.log("[Scrape] fetch failed:", err);
    return '';
  }
}

// ── Safe JSON parse (Gemini sometimes returns malformed JSON) ────

function safeParseGeminiJson(text: string): Record<string, unknown> {
  if (!text) return {};

  // First attempt: direct parse
  try {
    return JSON.parse(text);
  } catch { /* fall through to repair attempts */ }

  // Second attempt: strip markdown code fences
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  // Third attempt: repair truncated JSON — extract valid fields individually
  // Pattern matches: "key": "value", "key": null, "key": ["array"]
  const result: Record<string, unknown> = {};
  const fieldPattern = /"(\w+)":\s*("(?:[^"\\]|\\.)*"|null|\[[^\]]*\]|"[^"\n]*)/g;
  let match;
  while ((match = fieldPattern.exec(cleaned)) !== null) {
    const key = match[1];
    const rawVal = match[2];
    try {
      if (rawVal === 'null') {
        result[key] = null;
      } else if (rawVal.startsWith('[')) {
        result[key] = JSON.parse(rawVal);
      } else if (rawVal.startsWith('"')) {
        result[key] = JSON.parse(rawVal);
      } else {
        result[key] = rawVal;
      }
    } catch {
      // Best-effort for truncated strings: strip the opening quote and use what we have
      if (rawVal.startsWith('"')) {
        result[key] = rawVal.slice(1).replace(/["\\]$/, '').trim() || null;
      }
    }
  }

  if (Object.keys(result).length > 0) {
    console.log(`[safeParse] Extracted ${Object.keys(result).length} fields from partial JSON`);
    return result;
  }

  console.log("[safeParse] Could not extract any fields, returning empty. First 200 chars:", text.slice(0, 200));
  return {};
}

// ── Gemini call helper ──────────────────────────────────────────

async function geminiExtract(inputText: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n---\nContent to analyze:\n${inputText.substring(0, 4000)}\n---\nExtract the MAIN place. Return ONLY JSON.` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return safeParseGeminiJson(rawText);
}

// ── Enrichment: Gemini knowledge (replaces broken DuckDuckGo) ──

async function enrichWithGemini(
  name: string,
  current: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const enrichPrompt = `You are a Hong Kong local knowledge expert. Fill in missing details about this place using your knowledge.

Current data: ${JSON.stringify(current)}

Return ONLY a JSON object with the MISSING or UNCERTAIN fields filled in:
{
  "address_en": "full English address in Hong Kong, or null if truly unknown",
  "address_original": "full Chinese address 中文地址, or null",
  "district": "one of: Central & Western, Wan Chai, Eastern, Southern, Yau Tsim Mong, Sham Shui Po, Kowloon City, Wong Tai Sin, Kwun Tong, Kwai Tsing, Tsuen Wan, Tuen Mun, Yuen Long, North, Tai Po, Sha Tin, Sai Kung, Islands",
  "category": "restaurant|cafe|bar|activity|event|attraction|shopping|other",
  "price_hint": "$ / $$ / $$$ / HK$ range, or null",
  "tags": ["tag1", "tag2"]
}`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: enrichPrompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) {
      console.log("[Enrich] Gemini error:", res.status);
      return {};
    }
    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return safeParseGeminiJson(rawText);
  } catch (err) {
    console.log("[Enrich] Gemini failed:", err);
    return {};
  }
}

// ── Enrichment: Nominatim geocoding ─────────────────────────────

async function enrichWithNominatim(name: string): Promise<Record<string, unknown>> {
  try {
    const params = new URLSearchParams({
      q: `${name} Hong Kong`,
      format: "json",
      limit: "1",
      "accept-language": "en,zh-HK,zh-CN",
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": "Spot-App/1.0 (geocoder; +https://spot.app)" },
    });
    if (!res.ok) return {};
    const results = await res.json();
    if (!results?.length) return {};

    const r = results[0];
    const displayName = r.display_name as string || '';

    // Try to extract district from display name
    const districtMatch = displayName.match(/(?:Central & Western|Wan Chai|Eastern|Southern|Yau Tsim Mong|Sham Shui Po|Kowloon City|Wong Tai Sin|Kwun Tong|Kwai Tsing|Tsuen Wan|Tuen Mun|Yuen Long|North|Tai Po|Sha Tin|Sai Kung|Islands)/i);

    return {
      address_en: displayName || null,
      lat: r.lat,
      lng: r.lon,
      district: districtMatch?.[0] || null,
    };
  } catch (err) {
    console.log("[Nominatim] failed:", err);
    return {};
  }
}

// ── Reverse lookup: find name from address ──────────────────────

async function reverseLookupFromAddress(
  address: string,
): Promise<Record<string, unknown>> {
  const prompt = `You are a Hong Kong location expert. Given an address, identify the restaurant, cafe, shop, or attraction at this location.

Address: ${address}

Return ONLY a JSON object:
{
  "name_en": "English name of the place, or null if not identifiable",
  "name_original": "Chinese name 中文名, or null",
  "category": "restaurant|cafe|bar|activity|event|attraction|shopping|other",
  "district": "HK district, or null",
  "price_hint": "$/$$/$$$ or null",
  "tags": ["tag1", "tag2"]
}`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) {
      console.log("[ReverseLookup] Gemini error:", res.status);
      return {};
    }
    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return safeParseGeminiJson(rawText);
  } catch (err) {
    console.log("[ReverseLookup] Gemini failed:", err);
    return {};
  }
}

// ── Contextual place search for social platforms (when no name extracted) ─

async function contextualPlaceSearch(
  url: string,
  platform: Platform,
  promptText: string,
): Promise<Record<string, unknown>> {
  const contextParts: string[] = [];

  // Platform-specific metadata
  if (platform === 'instagram' || platform === 'threads') {
    const meta = extractInstagramMeta(url);
    if (meta.username) contextParts.push(`Account: @${meta.username}`);
    if (meta.postType) contextParts.push(`Post type: ${meta.postType}`);
  }

  if (platform === 'facebook') {
    contextParts.push('Platform: Facebook (Meta)');
    try {
      const pageMatch = new URL(url).pathname.match(/^\/([^/]+)\/(?:posts|videos|reels)\//);
      if (pageMatch) contextParts.push(`Facebook page: @${pageMatch[1]}`);
    } catch { /* ignore */ }
  }

  if (platform === 'youtube') {
    contextParts.push('Platform: YouTube');
    // Try to extract channel hints from the prompt text
    const channelMatch = promptText.match(/Channel:\s*(.+)/i);
    if (channelMatch) contextParts.push(`Channel: ${channelMatch[1]}`);
  }

  if (promptText) contextParts.push(`Available content: ${promptText.substring(0, 1000)}`);

  const platformLabel = platform === 'facebook' ? 'Facebook' : platform === 'youtube' ? 'YouTube' : platform === 'red' ? 'Xiaohongshu (RED)' : platform === 'threads' ? 'Threads' : 'Instagram';

  const searchPrompt = `You are a Hong Kong location expert. A ${platformLabel} post was shared but we couldn't identify the place. Look at the context clues and identify the MAIN place this post is about.

Context:
${contextParts.join('\n')}

Think step by step:
1. Does the account/channel name itself look like a business/restaurant name? (e.g., @bakehousehk → Bakehouse)
2. Does the video/post title contain a restaurant, cafe, shop name or area?
3. Are there hashtags or keywords that identify a place?
4. Does the caption/description mention a specific restaurant, cafe, or location?
5. What area/district of Hong Kong does this seem to be in?
6. For food/restaurant content: the video title often follows patterns like "Best [cuisine] in [area]" or "[Place name] - [Area]"

Return ONLY a JSON object with your best assessment:
{
  "name_en": "English place name, or null if truly unknown",
  "name_original": "Chinese place name 中文名, or null",
  "category": "restaurant|cafe|bar|activity|event|attraction|shopping|other",
  "district": "HK district, or null",
  "confidence": "high|medium|low|none",
  "reasoning": "brief explanation of how you arrived at this"
}`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: searchPrompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) {
      console.log("[Contextual] Gemini error:", res.status);
      return {};
    }
    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const result = safeParseGeminiJson(rawText);
    if (result.confidence === 'low' || result.confidence === 'none') {
      console.log(`[Contextual] Low confidence (${result.confidence}), discarding`);
      return {};
    }
    return result;
  } catch (err) {
    console.log("[Contextual] Gemini failed:", err);
    return {};
  }
}

// ── System prompt ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Hong Kong location data extractor. Extract the MAIN place (restaurant, cafe, shop, attraction, event) from social media content.

The input mixes English, Traditional Chinese (Cantonese), and Simplified Chinese. Preserve all original scripts.

## NAME DETECTION
Look for place names using these patterns:
- 【店名】 / 《店名》 / 「店名」 / "[Name]"
- "餐廳：XXX" / "Restaurant: XXX" / "店名係XXX" / "called XXX" / "📍 XXX"
- Hashtags: #店名 #restaurantname
- After location words: "去咗XXX", "at XXX in [area]", "試咗XXX", "今次介紹XXX"
- URL path: Instagram usernames often contain hints — if "Instagram author: @username" appears in the input, this username IS often the place itself (e.g., a restaurant's own account)

## CATEGORY DETECTION
Look for these clues to determine category:
- "restaurant": food/dining mentions, 餐廳, 菜館, 料理, cuisine words, menu items, "dinner", "lunch"
- "cafe": coffee/tea mentions, 咖啡, 茶, 冰室, "brunch", "latte", "matcha"
- "bar": alcohol mentions, 酒吧, cocktail, wine, beer, "happy hour"
- "activity": sports/outdoor, 行山, hiking, beach, gym, workshop, class
- "event": time-limited, 展覽, exhibition, festival, concert, pop-up, market
- "attraction": tourist spots, 景點, museum, temple, viewpoint, landmark
- "shopping": retail mentions, 商店, shop, store, boutique, mall
- "other": if none of the above fit

## INSTAGRAM CAPTION PATTERNS
Instagram captions have specific formats. Look for place names in these patterns:
- "📍 [Place] - [Area]" or "📍 [place] in [area]" — the emoji marks the location
- "New spot: [Name]" / "New cafe: [Name]" / "New in [area]: [Name]"
- "Finally tried [Name]" / "試咗 [Name]" / "終於試咗 [Name]" / "今次去咗 [Name]"
- "[Name] 📍 [Address]" — name before the pin emoji
- "@[shop_handle]" — the tagged Instagram account is often the place itself
- Hashtag clusters: #name #area #cuisine (e.g., #bakehouse #central #sourdough)
- Instagram author username from "Instagram author: @username" metadata IS often the business account — use it as a name candidate
- Multiple places mentioned? Pick the MAIN one (first mentioned, or one with most detail)
- Emoji-heavy captions: skip emojis, extract text around location/recommendation verbs
- "推介" / "推薦" / "必試" / "must try" / "hidden gem" / "隱世" followed by place name
- Price hints often appear as: $ / $$ / $$$ / HK$50-100 / 人均$100
- If the caption is in Chinese mixed with English, the place name could be in either language
- If the caption ONLY contains emojis and hashtags, extract the place from hashtags
- If NO place can be identified at all, do NOT guess — return null for names and mark category as "other"

## ADDRESS PATTERNS (HK specific)
- Full: 香港[區][街道][號碼] / [street] [number], [district]
- Partial: 在[街道] / 近[地標] / [商場名]內 / inside [mall]
- Address words: 地下/G/F, 樓/F, 號/No., 閣樓, 舖/shop
- Major HK malls: 海港城/Harbour City, 時代廣場/Times Square, K11 Musea, IFC, 朗豪坊/Langham Place, APM, 又一城/Festival Walk, 新城市廣場/New Town Plaza
- Street types: 道/Road, 街/Street, 里/Lane, 徑/Path, 邨/Estate, 商場/Mall, 中心/Centre

## HK AREA → DISTRICT MAPPING
Central & Western: 中環/Central, 上環/Sheung Wan, 金鐘/Admiralty, 西環, 西營盤/Sai Ying Pun, 堅尼地城/Kennedy Town
Wan Chai: 銅鑼灣/Causeway Bay, 灣仔, 跑馬地/Happy Valley, 大坑/Tai Hang
Eastern: 北角/North Point, 太古/Taikoo, 筲箕灣/Shau Kei Wan, 西灣河, 鰂魚涌/Quarry Bay
Southern: 香港仔/Aberdeen, 鴨脷洲/Ap Lei Chau, 赤柱/Stanley, 淺水灣/Repulse Bay, 薄扶林/Pok Fu Lam
Yau Tsim Mong: 尖沙咀/TST, 佐敦/Jordan, 油麻地, 旺角/Mong Kok, 太子/Prince Edward, 大角咀
Sham Shui Po: 深水埗, 長沙灣/Cheung Sha Wan, 荔枝角/Lai Chi Kok, 美孚/Mei Foo
Kowloon City: 九龍城, 土瓜灣/To Kwa Wan, 紅磡/Hung Hom, 黃埔/Whampoa, 何文田/Ho Man Tin
Wong Tai Sin: 黃大仙, 鑽石山/Diamond Hill, 慈雲山, 樂富/Lok Fu
Kwun Tong: 觀塘, 牛頭角, 九龍灣/Kowloon Bay, 油塘/Yau Tong
Kwai Tsing: 葵涌, 葵芳/Kwai Fong, 青衣/Tsing Yi
Tsuen Wan: 荃灣, 深井/Sham Tseng
Tuen Mun: 屯門
Yuen Long: 元朗, 天水圍/Tin Shui Wai, 錦田/Kam Tin
North: 上水/Sheung Shui, 粉嶺/Fanling
Tai Po: 大埔
Sha Tin: 沙田, 馬鞍山/Ma On Shan, 大圍/Tai Wai
Sai Kung: 西貢, 將軍澳/Tseung Kwan O, 坑口/Hang Hau
Islands: 大嶼山/Lantau, 東涌/Tung Chung, 長洲/Cheung Chau, 南丫島/Lamma

## CUISINE & TAGS
Cuisine: 日式/Japanese, 韓式/Korean, 泰式/Thai, 西式/Western, 意式/Italian, 法式/French, 中菜/Chinese, 廣東/Cantonese, 潮州/Chiu Chow, 上海/Shanghainese, 北京/Peking, 點心/dim sum, 火鍋/hotpot, 拉麵/ramen, 壽司/sushi, 燒肉/yakiniku, BBQ/燒烤, 海鮮/seafood, 素菜/vegetarian, 甜品/dessert, 糖水/tong sui, 咖啡/coffee, 茶餐廳/cha chaan teng, 冰室/bing sutt, 大牌檔/dai pai dong, 飲茶/yum cha, 放題/buffet, 米芝蓮/Michelin
Vibe: 打卡/instagrammable, 隱世/hidden gem, 排隊/queue, 寵物友善/pet-friendly, 天台/rooftop, 户外/outdoor, 海景/sea view, 夜景/night view, 親子/family-friendly, 文青/artsy, 復古/vintage, 新開/new, 限時/pop-up

Return ONLY a JSON object (no markdown, no backticks):
{
  "name_original": "中文名 from post, or null",
  "name_en": "English name from post, or null",
  "address_original": "地址 from post, or null",
  "address_en": "English address, or null",
  "category": "restaurant"|"cafe"|"bar"|"activity"|"event"|"attraction"|"shopping"|"other",
  "district": "district name from mapping above, or null",
  "price_hint": "$"|"$$"|"$$$"|"HK$" range, or null,
  "tags": ["tag1","tag2"],
  "raw_text": "the original input text"
}`;

// ── Request types ───────────────────────────────────────────────

interface ParseRequest {
  url: string;
  text?: string;
}

// ── Main handler ───────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { url, text: inputText } = (await req.json()) as ParseRequest;

    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), { status: 400 });
    }

    // ── 1. Check cache ──────────────────────────────────────
    const { data: existing } = await supabase
      .from("saved_items")
      .select("*")
      .eq("source_url", url)
      .single();

    if (existing) {
      return new Response(JSON.stringify({
        name_original: existing.name_original,
        name_en: existing.name_en,
        address_original: existing.address_original,
        address_en: existing.address_en,
        category: existing.category,
        district: existing.district,
        price_hint: existing.price_hint,
        tags: existing.tags,
        raw_text: existing.raw_text,
        cached: true,
      }), { headers: { "Content-Type": "application/json" } });
    }

    // ── 2. Build prompt text ────────────────────────────────
    const platform = detectPlatform(url);
    let promptText = inputText || "";
    let thumbnailUrl: string | null = null;

    if (!promptText) {
      let scrapeUrl = url;

      // Google Maps: extract name + coords from URL, skip scrape (JS-rendered)
      if (platform === 'googlemaps') {
        // Resolve short links first
        const isShortLink = url.includes('goo.gl/maps') || url.includes('maps.app.goo.gl');
        if (isShortLink) {
          const resolved = await resolveGoogleMapsShortLink(url);
          if (resolved !== url && resolved.includes('google.com/maps')) {
            scrapeUrl = resolved;
            console.log(`[Parse] Google Maps short link resolved: ${resolved}`);
          } else {
            // Short link resolution failed — likely network restrictions from HK/CN
            // Return early with a helpful hint instead of sending a useless URL to Gemini
            console.log(`[Parse] Google Maps short link unresolved — returning hint`);
            return new Response(JSON.stringify({
              name_original: null, name_en: null,
              address_original: null, address_en: null,
              category: "other", district: null, price_hint: null,
              tags: [], raw_text: url,
              short_link_unresolved: true,
              parse_hint: `Google Maps short links can't be expanded from our servers. Open this link in the Maps app first, then copy the full address link and paste it here.`,
            }), { headers: { "Content-Type": "application/json" } });
          }
        }

        const gmapsData = extractFromGoogleMapsUrl(scrapeUrl);
        if (gmapsData.placeName) {
          // Build a prompt with structured data extracted from the URL
          promptText = `Google Maps Place: ${gmapsData.placeName}`;
          if (gmapsData.lat && gmapsData.lng) {
            promptText += `\nCoordinates: ${gmapsData.lat}, ${gmapsData.lng}`;
          }
          promptText += `\nSource URL: ${scrapeUrl}\n\nThis is a Hong Kong place shared via Google Maps. Extract the complete restaurant/place details.`;
          console.log(`[Parse] Google Maps — extracted name from URL: ${gmapsData.placeName}, coords: ${!!gmapsData.lat}`);
        } else {
          // Can't extract from URL — use the URL itself as context
          promptText = `Google Maps URL: ${scrapeUrl}\n\nThis is a Google Maps link to a place in Hong Kong. Extract the restaurant/place details from the URL.`;
          console.log(`[Parse] Google Maps — no name in URL, passing URL as context`);
        }
      }

      // OpenRice deep links: convert openrice:// to https:// for scraping
      if (platform === 'openrice' && url.startsWith('openrice://')) {
        // Convert openrice://r/{id} or openrice://s/{slug} to HTTP URL
        const openriceHttp = url
          .replace('openrice://', 'https://www.openrice.com/')
          .replace(/^https:\/\/www\.openrice\.com\/r\//, 'https://www.openrice.com/hongkong/restaurant/')
          .replace(/^https:\/\/www\.openrice\.com\/s\//, 'https://www.openrice.com/hongkong/r/');
        scrapeUrl = openriceHttp;
        console.log(`[Parse] Converted OpenRice deep link to: ${scrapeUrl}`);
      }

      // OpenRice short links: try to resolve, otherwise return empty (no guessing)
      if (platform === 'openrice' && url.includes('s.openrice.com')) {
        const resolved = await resolveOpenRiceShortLink(url);
        if (resolved !== url) {
          scrapeUrl = resolved;
          console.log(`[Parse] OpenRice short link resolved, scraping full page`);
        } else {
          // Can't resolve — return empty. Guessing produces wrong restaurants.
          console.log(`[Parse] OpenRice short link unresolved — returning empty, user should Look Up by name`);
          return new Response(JSON.stringify({
            name_original: null, name_en: null,
            address_original: null, address_en: null,
            category: "restaurant", district: null, price_hint: null,
            tags: [], raw_text: url,
            short_link_unresolved: true,
            parse_hint: `Can't read OpenRice short links directly. Copy and paste the full restaurant page URL from your browser, or type the name and use Look Up.`,
          }), { headers: { "Content-Type": "application/json" } });
        }
      }

      if (!promptText) {
        // No Share Extension text → try oEmbed first, then HTML scrape
        const oembedResult = await fetchOembed(scrapeUrl, platform);
        if (oembedResult.text) {
          promptText = oembedResult.text;
          thumbnailUrl = oembedResult.thumbnailUrl;
          console.log(`[Parse] Got oEmbed data for ${platform}, hasThumbnail: ${!!thumbnailUrl}`);
        } else {
          // Last resort: scrape HTML
          const scrapedText = await fetchAndScrapeHtml(scrapeUrl, platform);
          promptText = scrapedText;
          console.log(`[Parse] HTML scrape for ${platform}: ${scrapedText.length} chars`);
        }

        // Vision fallback: if caption text is sparse, extract text from thumbnail
        if ((!promptText || promptText.trim().length < 50) && thumbnailUrl) {
          console.log(`[Parse] Caption sparse (${promptText?.length || 0} chars), trying vision OCR from thumbnail`);
          try {
            const visionText = await extractTextFromThumbnail(thumbnailUrl);
            if (visionText) {
              // Combine: original caption first, then vision-extracted text
              promptText = [promptText, `[Text from image: ${visionText}]`].filter(Boolean).join('\n');
              console.log(`[Parse] Vision OCR added ${visionText.length} chars`);
            }
          } catch (err) {
            console.log(`[Parse] Vision OCR failed:`, err);
          }
        }
      }
    } else {
      console.log(`[Parse] Using Share Extension text: ${inputText.length} chars`);
    }

    // Fallback: combine all available signals for a useful prompt
    if (!promptText || promptText.trim().length < 10) {
      const fallbackParts: string[] = [`URL: ${url}`, `Platform: ${platform}`];
      // For Instagram/Threads, add URL metadata as context hints
      if (platform === 'instagram' || platform === 'threads') {
        const meta = extractInstagramMeta(url);
        if (meta.username) {
          fallbackParts.push(`Instagram author: @${meta.username}`);
          fallbackParts.push(`Note: @${meta.username} may be the business account — check if it matches a known HK restaurant/cafe/shop name`);
        }
        if (meta.postType) fallbackParts.push(`Post type: ${meta.postType}`);
        fallbackParts.push('This is a Hong Kong Instagram post about a place (restaurant, cafe, shop, or attraction). Try to identify the place from the URL and username.');
      }
      // RED / 小紅書 — JS-rendered, often get minimal content from scrape
      if (platform === 'red') {
        fallbackParts.push('This is a Xiaohongshu (RED/小紅書) post about a place in Hong Kong. The post likely contains a restaurant, cafe, shop, or attraction recommendation with location details. Extract whatever place information you can identify.');
      }
      // Facebook — may have minimal scrape data depending on post privacy
      if (platform === 'facebook') {
        fallbackParts.push('This is a Facebook post (possibly a Reel or video) about a place in Hong Kong. Facebook posts often contain restaurant/cafe names in the caption or video overlay text. Look for HK place names in the available content.');
      }
      // YouTube — oEmbed gives video title; description may have place details
      if (platform === 'youtube') {
        fallbackParts.push('This is a YouTube video (possibly a Short) about a place in Hong Kong. Video titles often contain the restaurant/cafe name and sometimes the area. Descriptions may list the address. Extract the main place being reviewed or featured.');
      }
      if (platform === 'dianping') {
        fallbackParts.push('This is a Dianping (大眾點評) link to a restaurant in Hong Kong or mainland China. The page likely contains shop name, address, cuisine type, average price, and ratings. Extract whatever details are available.');
      }
      promptText = fallbackParts.join('\n');
      console.log(`[Parse] Minimal input — constructed fallback prompt (${promptText.length} chars)`);
    }

    // ── 3. First Gemini call — extract from text ────────────
    const isLookup = url.startsWith('https://spot.app/lookup/') || url.startsWith('https://spot.app/manual/');

    let parsed: Record<string, unknown>;
    if (isLookup && promptText) {
      // "Look Up" request: user already provided the name — skip extract, go straight to enrichment
      console.log(`[Parse] Look Up mode — skipping extract, direct enrichment for: ${promptText.slice(0, 100)}`);
      parsed = {
        name_en: promptText.replace(/Hong Kong/i, '').replace(/\blookup\b/i, '').trim() || null,
        category: "other",
      };
    } else {
      const geminiStart = Date.now();
      parsed = await geminiExtract(promptText);
      console.log(`[Parse] Gemini extract took ${Date.now() - geminiStart}ms, input ${promptText.length} chars`);
    }

    // ── 4. Enrichment — three tiers ──────────────────────────
    const searchName = (parsed.name_en || parsed.name_original) as string | undefined;
    const hasAddress = !!(parsed.address_en || parsed.address_original);
    const isSocial = platform === 'instagram' || platform === 'threads' || platform === 'red' || platform === 'facebook' || platform === 'openrice' || platform === 'dianping' || platform === 'youtube';

    // Tier 1: Name extracted but no address — standard enrichment
    if (searchName && !hasAddress) {
      console.log(`[Enrich] Tier 1 — name found, looking up: ${searchName}`);

      // 4a. Gemini knowledge enrichment
      const geminiEnriched = await enrichWithGemini(searchName, {
        name_en: parsed.name_en,
        name_original: parsed.name_original,
        category: parsed.category,
      });

      if (geminiEnriched && Object.keys(geminiEnriched).length > 0) {
        parsed = {
          ...parsed,
          address_en: geminiEnriched.address_en || parsed.address_en,
          address_original: geminiEnriched.address_original || parsed.address_original,
          district: geminiEnriched.district || parsed.district,
          category: geminiEnriched.category && geminiEnriched.category !== 'other'
            ? geminiEnriched.category : parsed.category,
          price_hint: geminiEnriched.price_hint || parsed.price_hint,
          tags: [...new Set([...(parsed.tags || []), ...(geminiEnriched.tags || [])])],
        };
        console.log(`[Enrich] Gemini filled: ${Object.keys(geminiEnriched).join(', ')}`);
      }

      // 4b. If still no address, try Nominatim
      const stillNoAddress = !parsed.address_en && !parsed.address_original;
      if (stillNoAddress) {
        const nominatimResult = await enrichWithNominatim(searchName);
        if (nominatimResult.address_en) {
          parsed.address_en = nominatimResult.address_en as string;
          if (nominatimResult.district && !parsed.district) {
            parsed.district = nominatimResult.district as string;
          }
          if (!parsed.name_en && nominatimResult.address_en) {
            const firstPart = (nominatimResult.address_en as string).split(',')[0]?.trim();
            if (firstPart && !firstPart.match(/^\d/)) {
              parsed.name_en = parsed.name_en || firstPart;
            }
          }
          console.log(`[Enrich] Nominatim found address`);
        }
      }
    }

    // Tier 1.5: Address found but no name — reverse lookup
    if (!searchName && hasAddress) {
      const lookupAddress = parsed.address_en || parsed.address_original;
      console.log(`[Enrich] Tier 1.5 — address found, looking up name for: ${lookupAddress}`);

      const reverseResult = await reverseLookupFromAddress(lookupAddress as string);
      if (reverseResult && Object.keys(reverseResult).length > 0) {
        parsed = {
          ...parsed,
          name_en: (reverseResult.name_en as string) || parsed.name_en,
          name_original: (reverseResult.name_original as string) || parsed.name_original,
          category: (reverseResult.category as string) && (reverseResult.category as string) !== 'other'
            ? (reverseResult.category as string) : parsed.category,
          district: (reverseResult.district as string) || parsed.district,
          price_hint: (reverseResult.price_hint as string) || parsed.price_hint,
          tags: [...new Set([...(parsed.tags || []), ...(reverseResult.tags as string[] || [])])],
        };
        console.log(`[Enrich] Reverse lookup found: ${reverseResult.name_en || reverseResult.name_original || 'none'}`);
      }
    }

    // Tier 2: No name extracted from social platform — contextual search
    if (!searchName && isSocial && promptText && promptText.length > 10) {
      console.log(`[Enrich] Tier 2 — contextual search for ${platform}`);

      const contextualResult = await contextualPlaceSearch(url, platform, promptText);
      if (contextualResult && Object.keys(contextualResult).length > 0) {
        parsed = {
          ...parsed,
          name_en: (contextualResult.name_en as string) || parsed.name_en,
          name_original: (contextualResult.name_original as string) || parsed.name_original,
          district: (contextualResult.district as string) || parsed.district,
          category: (contextualResult.category as string) && (contextualResult.category as string) !== 'other'
            ? (contextualResult.category as string) : parsed.category,
        };
        console.log(`[Enrich] Contextual found: ${contextualResult.name_en || contextualResult.name_original || 'none'}`);

        // If contextual search found a name, now try standard enrichment for address
        const newName = (parsed.name_en || parsed.name_original) as string | undefined;
        const stillNoAddress = !parsed.address_en && !parsed.address_original;
        if (newName && stillNoAddress) {
          const geminiEnriched = await enrichWithGemini(newName, {
            name_en: parsed.name_en,
            name_original: parsed.name_original,
            category: parsed.category,
          });
          if (geminiEnriched && Object.keys(geminiEnriched).length > 0) {
            parsed = {
              ...parsed,
              address_en: geminiEnriched.address_en || parsed.address_en,
              address_original: geminiEnriched.address_original || parsed.address_original,
              district: geminiEnriched.district || parsed.district,
              price_hint: geminiEnriched.price_hint || parsed.price_hint,
              tags: [...new Set([...(parsed.tags || []), ...(geminiEnriched.tags || [])])],
            };
          }
        }
      }
    }

    // Tier 3: Has address already — skip enrichment
    if (searchName && hasAddress) {
      console.log(`[Enrich] Tier 3 — skipping, address already present for: ${searchName}`);
    }

    // ── 5. Cache result (fire-and-forget) ────────────────────
    const hasName = !!(parsed.name_en || parsed.name_original);
    if (hasName) {
      // Upsert into saved_items so subsequent parses of this URL hit the cache
      // Only insert if not already cached (preserves curated entries)
      supabase.from("saved_items")
        .upsert({
          source_url: url,
          source_platform: platform as any,
          name_original: parsed.name_original || null,
          name_en: parsed.name_en || null,
          address_original: parsed.address_original || null,
          address_en: parsed.address_en || null,
          category: parsed.category || "other",
          district: parsed.district || null,
          price_hint: parsed.price_hint || null,
          tags: parsed.tags || [],
          raw_text: parsed.raw_text || promptText,
          parsed_json: { thumbnail_url: thumbnailUrl || null },
        }, { onConflict: "source_url", ignoreDuplicates: true })
        .then(() => console.log(`[Cache] Upserted: ${url.slice(0, 80)}`))
        .catch((err: any) => console.log(`[Cache] Upsert skipped (already exists): ${err?.message}`));
    }

    // ── 6. Build error hint ──────────────────────────────────
    const hasAddr = !!(parsed.address_en || parsed.address_original);
    let parseHint: string | null = null;

    if (!hasName && !hasAddr) {
      const isJsRendered = platform === 'red' || platform === 'instagram' || platform === 'threads';
      if (isJsRendered) {
        parseHint = `This platform's pages can't be read automatically. For best results, share directly from the app using the iOS Share Sheet, or type the name and use Look Up.`;
      } else if (platform === 'openrice') {
        parseHint = `Couldn't read this OpenRice link. Try pasting the full restaurant page URL instead of a short link, or type the name and use Look Up.`;
      } else {
        parseHint = `Couldn't extract details from this link. Try typing the name and tapping Look Up to search for the address.`;
      }
    } else if (!hasAddr) {
      parseHint = `Found the name but couldn't find the address. You can type the address manually or try Look Up to search for it.`;
    } else if (!hasName) {
      parseHint = `Found an address but not the place name. Type the name manually or try Look Up.`;
    }

    // ── 7. Return result ────────────────────────────────────
    return new Response(JSON.stringify({
      name_original: parsed.name_original || null,
      name_en: parsed.name_en || null,
      address_original: parsed.address_original || null,
      address_en: parsed.address_en || null,
      category: parsed.category || "other",
      district: parsed.district || null,
      price_hint: parsed.price_hint || null,
      tags: parsed.tags || [],
      raw_text: parsed.raw_text || promptText,
      thumbnail_url: thumbnailUrl || null,
      parse_hint: parseHint,
      cached: false,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Parse error:", err);
    return new Response(JSON.stringify({
      name_original: null, name_en: null,
      address_original: null, address_en: null,
      category: "other", district: null, price_hint: null,
      tags: [], raw_text: "",
      parse_failed: true,
      parse_hint: `Something went wrong while reading this link. Try again, or enter the details manually and use Look Up.`,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
});
