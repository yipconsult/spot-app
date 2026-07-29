-- Helper functions for geocoding and milestone logic

-- Update item location from geocode result
CREATE OR REPLACE FUNCTION update_item_location(
  item_id uuid,
  item_lat double precision,
  item_lng double precision
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE saved_items
  SET location = ST_SetSRID(ST_MakePoint(item_lng, item_lat), 4326)::geography
  WHERE id = item_id;
END;
$$;

-- Trigger: auto-create "My Saves" list when user signs up
CREATE OR REPLACE FUNCTION create_default_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_lists (user_id, name, is_shared, max_members)
  VALUES (NEW.id, 'My Saves', false, 1);
  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_list();

-- Trigger: check milestones after each save
CREATE OR REPLACE FUNCTION check_save_milestones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  save_count int;
BEGIN
  SELECT COUNT(*) INTO save_count FROM user_saves WHERE user_id = NEW.user_id;

  -- 10 saves
  IF save_count >= 10 AND NOT EXISTS (
    SELECT 1 FROM user_milestones WHERE user_id = NEW.user_id AND milestone_type = 'save_count_10'
  ) THEN
    INSERT INTO user_milestones (user_id, milestone_type) VALUES (NEW.user_id, 'save_count_10');
    INSERT INTO user_tastes (user_id, taste_type, triggered_by, expires_at)
    VALUES (NEW.user_id, 'auto_categories', 'save_count_10', now() + interval '7 days');
  END IF;

  -- 15 saves
  IF save_count >= 15 AND NOT EXISTS (
    SELECT 1 FROM user_milestones WHERE user_id = NEW.user_id AND milestone_type = 'save_count_15'
  ) THEN
    INSERT INTO user_milestones (user_id, milestone_type) VALUES (NEW.user_id, 'save_count_15');
    INSERT INTO user_tastes (user_id, taste_type, triggered_by, expires_at)
    VALUES (NEW.user_id, 'smart_shuffle', 'save_count_15', now() + interval '7 days');
  END IF;

  -- 50 saves
  IF save_count >= 50 AND NOT EXISTS (
    SELECT 1 FROM user_milestones WHERE user_id = NEW.user_id AND milestone_type = 'save_count_50'
  ) THEN
    INSERT INTO user_milestones (user_id, milestone_type) VALUES (NEW.user_id, 'save_count_50');
    INSERT INTO user_tastes (user_id, taste_type, triggered_by, expires_at)
    VALUES (NEW.user_id, 'premium_pass_24h', 'save_count_50', now() + interval '7 days');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_user_save ON user_saves;
CREATE TRIGGER after_user_save
  AFTER INSERT ON user_saves
  FOR EACH ROW
  EXECUTE FUNCTION check_save_milestones();
