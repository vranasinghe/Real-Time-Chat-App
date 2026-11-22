// Google sign-in with a state / PKCE / one-time-code design. Mounted under /api/auth.
//
//  1. The app makes a random PKCE verifier and sends only its S256 CHALLENGE:
//       GET /api/auth/google/url?redirect_uri=<app url>&code_challenge=<S256 challenge>
//     The server validates the redirect target against an EXACT allowlist, stores a transaction holding a
//     random one-time `state` (only its hash), the app's challenge, and its own PKCE verifier for the
//     leg to Google, and returns the Google URL.
//  2. Google redirects the browser to GET /api/auth/google/callback?code&state. The state must match an
//     unexpired, unused transaction (it is consumed atomically). The server exchanges the code with
//     Google (with its PKCE verifier), requires a VERIFIED e-mail, finds or creates the member and then
//     redirects to the validated app URL with ONLY a short-lived one-time exchange code: no session
//     token, no user record, never in a URL.
//  3. The app calls POST /api/auth/oauth/exchange { code, code_verifier }. The server checks
//     S256(verifier) against the stored challenge, consumes the code (single use, 60 seconds) and returns
//     the session: a token in the body for native apps, an HttpOnly cookie for web.
//
// Account linking: an existing account with the same e-mail is signed in only if Google vouches for that
// e-mail. If the existing account's e-mail was never verified, whoever registered it first may be a
// squatter, so linking also verifies the e-mail, REPLACES the password with a random one and signs every
// old session out (a pre-registered "hijack" account cannot survive the real owner signing in with Google).

const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const config = require("./config");
const logger = require("./logger");
const session = require("./session");
const eligibility = require("./eligibility");
const { hashPassword } = require("./passwords");

const router = express.Router();

const STATE_TTL_MINUTES = 10;
const EXCHANGE_TTL_SECONDS = 60;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // base64url(SHA-256) is exactly 43 characters
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/; // RFC 7636
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;

const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const s256 = (verifier) => crypto.createHash("sha256").update(verifier).digest("base64url");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Network access to Google goes through here so tests can replace it.
let httpClient = (url, init) => fetch(url, init);
function setHttpClient(fn) {
  httpClient = fn;
}

// The fake account chooser signs in as ANY e-mail without proof of ownership, so it is off unless a
// developer explicitly opts in on a non-production machine. It can never be enabled when a real Google
// client ID is configured, or on Render / NODE_ENV=production. Evaluated per call so tests can toggle it.
const mockEnabled = () =>
  process.env.ALLOW_MOCK_GOOGLE_LOGIN === "true" &&
  !process.env.GOOGLE_CLIENT_ID &&
  process.env.NODE_ENV !== "production" &&
  !process.env.RENDER;

// ---- redirect allowlist -----------------------------------------------------------------------

/**
 * Exact-match allowlist for where the finished sign-in may be sent. No wildcards, no query string, no
 * fragment, no credentials in the URL.
 *   native   dateza://auth-callback
 *            development only: exp://<host>/--/auth-callback  (Expo Go)
 *   web      <a configured web origin>/auth-callback
 *            development only: http://localhost:<port>/auth-callback and http://127.0.0.1:<port>/auth-callback
 * @returns {{ ok: true, platform: "native"|"web", url: string } | { ok: false }}
 */
function checkRedirect(uri, { production = config.isProduction, webOrigins = config.corsOrigins } = {}) {
  const no = { ok: false };
  if (typeof uri !== "string" || uri.length > 300) return no;
  let u;
  try {
    u = new URL(uri);
  } catch {
    return no;
  }
  if (u.username || u.password || u.search || u.hash) return no;

  if (u.protocol === "dateza:") {
    return u.host === "auth-callback" && (u.pathname === "" || u.pathname === "/") ? { ok: true, platform: "native", url: "dateza://auth-callback" } : no;
  }
  if (u.protocol === "exp:") {
    if (production) return no;
    return u.pathname === "/--/auth-callback" && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(u.host) ? { ok: true, platform: "native", url: u.href } : no;
  }
  if (u.protocol === "https:" || u.protocol === "http:") {
    if (u.pathname !== "/auth-callback") return no;
    if (webOrigins.includes(u.origin)) return { ok: true, platform: "web", url: u.href };
    if (!production && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return { ok: true, platform: "web", url: u.href };
    }
  }
  return no;
}

// ---- housekeeping -----------------------------------------------------------------------------

async function purgeExpired() {
  try {
    await db.query("DELETE FROM oauth_transactions WHERE expires_at < NOW() - INTERVAL '1 hour'");
    await db.query("DELETE FROM oauth_exchange_codes WHERE expires_at < NOW() - INTERVAL '1 hour'");
  } catch (err) {
    logger.warn("could not purge expired oauth rows", { message: err.message });
  }
}

