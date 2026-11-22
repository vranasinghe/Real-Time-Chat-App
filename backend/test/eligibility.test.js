// Database-free tests for the eligibility rules (backend/eligibility.js), the password rule and the
// route-policy inventory: every route declares how it is protected, so a new route cannot be added
// without a decision.
process.env.JWT_SECRET = process.env.JWT_SECRET || "eligibility-test-secret-eligibility-test-123";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://nobody:nobody@127.0.0.1:1/none"; // never connected to
process.env.NODE_ENV = "test";
process.env.REGISTER_RATE_LIMIT = "3"; // read when backend/auth.js loads

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const e = require("../eligibility");
const { passwordProblem } = require("../passwords");

const NOW = new Date("2026-11-22T12:00:00Z");
const good = () => ({
  status: "active", birthdate: "1990-06-15", email_verified_at: "2026-01-01T00:00:00Z", profile_completed_at: "2026-01-02T00:00:00Z",
});
const verdict = (patch, options = {}) => e.evaluate({ ...good(), ...patch }, { now: NOW, requireEmail: true, ...options });

test("an active adult with verified e-mail and a completed profile is eligible", () => {
  assert.deepEqual(verdict({}), { eligible: true, reason: null, reasons: [] });
});

test("every missing requirement closes dating features, with a specific reason", () => {
  assert.equal(verdict({ birthdate: null }).reason, "birthdate_required");
  assert.equal(verdict({ birthdate: undefined }).reason, "birthdate_required");
  assert.equal(verdict({ birthdate: "2010-01-01" }).reason, "not_adult");
  assert.equal(verdict({ birthdate: "2008-11-23" }).reason, "not_adult", "turns 18 tomorrow");
  assert.equal(verdict({ birthdate: "2008-02-30" }).reason, "invalid_birthdate", "impossible date on file");
  assert.equal(verdict({ birthdate: "0001-01-01" }).reason, "invalid_birthdate");
  assert.equal(verdict({ birthdate: "not a date" }).reason, "invalid_birthdate");
  assert.equal(verdict({ email_verified_at: null }).reason, "email_unverified");
  assert.equal(verdict({ profile_completed_at: null }).reason, "profile_incomplete");
  assert.equal(verdict({ status: "pending_deletion" }).reason, "account_closing");
  for (const bad of [verdict({ birthdate: null }), verdict({ profile_completed_at: null })]) assert.equal(bad.eligible, false);
});

test("the age rule uses the whole date: 18 today is adult, 18 tomorrow is not", () => {
  assert.equal(verdict({ birthdate: "2008-11-22" }).eligible, true);
  assert.equal(verdict({ birthdate: "2008-11-23" }).eligible, false);
});

test("suspended, banned and deleted accounts are never eligible; a finished suspension counts as active", () => {
  assert.equal(verdict({ status: "suspended" }).reason, "account_suspended");
  assert.equal(verdict({ status: "suspended", suspended_until: "2026-12-01T00:00:00Z" }).reason, "account_suspended");
  assert.equal(verdict({ status: "suspended", suspended_until: "2026-11-01T00:00:00Z" }).eligible, true, "suspension ended");
  assert.equal(verdict({ status: "banned" }).reason, "account_banned");
  assert.equal(verdict({ status: "banned", suspended_until: "2020-01-01T00:00:00Z" }).reason, "account_banned", "a ban has no end date");
  assert.equal(verdict({ status: "deleted" }).reason, "account_closed");
  assert.equal(e.statusProblem({ status: "suspended" }, NOW), "account_suspended");
  assert.equal(e.statusProblem({ status: "banned" }, NOW), "account_banned");
  assert.equal(e.statusProblem({ status: "deleted" }, NOW), "account_closed");
  assert.equal(e.statusProblem({ status: "pending_deletion" }, NOW), null, "may sign in (to cancel) but is not eligible");
  assert.equal(e.statusProblem({ status: "active" }, NOW), null);
  assert.equal(e.statusProblem({}, NOW), null, "rows from before the status column count as active");
});

test("missing or empty accounts are never eligible", () => {
  for (const account of [undefined, null, {}, { status: "active" }]) assert.equal(e.evaluate(account, { now: NOW }).eligible, false);
});

test("e-mail verification can be switched off only through the option (development)", () => {
  assert.equal(verdict({ email_verified_at: null }, { requireEmail: false }).eligible, true);
  assert.equal(verdict({ email_verified_at: null }, { requireEmail: true }).eligible, false);
});

