// Server-driven onboarding. Mounted at /api/onboarding. Every route needs a valid session of an active
// account; none needs a finished profile (this is how a profile gets finished).
//
//   GET   /api/onboarding            the member's saved answers, which steps are confirmed, the next step,
//                                    what is still missing, and e-mail / consent status
//   PATCH /api/onboarding/:step      validate and save ONE step (and mark it confirmed)
//   POST  /api/onboarding/complete   re-validate everything; only then does the SERVER set
//                                    profile_completed_at. A client can never mark itself complete.
//
// Rules this file enforces
//   - Nothing is invented: a step stores exactly what the member sent, optional answers may be empty, and
//     the member must confirm every step themselves. Gender, interested-in and intention are never
//     pre-selected for someone who has not confirmed them.
//   - The date of birth is validated strictly (age.js). An under-18 date is recorded and LOCKS the date
//     (it cannot be re-entered to try another one) and the account never becomes eligible. Once a profile is
//     completed the date can no longer be changed through the API.
//   - Photos must be images the member uploaded; at least one is required (three are recommended).
//   - Existing accounts keep all their data. Values that earlier versions of the app guessed and saved
//     (birth date 1999-01-01, the canned bio, the four default interests, height 175, stock photos) are not
//     shown as if the member had chosen them, so the member has to enter them for real.

const express = require("express");
const db = require("./db");
const logger = require("./logger");
const age = require("./age");
const config = require("./config");
const mailer = require("./mailer");
const session = require("./session");
const eligibility = require("./eligibility");
const { POLICY_VERSIONS } = require("./policies");
const { GENDERS, INTERESTED_IN, INTENTIONS } = require("./auth");

const router = express.Router();
router.use(session.authenticateToken);

const STEPS = [
  { id: "consent", required: true, derived: true },
  { id: "basics", required: true },
  { id: "verify_email", required: true, derived: true },
  { id: "birthday", required: true },
  { id: "gender", required: true },
  { id: "interested_in", required: true },
  { id: "intention", required: false },
  { id: "photos", required: true },
  { id: "interests", required: false },
  { id: "about", required: false },
  { id: "preferences", required: false },
];
const STEP_IDS = new Set(STEPS.map((s) => s.id));
const MAX_PHOTOS = 12;
const RECOMMENDED_PHOTOS = 3;
const IMAGE_ID_RE = /^\/api\/images\/([0-9a-f-]{36})$/i;

// Values earlier app versions invented and stored (see docs/implementation/BASELINE_AUDIT.md D-03).
const LEGACY = {
  birthdate: "1999-01-01",
  bio: "Just finished setting up my Dateza profile! Let's connect.",
  interests: ["Music", "Coffee", "Design", "Tacos"],
  height_cm: 175,
};
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });

async function ownedImageIds(userId, ids) {
  if (!ids.length) return new Set();
  const r = await db.query("SELECT id FROM images WHERE id = ANY($1::uuid[]) AND owner_id = $2", [ids, userId]);
  return new Set(r.rows.map((x) => x.id));
}