const baseUrl = (req) => (process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, "") : `${req.protocol}://${req.get("host")}`);

// ---- step 1: start ------------------------------------------------------------------------------

function startHandler(req, res) {
  return (async () => {
    const redirect = checkRedirect(req.query.redirect_uri);
    if (!redirect.ok) return res.status(400).json({ error: "redirect_uri is not allowed", code: "redirect_not_allowed" });
    const challenge = req.query.code_challenge;
    if (typeof challenge !== "string" || !CHALLENGE_RE.test(challenge)) {
      return res.status(400).json({ error: "code_challenge (S256) is required", code: "pkce_required" });
    }
    if (req.query.code_challenge_method !== undefined && req.query.code_challenge_method !== "S256") {
      return res.status(400).json({ error: "Only the S256 code challenge method is supported", code: "pkce_required" });
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId && !mockEnabled()) return res.status(503).json({ error: "Google sign-in is not configured" });

    try {
      await purgeExpired();
      const state = randomToken(32);
      const providerVerifier = randomToken(48);
      await db.query(
        `INSERT INTO oauth_transactions (id, state_hash, provider, platform, redirect_uri, client_challenge, provider_verifier, expires_at)
         VALUES ($1, $2, 'google', $3, $4, $5, $6, NOW() + make_interval(mins => $7))`,
        [crypto.randomUUID(), sha256Hex(state), redirect.platform, redirect.url, challenge, providerVerifier, STATE_TTL_MINUTES]
      );

      if (!clientId) {
        // Local development only: our own account chooser instead of Google.
        return res.json({ url: `${baseUrl(req)}/api/auth/google/mock-login?state=${state}` });
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${baseUrl(req)}/api/auth/google/callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: s256(providerVerifier),
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return res.json({ url: url.toString() });
    } catch (err) {
      logger.error("google start failed", err);
      return res.status(500).json({ error: "Could not start Google sign-in" });
    }
  })();
}
router.get("/google/url", startHandler);
router.get("/oauth/google/start", startHandler);

// ---- development account chooser ---------------------------------------------------------------

router.get("/google/mock-login", (req, res) => {
  if (!mockEnabled()) return res.status(404).json({ error: "Not found" });
  const state = String(req.query.state || "");
  if (!STATE_RE.test(state)) return res.status(400).send("Invalid state");
  res.set("Content-Type", "text/html; charset=utf-8").send(`<!DOCTYPE html>
<html><head><title>Sign in with Google (development mock)</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;background:#0E0720;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:16px}
.card{background:#150E28;border-radius:24px;padding:32px;width:100%;max-width:400px}input,button{width:100%;box-sizing:border-box;padding:12px;margin-top:10px;border-radius:12px;border:1px solid #333;font-size:14px}
button{background:#7C5CFF;color:#fff;border:none;font-weight:bold}</style></head>
<body><div class="card"><h2>Choose an account</h2><p>Development mock. It signs in as whichever e-mail you type.</p>
<form action="/api/auth/google/callback" method="GET">
<input type="hidden" name="state" value="${state}"><input type="hidden" name="mock" value="true">
<input type="text" name="name" placeholder="Full name" required><input type="email" name="email" placeholder="E-mail" required>
<button type="submit">Continue</button></form></div></body></html>`);
});

// ---- step 2: callback ---------------------------------------------------------------------------

const backToApp = (res, redirectUri, params) => {
  const target = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  // A bare 302 with an empty body (res.redirect would print the URL into the page).
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Location: target.toString() });
  return res.status(302).end();
};

