const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const config = require("./config");
const logger = require("./logger");
const age = require("./age");
const eligibility = require("./eligibility");
const { POLICY_VERSIONS } = require("./policies");
const { normalizePhotoList } = require("./photoUtils");
const { hashPassword, needsRehash, passwordProblem } = require("./passwords");
const session = require("./session");

const { authenticateToken } = session;
const router = express.Router();
const JWT_SECRET = config.jwtSecret;

// Helper to generate UUID-like strings
function generateId() {
  return "usr_" + crypto.randomUUID();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Values the app offers; the server accepts nothing else.
const GENDERS = ["male", "female", "non_binary", "other"];
const INTERESTED_IN = ["male", "female", "everyone"];
const INTENTIONS = ["long_term", "short_term", "friendship", "figuring_out"];

// Compared against when the email is unknown, so "no such user" and "wrong password"
// take the same time and can't be told apart.
const DUMMY_HASH = bcrypt.hashSync("dateza-dummy-password", 10);

// Brute-force protection: failed logins only, per email + IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${String(req.body?.email || "").trim().toLowerCase()}|${req.ip}`,
  message: { error: "Too many failed sign-in attempts. Please try again in 15 minutes.", code: "rate_limited" },
});

// Registration abuse limit: per IP, on top of the general /api/auth limit.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: parseInt(process.env.REGISTER_RATE_LIMIT, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-ups from this network. Please try again later.", code: "rate_limited" },
});

const asString = (v) => (typeof v === "string" ? v : "");

// Registration needs: e-mail, a strong password, a name, a real date of birth of an adult, and acceptance
// of the CURRENT policy versions. Nothing is invented and nothing is created for someone under 18.
const handleRegister = async (req, res) => {
  const email = asString(req.body?.email);
  const password = asString(req.body?.password);
  const name = asString(req.body?.name);
  if (!email || !password || !name.trim()) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }

  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem, code: "weak_password" });
  if (name.trim().length > 100) {
    return res.status(400).json({ error: "Name is too long" });
  }

  const dob = age.validateBirthdate(req.body?.birthdate);
  if (!dob.ok) {
    return res.status(400).json({
      error: dob.message,
      code: dob.code === "underage" ? "underage" : "invalid_birthdate",
      reason: dob.code,
      field: "birthdate",
    });
  }

  const accepted = req.body?.accepted_policies;
  if (!accepted || accepted.terms !== POLICY_VERSIONS.terms || accepted.privacy !== POLICY_VERSIONS.privacy) {
    return res.status(400).json({
      error: "Please accept the Terms of Service and the Privacy Policy to continue.",
      code: "consent_required",
      policies: POLICY_VERSIONS,
    });
  }

  try {
    // Check if email already exists
    const existing = await db.query("SELECT id FROM profiles WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hashedPassword = await hashPassword(password);
    const userId = generateId();

    const user = await db.withTransaction(async (q) => {
      const inserted = await q(
        `INSERT INTO profiles (id, email, password, name, birthdate, is_online, onboarding_done)
         VALUES ($1, $2, $3, $4, $5, false, $6)
         RETURNING *`,
        [userId, cleanEmail, hashedPassword, name.trim(), dob.birthdate, ["basics", "birthday"]]
      );
      for (const kind of ["terms", "privacy"]) {
        await q(
          `INSERT INTO privacy_consents (id, user_id, kind, version) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, kind, version) DO NOTHING`,
          [crypto.randomUUID(), userId, kind, POLICY_VERSIONS[kind]]
        );
      }
      return inserted.rows[0];
    });

    session.sendSession(req, res, user, 201);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    logger.error("registration failed", err);
    res.status(500).json({ error: "Internal server error during registration" });
  }
};

router.post("/register", registerLimiter, handleRegister);
router.post("/signup", registerLimiter, handleRegister);

