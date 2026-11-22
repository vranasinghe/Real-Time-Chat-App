// Images stored in Postgres (the `images` table) and served by the API.
//
//   POST /api/images      (auth) upload one image: { data: "<base64 or data: URL>" }
//                          -> { id, url: "/api/images/<id>" }
//   GET  /api/images/:id  public, long-cached image bytes
//
// Profiles store photos as the relative path "/api/images/<id>"; the app turns
// that into a full URL using its backend address.

const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const logger = require("./logger");
const { authenticateToken } = require("./auth");
const { requireAdult } = require("./eligibility");

const router = express.Router();

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB after decoding
const MAX_IMAGES_PER_USER = 50; // keeps one account from filling the database
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Identify the format from the file's first bytes; the client-supplied type is not trusted
function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 6 && ["GIF87a", "GIF89a"].includes(buf.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

// Saves image bytes. With a `source`, the same source is only stored once and the
// existing id is returned. Returns { id, url } or throws on invalid input.
async function storeImage(buffer, { ownerId = null, source = null } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Image is empty");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 5 MB");
  const contentType = detectImageType(buffer);
  if (!contentType) throw new Error("Only JPEG, PNG, WebP or GIF images are supported");
  if (ownerId) {
    const count = await db.query("SELECT COUNT(*)::int AS n FROM images WHERE owner_id = $1", [ownerId]);
    if (count.rows[0].n >= MAX_IMAGES_PER_USER) throw new Error("Upload limit reached (too many stored photos)");
  }

  const result = await db.query(
    `INSERT INTO images (id, owner_id, content_type, data, bytes, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source) DO UPDATE SET source = EXCLUDED.source
     RETURNING id`,
    [crypto.randomUUID(), ownerId, contentType, buffer, buffer.length, source]
  );
  const id = result.rows[0].id;
  return { id, url: `/api/images/${id}` };
}

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  message: { error: "Too many uploads. Please try again in a few minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Route: upload an image (larger body limit than the rest of the API)
// Authenticate BEFORE parsing the large body, so anonymous callers cannot make us read 8 MB
router.post("/", uploadLimiter, authenticateToken, requireAdult, express.json({ limit: "8mb" }), async (req, res) => {
  const raw = typeof req.body?.data === "string" ? req.body.data : "";
  const base64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (!base64) {
    return res.status(400).json({ error: "data (base64 image) is required" });
  }

  try {
    const buffer = Buffer.from(base64, "base64");
    const image = await storeImage(buffer, { ownerId: req.user.id });
    res.status(201).json(image);
  } catch (err) {
    if (/supported|empty|larger|limit reached/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    logger.error("image upload failed", err);
    res.status(500).json({ error: "Internal server error uploading image" });
  }
});

// Route: serve an image
router.get("/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Image not found" });
  }
  try {
    const result = await db.query("SELECT content_type, data FROM images WHERE id = $1", [req.params.id]);
    const image = result.rows[0];
    if (!image) return res.status(404).json({ error: "Image not found" });

    res.set({
      "Content-Type": image.content_type,
      "Cache-Control": "public, max-age=31536000, immutable", // ids never change content
      "Cross-Origin-Resource-Policy": "cross-origin", // the app runs on another origin
    });
    res.send(image.data);
  } catch (err) {
    logger.error("image fetch failed", err);
    res.status(500).json({ error: "Internal server error fetching image" });
  }
});

module.exports = { router, storeImage, detectImageType, MAX_IMAGE_BYTES };