async function googleIdentity(req, tx) {
  if (mockEnabled()) {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (req.query.mock !== "true" || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("mock identity missing");
    return { email, name: String(req.query.name || "Developer Account").slice(0, 100) };
  }
  const code = req.query.code;
  if (typeof code !== "string" || !code || code.length > 2048) throw new Error("missing code");
  const tokenRes = await httpClient("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: `${baseUrl(req)}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: tx.provider_verifier,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) throw new Error("google token exchange failed");
  const infoRes = await httpClient("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const info = await infoRes.json();
  if (!infoRes.ok) throw new Error("google userinfo failed");
  if (!info.email || info.email_verified !== true) throw new Error("google e-mail is missing or not verified");
  return { email: String(info.email).trim().toLowerCase(), name: String(info.name || info.given_name || "Google user").trim().slice(0, 100) || "Google user" };
}

// Finds or creates the member for a Google-verified e-mail. Returns { user } or { blocked }.
async function memberForGoogle(identity) {
  return db.withTransaction(async (q) => {
    const found = await q("SELECT * FROM profiles WHERE email = $1 FOR UPDATE", [identity.email]);
    if (found.rows[0]) {
      let user = found.rows[0];
      const blocked = eligibility.statusProblem(user);
      if (blocked) return { blocked };
      if (!user.email_verified_at) {
        // Google proves the real owner of this address. Whoever pre-registered it without proof is cut off.
        const randomPassword = await hashPassword(crypto.randomBytes(24).toString("hex"));
        user = (
          await q(
            `UPDATE profiles SET email_verified_at = NOW(), password = $2, token_version = token_version + 1
             WHERE id = $1 RETURNING *`,
            [user.id, randomPassword]
          )
        ).rows[0];
      }
      return { user };
    }
    const id = "usr_" + crypto.randomUUID();
    const randomPassword = await hashPassword(crypto.randomBytes(24).toString("hex")); // unusable; sign-in is via Google
    const created = await q(
      `INSERT INTO profiles (id, email, password, name, is_online, email_verified_at)
       VALUES ($1, $2, $3, $4, false, NOW()) RETURNING *`,
      [id, identity.email, randomPassword, identity.name]
    );
    return { user: created.rows[0] };
  });
}

router.get("/google/callback", async (req, res) => {
  const state = req.query.state;
  if (typeof state !== "string" || !STATE_RE.test(state)) {
    return res.status(400).send("This sign-in link is not valid. Please start again from the app.");
  }
  let tx;
  try {
    // Consume the transaction atomically: a state works once, within its lifetime.
    const consumed = await db.query(
      `UPDATE oauth_transactions SET consumed_at = NOW()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING *`,
      [sha256Hex(state)]
    );
    tx = consumed.rows[0];
  } catch (err) {
    logger.error("oauth state lookup failed", err);
    return res.status(500).send("Authentication failed");
  }
  if (!tx) return res.status(400).send("This sign-in link has expired or was already used. Please start again from the app.");
  // Re-check the stored target (defence in depth; it was validated when the transaction was created).
  if (!checkRedirect(tx.redirect_uri).ok) return res.status(400).send("Invalid redirect");

  if (req.query.error) return backToApp(res, tx.redirect_uri, { error: "access_denied" });

  try {
    const identity = await googleIdentity(req, tx);
    const outcome = await memberForGoogle(identity);
    if (outcome.blocked) return backToApp(res, tx.redirect_uri, { error: outcome.blocked });

    const code = randomToken(32);
    await db.query(
      `INSERT INTO oauth_exchange_codes (id, code_hash, user_id, platform, client_challenge, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6))`,
      [crypto.randomUUID(), sha256Hex(code), outcome.user.id, tx.platform, tx.client_challenge, EXCHANGE_TTL_SECONDS]
    );
    // ONLY the one-time code goes back: never a session token or the member record.
    return backToApp(res, tx.redirect_uri, { code });
  } catch (err) {
    logger.error("google callback failed", err);
    return backToApp(res, tx.redirect_uri, { error: "sign_in_failed" });
  }
});

// ---- step 3: exchange ---------------------------------------------------------------------------

const exchangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later.", code: "rate_limited" },
});

router.post("/oauth/exchange", exchangeLimiter, async (req, res) => {
  const code = req.body?.code;
  const verifier = req.body?.code_verifier;
  const invalid = () => res.status(400).json({ error: "This sign-in has expired. Please try again.", code: "invalid_code" });
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code) || typeof verifier !== "string" || !VERIFIER_RE.test(verifier)) {
    return invalid();
  }
  try {
    const hash = sha256Hex(code);
    const row = (
      await db.query(
        "SELECT * FROM oauth_exchange_codes WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()",
        [hash]
      )
    ).rows[0];
    if (!row || !safeEqual(s256(verifier), row.client_challenge)) return invalid();
    if ((row.platform === "web") !== session.isWebClient(req)) {
      return res.status(400).json({ error: "This sign-in was started on a different kind of device.", code: "platform_mismatch" });
    }
    // Single use, even under concurrent requests.
    const used = await db.query(
      "UPDATE oauth_exchange_codes SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL RETURNING user_id",
      [row.id]
    );
    if (!used.rows[0]) return invalid();

    const user = (await db.query("SELECT * FROM profiles WHERE id = $1", [row.user_id])).rows[0];
    if (!user) return invalid();
    const blocked = eligibility.statusProblem(user);
    if (blocked) return res.status(403).json({ error: eligibility.REASON_MESSAGES[blocked], code: blocked });
    return session.sendSession(req, res, user);
  } catch (err) {
    logger.error("oauth exchange failed", err);
    return res.status(500).json({ error: "Could not complete sign-in" });
  }
});

router.checkRedirect = checkRedirect;
router.setHttpClient = setHttpClient;
router.s256 = s256;
module.exports = { router, checkRedirect, setHttpClient, s256 };
