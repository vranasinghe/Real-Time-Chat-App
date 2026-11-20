// One-tap "Live Demo" login.
//
// Two built-in accounts (Alex and Elena) are already matched with each other, so
// two devices can start chatting in real time without signing up: device 1 picks
// Alex, device 2 picks Elena.
//
// Off unless DEMO_LOGIN_ENABLED=true. Demo accounts:
//   - have an unusable random password (only this endpoint can log into them)
//   - are flagged is_demo and never shown to real users in discovery
//   - have their chat history trimmed to the last DEMO_RETENTION_HOURS (default 24)

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const { JWT_SECRET } = require("./auth");
const { storeImage } = require("./images");

const router = express.Router();

const PERSONAS = {
  alex: {
    id: "demo-alex",
    email: "alex.demo@dateza.local",
    name: "Alex (Demo)",
    birthdate: "1998-03-12",
    gender: "male",
    looking_for: "everyone",
    bio: "Live demo account. Open the app on a second device as Elena and say hi!",
    height_cm: 180,
    interests: ["Music", "Travel", "Coffee", "Hiking"],
    photoFile: "demo/alex.jpg",
  },
  elena: {
    id: "demo-elena",
    email: "elena.demo@dateza.local",
    name: "Elena (Demo)",
    birthdate: "2000-08-15",
    gender: "female",
    looking_for: "everyone",
    bio: "Live demo account. Open the app on a second device as Alex and say hi!",
    height_cm: 168,
    interests: ["Art", "Coffee", "Photography", "Travel"],
    photoFile: "demo/elena.webp",
  },
};

const DEMO_IDS = Object.values(PERSONAS).map((p) => p.id);

// Demo photos ship as files in backend/public/ and are stored in the database
// (images table) on first use. Returns "/api/images/<id>".
const demoPhotoCache = new Map();
async function demoPhotoUrl(persona) {
  if (demoPhotoCache.has(persona.photoFile)) return demoPhotoCache.get(persona.photoFile);
  const bytes = fs.readFileSync(path.join(__dirname, "public", persona.photoFile));
  const { url } = await storeImage(bytes, { source: `file:public/${persona.photoFile}` });
  demoPhotoCache.set(persona.photoFile, url);
  return url;
}

// Full URL for the picker screen, built from how the client reached us
// (or PUBLIC_BASE_URL if set)
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

const isEnabled = () => process.env.DEMO_LOGIN_ENABLED === "true";

const retentionHours = () => {
  const h = parseInt(process.env.DEMO_RETENTION_HOURS, 10);
  return Number.isInteger(h) && h > 0 ? h : 24;
};

// Creates the demo accounts if needed, keeps their profile in sync with PERSONAS,
// removes retired demo accounts and makes sure the two personas are matched.
// Idempotent, so it is safe to run on every demo login.
async function ensureDemoAccounts() {
  // Retired personas (e.g. the old "Sam"): deleting the profile cascades to its
  // swipes, matches and messages
  await db.query("DELETE FROM profiles WHERE is_demo = true AND id <> ALL($1)", [DEMO_IDS]);

  for (const p of Object.values(PERSONAS)) {
    const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    await db.query(
      `INSERT INTO profiles (id, email, password, name, birthdate, gender, looking_for, bio, height_cm, interests, photos, is_online, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, true)
       ON CONFLICT (id) DO UPDATE SET
         is_demo = true, name = EXCLUDED.name, birthdate = EXCLUDED.birthdate, gender = EXCLUDED.gender,
         looking_for = EXCLUDED.looking_for, bio = EXCLUDED.bio, height_cm = EXCLUDED.height_cm,
         interests = EXCLUDED.interests, photos = EXCLUDED.photos`,
      [p.id, p.email, unusablePassword, p.name, p.birthdate, p.gender, p.looking_for, p.bio, p.height_cm, p.interests, [await demoPhotoUrl(p)]]
    );
  }

  const [a, b] = [...DEMO_IDS].sort();
  for (const [swiper, swipee] of [[a, b], [b, a]]) {
    await db.query(
      `INSERT INTO swipes (swiper_id, swipee_id, direction)
       VALUES ($1, $2, 'like')
       ON CONFLICT (swiper_id, swipee_id) DO UPDATE SET direction = 'like'`,
      [swiper, swipee]
    );
  }

  await db.query(
    `INSERT INTO matches (id, user_a, user_b, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '10 years')
     ON CONFLICT (user_a, user_b) DO NOTHING`,
    [`match_${a}_${b}`.replace(/-/g, "_"), a, b]
  );
}

// Keeps the shared demo chat short and fresh
async function trimDemoHistory() {
  await db.query(
    `DELETE FROM messages
     WHERE created_at < NOW() - make_interval(hours => $2)
       AND match_id IN (SELECT id FROM matches WHERE user_a = ANY($1) OR user_b = ANY($1))`,
    [DEMO_IDS, retentionHours()]
  );
}

// Route: Is live demo available, and which accounts can be picked?
router.get("/status", async (req, res) => {
  if (!isEnabled()) {
    return res.status(200).json({ enabled: false, personas: [] });
  }
  try {
    const base = baseUrl(req);
    const personas = [];
    for (const [key, p] of Object.entries(PERSONAS)) {
      personas.push({ key, name: p.name, photo: base + (await demoPhotoUrl(p)), bio: p.bio });
    }
    res.status(200).json({ enabled: true, personas });
  } catch (err) {
    console.error("Demo status error:", err);
    res.status(500).json({ error: "Internal server error loading live demo" });
  }
});

// Route: Log in as a demo persona. Body: { persona: "alex" | "elena" }
router.post("/", async (req, res) => {
  if (!isEnabled()) {
    return res.status(404).json({ error: "Live demo is not enabled on this server" });
  }

  const persona = PERSONAS[req.body?.persona];
  if (!persona) {
    return res.status(400).json({ error: `persona must be one of: ${Object.keys(PERSONAS).join(", ")}` });
  }

  try {
    await ensureDemoAccounts();
    await trimDemoHistory();

    const result = await db.query("SELECT * FROM profiles WHERE id = $1", [persona.id]);
    const user = result.rows[0];
    delete user.password;

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.status(200).json({ token, user });
  } catch (err) {
    console.error("Demo login error:", err);
    res.status(500).json({ error: "Internal server error during demo login" });
  }
});

module.exports = { router, PERSONAS, DEMO_IDS };
