const express = require("express");
const db = require("./db");
const logger = require("./logger");
const { authenticateToken } = require("./auth");

const router = express.Router();

// Live demo accounts are only visible to other demo accounts, never to real users.
// Expects the viewer's id as $1.
const VISIBLE_TO_VIEWER = `(p.is_demo = false OR EXISTS (SELECT 1 FROM profiles viewer WHERE viewer.id = $1 AND viewer.is_demo))`;

// Fetch discovery profiles for swipe feed
router.get("/discovery", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  try {
    // 1. Fetch user's preferences
    const userResult = await db.query(
      "SELECT gender, looking_for FROM profiles WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User preferences not found" });
    }

    const { looking_for } = userResult.rows[0];
    const targetGender = looking_for === "everyone" ? null : looking_for;

    // 2. Query matching discovery profiles
    const discoveryQuery = `
      SELECT 
        p.id, p.name, p.birthdate, p.gender, p.looking_for, p.bio, p.height_cm, p.interests, p.photos, p.lat, p.lng, p.is_online,
        (SELECT message FROM swipes WHERE swiper_id = p.id AND swipee_id = $1) as swipe_message,
        COALESCE(
          (
            SELECT count(*)::integer * 20
            FROM unnest(p.interests) interest
            WHERE interest = ANY(
              SELECT unnest(interests) FROM profiles WHERE id = $1
            )
          ), 
          50
        ) as match_percent
      FROM profiles p
      WHERE p.id != $1
        AND ($2::text IS NULL OR p.gender = $2)
        AND ${VISIBLE_TO_VIEWER}
        AND p.id NOT IN (
          SELECT swipee_id FROM swipes WHERE swiper_id = $1
        )
      ORDER BY p.is_online DESC, p.created_at DESC, p.id
      LIMIT $3;
    `;

    const result = await db.query(discoveryQuery, [userId, targetGender, limit]);

    res.status(200).json(result.rows);
  } catch (err) {
    logger.error("fetch discovery failed", err);
    res.status(500).json({ error: "Internal server error fetching discovery profiles" });
  }
});

// Route: Get profiles who liked the current user
router.get("/likes-you", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT 
        p.id, p.name, p.birthdate, p.gender, p.looking_for, p.bio, p.height_cm, p.interests, p.photos, p.lat, p.lng, p.is_online,
        COALESCE(
          (
            SELECT count(*)::integer * 20
            FROM unnest(p.interests) interest
            WHERE interest = ANY(
              SELECT unnest(interests) FROM profiles WHERE id = $1
            )
          ), 
          50
        ) as match_percent
      FROM profiles p
      INNER JOIN swipes s ON s.swiper_id = p.id
      WHERE s.swipee_id = $1
        AND (s.direction = 'like' OR s.direction = 'super')
        AND ${VISIBLE_TO_VIEWER}
        AND p.id NOT IN (
          SELECT swipee_id FROM swipes WHERE swiper_id = $1
        )
      ORDER BY s.created_at DESC
      LIMIT 100`,
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    logger.error("fetch likes-you failed", err);
    res.status(500).json({ error: "Internal server error fetching likes-you profiles" });
  }
});

module.exports = router;