/** Builds the full onboarding state for one member from the database. */
async function loadState(userId) {
  const row = (await db.query("SELECT * FROM profiles WHERE id = $1", [userId])).rows[0];
  if (!row) return null;
  const prefs = (await db.query("SELECT min_age, max_age FROM user_preferences WHERE user_id = $1", [userId])).rows[0] || {};
  const consents = (await db.query("SELECT kind, version FROM privacy_consents WHERE user_id = $1", [userId])).rows;
  const accepted = {
    terms: consents.some((c) => c.kind === "terms" && c.version === POLICY_VERSIONS.terms),
    privacy: consents.some((c) => c.kind === "privacy" && c.version === POLICY_VERSIONS.privacy),
  };

  const photoEntries = Array.isArray(row.photos) ? row.photos : [];
  const photoIds = photoEntries.map((p) => IMAGE_ID_RE.exec(p)?.[1]?.toLowerCase()).filter(Boolean);
  const owned = await ownedImageIds(userId, photoIds);
  const ownPhotos = photoEntries.filter((p) => {
    const id = IMAGE_ID_RE.exec(p)?.[1]?.toLowerCase();
    return id && owned.has(id);
  });

  const completed = !!row.profile_completed_at;
  const confirmed = new Set(row.onboarding_done || []);
  const emailRequired = config.requireEmailVerification;
  const done = (id) => {
    if (completed) return true;
    if (id === "consent") return accepted.terms && accepted.privacy;
    if (id === "verify_email") return !emailRequired || !!row.email_verified_at;
    return confirmed.has(id);
  };
  const steps = STEPS.map((s) => ({ id: s.id, required: s.required, done: done(s.id) }));
  const next = steps.find((s) => !s.done);

  const sure = (id) => completed || confirmed.has(id); // the member has explicitly confirmed this answer
  const dob = row.birthdate ? eligibility.dateOnly(row.birthdate) : null;
  const dobCheck = age.validateBirthdate(dob);
  const profile = {
    name: row.name || "",
    birthdate: dob && !(dob === LEGACY.birthdate && !sure("birthday")) ? dob : null,
    gender: sure("gender") ? row.gender || null : null,
    looking_for: sure("interested_in") ? row.looking_for || null : null,
    relationship_intention: sure("intention") ? row.relationship_intention || null : null,
    photos: ownPhotos,
    interests: !sure("interests") && sameList(row.interests, LEGACY.interests) ? [] : row.interests || [],
    bio: !sure("about") && row.bio === LEGACY.bio ? "" : row.bio || "",
    height_cm: !sure("about") && row.height_cm === LEGACY.height_cm ? null : row.height_cm ?? null,
    min_age: prefs.min_age ?? null,
    max_age: prefs.max_age ?? null,
  };

  // What still blocks completion, in step order.
  const missing = [];
  const need = (id, cond) => { if (cond && !missing.includes(id)) missing.push(id); };
  need("consent", !accepted.terms || !accepted.privacy);
  need("basics", !completed && !confirmed.has("basics"));
  need("verify_email", emailRequired && !row.email_verified_at);
  need("birthday", !completed && !confirmed.has("birthday"));
  need("birthday", !dobCheck.ok);
  need("gender", !completed && !confirmed.has("gender"));
  need("gender", !row.gender);
  need("interested_in", !completed && !confirmed.has("interested_in"));
  need("interested_in", !row.looking_for);
  need("photos", ownPhotos.length < 1);
  need("photos", !completed && !confirmed.has("photos"));

  return {
    row,
    state: {
      complete: completed,
      next_step: next ? next.id : "review",
      steps,
      profile,
      email: { address: row.email, verified: !!row.email_verified_at, required: emailRequired, delivery_available: mailer.isEnabled() },
      consent: { current_versions: POLICY_VERSIONS, accepted },
      photos: { minimum: 1, recommended: RECOMMENDED_PHOTOS, maximum: MAX_PHOTOS },
      birthdate_locked: !!dob && (!dobCheck.ok && dobCheck.code === "underage" ? true : completed),
      underage: !!dob && !dobCheck.ok && dobCheck.code === "underage",
      missing,
      can_complete: missing.length === 0,
      eligibility: eligibility.withEligibility(row).eligibility,
      options: { genders: GENDERS, interested_in: INTERESTED_IN, intentions: INTENTIONS },
    },
  };
}

router.get("/", async (req, res) => {
  try {
    const loaded = await loadState(req.user.id);
    if (!loaded) return fail(res, 404, "not_found", "User profile not found");
    res.status(200).json(loaded.state);
  } catch (err) {
    logger.error("onboarding state failed", err);
    fail(res, 500, "server_error", "Could not load your profile setup");
  }
});

// Marks a step confirmed and remembers it as the last one touched.
const confirm = (step) => ({
  done: `onboarding_done = CASE WHEN '${step}' = ANY(onboarding_done) THEN onboarding_done ELSE array_append(onboarding_done, '${step}') END, onboarding_step = '${step}'`,
});

const isText = (v, max) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;

