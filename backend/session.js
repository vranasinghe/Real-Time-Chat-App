// Session handling shared by REST and Socket.IO.
//
// Two ways to authenticate, same JWT:
//   - Web:    HttpOnly cookie (JavaScript can never read the token). State-changing
//             requests must also pass a CSRF check (custom header + Origin allowlist).
//   - Native: `Authorization: Bearer <token>`, stored in the OS secure store.
// A client that sends `X-Client-Platform: web` gets the cookie and no token in the
// response body; everyone else gets the token in the body.
//
// Sockets never receive the long-lived session token on web: the page asks
// POST /api/auth/socket-ticket (cookie-authenticated) for a single-use ticket that
// is valid for ~30 seconds and uses that to open the socket.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("./config");
const logger = require("./logger");
const eligibility = require("./eligibility");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const JWT_OPTIONS = { algorithms: ["HS256"] };

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

const isWebClient = (req) => (req.get("x-client-platform") || "").toLowerCase() === "web";

// Returns { token, via } from the Authorization header (preferred) or the session cookie
function extractCredential(req) {
  const header = req.headers["authorization"];
  if (header && /^Bearer\s+/i.test(header)) {
    return { token: header.replace(/^Bearer\s+/i, "").trim(), via: "bearer" };
  }
  const cookieToken = parseCookies(req.headers.cookie)[config.cookie.name];
  if (cookieToken) return { token: cookieToken, via: "cookie" };
  return { token: null, via: null };
}

// CSRF defence for cookie-authenticated, state-changing requests:
//  1. A custom header only same-origin scripts (or CORS-approved origins) can send.
//  2. If the browser sent an Origin, it must be on the allowlist.
function passesCsrf(req) {
  if (SAFE_METHODS.has(req.method)) return true;
  if (req.get("x-requested-with") !== "dateza") return false;
  const origin = req.get("origin");
  if (origin && !config.corsOpen && !config.corsOrigins.includes(origin.replace(/\/$/, ""))) return false;
  return true;
}

// Looks up the user's current token_version (null = user no longer exists). A token only
// works while its `tv` equals this value, so bumping it signs the user out everywhere.
// Replaceable so unit tests can run without a database.
// One query per request loads everything the eligibility rules need (see eligibility.js); the row is kept
// on req.account so route middleware never has to ask again.
let userLookup = async (id) => {
  const db = require("./db");
  const r = await db.query(
    `SELECT token_version, is_demo, status, suspended_until, birthdate::text AS birthdate,
            email_verified_at, profile_completed_at
     FROM profiles WHERE id = $1`,
    [id]
  );
  return r.rows[0] || null;
};
function setUserLookup(fn) {
  userLookup = fn;
}

const PROBLEM_MESSAGES = {
  session_revoked: "Your session has ended. Please sign in again.",
  account_suspended: "This account is suspended.",
  account_banned: "This account has been closed for breaking the community rules.",
  account_closed: "This account is closed.",
};

// Decides whether a token still stands for a usable account. problem is null when it does.
//   session_revoked   the account is gone, the token was superseded (password change / sign out
//                     everywhere), or it belongs to a demo account while the demo login is off
//   account_*         the account is suspended, banned or deleted: it can neither keep nor start a session
async function loadSession(decoded) {
  const account = await userLookup(decoded.id);
  if (!account) return { account: null, problem: "session_revoked" };
  // Demo accounts are shared and passwordless. When the demo login is switched off (always, in
  // production, unless it is an isolated demo service), sessions already issued to them stop working too.
  if (account.is_demo && !config.demoLoginEnabled) return { account, problem: "session_revoked" };
  // The account's standing is reported before the token's age, so a suspended or banned member always
  // learns that, whichever of their old tokens they present.
  const status = eligibility.statusProblem(account);
  if (status) return { account, problem: status };
  if ((account.token_version ?? 0) !== (decoded.tv ?? 0)) return { account, problem: "session_revoked" };
  return { account, problem: null };
}

function signAccessToken(user, platform) {
  const days = platform === "web" ? config.webSessionDays : config.nativeSessionDays;
  return jwt.sign({ id: user.id, email: user.email, typ: "access", tv: user.token_version ?? 0 }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: `${days}d`,
  });
}

