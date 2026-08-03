// Supabase Edge Function: prospect-search
// Searches for businesses in a given industry + district, returns scored prospect list.
// Uses DuckDuckGo HTML search (free) + Gemini for extraction & scoring.

import "jsr:@std/dotenv/load";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// ── Types ────────────────────────────────────────────────────────

interface ProspectRequest {
  industry: string;       // e.g. "通渠", "水電", "裝修", "搬屋"
  industryEn?: string;    // e.g. "drain cleaning", "plumbing"
  district: string;       // e.g. "油尖旺", "大角咀", "旺角"
  districtEn?: string;    // e.g. "Yau Tsim Mong"
  language?: "zh" | "en" | "both";
}

interface Prospect {
  name: string;
  name_en?: string;
  district: string;
  phone: string;
  whatsapp: string;
  has_website: "no" | "basic" | "yes";
  website_url?: string;
  rating?: string;
  whatsapp_likely: boolean;
  score: number;
  notes: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function cleanPhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]+/g, '').replace(/^852/, '');
}

function isHKMobile(phone: string): boolean {
  const raw = cleanPhone(phone);
  return /^[569]\d{7}$/.test(raw);
}

function toWhatsApp(phone: string): string {
  const raw = cleanPhone(phone);
  if (raw.startsWith('852')) return raw;
  return `852${raw}`;
}

// ── Multi-source Web Search ──────────────────────────────────────

const BRAVE_API_KEY = Deno.env.get("BRAVE_API_KEY") || "";
const HAS_BRAVE = BRAVE_API_KEY.length > 10;
const HAS_GEMINI = (Deno.env.get("GEMINI_API_KEY") || "").length > 10;
console.log(`[Init] BRAVE_API_KEY present: ${HAS_BRAVE}, GEMINI_API_KEY present: ${HAS_GEMINI}`);

interface SearchSnippet {
  title: string;
  url: string;
  description: string;
}

async function searchWeb(query: string, debugLog: string[], maxResults = 10): Promise<SearchSnippet[]> {
  const snippets: SearchSnippet[] = [];

  // Brave Search API
  if (BRAVE_API_KEY) {
    try {
      const params = new URLSearchParams({ q: query, count: String(maxResults) });
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": BRAVE_API_KEY,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const results = data?.web?.results || [];
        debugLog.push(`Brave: ${results.length} results for "${query.slice(0,30)}..."`);
        for (const r of results) {
          if (r.url && snippets.length < maxResults) {
            snippets.push({
              title: r.title || '',
              url: r.url,
              description: r.description || '',
            });
          }
        }
      } else {
        const errorBody = await res.text();
        debugLog.push(`Brave ${res.status}: ${errorBody.slice(0, 200)}`);
      }
    } catch (err) {
      debugLog.push(`Brave err: ${(err as Error).message}`);
    }
  } else {
    debugLog.push('Brave: no API key configured');
  }

  return snippets;
}

// ── Gemini: Extract prospects from search snippets ────────────────

const EXTRACT_PROMPT = `You are a Hong Kong business data extractor. From the search results below, extract ALL businesses in the [INDUSTRY] / [DISTRICT] area.

For each business, extract:
- name: Chinese business name (required)
- name_en: English name if visible
- district: specific area within the district
- phone: phone number in format XXXX XXXX
- has_website: "no" | "basic" | "yes"
- website_url: if available
- rating: star rating if visible (e.g. "4.5")
- notes: brief context (years in business, specialties, etc.)

SCORING RULES (1-5):
- Score 5: No website + mobile phone (starts with 5/6/9) + old district area
- Score 4: No website + landline + good reputation
- Score 3: Basic/old website + mobile number
- Score 2: Has website but outdated
- Score 1: Modern professional website (low priority for landing page sales)

Return ONLY a JSON array (no markdown, no backticks):
[
  {
    "name": "中文名",
    "name_en": "English name or null",
    "district": "area",
    "phone": "XXXX XXXX",
    "has_website": "no",
    "website_url": null,
    "rating": null,
    "score": 5,
    "notes": "context"
  }
]

If you find fewer than 15 businesses, that's fine — return only what you can confirm. Do NOT invent data.`;

// ── Gemini call helper ───────────────────────────────────────────