const HANDLERS = {
  async consent(req, res, { userId }) {
    const a = req.body?.accepted_policies;
    if (!a || a.terms !== POLICY_VERSIONS.terms || a.privacy !== POLICY_VERSIONS.privacy) {
      return fail(res, 400, "consent_required", "Please accept the Terms of Service and the Privacy Policy to continue.", { policies: POLICY_VERSIONS });
    }
    for (const kind of ["terms", "privacy"]) {
      await db.query(
        `INSERT INTO privacy_consents (id, user_id, kind, version) VALUES (gen_random_uuid(), $1, $2, $3)
         ON CONFLICT (user_id, kind, version) DO NOTHING`,
        [userId, kind, POLICY_VERSIONS[kind]]
      );
    }
    await db.query(`UPDATE profiles SET onboarding_step = 'consent' WHERE id = $1`, [userId]);
    return true;
  },

  async basics(req, res, { userId }) {
    if (!isText(req.body?.name, 100)) return fail(res, 400, "invalid_name", "Please enter your name (up to 100 characters).");
    await db.query(`UPDATE profiles SET name = $2, ${confirm("basics").done} WHERE id = $1`, [userId, req.body.name.trim()]);
    return true;
  },

  verify_email(req, res) {
    return fail(res, 400, "use_verification_endpoints", "Verify your e-mail with the verification code sent to you.");
  },

  async birthday(req, res, { userId, row }) {
    const current = row.birthdate ? eligibility.dateOnly(row.birthdate) : null;
    const currentCheck = age.validateBirthdate(current);
    if (current && !currentCheck.ok && currentCheck.code === "underage") {
      return fail(res, 403, "underage", age.validateBirthdate(current).message); // locked: no second try
    }
    if (row.profile_completed_at) {
      return fail(res, 409, "birthdate_locked", "Your date of birth can't be changed after setup. Contact support if it is wrong.");
    }
    const v = age.validateBirthdate(req.body?.birthdate);
    if (!v.ok && v.code !== "underage") {
      return fail(res, 400, "invalid_birthdate", v.message, { reason: v.code, field: "birthdate" });
    }
    if (!v.ok) {
      // Under 18: remember it so the answer cannot simply be re-entered, and refuse.
      await db.query("UPDATE profiles SET birthdate = $2 WHERE id = $1", [userId, req.body.birthdate]);
      return fail(res, 403, "underage", v.message);
    }
    await db.query(`UPDATE profiles SET birthdate = $2, ${confirm("birthday").done} WHERE id = $1`, [userId, v.birthdate]);
    return true;
  },

  async gender(req, res, { userId }) {
    if (!GENDERS.includes(req.body?.gender)) return fail(res, 400, "invalid_gender", `Choose one of: ${GENDERS.join(", ")}.`);
    await db.query(`UPDATE profiles SET gender = $2, ${confirm("gender").done} WHERE id = $1`, [userId, req.body.gender]);
    return true;
  },

  async interested_in(req, res, { userId }) {
    if (!INTERESTED_IN.includes(req.body?.looking_for)) return fail(res, 400, "invalid_preference", `Choose one of: ${INTERESTED_IN.join(", ")}.`);
    await db.query(`UPDATE profiles SET looking_for = $2, ${confirm("interested_in").done} WHERE id = $1`, [userId, req.body.looking_for]);
    return true;
  },

  async intention(req, res, { userId }) {
    const v = req.body?.relationship_intention;
    if (v !== null && !INTENTIONS.includes(v)) return fail(res, 400, "invalid_intention", `Choose one of: ${INTENTIONS.join(", ")}, or skip.`);
    await db.query(`UPDATE profiles SET relationship_intention = $2, ${confirm("intention").done} WHERE id = $1`, [userId, v]);
    return true;
  },

  async photos(req, res, { userId }) {
    const list = req.body?.photos;
    if (!Array.isArray(list) || list.length > MAX_PHOTOS || list.some((p) => typeof p !== "string")) {
      return fail(res, 400, "invalid_photos", `Send a list of up to ${MAX_PHOTOS} photos you uploaded.`);
    }
    const ids = [];
    for (const p of list) {
      const m = IMAGE_ID_RE.exec(p);
      if (!m) return fail(res, 400, "photo_not_owned", "Photos must be uploaded from your device.");
      ids.push(m[1].toLowerCase());
    }
    if (new Set(ids).size !== ids.length) return fail(res, 400, "invalid_photos", "The same photo is listed twice.");
    const owned = await ownedImageIds(userId, ids);
    if (owned.size !== ids.length) return fail(res, 400, "photo_not_owned", "Photos must be uploaded from your device.");
    await db.query(`UPDATE profiles SET photos = $2, ${confirm("photos").done} WHERE id = $1`, [userId, ids.map((id) => `/api/images/${id}`)]);
    return true;
  },

  async interests(req, res, { userId }) {
    const list = req.body?.interests;
    if (!Array.isArray(list) || list.length > 30 || list.some((i) => typeof i !== "string" || i.trim().length > 40)) {
      return fail(res, 400, "invalid_interests", "Send up to 30 short interests.");
    }
    const seen = new Set();
    const clean = [];
    for (const i of list.map((x) => x.trim()).filter(Boolean)) {
      if (!seen.has(i.toLowerCase())) { seen.add(i.toLowerCase()); clean.push(i); }
    }
    await db.query(`UPDATE profiles SET interests = $2, ${confirm("interests").done} WHERE id = $1`, [userId, clean]);
    return true;
  },

  async about(req, res, { userId }) {
    const bio = req.body?.bio ?? null;
    const height = req.body?.height_cm ?? null;
    if (bio !== null && (typeof bio !== "string" || bio.length > 1000)) return fail(res, 400, "invalid_bio", "Your bio can be up to 1000 characters.");
    if (height !== null && (!Number.isInteger(height) || height < 100 || height > 250)) {
      return fail(res, 400, "invalid_height", "Height must be a whole number between 100 and 250 cm.");
    }
    await db.query(`UPDATE profiles SET bio = $2, height_cm = $3, ${confirm("about").done} WHERE id = $1`, [userId, bio === null ? null : bio.trim() || null, height]);
    return true;
  },

  async preferences(req, res, { userId }) {
    const min = req.body?.min_age ?? null;
    const max = req.body?.max_age ?? null;
    const okAge = (n) => n === null || (Number.isInteger(n) && n >= 18 && n <= 99);
    if (!okAge(min) || !okAge(max) || (min !== null && max !== null && min > max)) {
      return fail(res, 400, "invalid_preferences", "Choose an age range between 18 and 99, with the minimum not above the maximum.");
    }
    await db.query(
      `INSERT INTO user_preferences (user_id, min_age, max_age, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET min_age = EXCLUDED.min_age, max_age = EXCLUDED.max_age, updated_at = NOW()`,
      [userId, min, max]
    );
    await db.query(`UPDATE profiles SET ${confirm("preferences").done} WHERE id = $1`, [userId]);
    return true;
  },
};

