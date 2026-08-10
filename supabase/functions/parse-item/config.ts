// Environment variables and shared clients
import { createClient } from "jsr:@supabase/supabase-js@2";
import "jsr:@std/dotenv/load";

export const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const FB_APP_TOKEN = Deno.env.get("FB_APP_TOKEN") || "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Server-side URL normalization (mirrors src/lib/url.ts on client).
 * Ensures cache lookup/storage is consistent regardless of tracking params.
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
  if (url.startsWith('openrice://')) {
    url = url.replace('openrice://', 'https://www.openrice.com/');
  }

  try {
    const u = new URL(url);
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./, '');
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';

    for (const p of ['igsh', 'igshid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ref', 'si']) {
      if (u.searchParams.has(p)) u.searchParams.delete(p);
    }

    // Platforms where ALL query params are tracking-only.
    // OpenRice and Google Maps intentionally excluded.
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

    url = u.toString();
  } catch { /* not a valid URL */ }

  return url;
}
