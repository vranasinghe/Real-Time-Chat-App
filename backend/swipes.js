const express = require("express");
const crypto = require("crypto");
const db = require("./db");
const logger = require("./logger");
const { authenticateToken } = require("./auth");
const { emitToMatch } = require("./realtime");

const router = express.Router();

function generateMatchId() {
  return "match_" + crypto.randomUUID();
}

const DIRECTIONS = new Set(["like", "pass", "super"]);
const MAX_SWIPE_MESSAGE_LENGTH = 500;

// Pure input check, so it can be tested without a database.
function validateSwipe(body, swiperId) {
  const swipeeId = typeof body?.swipee_id === "string" ? body.swipee_id.trim() : "";
  const direction = body?.direction;
  if (!swipeeId || !direction) return { error: "Swipee ID and direction are required" };
  if (!DIRECTIONS.has(direction)) return { error: "direction must be like, pass or super" };
  if (swipeeId === swiperId) return { error: "You cannot swipe on yourself" };
  let message = null;
  if (body.message !== undefined && body.message !== null) {
    if (typeof body.message !== "string") return { error: "message must be text" };
    message = body.message.trim() || null;
    if (message && message.length > MAX_SWIPE_MESSAGE_LENGTH) {
      return { error: `message must be ${MAX_SWIPE_MESSAGE_LENGTH} characters or fewer` };
    }
  }
  return { swipeeId, direction, message };
}

// Route: Record a swipe (like/pass/super). The swipe, the match and the opening
// messages are written in ONE transaction, so a failure cannot leave half a match behind.
router.post("/", authenticateToken, async (req, res) => {
  const swiper_id = req.user.id;
  const input = validateSwipe(req.body, swiper_id);
  if (input.error) return res.status(400).json({ error: input.error });
  const { swipeeId: swipee_id, direction, message } = input;

  try {
    const outcome = await db.withTransaction(async (q) => {
      await q(
        `INSERT INTO swipes (swiper_id, swipee_id, direction, message)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (swiper_id, swipee_id)
         DO UPDATE SET direction = EXCLUDED.direction, message = EXCLUDED.message`,
        [swiper_id, swipee_id, direction, message]
      );

      if (direction !== "like" && direction !== "super") return { activeMatch: null };

      const mutual = await q(
        `SELECT direction, message FROM swipes
         WHERE swiper_id = $1 AND swipee_id = $2 AND (direction = 'like' OR direction = 'super')`,
        [swipee_id, swiper_id]
      );
      if (mutual.rows.length === 0) return { activeMatch: null };

      // Sort user_a and user_b to ensure clean keys
      const user_a = swiper_id < swipee_id ? swiper_id : swipee_id;
      const user_b = swiper_id < swipee_id ? swipee_id : swiper_id;

      // ON CONFLICT makes concurrent mutual swipes create exactly one match
      const inserted = await q(
        `INSERT INTO matches (id, user_a, user_b, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_a, user_b) DO NOTHING
         RETURNING *`,
        [generateMatchId(), user_a, user_b, new Date(Date.now() + 24 * 60 * 60 * 1000)]
      );
      if (inserted.rows.length === 0) return { activeMatch: null }; // already matched

      const match = inserted.rows[0];
      const other = await q("SELECT id, name, photos, birthdate, bio, is_online FROM profiles WHERE id = $1", [swipee_id]);

      // Opening messages from the swipe notes, the older note first
      if (mutual.rows[0].message) {
        await q("INSERT INTO messages (match_id, sender_id, body) VALUES ($1, $2, $3)", [match.id, swipee_id, mutual.rows[0].message]);
      }
      if (message) {
        await q("INSERT INTO messages (match_id, sender_id, body) VALUES ($1, $2, $3)", [match.id, swiper_id, message]);
      }

      return { match, activeMatch: other.rows.length ? { match, profile: other.rows[0] } : null };
    });

    // Tell both people only after the transaction committed
    if (outcome.match) {
      emitToMatch(req.app.get("socketio"), outcome.match, "match_created", { match_id: outcome.match.id });
    }

    res.status(200).json({ success: true, activeMatch: outcome.activeMatch });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(404).json({ error: "That profile no longer exists" });
    }
    logger.error("record swipe failed", err);
    res.status(500).json({ error: "Internal server error recording swipe" });
  }
});

// Route: Reset swipes (equivalent to start over)
router.post("/reset", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    await db.query("DELETE FROM swipes WHERE swiper_id = $1", [userId]);
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error("reset swipes failed", err);
    res.status(500).json({ error: "Internal server error resetting swipes" });
  }
});

router.validateSwipe = validateSwipe;
module.exports = router;
