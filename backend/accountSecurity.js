// Account security endpoints: email verification, password reset, password change and
// "sign out everywhere". Mounted under /api/auth.
//
// One-time codes are 6 digits, valid 10 minutes, at most 5 guesses, one active code per
// user and purpose, 60 s between sends. Only an HMAC of the code is stored.

const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const config = require("./config");
const logger = require("./logger");
const mailer = require("./mailer");
const session = require("./session");
const { hashPassword, passwordProblem } = require("./passwords");
const { POLICY_VERSIONS } = require("./policies");

const router = express.Router();

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

const asString = (v) => (typeof v === "string" ? v : "");
const normEmail = (v) => asString(v).trim().toLowerCase();

const codeHash = (id, code) => crypto.createHmac("sha256", config.jwtSecret).update(`${id}:${code}`).digest("hex");

// Creates a code for the user (replacing any active one). Returns { code } or { cooldown: true }.
async function issueCode(userId, purpose) {
  const last = await db.query(
    "SELECT created_at FROM auth_codes WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, purpose]
  );
  if (last.rows[0] && Date.now() - new Date(last.rows[0].created_at).getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    return { cooldown: true };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const id = crypto.randomUUID();
  await db.withTransaction(async (q) => {
    await q("UPDATE auth_codes SET consumed_at = NOW() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL", [userId, purpose]);
    await q(
      `INSERT INTO auth_codes (id, user_id, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + make_interval(mins => $5))`,
      [id, userId, purpose, codeHash(id, code), CODE_TTL_MINUTES]
    );
  });
  return { code };
}

// True only if `code` matches the user's active code. Every check burns one attempt
// (counted atomically in SQL, so parallel guesses cannot exceed the limit).
async function consumeCode(userId, purpose, code) {
  if (!/^\d{6}$/.test(code)) return false;
  const active = await db.query(
    `SELECT id FROM auth_codes
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose]
  );
  if (!active.rows[0]) return false;
  const id = active.rows[0].id;

  const attempt = await db.query(
    "UPDATE auth_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL RETURNING code_hash",
    [id, MAX_ATTEMPTS]
  );
  if (!attempt.rows[0]) return false; // out of attempts

  const expected = Buffer.from(attempt.rows[0].code_hash, "hex");
  const given = Buffer.from(codeHash(id, code), "hex");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;

  const used = await db.query("UPDATE auth_codes SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL RETURNING id", [id]);
  return used.rows.length === 1;
}

const keyed = (req) => `${normEmail(req.body?.email) || req.user?.id || ""}|${req.ip}`;
const makeLimiter = (limit) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyed,
    message: { error: "Too many attempts. Please try again later.", code: "rate_limited" },
  });
const requestLimiter = makeLimiter(8);
const confirmLimiter = makeLimiter(15);

const requireMail = (req, res, next) =>
  mailer.isEnabled() ? next() : res.status(503).json({ error: "Email is not set up on this server yet", code: "email_disabled" });

// What the app should offer. The app skips verification and hides password reset when off.
router.get("/config", (req, res) => {
  const enabled = mailer.isEnabled();
  res.status(200).json({
    emailVerification: enabled,
    emailVerificationRequired: config.requireEmailVerification,
    passwordReset: enabled,
    policies: POLICY_VERSIONS, // the versions a new member must accept (see policies.js)
  });
});

// ---- Email verification ----------------------------------------------------------

router.post("/verify-email/request", session.authenticateToken, requireMail, requestLimiter, async (req, res) => {
  try {
    const u = await db.query("SELECT email, email_verified_at FROM profiles WHERE id = $1", [req.user.id]);
    const user = u.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.email_verified_at) return res.status(200).json({ ok: true, already_verified: true });

    const issued = await issueCode(req.user.id, "verify_email");
    if (issued.cooldown) {
      return res.status(429).json({ error: `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another code`, code: "cooldown" });
    }
    await mailer.sendMail({
      to: user.email,
      subject: "Your Dateza verification code",
      text: `Your Dateza verification code is ${issued.code}. It expires in ${CODE_TTL_MINUTES} minutes. If you did not create an account, ignore this email.`,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("verify-email request failed", err);
    res.status(500).json({ error: "Could not send the code. Please try again." });
  }
});

router.post("/verify-email/confirm", session.authenticateToken, confirmLimiter, async (req, res) => {
  try {
    const ok = await consumeCode(req.user.id, "verify_email", asString(req.body?.code).trim());
    if (!ok) return res.status(400).json({ error: "That code is wrong or has expired", code: "invalid_code" });
    await db.query("UPDATE profiles SET email_verified_at = NOW() WHERE id = $1", [req.user.id]);
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("verify-email confirm failed", err);
    res.status(500).json({ error: "Could not verify the code. Please try again." });
  }
});

// ---- Password reset (not signed in) -----------------------------------------------

// Always answers the same way, so it cannot be used to discover which emails have accounts.
router.post("/password-reset/request", requireMail, requestLimiter, async (req, res) => {
  const email = normEmail(req.body?.email);
  try {
    if (email) {
      const u = await db.query("SELECT id, email FROM profiles WHERE email = $1 AND is_demo = false", [email]);
      const user = u.rows[0];
      if (user) {
        const issued = await issueCode(user.id, "password_reset");
        if (issued.code) {
          await mailer.sendMail({
            to: user.email,
            subject: "Reset your Dateza password",
            text: `Your Dateza password reset code is ${issued.code}. It expires in ${CODE_TTL_MINUTES} minutes. If you did not ask for this, ignore this email and your password stays the same.`,
          });
        }
      }
    }
  } catch (err) {
    logger.error("password-reset request failed", err); // still answer generically
  }
  res.status(200).json({ ok: true });
});

router.post("/password-reset/confirm", requireMail, confirmLimiter, async (req, res) => {
  const email = normEmail(req.body?.email);
  const code = asString(req.body?.code).trim();
  const problem = passwordProblem(req.body?.new_password);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const u = await db.query("SELECT id FROM profiles WHERE email = $1 AND is_demo = false", [email]);
    const user = u.rows[0];
    const ok = user ? await consumeCode(user.id, "password_reset", code) : false;
    if (!ok) return res.status(400).json({ error: "That code is wrong or has expired", code: "invalid_code" });

    // New password, and every existing session (all devices) is signed out
    await db.query("UPDATE profiles SET password = $1, token_version = token_version + 1 WHERE id = $2", [
      await hashPassword(req.body.new_password),
      user.id,
    ]);
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("password-reset confirm failed", err);
    res.status(500).json({ error: "Could not reset the password. Please try again." });
  }
});

// ---- Signed-in account changes ------------------------------------------------------

router.post("/change-password", session.authenticateToken, confirmLimiter, async (req, res) => {
  const current = asString(req.body?.current_password);
  const next = req.body?.new_password;
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  if (next === current) return res.status(400).json({ error: "Your new password must be different from the current one" });

  try {
    const u = await db.query("SELECT * FROM profiles WHERE id = $1", [req.user.id]);
    const user = u.rows[0];
    if (!user || !(await bcrypt.compare(current.slice(0, 1024), user.password))) {
      return res.status(400).json({ error: "Current password is incorrect", code: "invalid_credentials" });
    }
    const updated = await db.query(
      "UPDATE profiles SET password = $1, token_version = token_version + 1 WHERE id = $2 RETURNING *",
      [await hashPassword(next), req.user.id]
    );
    delete updated.rows[0].password;
    // Other devices are signed out; this one continues with a fresh session
    session.sendSession(req, res, updated.rows[0]);
  } catch (err) {
    logger.error("change-password failed", err);
    res.status(500).json({ error: "Could not change the password. Please try again." });
  }
});

router.post("/logout-all", session.authenticateToken, async (req, res) => {
  try {
    await db.query("UPDATE profiles SET token_version = token_version + 1 WHERE id = $1", [req.user.id]);
    session.clearSessionCookie(res);
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("logout-all failed", err);
    res.status(500).json({ error: "Could not sign out of all devices" });
  }
});

module.exports = { router, issueCode, consumeCode };
