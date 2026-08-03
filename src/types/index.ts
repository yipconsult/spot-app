// ============================================================
// Spot App — Core TypeScript Types
// Based on App Scope Document §5.1
// ============================================================

// ── Enums ────────────────────────────────────────────────────

export type SourcePlatform =
  | 'instagram'
  | 'red'
  | 'facebook'
  | 'pinterest'
  | 'threads'
  | 'youtube_reels'
  | 'manual';

export type Category =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'activity'
  | 'event'
  | 'attraction'
  | 'shopping'
  | 'other';

export type ListRole = 'owner' | 'member';

export type MilestoneType =
  | 'save_count_10'
  | 'save_count_15'
  | 'save_count_50'
  | 'first_share'
  | 'first_export'
  | 'duplicate_detected'
  | 'rainy_day_open';

export type TasteType =
  | 'smart_shuffle'
  | 'auto_categories'
  | 'auto_calendar'
  | 'shared_list'
  | 'weather_filter'
  | 'group_vote'
  | 'duplicate_detect'
  | 'premium_pass_24h'
  | 'photo_attach';

// ── Database Row Types ───────────────────────────────────────

export interface SavedItem {
  id: string;
  source_url: string;
  source_platform: SourcePlatform;
  name_original: string | null;
  name_en: string | null;
  address_original: string | null;
  address_en: string | null;
  category: Category;
  district: string | null;
  location: GeoPoint | null;
  price_hint: string | null;
  tags: string[];
  raw_text: string | null;
  parsed_json: Record<string, unknown> | null;
  is_curated: boolean;
  curated_by: string | null;
  featured_until: string | null;
  created_at: string;
}

export interface UserSave {
  id: string;
  user_id: string;
  saved_item_id: string;
  list_id: string | null;
  saved_at: string;
  visited_at: string | null;
  rating: number | null;
  notes: string | null;
  photos: string[];
  // Joined
  saved_item?: SavedItem;
}

export interface UserList {
  id: string;
  user_id: string;
  name: string;
  is_shared: boolean;
  share_code: string | null;
  max_members: number;
  created_at: string;
  // Joined
  member_count?: number;
}

export interface ListMember {
  id: string;
  list_id: string;
  user_id: string;
  role: ListRole;
  joined_at: string;
  profile?: { email?: string; avatar_url?: string };
}

export interface UserMilestone {
  id: string;
  user_id: string;
  milestone_type: MilestoneType;
  achieved_at: string;
}

export interface UserTaste {
  id: string;
  user_id: string;
  taste_type: TasteType;
  triggered_by: string | null;
  unlocked_at: string;
  expires_at: string;
  used_at: string | null;
}

// ── Geo ──────────────────────────────────────────────────────

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export interface NearMeResult {
  id: string;
  name_original: string | null;
  name_en: string | null;
  address_original: string | null;
  address_en: string | null;
  category: Category;
  district: string | null;
  distance_meters: number;
  location: GeoPoint;
}

// ── Parse Result ─────────────────────────────────────────────

export interface ParseResult {
  name_original: string | null;
  name_en: string | null;
  address_original: string | null;
  address_en: string | null;
  category: Category;
  district: string | null;
  price_hint: string | null;
  tags: string[];
  raw_text: string;
}

// ── Display helpers ──────────────────────────────────────────

export const CATEGORY_LABELS: Record<Category, string> = {
  restaurant: '🍽️ Restaurant',
  cafe: '☕ Cafe',
  bar: '🍸 Bar',
  activity: '🎯 Activity',
  event: '🎪 Event',
  attraction: '🏛️ Attraction',
  shopping: '🛍️ Shopping',
  other: '📍 Other',
};

export const DISTRICT_LIST = [
  'Central & Western',
  'Wan Chai',
  'Eastern',
  'Southern',
  'Yau Tsim Mong',
  'Sham Shui Po',
  'Kowloon City',
  'Wong Tai Sin',
  'Kwun Tong',
  'Kwai Tsing',
  'Tsuen Wan',
  'Tuen Mun',
  'Yuen Long',
  'North',
  'Tai Po',
  'Sha Tin',
  'Sai Kung',
  'Islands',
] as const;

export const PLATFORM_LABELS: Record<SourcePlatform, string> = {
  instagram: 'Instagram',
  red: 'RED / 小紅書',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  threads: 'Threads',
  youtube_reels: 'YouTube Reels',
  manual: 'Manual',
};
