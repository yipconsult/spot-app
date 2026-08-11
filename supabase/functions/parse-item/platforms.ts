// Platform detection, oEmbed, and HTML scraping
import { FB_APP_TOKEN } from './config.ts';
import { findNoteInNextData, findDianpingShopData } from './utils.ts';
import { extractTextFromThumbnail } from './vision.ts';
import type { Platform, OembedResult } from './types.ts';

export function detectPlatform(url: string): Platform {
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

export function extractInstagramMeta(url: string): { username: string | null; postType: string | null } {
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

export async function fetchOembed(url: string, platform: Platform): Promise<OembedResult> {
  let oembedUrls: string[] = [];
  const result: OembedResult = { text: null, thumbnailUrl: null };
  try {
    switch (platform) {
      case 'instagram':
      case 'threads':
        // Only try oEmbed if we have a Facebook token — unauthenticated
        // api.instagram.com/oembed is deprecated by Meta and returns errors.
        if (FB_APP_TOKEN) {
          oembedUrls.push(`https://graph.facebook.com/v22.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${FB_APP_TOKEN}&fields=title,author_name,thumbnail_url`);
        }
        // If no token, we skip oEmbed and fall straight to HTML scraping
        break;
      case 'facebook':
        if (FB_APP_TOKEN) {
          oembedUrls.push(`https://graph.facebook.com/v22.0/oembed_post?url=${encodeURIComponent(url)}&access_token=${FB_APP_TOKEN}`);
        }
        oembedUrls.push(`https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`);
        oembedUrls.push(`https://www.facebook.com/plugins/video/oembed.json/?url=${encodeURIComponent(url)}`);
        break;
      case 'youtube':
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
      if (data.description) parts.push(data.description as string);
      result.text = parts.join('\n') || null;

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

export async function fetchAndScrapeHtml(url: string, platform?: Platform): Promise<{ text: string; thumbnailUrl: string | null }> {
  const result = { text: '', thumbnailUrl: null as string | null };
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
      return result;
    }

    const html = await pageRes.text();
    const parts: string[] = [];

    // Extract og:image for vision OCR fallback (especially useful for RED cover images)
    const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i)?.[1];
    if (ogImage) {
      result.thumbnailUrl = ogImage;
      console.log(`[Scrape] Found og:image for ${platform}: ${ogImage.slice(0, 80)}`);
    }

    // ── Priority content first (Gemini sees this before the 4K char limit) ──
    // 1. Meta description — Instagram/Facebook put the full caption here
    const descMeta = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1];
    if (descMeta) parts.push(descMeta);

    // 2. Title tag
    const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
    if (titleTag) {
      parts.push(`Page title: ${titleTag}`);
      if (platform === 'instagram' || platform === 'threads') {
        const captionMatch = titleTag.match(/"([^"]+)"/);
        if (captionMatch && captionMatch[1].length > 5) {
          parts.push(`Post caption: ${captionMatch[1]}`);
        }
      }
    }

    // 3. H1 headings (max 3)
    const h1s = (html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || [])
      .slice(0, 3)
      .map(h => h.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    if (h1s.length) parts.push(`Headings: ${h1s.join(' | ')}`);

    // ── Secondary content (filtered) ──
    // 4. OG tags — video URLs already filtered above
    const ogTags = html.match(/<meta[^>]+property="og:([^"]+)"[^>]+content="([^"]*)"/gi) || [];
    for (const tag of ogTags) {
      const prop = tag.match(/property="og:([^"]+)"/i)?.[1];
      const content = tag.match(/content="([^"]*)"/i)?.[1];
      // Skip images, site meta, and video URLs (huge, no useful content)
      if (prop && content && !['image', 'url', 'type', 'site_name', 'locale', 'video', 'video:secure_url', 'video:type', 'video:width', 'video:height'].includes(prop)) {
        // Truncate long values (e.g., tracking URLs)
        parts.push(`og:${prop}: ${content.slice(0, 500)}`);
      }
    }

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

    try {
      const pathname = new URL(url).pathname;
      parts.push(`URL path: ${pathname}`);
    } catch { /* ignore */ }

    if ((platform === 'instagram' || platform === 'threads') && !parts.some(p => p.includes('Author:'))) {
      try {
        const pathParts = new URL(url).pathname.split('/').filter(Boolean);
        if (platform === 'instagram' && pathParts.length >= 1) {
          parts.push(`Platform: Instagram post`);
        }
        if (platform === 'threads' && pathParts.length >= 2) {
          const username = pathParts[0]?.replace('@', '');
          if (username) parts.push(`Author: @${username} (Threads)`);
        }
      } catch { /* ignore */ }
    }

    if (platform === 'facebook') {
      const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1];
      if (ogDesc && ogDesc.length > 10) {
        parts.push(`Post caption: ${ogDesc}`);
      }
      const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
      if (ogTitle && ogTitle !== ogDesc && !parts.some(p => p.includes(ogTitle!))) {
        parts.push(`Post title: ${ogTitle}`);
      }
      try {
        const pathname = new URL(url).pathname;
        if (url.includes('reel') || url.includes('/share/r/') || url.includes('fb.watch')) {
          parts.push('Note: This is a Facebook Reel or video. Look for place mentions in the caption and title.');
        }
        if (pathname.includes('/posts/') || pathname.includes('/videos/')) {
          parts.push('Note: This is a Facebook post or video. Check the description for place mentions.');
        }
        const pageMatch = pathname.match(/^\/([^/]+)\/(?:posts|videos|reels)\//);
        if (pageMatch) {
          parts.push(`Facebook page: @${pageMatch[1]}`);
        }
      } catch { /* ignore */ }
      parts.push('Platform: Facebook post — this is a social media post about a place in Hong Kong');
    }

    if (platform === 'youtube') {
      const ytTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
      const ytDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1];
      if (ytTitle) {
        const cleanTitle = ytTitle.replace(/\s*-\s*YouTube\s*$/i, '').trim();
        parts.push(`Video title: ${cleanTitle}`);
      }
      if (ytDesc && ytDesc.length > 10) {
        parts.push(`Video description: ${ytDesc.slice(0, 500)}`);
      }
      const ogSiteName = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/i)?.[1];
      if (ogSiteName) parts.push(`Channel: ${ogSiteName}`);
      if (url.includes('/shorts/')) {
        parts.push('Note: This is a YouTube Short — a short video likely showcasing a Hong Kong restaurant, cafe, or attraction');
      } else {
        parts.push('Note: This is a YouTube video — likely a food/place review or recommendation in Hong Kong');
      }
    }

    if (platform === 'openrice') {
      const pathname = new URL(url).pathname;
      const isShortLink = url.includes('s.openrice.com');
      const nameFromPath = pathname.match(/\/(?:r|restaurant)-([^/\s?]+)/i)?.[1];
      if (nameFromPath) {
        parts.push(`URL name hint: ${nameFromPath.replace(/-/g, ' ')}`);
      } else if (isShortLink) {
        parts.push('Note: This is an OpenRice short link. The page redirects to the full restaurant page.');
      }
      const cuisineMatches = html.match(/<a[^>]*href="[^"]*\/(?:cuisine|dish|type)[^"]*"[^>]*>([^<]+)<\/a>/gi) || [];
      const cuisines = [...new Set(cuisineMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean))];
      if (cuisines.length) parts.push(`Cuisine: ${cuisines.join(', ')}`);
      const addressBlock = html.match(/<div[^>]*class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (addressBlock) {
        const addressText = addressBlock[1].replace(/<[^>]+>/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
        if (addressText && addressText.length > 5) parts.push(`Address from page: ${addressText}`);
      }
      const phoneMatch = html.match(/(?:tel|phone|電話)[:\s]*[">]?\s*(\+?[\d\s-]{8,})/i);
      if (phoneMatch) parts.push(`Phone: ${phoneMatch[1].trim()}`);
      const hoursMatch = html.match(/(?:opening|hours|營業|開放)[\s\S]{0,100}?(\d{1,2}[:.]\d{2}\s*[ap]m\s*[-–—]\s*\d{1,2}[:.]\d{2}\s*[ap]m)/i);
      if (hoursMatch) parts.push(`Hours: ${hoursMatch[1]}`);
      const priceMatch = html.match(/(?:人均|per head|average|消費)[\s\S]{0,50}?(H?K?\$\s*\d{2,4}\s*[-–—]\s*\d{2,4})/i);
      if (priceMatch) parts.push(`Price: ${priceMatch[1]}`);
      parts.push('Platform: OpenRice Hong Kong restaurant page');
    }

    if (platform === 'red') {
      let redDataFound = false;

      const nextData = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextData) {
        try {
          const parsed = JSON.parse(nextData[1]);
          const noteData = findNoteInNextData(parsed);
          if (noteData) {
            if (noteData.title) { parts.push(`Post title: ${noteData.title}`); redDataFound = true; }
            if (noteData.desc) { parts.push(`Description: ${noteData.desc}`); redDataFound = true; }
            if (noteData.tagList) parts.push(`Tags: ${noteData.tagList}`);
            if (noteData.ipLocation) parts.push(`Location: ${noteData.ipLocation}`);
            if (noteData.noteId) parts.push(`Note ID: ${noteData.noteId}`);
          }
        } catch { /* ignore */ }
      }

      const scriptDataPatterns = [
        /<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})<\/script>/i,
        /<script[^>]+id="__INITIAL_STATE__"[^>]*>([\s\S]*?)<\/script>/i,
        /<script[^>]*>window\._SSR_HYDRATED_DATA\s*=\s*({[\s\S]*?})<\/script>/i,
      ];
      for (const pattern of scriptDataPatterns) {
        const match = html.match(pattern);
        if (match) {
          try {
            const state = JSON.parse(match[1]);
            const noteInfo = state?.note?.noteDetailMap || state?.noteDetail || state?.note || state?.noteInfo;
            if (noteInfo) {
              const note = Array.isArray(noteInfo) ? noteInfo[0] : Object.values(noteInfo)[0] as any;
              if (note?.note?.title) { parts.push(`Post title: ${note.note.title}`); redDataFound = true; }
              if (note?.note?.desc) { parts.push(`Description: ${note.note.desc}`); redDataFound = true; }
              if (note?.note?.tagList?.length) parts.push(`Tags: ${note.note.tagList.map((t: any) => t.name || t).join(', ')}`);
              if (note?.note?.ipLocation) parts.push(`Location: ${note.note.ipLocation}`);
              if (note?.note?.noteId) parts.push(`Note ID: ${note.note.noteId}`);
            }
            if (state?.title || state?.desc) {
              if (state.title) { parts.push(`Post title: ${state.title}`); redDataFound = true; }
              if (state.desc) { parts.push(`Description: ${state.desc}`); redDataFound = true; }
            }
          } catch { /* ignore */ }
          break;
        }
      }

      const renderData = html.match(/<script[^>]*>window\.__(?:RENDER_DATA__|DATA__)\s*=\s*({[\s\S]*?})<\/script>/i)
        || html.match(/<script[^>]*id="__(?:RENDER_DATA__|DATA__)"[^>]*>([\s\S]*?)<\/script>/i);
      if (renderData) {
        try {
          const parsed = JSON.parse(renderData[1]);
          const noteData = findNoteInNextData(parsed);
          if (noteData) {
            if (noteData.title) { parts.push(`Post title: ${noteData.title}`); redDataFound = true; }
            if (noteData.desc) { parts.push(`Description: ${noteData.desc}`); redDataFound = true; }
            if (noteData.tagList) parts.push(`Tags: ${noteData.tagList}`);
            if (noteData.ipLocation) parts.push(`Location: ${noteData.ipLocation}`);
          }
        } catch { /* ignore */ }
      }

      if (!redDataFound) {
        const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
        const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1];
        if (ogTitle && !ogTitle.includes('小紅書') && !ogTitle.includes('Xiaohongshu')) {
          parts.push(`Post title: ${ogTitle}`);
          redDataFound = true;
        }
        if (ogDesc && ogDesc.length > 10) {
          parts.push(`Description: ${ogDesc}`);
          redDataFound = true;
        }
      }

      if (!redDataFound) {
        const contentMatches = html.match(/<div[^>]*class="[^"]*(?:note-text|desc|content|title)[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/gi) || [];
        const contentTexts = contentMatches
          .map(m => m.replace(/<[^>]+>/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
          .filter(t => t.length > 15);
        if (contentTexts.length) {
          parts.push(`Page content: ${contentTexts.join(' | ').slice(0, 500)}`);
          redDataFound = true;
        }
      }

      try {
        const pathname = new URL(url).pathname;
        const itemId = pathname.match(/\/item\/([a-zA-Z0-9]+)/i)?.[1];
        if (itemId) parts.push(`Post ID: ${itemId}`);
      } catch { /* ignore */ }

      parts.push('Platform: Xiaohongshu (RED) post — this is a social media post about a place in Hong Kong');
    }

    if (platform === 'googlemaps') {
      parts.push('Platform: Google Maps shared location');
    }

    if (platform === 'dianping') {
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

      try {
        const pathname = new URL(url).pathname;
        const shopId = pathname.match(/\/shop\/(\d+)/i)?.[1] || pathname.match(/\/(\d{5,})/)?.[1];
        if (shopId) parts.push(`Shop ID: ${shopId}`);
      } catch { /* ignore */ }

      const mainContent = html.match(/<div[^>]*class="[^"]*(?:main|content|shop|detail)[^"]*"[^>]*>([\s\S]{0,3000}?)<\/div>/i);
      if (mainContent) {
        const text = mainContent[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 20) parts.push(`Page content: ${text.slice(0, 500)}`);
      }

      parts.push('Platform: Dianping (大眾點評) — this is a mainland Chinese restaurant review page');
    }

    result.text = parts.filter(Boolean).join('\n');
    return result;
  } catch (err) {
    console.log("[Scrape] fetch failed:", err);
    return result;
  }
}
