-- 002: account security. Additive only.
--   token_version     bumping it signs the user out everywhere (password change / reset,
--                     "log out of all devices"). Existing sessions stay valid (version 0).
--   email_verified_at set when the user proves they own the address (NULL = not verified).
--   auth_codes        short-lived one-time codes for email verification and password reset.
--                     Only an HMAC of the code is stored, never the code itself.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS auth_codes (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  code_hash VARCHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_user_purpose ON auth_codes(user_id, purpose, created_at DESC);