function setSessionCookie(res, token) {
  res.cookie(config.cookie.name, token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    maxAge: config.webSessionDays * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.cookie.name, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: "/",
  });
}

// Creates a session for `user` and answers with { user } (+ { token } for native clients).
function sendSession(req, res, user, status = 200) {
  const publicUser = eligibility.withEligibility(user); // never exposes internals; adds the computed eligibility
  const platform = isWebClient(req) ? "web" : "native";
  const token = signAccessToken(user, platform);
  if (platform === "web") {
    setSessionCookie(res, token);
    return res.status(status).json({ user: publicUser });
  }
  return res.status(status).json({ token, user: publicUser });
}

function verifyAccessToken(token) {
  const decoded = jwt.verify(token, config.jwtSecret, JWT_OPTIONS);
  // Tokens issued before `typ` existed are access tokens. Socket tickets are not.
  if (decoded.typ && decoded.typ !== "access") throw new jwt.JsonWebTokenError("wrong token type");
  return decoded;
}

// Express middleware: 401 for missing/invalid/expired credentials, 403 for CSRF failures.
const authenticateToken = async (req, res, next) => {
  const { token, via } = extractCredential(req);
  if (!token) {
    return res.status(401).json({ error: "Not signed in", code: "no_token" });
  }
  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    if (via === "cookie") clearSessionCookie(res);
    return res.status(401).json({
      error: expired ? "Your session has expired. Please sign in again." : "Invalid session. Please sign in again.",
      code: expired ? "token_expired" : "invalid_token",
    });
  }
  if (via === "cookie" && !passesCsrf(req)) {
    return res.status(403).json({ error: "Request blocked (CSRF check failed)", code: "csrf" });
  }
  let loaded;
  try {
    loaded = await loadSession(decoded);
  } catch (err) {
    logger.error("session check failed", err);
    return res.status(503).json({ error: "Service temporarily unavailable. Please try again.", code: "unavailable" });
  }
  if (loaded.problem) {
    if (via === "cookie") clearSessionCookie(res);
    return res.status(401).json({ error: PROBLEM_MESSAGES[loaded.problem], code: loaded.problem });
  }
  req.user = decoded;
  req.account = loaded.account;
  req.authVia = via;
  next();
};
authenticateToken.policy = "session";

// ---- Socket tickets ------------------------------------------------------------

const usedTickets = new Map(); // jti -> expiry (ms). Single instance; see README for scaling note.
setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of usedTickets) if (exp < now) usedTickets.delete(jti);
}, 60 * 1000).unref();

function createSocketTicket(userId, tokenVersion = 0) {
  const jti = crypto.randomUUID();
  return jwt.sign({ id: userId, tv: tokenVersion, typ: "socket", jti }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.socketTicketSeconds,
  });
}

// Accepts a one-time socket ticket (web) or a normal access token (native). Returns { userId, account }.
// A suspended / banned / deleted account is refused here, like on REST.
async function authenticateSocket({ ticket, token }) {
  let decoded;
  if (ticket) {
    decoded = jwt.verify(ticket, config.jwtSecret, JWT_OPTIONS);
    if (decoded.typ !== "socket" || !decoded.jti) throw new jwt.JsonWebTokenError("wrong token type");
    if (usedTickets.has(decoded.jti)) throw new jwt.JsonWebTokenError("ticket already used");
    usedTickets.set(decoded.jti, decoded.exp * 1000);
  } else if (token) {
    decoded = verifyAccessToken(token);
  } else {
    throw new jwt.JsonWebTokenError("missing credentials");
  }
  const { account, problem } = await loadSession({ id: decoded.id, tv: decoded.tv });
  if (problem) throw new jwt.JsonWebTokenError(problem === "session_revoked" ? "session ended" : problem);
  return { userId: decoded.id, account };
}

async function authenticateSocketCredential(credential) {
  return (await authenticateSocket(credential)).userId;
}

module.exports = {
  parseCookies,
  isWebClient,
  extractCredential,
  passesCsrf,
  signAccessToken,
  setSessionCookie,
  clearSessionCookie,
  sendSession,
  verifyAccessToken,
  authenticateToken,
  createSocketTicket,
  authenticateSocket,
  authenticateSocketCredential,
  loadSession,
  setUserLookup,
};
