CREATE TABLE IF NOT EXISTS ephemeral_media (
  id UUID PRIMARY KEY,
  owner_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  match_id VARCHAR(255) REFERENCES matches(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('chat', 'story')),
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 26214400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours'),
  CHECK ((purpose = 'chat' AND match_id IS NOT NULL AND media_type = 'image') OR (purpose = 'story' AND match_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ephemeral_media_expiry_idx ON ephemeral_media(expires_at);
CREATE INDEX IF NOT EXISTS ephemeral_media_owner_idx ON ephemeral_media(owner_id);

CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_id UUID UNIQUE NOT NULL REFERENCES ephemeral_media(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stories_created_idx ON stories(created_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES ephemeral_media(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
UPDATE messages SET expires_at = created_at + INTERVAL '12 hours' WHERE kind = 'image' AND expires_at IS NULL;
CREATE INDEX IF NOT EXISTS messages_expiry_idx ON messages(expires_at) WHERE expires_at IS NOT NULL;
