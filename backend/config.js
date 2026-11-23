// Central, validated configuration. Every other module reads settings from here,
// never from process.env directly, so a bad deployment fails at boot with a clear
// message instead of misbehaving at runtime.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const env = process.env;
const isProduction = env.NODE_ENV === "production" || !!env.RENDER;

const list = (value) =>
  (value || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

const errors = [];
const warnings = [];

const jwtSecret = env.JWT_SECRET || "";
if (!jwtSecret) errors.push("JWT_SECRET is required");
else if (isProduction && jwtSecret.length < 32) errors.push("JWT_SECRET must be at least 32 characters in production");

if (!env.DATABASE_URL) errors.push("DATABASE_URL is required");

// Origins allowed to call the API / open sockets from a browser. Native apps send no Origin.
const corsOrigins = list(env.CORS_ORIGIN || (isProduction
  ? "https://real-time-chat-app-tau-six.vercel.app,https://real-time-chat-app-odrw.vercel.app"
  : ""));
if (corsOrigins.length === 0 && isProduction) {
  warnings.push("CORS_ORIGIN is not set: browsers from any origin can call this API. Set it to your web app URL(s).");
}

// Shared demo logins (Alex / Elena) let anyone sign in without a password. They must never exist on the
// consumer production service, so in production the flag alone is NOT enough: the operator must also
// set DEMO_ENVIRONMENT=isolated, which asserts "this is a separate demo service with its own database".
// Otherwise the request is ignored (and logged as a warning at startup). Outside production the flag
// works as before. Pure function so it can be tested without loading the whole configuration.
function resolveDemoLogin(e, production) {
  const requested = e.DEMO_LOGIN_ENABLED === "true";
  if (!requested) return { enabled: false, requested, blocked: false };
  if (!production) return { enabled: true, requested, blocked: false };
  if (e.DEMO_ENVIRONMENT === "isolated") return { enabled: true, requested, blocked: false };
  return { enabled: false, requested, blocked: true };
}
const demoLogin = resolveDemoLogin(env, isProduction);
if (demoLogin.blocked) {
  warnings.push(
    "DEMO_LOGIN_ENABLED=true is IGNORED in production: shared demo logins are only allowed on a separate demo service with its own database (also set DEMO_ENVIRONMENT=isolated there)."
  );
}

// Production can run without an email provider. Verification is optional in that mode;
// never mark an unverified address as verified. An explicit true still requires delivery.
const mailConfigured = !!(env.RESEND_API_KEY && env.MAIL_FROM);
const requireEmailVerification = env.REQUIRE_EMAIL_VERIFICATION === "false" ? false
  : env.REQUIRE_EMAIL_VERIFICATION === "true" ? true
    : isProduction ? mailConfigured : true;
if (isProduction && requireEmailVerification && !mailConfigured) {
  errors.push("RESEND_API_KEY and MAIL_FROM are required when REQUIRE_EMAIL_VERIFICATION=true in production");
}

const config = {
  isProduction,
  requireEmailVerification,
  port: parseInt(env.PORT, 10) || 3000,
  databaseUrl: env.DATABASE_URL,
  jwtSecret,
  corsOrigins,
  // true = any origin (only when CORS_ORIGIN is unset). Cookie sessions are never allowed in that mode.
  corsOpen: corsOrigins.length === 0,
  trustProxy: env.TRUST_PROXY ? parseInt(env.TRUST_PROXY, 10) || 1 : env.RENDER ? 1 : 0,
  cookie: {
    name: "dateza_session",
    // First-party cookie set through the Vercel proxy, so Lax is enough and
    // is not subject to third-party-cookie blocking.
    sameSite: "lax",
    secure: isProduction,
  },
  webSessionDays: parseInt(env.WEB_SESSION_DAYS, 10) || 7,
  nativeSessionDays: parseInt(env.NATIVE_SESSION_DAYS, 10) || 30,
  socketTicketSeconds: 30,
  demoLoginEnabled: demoLogin.enabled,
  logLevel: env.LOG_LEVEL || "info",
};

config.validate = () => {
  for (const w of warnings) console.warn(JSON.stringify({ level: "warn", msg: w }));
  if (errors.length) {
    throw new Error("Invalid configuration:\n - " + errors.join("\n - "));
  }
};

config.resolveDemoLogin = resolveDemoLogin;

module.exports = config;
