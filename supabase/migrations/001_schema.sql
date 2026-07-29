-- Spot App — Database Schema Migration 001
-- Tables: saved_items, user_saves, user_lists, list_members, user_milestones, user_tastes

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types
DO $$ BEGIN CREATE TYPE source_platform AS ENUM ('instagram','red','facebook','pinterest','threads','youtube_reels','manual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE item_category AS ENUM ('restaurant','cafe','bar','activity','event','attraction','shopping','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE list_role AS ENUM ('owner','member'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE milestone_type AS ENUM ('save_count_10','save_count_15','save_count_50','first_share','first_export','duplicate_detected','rainy_day_open'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE taste_type AS ENUM ('smart_shuffle','auto_categories','auto_calendar','shared_list','weather_filter','group_vote','duplicate_detect','premium_pass_24h','photo_attach'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- saved_items: global deduplicated item repository
CREATE TABLE IF NOT EXISTS saved_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_url text UNIQUE NOT NULL,
  source_platform source_platform NOT NULL DEFAULT 'manual',
  name_original text, name_en text,
  address_original text, address_en text,
  category item_category NOT NULL DEFAULT 'other',
  district text,
  location geography(Point, 4326),
  price_hint text,
  tags text[] DEFAULT '{}',
  raw_text text,
  parsed_json jsonb,
  is_curated boolean DEFAULT false,
  curated_by uuid REFERENCES auth.users(id),
  featured_until date,
  created_at timestamptz DEFAULT now()
);

-- user_lists: user-created lists (1 free shared list per user)
CREATE TABLE IF NOT EXISTS user_lists (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My Saves',
  is_shared boolean DEFAULT false,
  share_code text UNIQUE,
  max_members int DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- user_saves: junction table (user -> saved_item -> list)
CREATE TABLE IF NOT EXISTS user_saves (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_item_id uuid NOT NULL REFERENCES saved_items(id) ON DELETE CASCADE,
  list_id uuid REFERENCES user_lists(id) ON DELETE SET NULL,
  saved_at timestamptz DEFAULT now(),
  visited_at timestamptz,
  rating int CHECK (rating BETWEEN 1 AND 5),
  notes text,
  photos text[] DEFAULT '{}'
);

-- list_members: shared list membership
CREATE TABLE IF NOT EXISTS list_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id uuid NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role list_role NOT NULL DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(list_id, user_id)
);

-- user_milestones: tracks earned-taste achievements
CREATE TABLE IF NOT EXISTS user_milestones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone_type milestone_type NOT NULL,
  achieved_at timestamptz DEFAULT now(),
  UNIQUE(user_id, milestone_type)
);

-- user_tastes: temporary premium feature unlocks
CREATE TABLE IF NOT EXISTS user_tastes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  taste_type taste_type NOT NULL,
  triggered_by text,
  unlocked_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_saved_items_location ON saved_items USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_saved_items_category ON saved_items (category);
CREATE INDEX IF NOT EXISTS idx_saved_items_district ON saved_items (district);
CREATE INDEX IF NOT EXISTS idx_user_saves_user ON user_saves (user_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_saves_list ON user_saves (list_id);
CREATE INDEX IF NOT EXISTS idx_user_lists_share_code ON user_lists (share_code) WHERE is_shared = true;
CREATE INDEX IF NOT EXISTS idx_list_members_list ON list_members (list_id);
CREATE INDEX IF NOT EXISTS idx_user_milestones_user ON user_milestones (user_id);
CREATE INDEX IF NOT EXISTS idx_user_tastes_user ON user_tastes (user_id, expires_at);

-- RLS Policies
ALTER TABLE saved_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "si_read_all" ON saved_items FOR SELECT USING (true);
CREATE POLICY "si_insert_all" ON saved_items FOR INSERT WITH CHECK (true);

ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ul_owner_all" ON user_lists FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "ul_member_read" ON user_lists FOR SELECT USING (
  EXISTS (SELECT 1 FROM list_members WHERE list_members.list_id = user_lists.id AND list_members.user_id = auth.uid())
);

ALTER TABLE user_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "us_owner_all" ON user_saves FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "us_member_read" ON user_saves FOR SELECT USING (
  list_id IS NOT NULL AND EXISTS (SELECT 1 FROM list_members WHERE list_members.list_id = user_saves.list_id AND list_members.user_id = auth.uid())
);

ALTER TABLE list_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lm_read_own" ON list_members FOR SELECT USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM user_lists WHERE user_lists.id = list_members.list_id AND user_lists.user_id = auth.uid())
);
CREATE POLICY "lm_owner_insert" ON list_members FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM user_lists WHERE user_lists.id = list_members.list_id AND user_lists.user_id = auth.uid())
);
CREATE POLICY "lm_owner_delete" ON list_members FOR DELETE USING (
  EXISTS (SELECT 1 FROM user_lists WHERE user_lists.id = list_members.list_id AND user_lists.user_id = auth.uid())
);

ALTER TABLE user_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "um_owner_all" ON user_milestones FOR ALL USING (auth.uid() = user_id);

ALTER TABLE user_tastes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ut_owner_all" ON user_tastes FOR ALL USING (auth.uid() = user_id);

-- Functions
CREATE OR REPLACE FUNCTION near_me(lat double precision, lng double precision, radius_meters double precision DEFAULT 5000)
RETURNS TABLE (
  id uuid, name_original text, name_en text, address_original text, address_en text,
  category item_category, district text, distance_meters double precision, location_json jsonb
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT si.id, si.name_original, si.name_en, si.address_original, si.address_en,
    si.category, si.district,
    ST_Distance(si.location, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) AS distance_meters,
    jsonb_build_object('type','Point','coordinates',jsonb_build_array(ST_X(si.location::geometry),ST_Y(si.location::geometry))) AS location_json
  FROM saved_items si
  WHERE si.location IS NOT NULL
    AND ST_DWithin(si.location, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, radius_meters)
  ORDER BY distance_meters;
END;
$$;

CREATE OR REPLACE FUNCTION count_user_saves(uid uuid) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int FROM user_saves WHERE user_id = uid;
$$;

CREATE OR REPLACE FUNCTION count_list_members(lid uuid) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int FROM list_members WHERE list_id = lid;
$$;
