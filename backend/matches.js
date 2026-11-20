const express = require("express");
const crypto = require("crypto");
const db = require("./db");
const { authenticateToken } = require("./auth");
const { emitToMatch } = require("./realtime");

const router = express.Router();

// Two users may only be matched once they have both swiped like/super on each other
async function hasMutualLike(userA, userB) {
  const result = await db.query(
    `SELECT 1 FROM swipes
     WHERE swiper_id = $1 AND swipee_id = $2 AND direction IN ('like', 'super')
       AND EXISTS (
         SELECT 1 FROM swipes
         WHERE swiper_id = $2 AND swipee_id = $1 AND direction IN ('like', 'super')
       )`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MESSAGE_KINDS = new Set(["text", "image", "location"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the match row if `userId` is a participant, otherwise null
async function getMatchForUser(matchId, userId) {
  const result = await db.query(
    "SELECT id, user_a, user_b FROM matches WHERE id = $1 AND (user_a = $2 OR user_b = $2)",
    [matchId, userId]
  );
  return result.rows[0] || null;
}

// Route: Conversation list — every match with the other user's profile, the last
// message, my unread count and how far the other user has read, in ONE query.
// Served at both "/" (backwards compatible) and "/conversations".
async function listConversations(req, res) {
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT m.*,
              json_build_object(
                'id', p.id,
                'name', p.name,
                'photos', p.photos,
                'birthdate', p.birthdate,
                'bio', p.bio,
                'gender', p.gender,
                'looking_for', p.looking_for,
                'interests', p.interests,
                'is_online', p.is_online
              ) AS other_user,
              lm.last_message,
              COALESCE(uc.unread, 0)::int AS unread_count,
              COALESCE(other_read.last_read_message_id, 0) AS other_last_read_message_id
       FROM matches m
       INNER JOIN profiles p ON (p.id = CASE WHEN m.user_a = $1 THEN m.user_b ELSE m.user_a END)
       LEFT JOIN match_reads my_read ON my_read.match_id = m.id AND my_read.user_id = $1
       LEFT JOIN match_reads other_read ON other_read.match_id = m.id AND other_read.user_id = p.id
       LEFT JOIN LATERAL (
         SELECT row_to_json(x) AS last_message
         FROM (SELECT * FROM messages WHERE match_id = m.id ORDER BY id DESC LIMIT 1) x
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread FROM messages
         WHERE match_id = m.id AND sender_id <> $1
           AND id > COALESCE(my_read.last_read_message_id, 0)
       ) uc ON true
       WHERE m.user_a = $1 OR m.user_b = $1
       ORDER BY COALESCE((lm.last_message->>'created_at')::timestamptz, m.created_at) DESC`,
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ error: "Internal server error fetching conversations" });
  }
}

router.get("/", authenticateToken, listConversations);
router.get("/conversations", authenticateToken, listConversations);

// Route: Create a quick match (for direct messaging from explore/likes tabs)
router.post("/", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { targetUserId } = req.body;

  if (!targetUserId) {
    return res.status(400).json({ error: "targetUserId is required" });
  }

  try {
    // Sort user_a and user_b
    const user_a = userId < targetUserId ? userId : targetUserId;
    const user_b = userId < targetUserId ? targetUserId : userId;

    // Check if match already exists
    const existing = await db.query(
      "SELECT * FROM matches WHERE user_a = $1 AND user_b = $2",
      [user_a, user_b]
    );

    let matchRecord;
    if (existing.rows.length > 0) {
      matchRecord = existing.rows[0];
    } else {
      const mutual = await hasMutualLike(userId, targetUserId);
      if (!mutual) {
        return res.status(403).json({ error: "You can only start a chat once you've both liked each other" });
      }

      const matchId = "match_" + crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      const insert = await db.query(
        `INSERT INTO matches (id, user_a, user_b, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_a, user_b) DO NOTHING
         RETURNING *`,
        [matchId, user_a, user_b, expiresAt]
      );
      matchRecord = insert.rows[0];
      if (!matchRecord) {
        // Lost the race to a concurrent request — fetch the row it created
        const raced = await db.query("SELECT * FROM matches WHERE user_a = $1 AND user_b = $2", [user_a, user_b]);
        matchRecord = raced.rows[0];
      }
    }

    // Populate other user details
    const otherUserResult = await db.query(
      "SELECT id, name, photos, birthdate, bio, gender, looking_for, interests, is_online FROM profiles WHERE id = $1",
      [targetUserId]
    );

    const matchResponse = {
      ...matchRecord,
      other_user: otherUserResult.rows[0]
    };

    res.status(200).json(matchResponse);
  } catch (err) {
    console.error("Create quick match error:", err);
    res.status(500).json({ error: "Internal server error creating match" });
  }
});

// Route: Get one page of messages for a match, oldest-first.
//   ?limit=N      page size (default 50, max 100)
//   ?before=<id>  only messages older than this id (load older history)
// Without `before` it returns the most recent page.
router.get("/:matchId/messages", authenticateToken, async (req, res) => {
  const { matchId } = req.params;
  const userId = req.user.id;

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const before = req.query.before !== undefined ? parseInt(req.query.before, 10) : null;
  if (req.query.before !== undefined && (!Number.isInteger(before) || before < 1)) {
    return res.status(400).json({ error: "before must be a positive message id" });
  }

  try {
    if (!(await getMatchForUser(matchId, userId))) {
      return res.status(403).json({ error: "Access denied to this match thread" });
    }

    const result = await db.query(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE match_id = $1 AND ($2::int IS NULL OR id < $2)
         ORDER BY id DESC
         LIMIT $3
       ) page ORDER BY id ASC`,
      [matchId, before, limit]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Internal server error fetching messages" });
  }
});

// Route: Post a new message.
// `client_id` (a UUID generated on the device) makes the call idempotent: retrying
// a send that already reached the server returns the stored message instead of
// creating a duplicate.
router.post("/:matchId/messages", authenticateToken, async (req, res) => {
  const { matchId } = req.params;
  const { kind, client_id } = req.body;
  const userId = req.user.id;
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";

  if (!body) {
    return res.status(400).json({ error: "Message body is required" });
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }
  const messageKind = kind || "text";
  if (!MESSAGE_KINDS.has(messageKind)) {
    return res.status(400).json({ error: "Invalid message kind" });
  }
  if (client_id !== undefined && client_id !== null && !(typeof client_id === "string" && UUID_RE.test(client_id))) {
    return res.status(400).json({ error: "client_id must be a UUID" });
  }

  try {
    const match = await getMatchForUser(matchId, userId);
    if (!match) {
      return res.status(403).json({ error: "Access denied to this match thread" });
    }

    const result = await db.query(
      `INSERT INTO messages (match_id, sender_id, body, kind, client_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING *`,
      [matchId, userId, body, messageKind, client_id || null]
    );

    if (result.rows.length === 0) {
      // Retry of a message we already stored: hand back the original
      const existing = await db.query("SELECT * FROM messages WHERE client_id = $1", [client_id]);
      const original = existing.rows[0];
      if (!original || original.sender_id !== userId || original.match_id !== matchId) {
        return res.status(409).json({ error: "client_id already used" });
      }
      return res.status(200).json(original);
    }

    const newMessage = result.rows[0];
    emitToMatch(req.app.get("socketio"), match, "new_message", newMessage);

    res.status(201).json(newMessage);
  } catch (err) {
    console.error("Post message error:", err);
    res.status(500).json({ error: "Internal server error posting message" });
  }
});

// Route: Mark messages as read up to (and including) a message id.
// Read pointers only move forward. The other participant is told so it can show "Seen".
router.post("/:matchId/read", authenticateToken, async (req, res) => {
  const { matchId } = req.params;
  const userId = req.user.id;
  const requested = Number(req.body.last_read_message_id);

  if (!Number.isInteger(requested) || requested < 0) {
    return res.status(400).json({ error: "last_read_message_id must be a non-negative integer" });
  }

  try {
    const match = await getMatchForUser(matchId, userId);
    if (!match) {
      return res.status(403).json({ error: "Access denied to this match thread" });
    }

    // Never point past the newest message in this thread
    const maxResult = await db.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM messages WHERE match_id = $1", [matchId]);
    const target = Math.min(requested, Number(maxResult.rows[0].max_id));

    const upsert = await db.query(
      `INSERT INTO match_reads (match_id, user_id, last_read_message_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (match_id, user_id) DO UPDATE
         SET last_read_message_id = GREATEST(match_reads.last_read_message_id, EXCLUDED.last_read_message_id),
             updated_at = NOW()
       RETURNING last_read_message_id`,
      [matchId, userId, target]
    );

    const lastRead = upsert.rows[0].last_read_message_id;
    emitToMatch(req.app.get("socketio"), match, "messages_read", {
      match_id: matchId,
      user_id: userId,
      last_read_message_id: lastRead,
    });

    res.status(200).json({ match_id: matchId, last_read_message_id: lastRead });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ error: "Internal server error marking messages read" });
  }
});