test("adult-only check (used while onboarding) needs an active account and an adult date, nothing else", () => {
  const adult = (patch) => e.evaluateAdult({ ...good(), ...patch }, { now: NOW });
  assert.equal(adult({ email_verified_at: null, profile_completed_at: null }).eligible, true);
  assert.equal(adult({ birthdate: null }).reason, "birthdate_required");
  assert.equal(adult({ birthdate: "2012-01-01" }).reason, "not_adult");
  assert.equal(adult({ status: "banned" }).reason, "account_banned");
});

test("DATE values given as Date objects are read as the calendar day they show", () => {
  assert.equal(e.dateOnly(new Date(1990, 5, 15)), "1990-06-15");
  assert.equal(e.dateOnly("1990-06-15"), "1990-06-15");
  assert.equal(e.dateOnly(null), null);
});

test("withEligibility removes secrets and adds the verdict", () => {
  const out = e.withEligibility({ id: "u", email: "a@b.co", password: "hash", token_version: 4, ...good() }, { now: NOW, requireEmail: true });
  assert.ok(!("password" in out) && !("token_version" in out));
  assert.equal(out.email_verified, true);
  assert.deepEqual(out.eligibility, { eligible: true, reasons: [] });
  assert.equal(e.withEligibility(null), null);
});

function run(middleware, account) {
  const out = { status: null, body: null, nextCalled: false };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  middleware({ account }, res, () => { out.nextCalled = true; });
  return out;
}

test("requireEligible answers 403 not_eligible with the reason, and lets eligible members through", () => {
  const closed = run(e.requireEligible, { ...good(), profile_completed_at: null });
  assert.equal(closed.status, 403);
  assert.equal(closed.body.code, "not_eligible");
  assert.equal(closed.body.reason, "profile_incomplete");
  assert.equal(closed.nextCalled, false);
  assert.equal(run(e.requireEligible, undefined).status, 403);
  assert.equal(run(e.requireEligible, good()).nextCalled, true);
  assert.equal(e.requireEligible.policy, "eligible");
});

test("requireAdult lets an incomplete adult through and stops everyone else", () => {
  assert.equal(run(e.requireAdult, { ...good(), profile_completed_at: null, email_verified_at: null }).nextCalled, true);
  assert.equal(run(e.requireAdult, { ...good(), birthdate: "2015-01-01" }).status, 403);
  assert.equal(run(e.requireAdult, { ...good(), birthdate: null }).body.reason, "birthdate_required");
  assert.equal(e.requireAdult.policy, "adult");
});

test("the SQL for visible members checks status, completion, adulthood and (when required) verified e-mail", () => {
  const sql = e.candidateSql("x");
  for (const part of ["x.status = 'active'", "x.profile_completed_at IS NOT NULL", "x.birthdate IS NOT NULL", "x.birthdate <=", "INTERVAL '18 years'", "x.email_verified_at IS NOT NULL"]) {
    assert.ok(sql.includes(part), part);
  }
  assert.ok(!sql.includes("p."), "uses the alias it was given");
});

// ---- password rule -------------------------------------------------------------------------------

test("password rule: 8-72 characters with upper and lower case, a number and a symbol", () => {
  for (const ok of ["Str0ng#Pass", "aA1!aaaa", "Zz9_".repeat(18)]) assert.equal(passwordProblem(ok), null, ok);
  for (const bad of ["Sh0rt!", "alllowercase1!", "ALLUPPERCASE1!", "NoNumber!!!", "NoSymbol123A", "12345678", "password", "", "aA1!".repeat(19), undefined, null, 12345678, { a: 1 }]) {
    assert.ok(passwordProblem(bad), String(bad));
  }
});

// ---- registration abuse limit ---------------------------------------------------------------------