// Route: User login
router.post("/login", loginLimiter, async (req, res) => {
  const email = asString(req.body?.email);
  const password = asString(req.body?.password);
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const result = await db.query("SELECT * FROM profiles WHERE email = $1", [cleanEmail]);
    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password.slice(0, 1024), user ? user.password : DUMMY_HASH);

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password", code: "invalid_credentials" });
    }

    // Only after the password is right do we say why an account cannot sign in. Suspended, banned and
    // deleted accounts get no session at all.
    const blocked = eligibility.statusProblem(user);
    if (blocked) {
      return res.status(403).json({ error: eligibility.REASON_MESSAGES[blocked], code: blocked });
    }

    // Online presence is tracked by live socket connections (see index.js), not by login.

    // Transparently upgrade an older, cheaper hash now that we know the plaintext
    if (needsRehash(user.password)) {
      hashPassword(password)
        .then((h) => db.query("UPDATE profiles SET password = $1 WHERE id = $2", [h, user.id]))
        .catch((err) => logger.error("password rehash failed", err));
    }
    // Delete password from user object
    delete user.password;

    session.sendSession(req, res, user);
  } catch (err) {
    logger.error("login failed", err);
    res.status(500).json({ error: "Internal server error during login" });
  }
});

// Route: Log out. Clears the web cookie; native clients just discard their token.
// Works even with an expired session so a stale cookie can always be removed.
router.post("/logout", (req, res) => {
  const { via } = session.extractCredential(req);
  if (via === "cookie" && !session.passesCsrf(req)) {
    return res.status(403).json({ error: "Request blocked (CSRF check failed)", code: "csrf" });
  }
  // A bearer session (native, or a per-tab web demo session) has no cookie of its own;
  // don't sign out a real member whose cookie lives in the same browser.
  if (via !== "bearer") session.clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

// Route: One-time ticket for opening a Socket.IO connection (used by web, where the
// session token lives in an HttpOnly cookie that sockets on another origin can't use).
// Only eligible members get one: real-time messaging is a dating feature.
router.post("/socket-ticket", authenticateToken, eligibility.requireEligible, (req, res) => {
  res.status(200).json({ ticket: session.createSocketTicket(req.user.id, req.user.tv ?? 0), expires_in: config.socketTicketSeconds });
});

// Validates the profile fields the legacy edit endpoint may change. Fields that are absent are left alone.
//
// What it will NOT take (each has a dedicated, validated path):
//   - birthdate         set during onboarding only (PATCH /api/onboarding/birthday); never editable here
//   - lat / lng         precise location needs a consent flow that does not exist yet
//   - profile_completed_at, status, email_verified_at, onboarding fields  (not read at all)
function validateProfileInput(body) {
  const out = {};
  const text = (key, max) => {
    if (body[key] === undefined) return null;
    if (body[key] !== null && typeof body[key] !== "string") return `${key} must be text`;
    if (typeof body[key] === "string" && body[key].length > max) return `${key} must be ${max} characters or fewer`;
    out[key] = body[key] === null ? null : body[key].trim();
    return null;
  };
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) {
      return { error: "name must be 1 to 100 characters" };
    }
    out.name = body.name.trim();
  }
  if (body.gender !== undefined) {
    if (!GENDERS.includes(body.gender)) return { error: `gender must be one of: ${GENDERS.join(", ")}` };
    out.gender = body.gender;
  }
  if (body.looking_for !== undefined) {
    if (!INTERESTED_IN.includes(body.looking_for)) return { error: `looking_for must be one of: ${INTERESTED_IN.join(", ")}` };
    out.looking_for = body.looking_for;
  }
  const err = text("bio", 1000);
  if (err) return { error: err };
  if (body.birthdate !== undefined) {
    return { error: "Your date of birth is set during onboarding and cannot be changed here.", code: "use_onboarding" };
  }
  if (body.height_cm !== undefined) {
    const h = body.height_cm === null ? null : Number(body.height_cm);
    if (h !== null && (!Number.isInteger(h) || h < 100 || h > 250)) return { error: "height_cm must be a whole number between 100 and 250" };
    out.height_cm = h;
  }
  if (body.interests !== undefined) {
    if (!Array.isArray(body.interests) || body.interests.length > 30 || body.interests.some((i) => typeof i !== "string" || i.length > 40)) {
      return { error: "interests must be a list of up to 30 short texts" };
    }
    out.interests = body.interests.map((i) => i.trim()).filter(Boolean);
  }
  // Precise location is private and needs an explicit consent flow that does not exist yet
  // (planned with the discovery rewrite). Until then profile setup refuses coordinates instead of
  // silently storing something nobody agreed to share. (null / absent is fine: nothing to store.)
  for (const key of ["lat", "lng"]) {
    if (body[key] !== undefined && body[key] !== null) {
      return { error: "Precise location (lat/lng) cannot be saved yet.", code: "location_not_supported" };
    }
  }
  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > 12) return { error: "photos must be a list of up to 12 images" };
    // Keep only photos other devices can load: our stored images or web URLs
    out.photos = normalizePhotoList(body.photos);
  }
  return { fields: out };
}