router.patch("/:step", async (req, res) => {
  const step = req.params.step;
  if (!STEP_IDS.has(step)) return fail(res, 404, "unknown_step", "Unknown onboarding step");
  try {
    const before = await loadState(req.user.id);
    if (!before) return fail(res, 404, "not_found", "User profile not found");
    // Someone who is not an adult gets no further than the date-of-birth step.
    const ageVerdict = eligibility.evaluateAdult(before.row);
    if (ageVerdict.reason === "not_adult" && step !== "birthday") {
      return fail(res, 403, "underage", eligibility.REASON_MESSAGES.not_adult);
    }
    const outcome = await HANDLERS[step](req, res, { userId: req.user.id, row: before.row });
    if (outcome !== true) return outcome; // the handler already answered
    const after = await loadState(req.user.id);
    res.status(200).json(after.state);
  } catch (err) {
    logger.error("onboarding step failed", err);
    fail(res, 500, "server_error", "Could not save this step. Please try again.");
  }
});

router.post("/complete", async (req, res) => {
  try {
    const loaded = await loadState(req.user.id);
    if (!loaded) return fail(res, 404, "not_found", "User profile not found");
    if (loaded.state.underage || eligibility.evaluateAdult(loaded.row).reason === "not_adult") {
      return fail(res, 403, "underage", eligibility.REASON_MESSAGES.not_adult);
    }
    if (!loaded.state.can_complete) {
      return fail(res, 400, "onboarding_incomplete", "Some required steps are still missing.", { missing: loaded.state.missing, next_step: loaded.state.next_step });
    }
    await db.query(
      `UPDATE profiles SET profile_completed_at = COALESCE(profile_completed_at, NOW()), onboarding_step = NULL WHERE id = $1`,
      [req.user.id]
    );
    const after = await loadState(req.user.id);
    res.status(200).json(after.state);
  } catch (err) {
    logger.error("onboarding complete failed", err);
    fail(res, 500, "server_error", "Could not finish your profile. Please try again.");
  }
});

module.exports = { router, STEPS, LEGACY, loadState };
