-- 006: account state, onboarding progress and discovery preferences. ADDITIVE ONLY.
--
--   * Every existing row keeps all of its data. Existing members become status 'active' with no completed
--     profile, so they pass through the new onboarding once (nothing is deleted, nothing is invented).
--   * No column is dropped, renamed or rewritten, and no existing value is changed.
--
--   status                  active | suspended | banned | pending_deletion | deleted
--   suspended_until         optional end of a suspension (NULL = until a moderator lifts it)
--   status_changed_at       when status last changed
--   profile_completed_at    set ONLY by the server when onboarding is validated and finished
--   onboarding_step         the step the member should see next (resume pointer)
--   onboarding_done         steps the member has explicitly confirmed
--   relationship_intention  optional, one of a fixed list
--   user_preferences        interim home of the discovery age range (extended in migration 010)
--
-- Recovery: these columns are not read by older code, so leaving them in place is safe. Removing them
-- would be destructive and needs a backup and the destructive-migration review (see DATABASE_MIGRATIONS.md).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_step VARCHAR(30);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_done TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS relationship_intention VARCHAR(30);

DO $$
BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
    CHECK (status IN ('active', 'suspended', 'banned', 'pending_deletion', 'deleted'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_intention_check
    CHECK (relationship_intention IS NULL OR relationship_intention IN ('long_term', 'short_term', 'friendship', 'figuring_out'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Static bounds only (a CHECK must not depend on today's date). NOT VALID: applies to new and updated
-- rows, so no existing row is rejected or rewritten.
DO $$
BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_birthdate_range
    CHECK (birthdate IS NULL OR (birthdate >= DATE '1900-01-01' AND birthdate < DATE '2100-01-01')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Discovery eligibility lookups
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_completed ON profiles(profile_completed_at) WHERE profile_completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id VARCHAR(255) PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  min_age INTEGER CHECK (min_age IS NULL OR (min_age >= 18 AND min_age <= 99)),
  max_age INTEGER CHECK (max_age IS NULL OR (max_age >= 18 AND max_age <= 99)),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age)
);
