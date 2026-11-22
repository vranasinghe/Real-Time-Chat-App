// Who may use dating features, decided in ONE place and enforced by the server on REST and Socket.IO.
//
// A member is ELIGIBLE only when ALL of these hold:
//   - the account is active (not banned, deleted, pending deletion, or inside a suspension),
//   - a valid date of birth is on file and the member is at least 18 today (UTC),
//   - the e-mail address is verified (unless verification is switched off outside production),
//   - the profile was completed through the server-validated onboarding (profile_completed_at is set).
//
// Nothing here trusts the client. Route classes (see backend/routePolicy.test.js for the inventory):
//   public     no session needed (register, login, password reset, OAuth start/exchange, health)
//   session    a valid session of an active account: authenticateToken (account recovery, onboarding,
//              verification, password change, logout)
//   adult      session + adult date of birth (photo upload while onboarding)
//   eligible   everything above plus verified e-mail and a completed profile (all dating features)
// Suspended / banned / deleted accounts cannot hold a session at all (see session.js): they can neither
// sign in nor keep using a token or a socket they already had.

const config = require("./config");
const age = require("./age");

// ---- pure rules ------------------------------------------------------------------------------

const REASON_MESSAGES = Object.freeze({
  account_suspended: "This account is suspended.",
  account_banned: "This account has been closed for breaking the community rules.",
  account_closed: "This account is closed.",
  account_closing: "This account is being deleted.",
  birthdate_required: "Add your date of birth to continue.",
  invalid_birthdate: "The date of birth on this account is not valid. Please enter it again.",
  not_adult: "You must be at least 18 years old to use Dateza.",
  email_unverified: "Verify your email address to continue.",
  profile_incomplete: "Finish setting up your profile to continue.",
});

/** DATE columns arrive as "YYYY-MM-DD" strings (see db.js) but tolerate Date objects. */
function dateOnly(value) {
  if (value == null) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
  if (value instanceof Date && !isNaN(value.getTime())) {
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(value.getFullYear(), 4)}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return null;
}

/** The status that counts right now: a suspension whose end date has passed counts as active. */
function effectiveStatus(account, now = new Date()) {
  const status = account?.status || "active";
  if (status === "suspended" && account.suspended_until && new Date(account.suspended_until) <= now) return "active";
  return status;
}

/** Reason code when the account may not hold a session, otherwise null. */
function statusProblem(account, now = new Date()) {
  switch (effectiveStatus(account, now)) {
    case "banned": return "account_banned";
    case "suspended": return "account_suspended";
    case "deleted": return "account_closed";
    default: return null; // active, pending_deletion (may sign in to cancel; not eligible)
  }
}

function ageReason(account, now) {
  const dob = dateOnly(account?.birthdate);
  if (!dob) return "birthdate_required";
  const v = age.validateBirthdate(dob, { now });
  if (v.ok) return null;
  return v.code === "underage" ? "not_adult" : "invalid_birthdate";
}

/**
 * Evaluates an account row (any object with the profile columns). Never throws.
 * @returns {{ eligible: boolean, reason: string|null, reasons: string[] }}
 */
function evaluate(account, { now = new Date(), requireEmail = config.requireEmailVerification } = {}) {
  const reasons = [];
  const status = effectiveStatus(account, now);
  const closed = statusProblem(account, now);
  if (closed) reasons.push(closed);
  else if (status === "pending_deletion") reasons.push("account_closing");
  const ageProblem = ageReason(account, now);
  if (ageProblem) reasons.push(ageProblem);
  if (requireEmail && !account?.email_verified_at) reasons.push("email_unverified");
  if (!account?.profile_completed_at) reasons.push("profile_incomplete");
  return { eligible: reasons.length === 0, reason: reasons[0] || null, reasons };
}

/** Active account and an adult date of birth (for steps that happen DURING onboarding, e.g. photo upload). */
function evaluateAdult(account, { now = new Date() } = {}) {
  const reasons = [];
  const closed = statusProblem(account, now);
  if (closed) reasons.push(closed);
  else if (effectiveStatus(account, now) === "pending_deletion") reasons.push("account_closing");
  const ageProblem = ageReason(account, now);
  if (ageProblem) reasons.push(ageProblem);
  return { eligible: reasons.length === 0, reason: reasons[0] || null, reasons };
}

/** A profile row as the member's own API response: no secrets, plus the computed eligibility. */
function withEligibility(row, options) {
  if (!row) return row;
  // eslint-disable-next-line no-unused-vars
  const { password, token_version, ...rest } = row;
  const verdict = evaluate(row, options);
  return { ...rest, email_verified: !!row.email_verified_at, eligibility: { eligible: verdict.eligible, reasons: verdict.reasons } };
}

// ---- Express middleware ----------------------------------------------------------------------

function deny(res, verdict) {
  return res.status(403).json({
    error: REASON_MESSAGES[verdict.reason] || "You can't do that yet.",
    code: "not_eligible",
    reason: verdict.reason,
    reasons: verdict.reasons,
  });
}

/** Full dating eligibility. Must run after authenticateToken (which loads req.account). */
function requireEligible(req, res, next) {
  const verdict = evaluate(req.account);
  if (!verdict.eligible) return deny(res, verdict);
  next();
}
requireEligible.policy = "eligible";

/** Active account with an adult date of birth. */
function requireAdult(req, res, next) {
  const verdict = evaluateAdult(req.account);
  if (!verdict.eligible) return deny(res, verdict);
  next();
}
requireAdult.policy = "adult";

// ---- SQL for "may other members see this profile" ---------------------------------------------

// Members shown to others must pass the same tests, evaluated in SQL on the candidate row.
// The latest birth date that counts as an adult on the given day (an SQL date expression). Exported so a test can
// prove it agrees with age.js for every shared vector.
const adultCutoffSql = (todayExpr) => `((${todayExpr})::date - INTERVAL '18 years')::date`;
const ADULT_CUTOFF_SQL = adultCutoffSql("NOW() AT TIME ZONE 'UTC'");

/** Boolean SQL expression: the profile aliased `alias` is an eligible, visible dating member. */
function candidateSql(alias = "p") {
  const email = config.requireEmailVerification ? `AND ${alias}.email_verified_at IS NOT NULL` : "";
  return `(
    (${alias}.status = 'active' OR (${alias}.status = 'suspended' AND ${alias}.suspended_until IS NOT NULL AND ${alias}.suspended_until <= NOW()))
    AND ${alias}.profile_completed_at IS NOT NULL
    AND ${alias}.birthdate IS NOT NULL AND ${alias}.birthdate <= ${ADULT_CUTOFF_SQL}
    ${email}
  )`;
}

module.exports = {
  REASON_MESSAGES,
  dateOnly,
  effectiveStatus,
  statusProblem,
  evaluate,
  evaluateAdult,
  withEligibility,
  requireEligible,
  requireAdult,
  candidateSql,
  adultCutoffSql,
};
