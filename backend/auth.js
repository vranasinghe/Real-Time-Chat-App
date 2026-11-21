const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const config = require("./config");
const logger = require("./logger");
const { normalizePhotoList } = require("./photoUtils");
const { hashPassword, needsRehash, MAX_LENGTH: MAX_PASSWORD_LENGTH } = require("./passwords");
const session = require("./session");

const { authenticateToken } = session;
const router = express.Router();
const JWT_SECRET = config.jwtSecret;

// Helper to generate UUID-like strings
function generateId() {
  return "usr_" + crypto.randomUUID();
}

const MIN_AGE_YEARS = 18;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isAtLeastMinAge(birthdate) {
  const dob = new Date(birthdate);
  if (isNaN(dob.getTime())) return false;

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - MIN_AGE_YEARS);
  return dob <= cutoff;
}

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

const asString = (v) => (typeof v === "string" ? v : "");

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

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long" });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters long` });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: "Name is too long" });
  }

  try {
    // Check if email already exists
    const existing = await db.query("SELECT id FROM profiles WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hashedPassword = await hashPassword(password);
    const userId = generateId();

    const result = await db.query(
      `INSERT INTO profiles (id, email, password, name, is_online)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, email, name, is_online, created_at`,
      [userId, cleanEmail, hashedPassword, name.trim()]
    );

    session.sendSession(req, res, result.rows[0], 201);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    logger.error("registration failed", err);
    res.status(500).json({ error: "Internal server error during registration" });
  }
};

router.post("/register", handleRegister);
router.post("/signup", handleRegister);

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
  session.clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

// Route: One-time ticket for opening a Socket.IO connection (used by web, where the
// session token lives in an HttpOnly cookie that sockets on another origin can't use).
router.post("/socket-ticket", authenticateToken, (req, res) => {
  res.status(200).json({ ticket: session.createSocketTicket(req.user.id, req.user.tv ?? 0), expires_in: config.socketTicketSeconds });
});

// Validates the profile fields a client may send. Fields that are absent are left alone.
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
  for (const [key, max] of [["gender", 50], ["looking_for", 50], ["bio", 1000]]) {
    const err = text(key, max);
    if (err) return { error: err };
  }
  if (body.birthdate !== undefined) {
    if (typeof body.birthdate !== "string" || isNaN(new Date(body.birthdate).getTime())) {
      return { error: "birthdate must be a valid date" };
    }
    if (!isAtLeastMinAge(body.birthdate)) {
      return { error: `You must be at least ${MIN_AGE_YEARS} years old to use Dateza` };
    }
    out.birthdate = body.birthdate;
  }
  if (body.height_cm !== undefined) {
    const h = Number(body.height_cm);
    if (!Number.isInteger(h) || h < 0 || h > 300) return { error: "height_cm must be a whole number up to 300" };
    out.height_cm = h || null;
  }
  if (body.interests !== undefined) {
    if (!Array.isArray(body.interests) || body.interests.length > 30 || body.interests.some((i) => typeof i !== "string" || i.length > 40)) {
      return { error: "interests must be a list of up to 30 short texts" };
    }
    out.interests = body.interests.map((i) => i.trim()).filter(Boolean);
  }
  for (const key of ["lat", "lng"]) {
    if (body[key] === undefined || body[key] === null) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || Math.abs(n) > 180) return { error: `${key} is not valid` };
    out[key] = n;
  }
  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > 12) return { error: "photos must be a list of up to 12 images" };
    // Keep only photos other devices can load: our stored images or web URLs
    out.photos = normalizePhotoList(body.photos);
  }
  return { fields: out };
}

// Route: Complete / update profile. Only the fields you send are changed, so a client
// can update just the photos (or bio, ...) without wiping the rest of the profile.
router.post("/complete-setup", authenticateToken, async (req, res) => {
  const parsed = validateProfileInput(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const userId = req.user.id;
  const f = parsed.fields;

  try {
    const result = await db.query(
      `UPDATE profiles
       SET birthdate = COALESCE($1, birthdate), gender = COALESCE($2, gender),
           looking_for = COALESCE($3, looking_for), bio = COALESCE($4, bio),
           height_cm = COALESCE($5, height_cm), interests = COALESCE($6, interests),
           photos = COALESCE($7, photos), lat = COALESCE($8, lat), lng = COALESCE($9, lng),
           name = COALESCE($11, name)
       WHERE id = $10
       RETURNING *`,
      [f.birthdate ?? null, f.gender ?? null, f.looking_for ?? null, f.bio ?? null, f.height_cm ?? null,
       f.interests ?? null, f.photos ?? null, f.lat ?? null, f.lng ?? null, userId, f.name ?? null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const profile = result.rows[0];
    delete profile.password;
    delete profile.token_version;

    res.status(200).json({ user: profile });
  } catch (err) {
    logger.error("complete-setup failed", err);
    res.status(500).json({ error: "Internal server error during profile setup" });
  }
});

// Route: Get current user profile
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM profiles WHERE id = $1", [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const profile = result.rows[0];
    delete profile.password;
    delete profile.token_version;

    res.status(200).json(profile);
  } catch (err) {
    logger.error("fetch profile failed", err);
    res.status(500).json({ error: "Internal server error fetching profile" });
  }
});

