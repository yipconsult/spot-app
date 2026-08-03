-- Migration 003: Add UNIQUE constraint on user_saves(user_id, saved_item_id)
-- This prevents duplicate saves of the same item by the same user.
-- Required by the upsert in save.tsx handleSave().

-- Step 1: Remove any existing duplicate rows (keep the earliest save)
DELETE FROM user_saves a
USING user_saves b
WHERE a.user_id = b.user_id
  AND a.saved_item_id = b.saved_item_id
  AND a.saved_at > b.saved_at;

-- Step 2: Add the unique constraint
ALTER TABLE user_saves
ADD CONSTRAINT uq_user_saves_user_item UNIQUE (user_id, saved_item_id);
