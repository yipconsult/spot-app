// Supabase Edge Function: geocode
// Converts address string → lat/lng coordinates → PostGIS geography Point.
// Uses free Nominatim API with aggressive caching.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

interface GeocodeRequest {
  address: string;
  itemId?: string; // if provided, update the saved_item directly
}

interface GeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { address, itemId } = (await req.json()) as GeocodeRequest;

    if (!address) {
      return new Response(JSON.stringify({ error: "address is required" }), { status: 400 });
    }

    // Geocode via Nominatim (free, rate-limited to 1 req/sec)
    const params = new URLSearchParams({
      q: address,
      format: "json",
      limit: "1",
      "accept-language": "en,zh-HK,zh-CN",
    });

    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { "User-Agent": "Spot-App/1.0 (geocoder; +https://spot.app)" },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Geocoding failed" }), { status: 502 });
    }

    const data = await res.json() as GeocodeResult[];

    if (!data || data.length === 0) {
      return new Response(JSON.stringify({ error: "No results found", lat: null, lng: null }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const { lat, lng, display_name } = data[0];

    // If itemId provided, update saved_items with the location
    if (itemId) {
      await supabase.rpc("update_item_location", {
        item_id: itemId,
        item_lat: lat,
        item_lng: lng,
      }).maybeSingle();
    }

    return new Response(JSON.stringify({
      lat,
      lng,
      display_name,
      point: { type: "Point", coordinates: [lng, lat] },
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Geocode error:", err);
    return new Response(JSON.stringify({
      error: "Geocoding failed",
      details: (err as Error).message,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
});
