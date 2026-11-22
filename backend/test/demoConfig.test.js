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

test("resolveDemoLogin: production needs the flag AND DEMO_ENVIRONMENT=isolated; development needs only the flag", () => {
  const r = (env, production) => config.resolveDemoLogin(env, production);
  // off by default
  assert.equal(r({}, true).enabled, false);
  assert.equal(r({}, false).enabled, false);
  // production: the flag alone is ignored (and reported as blocked)
  assert.deepEqual(r({ DEMO_LOGIN_ENABLED: "true" }, true), { enabled: false, requested: true, blocked: true });
  // production: both together = an explicitly isolated demo service
  assert.equal(r({ DEMO_LOGIN_ENABLED: "true", DEMO_ENVIRONMENT: "isolated" }, true).enabled, true);
  // production: isolation marker without the flag does not turn anything on
  assert.equal(r({ DEMO_ENVIRONMENT: "isolated" }, true).enabled, false);
  // other marker values do not count
  for (const v of ["", "true", "demo", "ISOLATED", "1"]) {
    assert.equal(r({ DEMO_LOGIN_ENABLED: "true", DEMO_ENVIRONMENT: v }, true).enabled, false, `DEMO_ENVIRONMENT=${v}`);
  }
  // development and tests keep working
  assert.equal(r({ DEMO_LOGIN_ENABLED: "true" }, false).enabled, true);
  // the flag is strict: only the exact string "true"
  for (const v of ["1", "TRUE", "True", "yes", "on", " true", "false", ""]) {
    assert.equal(r({ DEMO_LOGIN_ENABLED: v, DEMO_ENVIRONMENT: "isolated" }, true).enabled, false, `DEMO_LOGIN_ENABLED=${JSON.stringify(v)}`);
    assert.equal(r({ DEMO_LOGIN_ENABLED: v }, false).enabled, false, `DEMO_LOGIN_ENABLED=${JSON.stringify(v)} (dev)`);
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

test("config module: production ignores DEMO_LOGIN_ENABLED=true unless the demo is explicitly isolated", () => {
  const blocked = loadConfig({ NODE_ENV: "production", DEMO_LOGIN_ENABLED: "true" });
  assert.deepEqual([blocked.prod, blocked.demo], [true, false]);
  assert.match(blocked.stderr, /DEMO_LOGIN_ENABLED=true is IGNORED in production/, "the operator is told at startup");

  const onRender = loadConfig({ RENDER: "true", DEMO_LOGIN_ENABLED: "true" });
  assert.deepEqual([onRender.prod, onRender.demo], [true, false], "RENDER alone counts as production");

  assert.equal(loadConfig({ NODE_ENV: "production" }).demo, false, "production default");
  assert.equal(loadConfig({ NODE_ENV: "production", DEMO_LOGIN_ENABLED: "false", DEMO_ENVIRONMENT: "isolated" }).demo, false);

  const isolated = loadConfig({ NODE_ENV: "production", DEMO_LOGIN_ENABLED: "true", DEMO_ENVIRONMENT: "isolated" });
  assert.equal(isolated.demo, true, "a separate, explicitly isolated demo service may enable it");
  assert.doesNotMatch(isolated.stderr, /IGNORED/);
});

test("config module: e-mail verification is mandatory in production and the service refuses to start without a mail provider", () => {
  const ok = loadConfig({ NODE_ENV: "production" });
  assert.equal(ok.email, true);

  const noMail = loadConfig({ NODE_ENV: "production", RESEND_API_KEY: "", MAIL_FROM: "" });
  assert.equal(noMail.failed, true, "startup fails closed");
  assert.match(noMail.stderr, /RESEND_API_KEY and MAIL_FROM are required in production/);
  assert.equal(loadConfig({ RENDER: "true", RESEND_API_KEY: "" }).failed, true, "RENDER counts as production");

  const switchOff = loadConfig({ NODE_ENV: "production", REQUIRE_EMAIL_VERIFICATION: "false" });
  assert.equal(switchOff.email, true, "the development switch is ignored in production");
  assert.match(switchOff.stderr, /REQUIRE_EMAIL_VERIFICATION=false is IGNORED in production/);
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

test("render.yaml never turns the shared demo login on for the production service", () => {
  // Comments are explanations, not configuration.
  const yaml = fs.readFileSync(path.join(REPO, "render.yaml"), "utf8").replace(/^[ 	]*#.*$/gm, "");
  assert.match(yaml, /key:\s*NODE_ENV\s*\r?\n\s*value:\s*production/, "the blueprint really is the production service (guards this test)");
  const values = [...yaml.matchAll(/key:\s*DEMO_LOGIN_ENABLED\s*\r?\n\s*value:\s*"?([^"\r\n]+)"?/g)].map((m) => m[1].trim());
  for (const v of values) assert.equal(v, "false", "DEMO_LOGIN_ENABLED in render.yaml must be false");
  assert.doesNotMatch(yaml, /key:\s*DEMO_LOGIN_ENABLED\s*\r?\n\s*value:\s*"?true/i);
  assert.doesNotMatch(yaml, /DEMO_ENVIRONMENT/, "the production blueprint must not carry the isolation marker; that belongs to a separate demo service");
  assert.doesNotMatch(yaml, /ALLOW_REMOTE_DEV_SEED|ALLOW_DESTRUCTIVE_MIGRATIONS/, "dangerous overrides are not part of the blueprint");
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
