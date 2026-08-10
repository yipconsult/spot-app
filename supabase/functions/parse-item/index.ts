// Main handler — wires all modules together
import { supabase, normalizeUrl } from './config.ts';
import { detectPlatform, extractInstagramMeta, fetchOembed, fetchAndScrapeHtml } from './platforms.ts';
import { extractFromGoogleMapsUrl, resolveGoogleMapsShortLink, resolveOpenRiceShortLink } from './maps.ts';
import { extractTextFromThumbnail } from './vision.ts';
import { geminiExtract } from './gemini.ts';
import { enrichWithGemini, enrichWithNominatim, reverseLookupFromAddress, contextualPlaceSearch } from './enrichment.ts';
import type { ParseRequest, Platform } from './types.ts';

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
    const normalizedUrl = normalizeUrl(url);
    const { data: existing } = await supabase
      .from("saved_items")
      .select("*")
      .eq("source_url", normalizedUrl)
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

      // Google Maps
      if (platform === 'googlemaps') {
        const isShortLink = url.includes('goo.gl/maps') || url.includes('maps.app.goo.gl');
        if (isShortLink) {
          const resolved = await resolveGoogleMapsShortLink(url);
          if (resolved !== url && resolved.includes('google.com/maps')) {
            scrapeUrl = resolved;
            console.log(`[Parse] Google Maps short link resolved: ${resolved}`);
          } else {
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
          promptText = `Google Maps Place: ${gmapsData.placeName}`;
          if (gmapsData.lat && gmapsData.lng) {
            promptText += `\nCoordinates: ${gmapsData.lat}, ${gmapsData.lng}`;
          }
          promptText += `\nSource URL: ${scrapeUrl}\n\nThis is a Hong Kong place shared via Google Maps. Extract the complete restaurant/place details.`;
          console.log(`[Parse] Google Maps — extracted name from URL: ${gmapsData.placeName}, coords: ${!!gmapsData.lat}`);
        } else {
          promptText = `Google Maps URL: ${scrapeUrl}\n\nThis is a Google Maps link to a place in Hong Kong. Extract the restaurant/place details from the URL.`;
          console.log(`[Parse] Google Maps — no name in URL, passing URL as context`);
        }
      }

      // OpenRice deep links
      if (platform === 'openrice' && url.startsWith('openrice://')) {
        const openriceHttp = url
          .replace('openrice://', 'https://www.openrice.com/')
          .replace(/^https:\/\/www\.openrice\.com\/r\//, 'https://www.openrice.com/hongkong/restaurant/')
          .replace(/^https:\/\/www\.openrice\.com\/s\//, 'https://www.openrice.com/hongkong/r/');
        scrapeUrl = openriceHttp;
        console.log(`[Parse] Converted OpenRice deep link to: ${scrapeUrl}`);
      }

      // OpenRice short links
      if (platform === 'openrice' && url.includes('s.openrice.com')) {
        const resolved = await resolveOpenRiceShortLink(url);
        if (resolved !== url) {
          scrapeUrl = resolved;
          console.log(`[Parse] OpenRice short link resolved, scraping full page`);
        } else {
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
        const oembedResult = await fetchOembed(scrapeUrl, platform);
        if (oembedResult.text) {
          promptText = oembedResult.text;
          thumbnailUrl = oembedResult.thumbnailUrl;
          console.log(`[Parse] Got oEmbed data for ${platform}, hasThumbnail: ${!!thumbnailUrl}`);
        } else {
          const scrapeResult = await fetchAndScrapeHtml(scrapeUrl, platform);
          promptText = scrapeResult.text;
          // Use og:image from HTML scrape as thumbnail (enables RED vision OCR)
          if (!thumbnailUrl && scrapeResult.thumbnailUrl) {
            thumbnailUrl = scrapeResult.thumbnailUrl;
          }
          console.log(`[Parse] HTML scrape for ${platform}: ${scrapeResult.text.length} chars, hasThumbnail: ${!!scrapeResult.thumbnailUrl}`);
        }

        if ((!promptText || promptText.trim().length < 50) && thumbnailUrl) {
          console.log(`[Parse] Caption sparse (${promptText?.length || 0} chars), trying vision OCR from thumbnail`);
          try {
            const visionText = await extractTextFromThumbnail(thumbnailUrl);
            if (visionText) {
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

    // P2-C: RED-specific vision OCR from cover image
    if (platform === 'red' && thumbnailUrl) {
      console.log(`[Parse] RED post — trying vision OCR from cover thumbnail`);
      try {
        const visionText = await extractTextFromThumbnail(thumbnailUrl);
        if (visionText) {
          promptText = [promptText, `[Text from RED cover image: ${visionText}]`].filter(Boolean).join('\n');
          console.log(`[Parse] RED vision OCR added ${visionText.length} chars`);
        }
      } catch (err) {
        console.log(`[Parse] RED vision OCR failed:`, err);
      }
    }

    // Fallback prompt construction
    if (!promptText || promptText.trim().length < 10) {
      const fallbackParts: string[] = [`URL: ${url}`, `Platform: ${platform}`];
      if (platform === 'instagram' || platform === 'threads') {
        const meta = extractInstagramMeta(url);
        if (meta.username) {
          fallbackParts.push(`Instagram author: @${meta.username}`);
          fallbackParts.push(`Note: @${meta.username} may be the business account — check if it matches a known HK restaurant/cafe/shop name`);
        }
        if (meta.postType) fallbackParts.push(`Post type: ${meta.postType}`);
        fallbackParts.push('This is a Hong Kong Instagram post about a place (restaurant, cafe, shop, or attraction). Try to identify the place from the URL and username.');
      }
      if (platform === 'red') {
        fallbackParts.push('This is a Xiaohongshu (RED/小紅書) post about a place in Hong Kong.');
        fallbackParts.push('RED posts typically contain: a cover image with text overlay, a title, a detailed caption with place name and address, and location tags.');
        fallbackParts.push('Look for: Chinese place names (often in 【】or 《》), district names, "📍" location pins, price hints like 人均$100, and cuisine tags.');
        fallbackParts.push('Extract whatever place information you can identify from the available content.');
      }
      if (platform === 'facebook') {
        fallbackParts.push('This is a Facebook post (possibly a Reel or video) about a place in Hong Kong. Facebook posts often contain restaurant/cafe names in the caption or video overlay text. Look for HK place names in the available content.');
      }
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

    // Tier 1: Name extracted but no address
    if (searchName && !hasAddress) {
      console.log(`[Enrich] Tier 1 — name found, looking up: ${searchName}`);

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
          tags: [...new Set([...(parsed.tags as string[] || []), ...(geminiEnriched.tags as string[] || [])])],
        };
        console.log(`[Enrich] Gemini filled: ${Object.keys(geminiEnriched).join(', ')}`);
      }

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

    // Tier 1.5: Address found but no name
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
          tags: [...new Set([...(parsed.tags as string[] || []), ...(reverseResult.tags as string[] || [])])],
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
              tags: [...new Set([...(parsed.tags as string[] || []), ...(geminiEnriched.tags as string[] || [])])],
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
      supabase.from("saved_items")
        .upsert({
          source_url: normalizedUrl,
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
      if (platform === 'dianping') {
        parseHint = `Dianping (大眾點評) links can't be read directly due to access restrictions. Please copy the restaurant name from the page and use Look Up to find the details.`;
      } else if (platform === 'googlemaps') {
        parseHint = `Couldn't read this Google Maps link. Try opening it in the Maps app and sharing the full place link, or type the name and use Look Up.`;
      } else if (platform === 'threads' && (!promptText || promptText.trim().length < 30)) {
        parseHint = `This Threads post has no caption or the caption couldn't be read. Please type the restaurant or place name above, then tap Look Up to find the address.`;
      } else if (platform === 'red' || platform === 'instagram' || platform === 'threads') {
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