// Route: Create a quick match (message shortcut)
router.post("/quick", authenticateToken, async (req, res) => {
  const { profile_id } = req.body;
  const userId = req.user.id;

  if (!profile_id) {
    return res.status(400).json({ error: "Profile ID is required" });
  }

  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user_a = userId < profile_id ? userId : profile_id;
    const user_b = userId < profile_id ? profile_id : userId;

    // Check if match already exists
    const existing = await db.query(
      "SELECT * FROM matches WHERE user_a = $1 AND user_b = $2",
      [user_a, user_b]
    );

    let matchRecord;
    if (existing.rows.length > 0) {
      matchRecord = existing.rows[0];
    } else {
      const mutual = await hasMutualLike(userId, profile_id);
      if (!mutual) {
        return res.status(403).json({ error: "You can only start a chat once you've both liked each other" });
      }

      const matchId = "match_" + crypto.randomUUID();
      const insertResult = await db.query(
        `INSERT INTO matches (id, user_a, user_b, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_a, user_b) DO NOTHING
         RETURNING *`,
        [matchId, user_a, user_b, expiresAt]
      );
      matchRecord = insertResult.rows[0];
      if (!matchRecord) {
        const raced = await db.query("SELECT * FROM matches WHERE user_a = $1 AND user_b = $2", [user_a, user_b]);
        matchRecord = raced.rows[0];
      }
    }

    // Get profile details
    const profileRes = await db.query(
      "SELECT id, name, photos, birthdate, bio, is_online FROM profiles WHERE id = $1",
      [profile_id]
    );

    const otherUser = profileRes.rows[0];
    const matchObj = {
      ...matchRecord,
      other_user: otherUser
    };

    res.status(200).json(matchObj);
  } catch (err) {
    console.error("Create quick match error:", err);
    res.status(500).json({ error: "Internal server error creating match" });
  }
});

module.exports = router;
