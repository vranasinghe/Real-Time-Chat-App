-- 007: policy consents and OAuth sign-in transactions. ADDITIVE ONLY (new tables).
--
--   privacy_consents     which version of which policy a member accepted, and when. One row per
--                        (member, kind, version). Policy VERSIONS are labels used by the app; the
--                        policy texts themselves are drafts pending legal review (see docs).
--   oauth_transactions   one row per started Google sign-in: a random one-time `state` (only its SHA-256 is
--                        stored), the app's PKCE challenge, the validated redirect target, our own PKCE
--                        verifier for the leg to Google. Short-lived and single-use.
--   oauth_exchange_codes the one-time code the app trades for a session (only its hash is stored),
--                        bound to the member and to the app's PKCE challenge. 60-second life, single-use.
--
-- Nothing here holds a session token. Recovery: the tables are new; leaving them in place is safe.

CREATE TABLE IF NOT EXISTS privacy_consents (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('terms', 'privacy')),
  version VARCHAR(40) NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, version)
);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_user ON privacy_consents(user_id);

CREATE TABLE IF NOT EXISTS oauth_transactions (
  id UUID PRIMARY KEY,
  state_hash VARCHAR(64) NOT NULL UNIQUE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('google')),
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('native', 'web')),
  redirect_uri TEXT NOT NULL,
  client_challenge VARCHAR(128) NOT NULL,
  provider_verifier VARCHAR(128),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_transactions_expiry ON oauth_transactions(expires_at);

CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
  id UUID PRIMARY KEY,
  code_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('native', 'web')),
  client_challenge VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_exchange_expiry ON oauth_exchange_codes(expires_at);