async function geminiCall(prompt: string, input: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}\n\n---\nSearch results:\n${input.substring(0, 8000)}` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

  // Clean and repair JSON
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').trim();

  // Try direct parse
  try { return JSON.parse(text); } catch {}

  // Repair: if text ends mid-array/item, close it
  try { return JSON.parse(text + ']'); } catch {}
  try { return JSON.parse(text + '"}];'); } catch {}
  try { return JSON.parse(text + '"}]'); } catch {}

  // Last resort: regex-extract individual prospect objects
  const prospects: Record<string, unknown>[] = [];
  const matches = text.matchAll(/\{[^}]*"name"\s*:\s*"[^"]*"[^}]*\}/g);
  for (const m of matches) {
    try { prospects.push(JSON.parse(m[0])); } catch {}
  }
  if (prospects.length > 0) {
    console.log(`[Gemini] Repaired ${prospects.length} prospects from truncated JSON`);
    return { prospects } as any;
  }

  console.log(`[Gemini] Parse failed. Raw (200 chars): ${text.slice(0, 200)}`);
  return {};
}

// ── Main handler ──────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const { industry, industryEn, district, districtEn, language } = (await req.json()) as ProspectRequest;

    if (!industry || !district) {
      return new Response(JSON.stringify({ error: "industry and district are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // ── 1. Build search queries ──────────────────────────────
    const queries: string[] = [
      `${industry} ${district} 電話`,
      `${industry} ${district} 24小時`,
      `${industry}公司 ${district} 聯絡`,
    ];

    if (industryEn) {
      queries.push(`${industryEn} ${districtEn || district} phone`);
      queries.push(`${industryEn} Hong Kong ${districtEn || district}`);
    }

    // Add sub-district searches if the district is a larger area
    const districtAreas: Record<string, string[]> = {
      '油尖旺': ['大角咀', '旺角', '油麻地', '尖沙咀', '佐敦'],
      '中西區': ['中環', '上環', '西環', '堅尼地城', '金鐘'],
      '灣仔': ['銅鑼灣', '灣仔', '跑馬地', '大坑'],
      '東區': ['北角', '太古', '鰂魚涌', '筲箕灣'],
      '深水埗': ['深水埗', '長沙灣', '荔枝角', '美孚'],
      '觀塘': ['觀塘', '牛頭角', '九龍灣', '油塘'],
      '沙田': ['沙田', '大圍', '馬鞍山'],
      '荃灣': ['荃灣', '深井'],
      '元朗': ['元朗', '天水圍'],
      '屯門': ['屯門'],
      '九龍城': ['九龍城', '土瓜灣', '紅磡', '何文田'],
      '黃大仙': ['黃大仙', '鑽石山', '慈雲山'],
      '葵青': ['葵涌', '葵芳', '青衣'],
      '北區': ['上水', '粉嶺'],
      '大埔': ['大埔'],
      '西貢': ['西貢', '將軍澳', '坑口'],
      '南區': ['香港仔', '鴨脷洲', '赤柱', '淺水灣'],
      '離島': ['東涌', '長洲', '南丫島'],
    };

    const areas = districtAreas[district] || [district];
    for (const area of areas.slice(0, 4)) { // max 4 sub-area searches
      queries.push(`${industry} ${area} 電話`);
    }

    const debugLog: string[] = [];
    console.log(`[Prospect] Running ${queries.length} searches for "${industry}" in "${district}"`);

    // ── 2. Run searches in parallel, collect snippets ─────────
    const allSnippets: SearchSnippet[] = [];
    const seenUrls = new Set<string>();

    await Promise.all(
      queries.map(async (q) => {
        const results = await searchWeb(q, debugLog, 8);
        for (const r of results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            allSnippets.push(r);
          }
        }
      })
    );

    debugLog.push(`Unique snippets: ${allSnippets.length}`);
    console.log(`[Prospect] ${allSnippets.length} unique snippets across all searches`);

    // ── 3. Quick metadata scrape from each result URL ────────
    // Fetch just enough HTML to extract phone numbers, addresses, business names
    debugLog.push(`Scraping metadata from ${allSnippets.length} URLs...`);

    // Scrape fewer URLs with shorter timeout for faster completion
    const urlsToScrape = allSnippets.slice(0, 15);

    const enriched = await Promise.all(
      urlsToScrape.map(async (s) => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 2500); // 2.5s timeout per URL
          const res = await fetch(s.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
              "Accept": "text/html",
              "Accept-Language": "en-HK,en;q=0.9,zh-HK;q=0.8",
            },
            redirect: "follow",
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (!res.ok) return { ...s, meta: '' };

          const html = await res.text();
          const metaParts: string[] = [];

          // Title tag
          const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
          if (title) metaParts.push(`Title: ${title.trim()}`);

          // Meta description
          const desc = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1];
          if (desc) metaParts.push(`Desc: ${desc.trim()}`);

          // Phone numbers (HK mobile + landline)
          const phones = html.match(/(?:\+852[\s\-]?)?[2569]\d{3}[\s\-]?\d{4}/g) || [];
          if (phones.length) metaParts.push(`Phone: ${[...new Set(phones)].join(', ')}`);

          // JSON-LD
          const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
          if (ldMatch) {
            try {
              const ld = JSON.parse(ldMatch[1]);
              if (ld.name) metaParts.push(`Business: ${ld.name}`);
              if (ld.telephone) metaParts.push(`Tel: ${ld.telephone}`);
              if (ld.address?.streetAddress) metaParts.push(`Addr: ${ld.address.streetAddress}`);
            } catch {}
          }

          return { ...s, meta: metaParts.join(' | ') };
        } catch {
          return { ...s, meta: '' };
        }
      })
    );

    const enrichedCount = enriched.filter(e => e.meta).length;
    debugLog.push(`Scraped: ${enrichedCount}/${enriched.length} pages returned metadata`);

    // ── 4. Gemini extraction (batch processing for higher yield) ──
    const prompt = EXTRACT_PROMPT
      .replace('[INDUSTRY]', industry)
      .replace('[DISTRICT]', district);

    // Split into batches of 8 for better extraction quality
    const BATCH_SIZE = 6;
    const batches: SearchSnippet[][] = [];
    for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
      batches.push(enriched.slice(i, i + BATCH_SIZE));
    }

    debugLog.push(`Processing ${batches.length} batches of ${BATCH_SIZE}`);

    const batchResults = await Promise.all(
      batches.map(async (batch, idx) => {
        const batchInput = [
          `BATCH ${idx + 1}/${batches.length}: ${industry} businesses in ${district}`,
          'Extract ALL distinct businesses. Include phone numbers from PAGE META.',
          '',
          ...batch.map(e =>
            `TITLE: ${e.title}\nDESC: ${e.description}\nURL: ${e.url}\nPAGE META: ${e.meta || '(none)'}\n---`
          ),
        ].join('\n');

        console.log(`[Prospect] Batch ${idx + 1}: ${batch.length} items, ${batchInput.length} chars`);
        const result = await geminiCall(prompt, batchInput);
        const items = (Array.isArray(result) ? result : (result as any)?.prospects || []) as any[];
        debugLog.push(`Batch ${idx + 1}: ${items.length} prospects`);
        return items;
      })
    );

    // Merge, deduplicate by phone first (most reliable), then by name
    const allProspects = batchResults.flat();
    const seenPhones = new Set<string>();
    const seenNames = new Set<string>();
    const prospects: any[] = [];
    for (const p of allProspects) {
      const phone = (p.phone || '').replace(/[\s\-\/]+/g, '');
      const name = (p.name || '').trim().toLowerCase().replace(/\s*公司$/, '');

      // Skip if phone already seen (phone dedup)
      if (phone && seenPhones.has(phone)) continue;
      // Skip if name already seen and no new phone
      if (name && seenNames.has(name) && !phone) continue;

      if (phone) seenPhones.add(phone);
      if (name) seenNames.add(name);
      prospects.push(p);
    }
    debugLog.push(`Merged: ${prospects.length} unique prospects from ${batches.length} batches`);

    // ── 5. Post-process & clean ──────────────────────────────
    const cleaned: Prospect[] = prospects.map((p: any, i: number) => {
      const phone = p.phone || '';
      const mobile = isHKMobile(phone);
      const noWebsite = p.has_website === 'no' || !p.website_url;
      const basicWebsite = p.has_website === 'basic';

      // Re-score to ensure consistency
      let score = p.score || 3;
      if (noWebsite && mobile) score = Math.max(score, 5);
      else if (noWebsite && !mobile) score = Math.max(score, 3);
      else if (basicWebsite && mobile) score = Math.max(score, 4);
      else if (p.has_website === 'yes') score = Math.min(score, 2);

      return {
        name: p.name || 'Unknown',
        name_en: p.name_en || undefined,
        district: p.district || district,
        phone: phone,
        whatsapp: mobile ? toWhatsApp(phone) : '',
        has_website: p.has_website || (p.website_url ? 'yes' : 'no'),
        website_url: p.website_url || undefined,
        rating: p.rating || undefined,
        whatsapp_likely: mobile,
        score,
        notes: p.notes || '',
      };
    });

    // Sort by score descending
    cleaned.sort((a, b) => b.score - a.score);

    // ── 6. Summary stats ─────────────────────────────────────
    const total = cleaned.length;
    const withWhatsApp = cleaned.filter(p => p.whatsapp_likely).length;
    const noWebsite = cleaned.filter(p => p.has_website === 'no').length;
    const basicWebsite = cleaned.filter(p => p.has_website === 'basic').length;
    const withRating = cleaned.filter(p => p.rating).length;
    const top5 = cleaned.filter(p => p.score >= 5).length;
    const top4 = cleaned.filter(p => p.score >= 4).length;

    return new Response(JSON.stringify({
      prospects: cleaned,
      summary: {
        total,
        with_whatsapp: withWhatsApp,
        no_website: noWebsite,
        basic_website: basicWebsite,
        with_rating: withRating,
        score_5: top5,
        score_4_plus: top4,
        top_10: cleaned.slice(0, 10),
        searches_run: queries.length,
        urls_found: allSnippets.length,
      },
      _debug: {
        brave_key_set: HAS_BRAVE,
        gemini_key_set: HAS_GEMINI,
        search_count: queries.length,
        url_count: allSnippets.length,
        prospect_count: cleaned.length,
        log: debugLog,
        sample_snippets: enriched.slice(0, 3).map(s => ({ t: s.title.slice(0,60), m: s.meta.slice(0,120) })),
      },
      meta: {
        industry,
        industry_en: industryEn || null,
        district,
        district_en: districtEn || null,
        subdistricts: areas,
        generated_at: new Date().toISOString(),
      },
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    console.error("[Prospect] Error:", err);
    return new Response(JSON.stringify({
      error: "Search failed. Try again with different keywords.",
      details: (err as Error).message,
    }), {
      status: 200, // Return 200 so client can read the error body
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
