-- 001: additive, idempotent. Only adds indexes and NOT VALID constraints (checked for
-- new/updated rows only, so existing production rows are never rejected or rewritten).

CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches(user_b);
CREATE INDEX IF NOT EXISTS idx_swipes_swipee ON swipes(swipee_id, direction);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_images_owner ON images(owner_id);

DO $$
BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_kind_check
    CHECK (kind IN ('text', 'image', 'location')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE matches ADD CONSTRAINT matches_distinct_users CHECK (user_a <> user_b) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE swipes ADD CONSTRAINT swipes_not_self CHECK (swiper_id <> swipee_id) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
