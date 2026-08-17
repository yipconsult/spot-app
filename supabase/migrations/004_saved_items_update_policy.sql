-- Migration 004: Add UPDATE/DELETE policies for saved_items
-- Previously only SELECT + INSERT policies existed, so all client-side
-- edits (tags, name corrections, Look Up enrichment) silently failed.

CREATE POLICY "si_update_all" ON saved_items FOR UPDATE USING (true);

-- DELETE restricted to authenticated users (used by item removal flows)
CREATE POLICY "si_delete_auth" ON saved_items FOR DELETE USING (auth.role() = 'authenticated');
