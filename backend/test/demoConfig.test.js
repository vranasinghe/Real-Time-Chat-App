// Database-free tests that keep the shared demo login out of production (Release Gate A, P1-00b):
//  - the decision table in config.js,
//  - the real configuration module loaded in child processes with production-like environments,
//  - the deployment blueprint (render.yaml) and the env template,
//  - sessions already issued to demo accounts when the demo login is off.

process.env.JWT_SECRET = process.env.JWT_SECRET || "demo-config-test-secret-demo-config-test-123";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://nobody:nobody@127.0.0.1:1/none"; // never connected to

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const config = require("../config");
const session = require("../session");

const REPO = path.join(__dirname, "../..");
const BACKEND = path.join(__dirname, "..");

// ---- decision table ----------------------------------------------------------------------

test("resolveDemoLogin: explicit demo opt-in works in production and development", () => {
  for (const production of [true, false]) {
    assert.equal(config.resolveDemoLogin({}, production).enabled, false);
    assert.deepEqual(config.resolveDemoLogin({ DEMO_LOGIN_ENABLED: "true" }, production), { enabled: true, requested: true, blocked: false });
    for (const value of ["false", "1", "TRUE", " true"]) assert.equal(config.resolveDemoLogin({ DEMO_LOGIN_ENABLED: value }, production).enabled, false);
  }
});

// ---- the real module, production-like environments ----------------------------------------

// Loads config.js in a fresh process. Every variable that could change the answer is set explicitly
// (empty string = unset), so a developer's own backend/.env cannot influence the result.
function loadConfig(overrides) {
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: "", RENDER: "", DEMO_LOGIN_ENABLED: "", DEMO_ENVIRONMENT: "", CORS_ORIGIN: "https://app.example.test",
    JWT_SECRET: "x".repeat(40), DATABASE_URL: "postgresql://u:p@db.example.com/db",
    RESEND_API_KEY: "re_test_key", MAIL_FROM: "Dateza <no-reply@example.test>", REQUIRE_EMAIL_VERIFICATION: "", ...overrides,
  };
  const code = "const c=require('./config');c.validate();console.log(JSON.stringify({demo:c.demoLoginEnabled,prod:c.isProduction,email:c.requireEmailVerification}))";
  const r = spawnSync(process.execPath, ["-e", code], { cwd: BACKEND, env, encoding: "utf8" });
  if (r.status !== 0) return { failed: true, stderr: r.stderr };
  return { ...JSON.parse(r.stdout.trim().split("\n").pop()), stderr: r.stderr };
}

test("config module: public demo opt-in works on Render and can be revoked", () => {
  assert.equal(loadConfig({ NODE_ENV: "production", DEMO_LOGIN_ENABLED: "true" }).demo, true);
  assert.equal(loadConfig({ RENDER: "true", DEMO_LOGIN_ENABLED: "true" }).demo, true);
  assert.equal(loadConfig({ NODE_ENV: "production", DEMO_LOGIN_ENABLED: "false" }).demo, false);
  assert.equal(loadConfig({ NODE_ENV: "production" }).demo, false);
});

test("config module: production boots without mail, but explicit verification requires a provider", () => {
  const ok = loadConfig({ NODE_ENV: "production" });
  assert.equal(ok.email, true);

  const noMail = loadConfig({ NODE_ENV: "production", RESEND_API_KEY: "", MAIL_FROM: "" });
  assert.equal(noMail.failed, undefined, "missing optional mail does not block startup");
  assert.equal(noMail.email, false);
  assert.equal(loadConfig({ RENDER: "true", RESEND_API_KEY: "" }).email, false);
  const required = loadConfig({ NODE_ENV: "production", RESEND_API_KEY: "", MAIL_FROM: "", REQUIRE_EMAIL_VERIFICATION: "true" });
  assert.equal(required.failed, true);
  assert.match(required.stderr, /required when REQUIRE_EMAIL_VERIFICATION=true/);

  const switchOff = loadConfig({ NODE_ENV: "production", REQUIRE_EMAIL_VERIFICATION: "false" });
  assert.equal(switchOff.email, false, "production supports explicitly optional verification");
});

test("config module: outside production verification is on by default and can be switched off for development", () => {
  assert.equal(loadConfig({ NODE_ENV: "development", RESEND_API_KEY: "", MAIL_FROM: "" }).email, true);
  assert.equal(loadConfig({ NODE_ENV: "development", REQUIRE_EMAIL_VERIFICATION: "false", RESEND_API_KEY: "", MAIL_FROM: "" }).email, false);
  assert.equal(loadConfig({ NODE_ENV: "test", REQUIRE_EMAIL_VERIFICATION: "0" }).email, true, "only the exact string false switches it off");
});

test("config module: development behaviour is unchanged", () => {
  assert.equal(loadConfig({ NODE_ENV: "development", DEMO_LOGIN_ENABLED: "true" }).demo, true);
  assert.equal(loadConfig({ NODE_ENV: "development" }).demo, false);
  assert.equal(loadConfig({ DEMO_LOGIN_ENABLED: "true" }).demo, true, "no NODE_ENV at all is not production");
});

// ---- deployment files ---------------------------------------------------------------------

test("render.yaml enables the public demo without dangerous database overrides", () => {
  const yaml = fs.readFileSync(path.join(REPO, "render.yaml"), "utf8").replace(/^[ \t]*#.*$/gm, "");
  assert.match(yaml, /key:\s*DEMO_LOGIN_ENABLED\s*\r?\n\s*value:\s*"true"/);
  assert.doesNotMatch(yaml, /ALLOW_REMOTE_DEV_SEED|ALLOW_DESTRUCTIVE_MIGRATIONS/);
});

test("the env template defaults the demo login to off", () => {
  const example = fs.readFileSync(path.join(BACKEND, ".env.example"), "utf8");
  assert.match(example, /^DEMO_LOGIN_ENABLED=false\s*$/m);
  assert.doesNotMatch(example, /^DEMO_ENVIRONMENT=/m, "the isolation marker stays commented out in the template");
});

// ---- sessions already issued to demo accounts ----------------------------------------------

function run(token) {
  const req = { headers: { authorization: `Bearer ${token}` }, method: "GET", get: () => undefined };
  const out = { status: null, body: null, nextCalled: false };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; }, clearCookie() {}, cookie() {} };
  return session.authenticateToken(req, res, () => { out.nextCalled = true; }).then(() => out);
}

test("when the demo login is off, tokens already issued to demo accounts stop working; real users are unaffected", async () => {
  const original = config.demoLoginEnabled;
  try {
    const demoToken = session.signAccessToken({ id: "demo-alex", email: "alex.demo@dateza.local", token_version: 0 }, "native");
    const realToken = session.signAccessToken({ id: "usr_real", email: "real@example.com", token_version: 0 }, "native");
    session.setUserLookup(async (id) => (id.startsWith("demo-") ? { token_version: 0, is_demo: true } : { token_version: 0, is_demo: false }));

    config.demoLoginEnabled = false;
    const blocked = await run(demoToken);
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.code, "session_revoked");
    assert.equal(blocked.nextCalled, false);
    await assert.rejects(session.authenticateSocketCredential({ token: demoToken }), /session ended/, "sockets too");
    assert.equal((await run(realToken)).nextCalled, true, "real users are unaffected");

    config.demoLoginEnabled = true; // an isolated demo service
    assert.equal((await run(demoToken)).nextCalled, true);
    assert.equal(await session.authenticateSocketCredential({ token: demoToken }), "demo-alex");
  } finally {
    config.demoLoginEnabled = original;
  }
});
