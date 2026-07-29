/**
 * Spot App — Curated Seed Data Script
 * Imports 200-500 Hong Kong spots into saved_items for cold-start.
 *
 * Data source: Structured JSON file (curated-spots.json) or inline seeded entries.
 *
 * Run with: npx ts-node supabase/seed/seed-curated.ts
 *
 * Prerequisites:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 * - Database migrations applied
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface SeedSpot {
  source_url: string;
  source_platform: string;
  name_original?: string;
  name_en: string;
  address_original?: string;
  address_en: string;
  category: string;
  district: string;
  price_hint?: string;
  tags: string[];
  lat?: number;
  lng?: number;
  is_curated?: boolean;
}

// Sample curated HK spots — replace with full 200-500 dataset
const SEED_SPOTS: SeedSpot[] = [
  {
    source_url: "https://spot.app/curated/bakehouse-causeway-bay",
    source_platform: "manual",
    name_original: "Bakehouse",
    name_en: "Bakehouse",
    address_original: "銅鑼灣啟超道16號",
    address_en: "16 Kai Chiu Road, Causeway Bay",
    category: "cafe",
    district: "Wan Chai",
    price_hint: "$$",
    tags: ["sourdough", "pastry", "egg tart", "bakery"],
    lat: 22.2793, lng: 114.1857,
    is_curated: true,
  },
  {
    source_url: "https://spot.app/curated/nine-ones",
    source_platform: "manual",
    name_original: "Nine One 壹玖",
    name_en: "Nine One",
    address_original: "尖沙咀漆咸道南91號",
    address_en: "91 Chatham Road South, Tsim Sha Tsui",
    category: "restaurant",
    district: "Yau Tsim Mong",
    price_hint: "$$$",
    tags: ["cantonese", "dim sum", "fine dining"],
    lat: 22.3005, lng: 114.1770,
    is_curated: true,
  },
  {
    source_url: "https://spot.app/curated/tai-kwun",
    source_platform: "manual",
    name_original: "大館 Tai Kwun",
    name_en: "Tai Kwun Centre for Heritage and Arts",
    address_original: "中環荷李活道10號",
    address_en: "10 Hollywood Road, Central",
    category: "attraction",
    district: "Central & Western",
    price_hint: "$",
    tags: ["heritage", "art", "museum", "free"],
    lat: 22.2814, lng: 114.1545,
    is_curated: true,
  },
  {
    source_url: "https://spot.app/curated/coa-hk",
    source_platform: "manual",
    name_original: "COA",
    name_en: "COA",
    address_original: "中環善慶街6-10號",
    address_en: "6-10 Shin Hing Street, Central",
    category: "bar",
    district: "Central & Western",
    price_hint: "$$$",
    tags: ["cocktails", "mezcal", "award-winning", "speakeasy"],
    lat: 22.2821, lng: 114.1520,
    is_curated: true,
  },
  {
    source_url: "https://spot.app/curated/victoria-peak",
    source_platform: "manual",
    name_original: "太平山頂",
    name_en: "Victoria Peak",
    address_original: "山頂道118號",
    address_en: "118 Peak Road, The Peak",
    category: "attraction",
    district: "Central & Western",
    price_hint: "$",
    tags: ["viewpoint", "hiking", "sunset", "tourist"],
    lat: 22.2758, lng: 114.1455,
    is_curated: true,
  },
  {
    source_url: "https://spot.app/curated/yardbird-hk",
    source_platform: "manual",
    name_original: "Yardbird",
    name_en: "Yardbird",
    address_original: "上環必列者士街33-35號",
    address_en: "33-35 Bridges Street, Sheung Wan",
    category: "restaurant",
    district: "Central & Western",
    price_hint: "$$$",
    tags: ["yakitori", "izakaya", "japanese", "trendy"],
    lat: 22.2845, lng: 114.1500,
    is_curated: true,
  },
  {
    source_url: "https://spot.app/curated/sai-kung-waterfront",
    source_platform: "manual",
    name_original: "西貢海濱",
    name_en: "Sai Kung Waterfront",
    address_original: "西貢海濱公園",
    address_en: "Sai Kung Waterfront Park",
    category: "activity",
    district: "Sai Kung",
    price_hint: "$",
    tags: ["seafood", "kayaking", "outdoor", "weekend", "dog-friendly"],
    lat: 22.3811, lng: 114.2725,
    is_curated: true,
  },
  {
    source_url: "https://spot.app/curated/m-plus",
    source_platform: "manual",
    name_original: "M+博物館",
    name_en: "M+ Museum",
    address_original: "九龍博物館道38號西九文化區",
    address_en: "38 Museum Drive, West Kowloon Cultural District",
    category: "attraction",
    district: "Yau Tsim Mong",
    price_hint: "$$",
    tags: ["art", "museum", "contemporary", "architecture"],
    lat: 22.3015, lng: 114.1573,
    is_curated: true,
  },
];

async function main() {
  console.log(`Seeding ${SEED_SPOTS.length} curated spots...`);

  for (const spot of SEED_SPOTS) {
    const { error } = await supabase.from("saved_items").upsert(
      {
        source_url: spot.source_url,
        source_platform: spot.source_platform,
        name_original: spot.name_original || null,
        name_en: spot.name_en,
        address_original: spot.address_original || null,
        address_en: spot.address_en,
        category: spot.category,
        district: spot.district,
        price_hint: spot.price_hint || null,
        tags: spot.tags,
        location: spot.lat && spot.lng
          ? `SRID=4326;POINT(${spot.lng} ${spot.lat})`
          : null,
        is_curated: spot.is_curated ?? true,
      },
      { onConflict: "source_url", ignoreDuplicates: true }
    );

    if (error) {
      console.error(`  ✗ ${spot.name_en}: ${error.message}`);
    } else {
      console.log(`  ✓ ${spot.name_en}`);
    }
  }

  console.log(`Done. Seeded ${SEED_SPOTS.length} spots.`);
}

main().catch(console.error);