test("registration is rate limited per network (the limit is configurable)", async () => {
  const express = require("express");
  const http = require("node:http");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", require("../auth").router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await post()).status);
    assert.deepEqual(statuses, [400, 400, 400, 429, 429], "the first three reach validation, then the limiter answers 429");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---- route policy inventory ----------------------------------------------------------------------

const RANK = { public: 0, session: 1, adult: 2, eligible: 3 };
function policyOf(handlers) {
  let best = "public";
  for (const h of handlers) if (h?.policy && RANK[h.policy] > RANK[best]) best = h.policy;
  return best;
}
function collect(router, prefix, into) {
  const inherited = [];
  for (const layer of router.stack) {
    if (layer.route) {
      const policy = policyOf([...inherited, ...layer.route.stack.map((l) => l.handle)]);
      const sub = layer.route.path === "/" ? "" : layer.route.path;
      for (const method of Object.keys(layer.route.methods)) into[`${method.toUpperCase()} ${prefix}${sub}`] = policy;
    } else if (layer.name !== "router") {
      inherited.push(layer.handle);
    }
  }
}

test("every route declares its protection (public / session / adult / eligible): the inventory matches the expected table exactly", () => {
  const media = require("../media");
  const mounts = [
    ["/api/images", require("../images").router],
    ["/api/media", media.router],
    ["/api/auth/demo", require("../demo").router],
    ["/api/auth", require("../accountSecurity").router],
    ["/api/auth", require("../oauth").router],
    ["/api/auth", require("../auth").router],
    ["/api/profiles", require("../profiles")],
    ["/api/swipes", require("../swipes")],
    ["/api/matches", require("../matches")],
    ["/api/stories", media.storiesRouter],
    ["/api/onboarding", require("../onboarding").router],
  ];
  const actual = {};
  for (const [prefix, router] of mounts) collect(router, prefix, actual);

  const expected = {
    "POST /api/images": "adult",
    "GET /api/images/:id": "public",
    "POST /api/media": "eligible",
    "GET /api/media/:id": "eligible",
    "GET /api/stories": "eligible",
    "POST /api/stories": "eligible",
    "DELETE /api/stories/:id": "eligible",
    "GET /api/auth/demo/status": "public",
    "POST /api/auth/demo": "public",
    "GET /api/auth/config": "public",
    "POST /api/auth/verify-email/request": "session",
    "POST /api/auth/verify-email/confirm": "session",
    "POST /api/auth/password-reset/request": "public",
    "POST /api/auth/password-reset/confirm": "public",
    "POST /api/auth/change-password": "session",
    "POST /api/auth/logout-all": "session",
    "GET /api/auth/google/url": "public",
    "GET /api/auth/oauth/google/start": "public",
    "GET /api/auth/google/mock-login": "public",
    "GET /api/auth/google/callback": "public",
    "POST /api/auth/oauth/exchange": "public",
    "POST /api/auth/register": "public",
    "POST /api/auth/signup": "public",
    "POST /api/auth/login": "public",
    "POST /api/auth/logout": "public",
    "POST /api/auth/socket-ticket": "eligible",
    "POST /api/auth/complete-setup": "session",
    "GET /api/auth/me": "session",
    "GET /api/profiles/discovery": "eligible",
    "GET /api/profiles/likes-you": "eligible",
    "POST /api/swipes": "eligible",
    "POST /api/swipes/reset": "eligible",
    "GET /api/matches": "eligible",
    "GET /api/matches/conversations": "eligible",
    "POST /api/matches": "eligible",
    "GET /api/matches/:matchId/messages": "eligible",
    "POST /api/matches/:matchId/messages": "eligible",
    "POST /api/matches/:matchId/read": "eligible",
    "POST /api/matches/quick": "eligible",
    "GET /api/onboarding": "session",
    "PATCH /api/onboarding/:step": "session",
    "POST /api/onboarding/complete": "session",
  };
  assert.deepEqual(actual, expected, "a route was added, removed or re-classified: decide its protection and update this table");

  // Every dating feature (anything that shows other members or lets members talk) must be 'eligible'.
  for (const [route, policy] of Object.entries(actual)) {
    if (/\/(profiles|swipes|matches|stories|media)\b|socket-ticket/.test(route)) assert.equal(policy, "eligible", route);
  }
});

test("every router mounted in index.js is in the inventory", () => {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const mounted = [...source.matchAll(/app\.use\("(\/api\/[^"]+)",\s*([\w.]+)\)/g)]
    .filter((m) => !/Limiter$/.test(m[2]))
    .map((m) => `${m[1]} ${m[2]}`)
    .sort();
  assert.deepEqual(mounted, [
    "/api/auth accountSecurity.router",
    "/api/auth auth.router",
    "/api/auth oauth.router",
    "/api/auth/demo demo.router",
    "/api/images images.router",
    "/api/matches matches",
    "/api/media media.router",
    "/api/onboarding onboarding.router",
    "/api/profiles profiles",
    "/api/stories media.storiesRouter",
    "/api/swipes swipes",
  ]);
});
