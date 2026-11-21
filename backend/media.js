const express = require("express");
const crypto = require("node:crypto");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const logger = require("./logger");
const { authenticateToken } = require("./auth");
const { detectImageType, MAX_IMAGE_BYTES } = require("./images");
const { emitToMatch } = require("./realtime");

const router = express.Router();
const storiesRouter = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function detectMediaType(bytes) {
  const image = detectImageType(bytes);
  if (image) return { type: "image", contentType: image };
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brands = bytes.toString("ascii", 8, Math.min(bytes.length, 40));
    if (/avif|avis|heic|heix|mif1/.test(brands)) return null;
    if (/qt  /.test(brands)) return { type: "video", contentType: "video/quicktime" };
    if (/isom|iso[2-9]|mp4[12]|avc1|M4V /.test(brands)) return { type: "video", contentType: "video/mp4" };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && bytes.subarray(0, 4096).includes(Buffer.from("webm"))) return { type: "video", contentType: "video/webm" };
  return null;
}

const uploadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
router.post("/", uploadLimiter, authenticateToken, express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
  const purpose = req.query.purpose;
  const matchId = typeof req.query.matchId === "string" ? req.query.matchId : null;
  if (!["chat", "story"].includes(purpose)) return res.status(400).json({ error: "Choose chat or story media." });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Choose a photo or video to upload." });
  const format = detectMediaType(req.body);
  if (!format) return res.status(400).json({ error: "Use JPEG, PNG, WebP, GIF, MP4, MOV or WebM media." });
  if (format.type === "image" && req.body.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: "Photos must be 5 MB or smaller." });
  if (purpose === "chat" && format.type !== "image") return res.status(400).json({ error: "Chat attachments support photos." });
  try {
    if (purpose === "chat") {
      const match = await db.query("SELECT id FROM matches WHERE id = $1 AND (user_a = $2 OR user_b = $2)", [matchId, req.user.id]);
      if (!match.rows.length) return res.status(403).json({ error: "You can only upload photos to your own conversations." });
    }
    const saved = await db.withTransaction(async query => {
      // Serialize quota checks for simultaneous uploads by the same account.
      await query("SELECT id FROM profiles WHERE id = $1 FOR UPDATE", [req.user.id]);
      const quota = await query("SELECT count(*)::int AS count, COALESCE(SUM(bytes),0)::bigint AS bytes FROM ephemeral_media WHERE owner_id = $1 AND expires_at > NOW()", [req.user.id]);
      if (quota.rows[0].count >= 100 || Number(quota.rows[0].bytes) + req.body.length > 250 * 1024 * 1024) throw new Error("media_quota");
      const result = await query(
        `INSERT INTO ephemeral_media (id, owner_id, match_id, purpose, media_type, content_type, data, bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, media_type, created_at, expires_at`,
        [crypto.randomUUID(), req.user.id, purpose === "chat" ? matchId : null, purpose, format.type, format.contentType, req.body, req.body.length]
      );
      return result.rows[0];
    });
    res.status(201).json({ ...saved, url: `/api/media/${saved.id}` });
  } catch (err) {
    if (err.message === "media_quota") return res.status(429).json({ error: "Your media storage is full. Try again after older uploads expire." });
    logger.error("media upload failed", err);
    res.status(500).json({ error: "Could not upload media. Try again." });
  }
});

// No caches: access and the exact 12-hour deadline are checked on every request,
// including video range requests. The bytes are never put in the public image store.
router.get("/:id", authenticateToken, async (req, res) => {
  res.set({ "Cache-Control": "private, no-store, max-age=0", "Cross-Origin-Resource-Policy": "cross-origin" });
  if (!UUID.test(req.params.id)) return res.sendStatus(404);
  try {
    const result = await db.query(
      `SELECT e.* FROM ephemeral_media e JOIN profiles p ON p.id = e.owner_id
       WHERE e.id = $1 AND e.expires_at > NOW() AND (
         (e.purpose = 'chat' AND EXISTS (SELECT 1 FROM matches m WHERE m.id = e.match_id AND (m.user_a = $2 OR m.user_b = $2)))
         OR (e.purpose = 'story' AND (e.owner_id = $2 OR (EXISTS (SELECT 1 FROM stories s WHERE s.media_id = e.id)
           AND (p.is_demo = false OR EXISTS (SELECT 1 FROM profiles v WHERE v.id = $2 AND v.is_demo))))))`,
      [req.params.id, req.user.id]
    );
    const media = result.rows[0];
    if (!media) return res.sendStatus(404);
    res.set({ "Content-Type": media.content_type, "Accept-Ranges": "bytes" });
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      const start = range?.[1] ? Number(range[1]) : range?.[2] ? Math.max(0, media.bytes - Number(range[2])) : NaN;
      const end = range?.[1] && range?.[2] ? Math.min(Number(range[2]), media.bytes - 1) : media.bytes - 1;
      if (!Number.isSafeInteger(start) || start < 0 || start >= media.bytes || end < start) return res.status(416).set("Content-Range", `bytes */${media.bytes}`).end();
      return res.status(206).set({ "Content-Range": `bytes ${start}-${end}/${media.bytes}`, "Content-Length": String(end - start + 1) }).send(media.data.subarray(start, end + 1));
    }
    res.set("Content-Length", String(media.bytes)).send(media.data);
  } catch (err) { logger.error("media fetch failed", err); res.sendStatus(500); }
});