const IMAGE_ID_RE = /^\/api\/images\/([0-9a-f-]{36})$/i;

/**
 * Photos may only be images THIS member uploaded. Entries already on the profile may stay (older accounts
 * can hold photos from before this rule). Returns an error message or null.
 */
async function checkOwnPhotos(userId, requested, current = []) {
  const keep = new Set(current);
  const fresh = requested.filter((p) => !keep.has(p));
  if (fresh.length === 0) return null;
  const ids = [];
  for (const p of fresh) {
    const m = IMAGE_ID_RE.exec(p);
    if (!m) return "Photos must be uploaded from your device.";
    ids.push(m[1].toLowerCase());
  }
  const owned = await db.query("SELECT id FROM images WHERE id = ANY($1::uuid[]) AND owner_id = $2", [ids, userId]);
  return owned.rows.length === new Set(ids).size ? null : "Photos must be uploaded from your device.";
}

// Route: Edit profile details (name, gender, interested-in, bio, height, interests, photos). Only the
// fields you send are changed, so a client can update just the photos (or bio, ...) without wiping the
// rest of the profile. It can never complete onboarding, change the date of birth or store a location.
router.post("/complete-setup", authenticateToken, async (req, res) => {
  const parsed = validateProfileInput(req.body || {});
  if (parsed.error) {
    return res.status(400).json(parsed.code ? { error: parsed.error, code: parsed.code } : { error: parsed.error });
  }
  const userId = req.user.id;
  const f = parsed.fields;

  try {
    if (f.photos) {
      const current = await db.query("SELECT photos FROM profiles WHERE id = $1", [userId]);
      const problem = await checkOwnPhotos(userId, f.photos, current.rows[0]?.photos || []);
      if (problem) return res.status(400).json({ error: problem, code: "photo_not_owned" });
    }

    const result = await db.query(
      `UPDATE profiles
       SET gender = COALESCE($1, gender),
           looking_for = COALESCE($2, looking_for), bio = COALESCE($3, bio),
           height_cm = CASE WHEN $4::boolean THEN $5::integer ELSE height_cm END, interests = COALESCE($6, interests),
           photos = COALESCE($7, photos),
           name = COALESCE($9, name)
       WHERE id = $8
       RETURNING *`,
      [f.gender ?? null, f.looking_for ?? null, f.bio ?? null, "height_cm" in f, f.height_cm ?? null,
       f.interests ?? null, f.photos ?? null, userId, f.name ?? null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }

    res.status(200).json({ user: eligibility.withEligibility(result.rows[0]) });
  } catch (err) {
    logger.error("complete-setup failed", err);
    res.status(500).json({ error: "Internal server error during profile setup" });
  }
});

// Route: Get current user profile (with the server's verdict on whether dating features are open)
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM profiles WHERE id = $1", [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }
    res.status(200).json(eligibility.withEligibility(result.rows[0]));
  } catch (err) {
    logger.error("fetch profile failed", err);
    res.status(500).json({ error: "Internal server error fetching profile" });
  }
});

router.validateProfileInput = validateProfileInput;
router.checkOwnPhotos = checkOwnPhotos;

module.exports = {
  router,
  authenticateToken,
  JWT_SECRET,
  GENDERS,
  INTERESTED_IN,
  INTENTIONS,
  checkOwnPhotos,
};