// The mock Google account chooser signs in as ANY email without proof of ownership,
// so it is off unless a developer explicitly opts in on a non-production machine.
// It can never be enabled when a real Google client ID is configured, or on
// Render / NODE_ENV=production.
const MOCK_GOOGLE_LOGIN_ENABLED =
  process.env.ALLOW_MOCK_GOOGLE_LOGIN === "true" &&
  !process.env.GOOGLE_CLIENT_ID &&
  process.env.NODE_ENV !== "production" &&
  !process.env.RENDER;

const requireMockGoogle = (req, res, next) => {
  if (!MOCK_GOOGLE_LOGIN_ENABLED) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
};

// The Google flow hands a session token back by redirecting to a client-supplied URL,
// so that URL must be one of ours (open-redirect protection): the app's own scheme,
// Expo dev schemes, a configured web origin, or localhost outside production.
function isAllowedRedirect(uri) {
  let u;
  try {
    u = new URL(String(uri));
  } catch {
    return false;
  }
  if (u.protocol === "dateza:" || u.protocol === "exp:" || u.protocol === "exp+dateza:") return true;
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (config.corsOrigins.includes(u.origin)) return true;
  return !config.isProduction && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

// Google Authentication Route: Get Redirect URL
router.get("/google/url", (req, res) => {
  const { redirect_uri } = req.query;
  if (!redirect_uri) {
    return res.status(400).json({ error: "redirect_uri query parameter is required" });
  }
  if (!isAllowedRedirect(redirect_uri)) {
    return res.status(400).json({ error: "redirect_uri is not allowed" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId && !MOCK_GOOGLE_LOGIN_ENABLED) {
    return res.status(503).json({ error: "Google sign-in is not configured" });
  }
  // Local development only: redirect to the mock account chooser
  if (!clientId) {
    const mockUrl = `${req.protocol}://${req.get("host")}/api/auth/google/mock-login?state=${encodeURIComponent(redirect_uri)}`;
    return res.json({ url: mockUrl });
  }

  // Real Google OAuth redirect URL construction
  const callbackUrl = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const googleOAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=email%20profile&state=${encodeURIComponent(redirect_uri)}`;
  return res.json({ url: googleOAuthUrl });
});

// Google Authentication Route: Mock Chooser Page
router.get("/google/mock-login", requireMockGoogle, (req, res) => {
  const { state } = req.query;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Sign in with Google - Choose an account</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: 'SF Pro Text', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
            background-color: #0E0720;
            color: #ffffff;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            padding: 16px;
            box-sizing: border-box;
          }
          .card {
            background-color: #150E28;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            padding: 32px;
            width: 100%;
            max-width: 400px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
            text-align: center;
          }
          h2 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
            background: linear-gradient(90deg, #FF3B70, #C535FF);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .subtitle {
            color: #a0aec0;
            font-size: 14px;
            margin-bottom: 28px;
          }
          .google-logo {
            display: inline-block;
            margin-bottom: 16px;
            background: #ffffff;
            border-radius: 50%;
            padding: 10px;
            width: 32px;
            height: 32px;
          }
          .account-btn {
            display: flex;
            align-items: center;
            background-color: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            color: #ffffff;
            padding: 14px 16px;
            border-radius: 16px;
            width: 100%;
            text-align: left;
            margin-bottom: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            box-sizing: border-box;
          }
          .account-btn:hover {
            background-color: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.15);
          }
          .avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background-color: #6C5DD3;
            display: flex;
            justify-content: center;
            align-items: center;
            font-weight: bold;
            margin-right: 12px;
            color: white;
          }
          .details {
            flex-grow: 1;
          }
          .name {
            font-size: 14px;
            font-weight: 600;
            margin: 0;
          }
          .email {
            font-size: 12px;
            color: #a0aec0;
            margin: 0;
          }
          .form-group {
            margin-top: 24px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 20px;
            text-align: left;
          }
          label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #a0aec0;
            margin-bottom: 6px;
          }
          input {
            width: 100%;
            background-color: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: white;
            padding: 12px;
            border-radius: 12px;
            box-sizing: border-box;
            margin-bottom: 12px;
            font-size: 14px;
          }
          input:focus {
            outline: none;
            border-color: #C535FF;
          }
          .submit-btn {
            background: linear-gradient(90deg, #FF3B70, #C535FF);
            color: white;
            border: none;
            padding: 12px;
            width: 100%;
            border-radius: 12px;
            font-weight: bold;
            cursor: pointer;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <svg class="google-logo" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          <h2>Choose an account</h2>
          <div class="subtitle">to continue to Dateza (Mock Developer Mode)</div>
          
          <button class="account-btn" onclick="selectMock('Jane Doe', 'jane@example.com')">
            <div class="avatar" style="background-color: #FF3B70">J</div>
            <div class="details">
              <p class="name">Jane Doe</p>
              <p class="email">jane@example.com</p>
            </div>
          </button>

          <button class="account-btn" onclick="selectMock('Alex Mercer', 'alex@gmail.com')">
            <div class="avatar" style="background-color: #6C5DD3">A</div>
            <div class="details">
              <p class="name">Alex Mercer</p>
              <p class="email">alex@gmail.com</p>
            </div>
          </button>
          
          <div class="form-group">
            <form action="/api/auth/google/callback" method="GET">
              <input type="hidden" name="state" value="${state || ""}">
              <input type="hidden" name="mock" value="true">
              <label for="name">Or sign in with a new account</label>
              <input type="text" id="name" name="name" placeholder="Full Name" required>
              <input type="email" name="email" placeholder="Email Address" required>
              <button type="submit" class="submit-btn">Continue</button>
            </form>
          </div>
        </div>

        <script>
          function selectMock(name, email) {
            const state = "${state || ""}";
            window.location.href = "/api/auth/google/callback?mock=true&name=" + encodeURIComponent(name) + "&email=" + encodeURIComponent(email) + "&state=" + encodeURIComponent(state);
          }
        </script>
      </body>
    </html>
  `;
  res.send(html);
});

// Google Authentication Route: OAuth / Mock Callback Handling
router.get("/google/callback", async (req, res) => {
  const { code, state, mock, email, name } = req.query;
  const clientRedirectUri = state || "dateza://auth-callback";
  if (!isAllowedRedirect(clientRedirectUri)) {
    return res.status(400).send("Invalid redirect");
  }

  let userEmail = "";
  let userName = "";

  if (!process.env.GOOGLE_CLIENT_ID && !MOCK_GOOGLE_LOGIN_ENABLED) {
    return res.status(503).send("Google sign-in is not configured");
  }

  try {
    if (MOCK_GOOGLE_LOGIN_ENABLED && !process.env.GOOGLE_CLIENT_ID) {
      // Mock developer flow (local development only, see MOCK_GOOGLE_LOGIN_ENABLED)
      userEmail = email || "developer@example.com";
      userName = name || "Developer Account";
    } else {
      // Real Google OAuth code exchange
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const callbackUrl = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(tokenData.error_description || "Failed to exchange Google OAuth code");
      }

      const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const infoData = await infoRes.json();
      if (!infoRes.ok) {
        throw new Error("Failed to retrieve Google userinfo");
      }

      if (!infoData.email || infoData.email_verified === false) {
        throw new Error("Google account email is missing or not verified");
      }
      userEmail = infoData.email;
      userName = infoData.name || infoData.given_name || "Google User";
    }

    const cleanEmail = userEmail.trim().toLowerCase();
    
    // Find or create the user profile
    let userId;
    let userRecord;
    
    const existing = await db.query("SELECT * FROM profiles WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      userRecord = existing.rows[0];
      userId = userRecord.id;
      // Mark as online
      await db.query("UPDATE profiles SET is_online = true WHERE id = $1", [userId]);
      userRecord.is_online = true;
    } else {
      // Create new user profile with a generated password hash (to satisfy NOT NULL constraint)
      userId = generateId();
      const mockPasswordRaw = crypto.randomBytes(16).toString("hex");
      const hashedPassword = await hashPassword(mockPasswordRaw);
      
      const insertResult = await db.query(
        `INSERT INTO profiles (id, email, password, name, is_online)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
        [userId, cleanEmail, hashedPassword, userName.trim()]
      );
      userRecord = insertResult.rows[0];
    }
    
    delete userRecord.password;
    
    // Generate JWT token
    const appToken = session.signAccessToken(userRecord, "native");
    
    // Redirect back to app with token and user details
    const redirectUrl = new URL(clientRedirectUri);
    redirectUrl.searchParams.set("token", appToken);
    redirectUrl.searchParams.set("user", JSON.stringify(userRecord));
    
    res.redirect(redirectUrl.toString());
  } catch (err) {
    logger.error("google callback failed", err);
    res.status(500).send("Authentication failed");
  }
});

router.validateProfileInput = validateProfileInput;

module.exports = {
  router,
  authenticateToken,
  JWT_SECRET
};