const STORY_FIELDS = `s.id, s.user_id, p.name AS user_name, COALESCE(p.photos[1], '') AS user_avatar,
  '/api/media/' || e.id AS media_url, e.media_type, s.created_at, e.expires_at`;
storiesRouter.use(authenticateToken);
storiesRouter.get("/", async (req, res) => {
  try {
    const result = await db.query(`SELECT ${STORY_FIELDS} FROM stories s JOIN ephemeral_media e ON e.id = s.media_id JOIN profiles p ON p.id = s.user_id
      WHERE e.expires_at > NOW() AND (p.is_demo = false OR EXISTS (SELECT 1 FROM profiles v WHERE v.id = $1 AND v.is_demo))
      ORDER BY s.created_at DESC LIMIT 200`, [req.user.id]);
    res.set("Cache-Control", "no-store").json(result.rows);
  } catch (err) { logger.error("story feed failed", err); res.status(500).json({ error: "Could not load statuses." }); }
});
storiesRouter.post("/", async (req, res) => {
  const mediaId = req.body?.media_id;
  if (typeof mediaId !== "string" || !UUID.test(mediaId)) return res.status(400).json({ error: "Upload a photo or video first." });
  try {
    const inserted = await db.query(`INSERT INTO stories (id, user_id, media_id)
      SELECT $1::uuid, $2::varchar, id FROM ephemeral_media WHERE id = $3::uuid AND owner_id = $2::varchar AND purpose = 'story' AND expires_at > NOW()
      ON CONFLICT (media_id) DO NOTHING RETURNING id`, [crypto.randomUUID(), req.user.id, mediaId]);
    const result = await db.query(`SELECT ${STORY_FIELDS} FROM stories s JOIN ephemeral_media e ON e.id = s.media_id JOIN profiles p ON p.id = s.user_id
      WHERE e.id = $1 AND s.user_id = $2 AND e.expires_at > NOW()`, [mediaId, req.user.id]);
    if (!result.rows.length) return res.status(400).json({ error: "Media is unavailable or expired. Upload it again." });
    req.app.get("socketio")?.emit("stories_changed");
    res.status(inserted.rows.length ? 201 : 200).json(result.rows[0]);
  } catch (err) { logger.error("story publish failed", err); res.status(500).json({ error: "Could not publish status." }); }
});
storiesRouter.delete("/:id", async (req, res) => {
  if (!UUID.test(req.params.id)) return res.sendStatus(404);
  try {
    const result = await db.query(`DELETE FROM ephemeral_media WHERE id IN (SELECT media_id FROM stories WHERE id = $1 AND user_id = $2) RETURNING id`, [req.params.id, req.user.id]);
    if (!result.rows.length) return res.sendStatus(404);
    req.app.get("socketio")?.emit("stories_changed");
    res.sendStatus(204);
  } catch (err) { logger.error("story delete failed", err); res.sendStatus(500); }
});

async function cleanupExpiredMedia(io) {
  const expired = await db.query(`DELETE FROM messages WHERE expires_at <= NOW() RETURNING id, match_id`);
  const media = await db.query("DELETE FROM ephemeral_media WHERE expires_at <= NOW() RETURNING id");
  for (const matchId of new Set(expired.rows.map(m => m.match_id))) {
    const match = (await db.query("SELECT * FROM matches WHERE id = $1", [matchId])).rows[0];
    emitToMatch(io, match, "media_expired", { match_id: matchId });
  }
  if (media.rows.length) io?.emit("stories_changed");
  return { messages: expired.rowCount, media: media.rowCount };
}

module.exports = { router, storiesRouter, cleanupExpiredMedia, detectMediaType, MAX_VIDEO_BYTES };
