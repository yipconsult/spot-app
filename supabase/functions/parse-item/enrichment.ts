// Enrichment tiers: Gemini knowledge, Nominatim geocoding, reverse lookup, contextual search
import { GEMINI_URL, GEMINI_API_KEY } from './config.ts';
import { safeParseGeminiJson } from './utils.ts';
import type { Platform } from './types.ts';

export async function enrichWithGemini(
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

export async function enrichWithNominatim(name: string): Promise<Record<string, unknown>> {
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

export async function reverseLookupFromAddress(
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

export async function contextualPlaceSearch(
  url: string,
  platform: Platform,
  promptText: string,
): Promise<Record<string, unknown>> {
  const contextParts: string[] = [];

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
    const channelMatch = promptText.match(/Channel:\s*(.+)/i);
    if (channelMatch) contextParts.push(`Channel: ${channelMatch[1]}`);
  }

  if (promptText) contextParts.push(`Available content: ${promptText.substring(0, 1000)}`);

  const platformLabel = platform === 'facebook' ? 'Facebook' : platform === 'youtube' ? 'YouTube' : platform === 'red' ? 'Xiaohongshu (RED)' : platform === 'threads' ? 'Threads' : 'Instagram';

  const searchPrompt = `You are a Hong Kong location expert. A ${platformLabel} post was shared but we couldn't identify the place. Look at the context clues and identify the MAIN place this post is about.

Context:
${contextParts.join('\n')}

Think step by step:
1. Does the account/channel name itself look like a business/restaurant name? (e.g., @bakehousehk -> Bakehouse)
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
