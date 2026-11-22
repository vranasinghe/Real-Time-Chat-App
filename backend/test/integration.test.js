// Integration tests against a REAL PostgreSQL database, with the real Express app and
// real Socket.IO sockets running in this process.
//
//   node scripts/test-db.js start          (throwaway local cluster; prints the URL)
//   TEST_DATABASE_URL=<that url> npm run test:integration
//
// Safety: the database URL must point at this machine (localhost / 127.0.0.1) unless you
// set ALLOW_REMOTE_TEST_DB=1. Tests create accounts and never clean up, so NEVER point
// them at production. They ignore DATABASE_URL and backend/.env on purpose.

const url = process.env.TEST_DATABASE_URL;
const test = require("node:test");

if (!url) {
  console.log("integration tests skipped: set TEST_DATABASE_URL (see scripts/test-db.js)");
  test("integration tests need TEST_DATABASE_URL", { skip: true }, () => {});
  return;
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
  throw new Error(`Refusing to run integration tests against non-local database host "${host}"`);
}

process.env.DATABASE_URL = url;
process.env.JWT_SECRET = "integration-test-secret-integration-test-123";
process.env.CORS_ORIGIN = "https://app.example.test";
process.env.NODE_ENV = "test";
process.env.DEMO_LOGIN_ENABLED = "true";
process.env.AUTH_RATE_LIMIT = "100000"; // the many sign-ups below would trip the per-IP limit
process.env.REGISTER_RATE_LIMIT = "100000";
process.env.API_RATE_LIMIT = "100000";
delete process.env.RENDER;
delete process.env.RESEND_API_KEY;

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");
const dbSafety = require("../dbSafety");
const config = require("../config");
const { POLICY_VERSIONS } = require("../policies");
const accountStatus = require("../accountStatus");
const { io: connect } = require("socket.io-client");

const { server, io } = require("../index");
const db = require("../db");
const session = require("../session");
const accountSecurity = require("../accountSecurity");

const RUN = Date.now().toString(36);
const PASSWORD = "Str0ng#Pass-" + crypto.randomBytes(3).toString("hex");
const ORIGIN = "https://app.example.test";
let base;

test.before(async () => {
  await db.initDb();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => io.close(r));
  await db.close();
});

// ---- clients -----------------------------------------------------------------------

// A browser: cookie jar, web headers, same-origin calls
class WebClient {
  constructor() {
    this.cookie = "";
  }
  async call(method, path, body, extraHeaders = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Client-Platform": "web",
        "X-Requested-With": "dateza",
        Origin: ORIGIN,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await res.text();
    return { status: res.status, data: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null, headers: res.headers };
  }
}

// A phone: bearer token
class NativeClient {
  constructor() {
    this.token = null;
  }
  async call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, data: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null, headers: res.headers };
  }
}

const email = (label) => `it-${label}-${RUN}-${crypto.randomBytes(2).toString("hex")}@example.com`;

// What registration now requires besides e-mail, password and name: a real adult date of birth and
// acceptance of the current policy versions.
const REG = { birthdate: "1990-06-15", accepted_policies: POLICY_VERSIONS };

// Dating features need a verified e-mail and a completed profile. Tests that are NOT about onboarding use
// this shortcut (a direct database update); the tests that ARE about onboarding walk the real API instead.
async function makeEligible(userId) {
  await db.query(
    `UPDATE profiles SET email_verified_at = COALESCE(email_verified_at, NOW()),
                         profile_completed_at = COALESCE(profile_completed_at, NOW()) WHERE id = $1`,
    [userId]
  );
}

// signUpWeb / signUpNative create a member who is eligible by default; pass { eligible: false } to get a brand-new,
// not yet onboarded account exactly as the API creates it.
async function signUpWeb(label = "w", { eligible = true, birthdate = REG.birthdate } = {}) {
  const c = new WebClient();
  const e = email(label);
  const r = await c.call("POST", "/api/auth/register", { email: e, password: PASSWORD, name: `Web ${label}`, ...REG, birthdate });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  if (eligible) await makeEligible(r.data.user.id);
  return { c, email: e, user: r.data.user };
}
async function signUpNative(label = "n", { eligible = true, birthdate = REG.birthdate } = {}) {
  const c = new NativeClient();
  const e = email(label);
  const r = await c.call("POST", "/api/auth/register", { email: e, password: PASSWORD, name: `Phone ${label}`, ...REG, birthdate });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.token = r.data.token;
  if (eligible) await makeEligible(r.data.user.id);
  return { c, email: e, user: r.data.user };
}

// Sockets: web uses a one-time ticket, native its token
async function webSocket(client) {
  const { data } = await client.call("POST", "/api/auth/socket-ticket");
  return openSocket({ ticket: data.ticket });
}
const nativeSocket = (client) => openSocket({ token: client.token });
function openSocket(auth) {
  return new Promise((resolve, reject) => {
    const s = connect(base, { auth, reconnection: false, transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => reject(new Error(e.message)));
  });
}
const nextEvent = (socket, name, ms = 4000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for "${name}"`)), ms);
    socket.once(name, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

// ---- authentication ------------------------------------------------------------------

test("web sign-up sets an HttpOnly cookie and never puts the token, hash or internals in the body", async () => {
  const { c, user } = await signUpWeb("reg");
  assert.ok(c.cookie.startsWith("dateza_session="));
  const r = await new WebClient().call("POST", "/api/auth/login", { email: user.email, password: PASSWORD });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.equal(r.data.token, undefined, "web must not receive the token in JSON");
  assert.equal(r.data.user.password, undefined);
  assert.equal(r.data.user.token_version, undefined);
});

test("sign-up validation: duplicate, bad email, short and over-long passwords", async () => {
  const { email: used } = await signUpWeb("dup");
  const c = new WebClient();
  const reg = (o) => ({ password: PASSWORD, name: "X", ...REG, ...o });
  assert.equal((await c.call("POST", "/api/auth/register", reg({ email: used }))).status, 409);
  assert.equal((await c.call("POST", "/api/auth/register", reg({ email: "nope" }))).status, 400);
  assert.equal((await c.call("POST", "/api/auth/register", reg({ email: email("s"), password: "short" }))).status, 400);
  assert.equal((await c.call("POST", "/api/auth/register", reg({ email: email("l"), password: "a".repeat(73) }))).status, 400);
  assert.equal((await c.call("POST", "/api/auth/register", reg({ email: email("o"), password: { $ne: 1 } }))).status, 400);
});

test("login: valid, wrong password and unknown email give the same answer; session restores via /me", async () => {
  const { email: e } = await signUpWeb("login");
  const good = new WebClient();
  assert.equal((await good.call("POST", "/api/auth/login", { email: e, password: PASSWORD })).status, 200);
  const me = await good.call("GET", "/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.email, e);
  assert.equal(me.data.password, undefined);

  const bad = await new WebClient().call("POST", "/api/auth/login", { email: e, password: "Wrong#Pass1" });
  const ghost = await new WebClient().call("POST", "/api/auth/login", { email: email("ghost"), password: "Wrong#Pass1" });
  assert.equal(bad.status, 401);
  assert.equal(ghost.status, 401);
  assert.deepEqual(bad.data, ghost.data, "must not reveal whether the email exists");

  assert.equal((await new WebClient().call("GET", "/api/auth/me")).status, 401);
});

test("login is rate limited after repeated failures", async () => {
  const { email: e } = await signUpWeb("rl");
  let last;
  for (let i = 0; i < 12; i++) last = await new WebClient().call("POST", "/api/auth/login", { email: e, password: "Wrong#Pass" + i });
  assert.equal(last.status, 429);
});

test("native login returns a token that works as a bearer credential", async () => {
  const { c } = await signUpNative("tok");
  assert.equal((await c.call("GET", "/api/auth/me")).status, 200);
  c.token = c.token + "x";
  assert.equal((await c.call("GET", "/api/auth/me")).status, 401);
});

test("logout clears the web cookie", async () => {
  const { c } = await signUpWeb("lo");
  const r = await c.call("POST", "/api/auth/logout");
  assert.equal(r.status, 200);
  assert.equal(c.cookie, "");
  assert.equal((await c.call("GET", "/api/auth/me")).status, 401);
});

test("old tokens that predate token versions still work (existing users are not logged out)", async () => {
  const jwt = require("jsonwebtoken");
  const { user } = await signUpNative("legacy");
  const legacy = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const c = new NativeClient();
  c.token = legacy;
  assert.equal((await c.call("GET", "/api/auth/me")).status, 200);
});

test("change password signs every other device out and keeps this one signed in", async () => {
  const { c: phone, email: e } = await signUpNative("cp");
  const web = new WebClient();
  await web.call("POST", "/api/auth/login", { email: e, password: PASSWORD });

  assert.equal((await phone.call("POST", "/api/auth/change-password", { current_password: "nope", new_password: "NewPass#12345" })).status, 400);
  assert.equal((await phone.call("POST", "/api/auth/change-password", { current_password: PASSWORD, new_password: PASSWORD })).status, 400);
  const ok = await phone.call("POST", "/api/auth/change-password", { current_password: PASSWORD, new_password: "NewPass#12345" });
  assert.equal(ok.status, 200);
  const oldToken = phone.token;
  phone.token = ok.data.token;

  assert.equal((await phone.call("GET", "/api/auth/me")).status, 200, "this device continues");
  assert.equal((await web.call("GET", "/api/auth/me")).status, 401, "other device is signed out");
  const old = new NativeClient();
  old.token = oldToken;
  const r = await old.call("GET", "/api/auth/me");
  assert.equal(r.status, 401);
  assert.equal(r.data.code, "session_revoked");
  assert.equal((await new WebClient().call("POST", "/api/auth/login", { email: e, password: PASSWORD })).status, 401);
  assert.equal((await new WebClient().call("POST", "/api/auth/login", { email: e, password: "NewPass#12345" })).status, 200);
});

test("logout-all revokes every session, including live sockets' future connections", async () => {
  const { c, email: e } = await signUpNative("la");
  const other = new WebClient();
  await other.call("POST", "/api/auth/login", { email: e, password: PASSWORD });
  assert.equal((await c.call("POST", "/api/auth/logout-all")).status, 200);
  assert.equal((await c.call("GET", "/api/auth/me")).status, 401);
  assert.equal((await other.call("GET", "/api/auth/me")).status, 401);
  await assert.rejects(() => nativeSocket(c), /invalid or expired/);
});

test("password reset: codes are single use, limited to 5 guesses, and end all sessions", async () => {
  const { c, email: e, user } = await signUpNative("pr");
  const web = new WebClient();

  // unknown emails get the same answer as real ones
  assert.equal((await web.call("POST", "/api/auth/password-reset/request", { email: email("none") })).status, 200);
  assert.equal((await web.call("POST", "/api/auth/password-reset/request", { email: e })).status, 200);

  const { code } = await accountSecurity.issueCode(user.id, "password_reset").then((r) => (r.cooldown ? { code: null } : r));
  assert.equal(code, null, "a second code within 60 s is refused (resend cooldown)");

  // make the cooldown pass, then test guesses
  await db.query("UPDATE auth_codes SET created_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1", [user.id]);
  const issued = await accountSecurity.issueCode(user.id, "password_reset");
  const good = issued.code;
  const wrong = good === "000000" ? "111111" : "000000";
  const confirm = (code, pw = "Reset#Pass9876") => web.call("POST", "/api/auth/password-reset/confirm", { email: e, code, new_password: pw });

  assert.equal((await confirm(wrong)).status, 400);
  assert.equal((await confirm("12")).status, 400);
  assert.equal((await confirm(good, "short")).status, 400, "weak password rejected before the code is spent");
  for (let i = 0; i < 4; i++) await confirm(wrong);
  assert.equal((await confirm(good)).status, 400, "after 5 wrong guesses even the right code is dead");

  await db.query("UPDATE auth_codes SET created_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1", [user.id]);
  const fresh = await accountSecurity.issueCode(user.id, "password_reset");
  assert.equal((await confirm(fresh.code)).status, 200);
  assert.equal((await confirm(fresh.code)).status, 400, "single use");

  assert.equal((await c.call("GET", "/api/auth/me")).status, 401, "old sessions are revoked");
  assert.equal((await new WebClient().call("POST", "/api/auth/login", { email: e, password: "Reset#Pass9876" })).status, 200);
});

test("email verification: request is rate limited by cooldown, confirm marks the account verified", async () => {
  const { c, user } = await signUpWeb("ev", { eligible: false });
  assert.equal((await c.call("GET", "/api/auth/config")).data.emailVerification, true);
  assert.equal((await c.call("POST", "/api/auth/verify-email/request")).status, 200);
  assert.equal((await c.call("POST", "/api/auth/verify-email/request")).status, 429);
  assert.equal((await c.call("POST", "/api/auth/verify-email/confirm", { code: "123456" })).status, 400);

  await db.query("UPDATE auth_codes SET created_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1", [user.id]);
  const { code } = await accountSecurity.issueCode(user.id, "verify_email");
  assert.equal((await c.call("POST", "/api/auth/verify-email/confirm", { code })).status, 200);
  const me = await c.call("GET", "/api/auth/me");
  assert.ok(me.data.email_verified_at);
});

test("CSRF: a cookie session cannot be used for writes without the custom header or from another origin", async () => {
  const { c } = await signUpWeb("csrf");
  const noHeader = await c.call("POST", "/api/swipes/reset", null, { "X-Requested-With": "" });
  assert.equal(noHeader.status, 403);
  const evil = await c.call("POST", "/api/swipes/reset", null, { Origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal((await c.call("POST", "/api/swipes/reset")).status, 200);
});

// ---- profile ---------------------------------------------------------------------------

test("profile updates change only the fields sent and are validated", async () => {
  const { c } = await signUpWeb("prof");
  const other = await signUpWeb("prof-other");
  const full = await c.call("POST", "/api/auth/complete-setup", {
    gender: "female", looking_for: "male", bio: "Hello", height_cm: 170, interests: ["a", "b"],
  });
  assert.equal(full.status, 200);

  const mine = await c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") });
  assert.equal(mine.status, 201);
  const theirs = await other.c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") });
  assert.equal(theirs.status, 201);

  // Photos must be images this member uploaded: remote URLs and other members' images are refused.
  for (const photos of [["https://images.example.com/a.jpg"], [theirs.data.url], [mine.data.url, "https://images.example.com/a.jpg"]]) {
    const r = await c.call("POST", "/api/auth/complete-setup", { photos });
    assert.equal(r.status, 400, JSON.stringify(photos));
    assert.equal(r.data.code, "photo_not_owned");
  }
  const photoOnly = await c.call("POST", "/api/auth/complete-setup", { photos: [mine.data.url, "blob:x", "file:///y"] });
  assert.equal(photoOnly.status, 200, "device-only references are dropped, own images kept");
  assert.equal(photoOnly.data.user.bio, "Hello");
  assert.equal(photoOnly.data.user.gender, "female");
  assert.deepEqual(photoOnly.data.user.photos, [mine.data.url]);
  assert.equal(photoOnly.data.user.password, undefined);
  assert.equal(photoOnly.data.user.token_version, undefined);

  assert.equal((await c.call("POST", "/api/auth/complete-setup", { name: "New Name" })).data.user.name, "New Name");
  const dob = await c.call("POST", "/api/auth/complete-setup", { birthdate: "1995-05-05" });
  assert.equal(dob.status, 400);
  assert.equal(dob.data.code, "use_onboarding");
  assert.equal((await c.call("POST", "/api/auth/complete-setup", { bio: "x".repeat(2000) })).status, 400);
});

// ---- images --------------------------------------------------------------------------

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("image upload: needs auth, checks the real file type and size, serves the same bytes back", async () => {
  const { c } = await signUpWeb("img");
  assert.equal((await new WebClient().call("POST", "/api/images", { data: PNG_1PX.toString("base64") })).status, 401);

  const up = await c.call("POST", "/api/images", { data: "data:image/png;base64," + PNG_1PX.toString("base64") });
  assert.equal(up.status, 201);
  const got = await fetch(base + up.data.url);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG_1PX);

  const fake = await c.call("POST", "/api/images", { data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64") });
  assert.equal(fake.status, 400);
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 10)]);
  assert.equal((await c.call("POST", "/api/images", { data: big.toString("base64") })).status, 400);
  assert.equal((await fetch(base + "/api/images/not-a-uuid")).status, 404);
});

// ---- matching, messaging, presence ---------------------------------------------------------

async function matchedPair() {
  const a = await signUpWeb("A");
  const b = await signUpNative("B");
  for (const [who, g, l] of [[a, "female", "male"], [b, "male", "female"]]) {
    await who.c.call("POST", "/api/auth/complete-setup", { gender: g, looking_for: l });
  }
  assert.equal((await a.c.call("POST", "/api/swipes", { swipee_id: b.user.id, direction: "like" })).data.activeMatch, null);
  const done = await b.c.call("POST", "/api/swipes", { swipee_id: a.user.id, direction: "like" });
  assert.ok(done.data.activeMatch, "mutual like creates a match");
  return { a, b, matchId: done.data.activeMatch.match.id };
}

test("swipe validation and one match per pair", async () => {
  const { a, b } = await matchedPair();
  assert.equal((await a.c.call("POST", "/api/swipes", { swipee_id: b.user.id, direction: "love" })).status, 400);
  assert.equal((await a.c.call("POST", "/api/swipes", { swipee_id: a.user.id, direction: "like" })).status, 400);
  assert.equal((await a.c.call("POST", "/api/swipes", { swipee_id: "usr_does_not_exist", direction: "like" })).status, 404);
  // swiping again does not create a second match
  assert.equal((await b.c.call("POST", "/api/swipes", { swipee_id: a.user.id, direction: "like" })).data.activeMatch, null);
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM matches WHERE user_a = ANY($1) AND user_b = ANY($1)", [[a.user.id, b.user.id]]);
  assert.equal(rows[0].n, 1);
});

test("web user and phone exchange messages in real time, both directions, no duplicates, history persists", async () => {
  const { a, b, matchId } = await matchedPair();
  const webSock = await webSocket(a.c);
  const phoneSock = await nativeSocket(b.c);

  // web -> phone
  const toPhone = nextEvent(phoneSock, "new_message");
  const cid1 = crypto.randomUUID();
  const sent = await a.c.call("POST", `/api/matches/${matchId}/messages`, { body: "hi from web", client_id: cid1 });
  assert.equal(sent.status, 201);
  assert.equal((await toPhone).body, "hi from web");

  // phone -> web
  const toWeb = nextEvent(webSock, "new_message");
  const cid2 = crypto.randomUUID();
  assert.equal((await b.c.call("POST", `/api/matches/${matchId}/messages`, { body: "hi from phone", client_id: cid2 })).status, 201);
  assert.equal((await toWeb).body, "hi from phone");

  // retry of the same send is idempotent
  const retry = await a.c.call("POST", `/api/matches/${matchId}/messages`, { body: "hi from web", client_id: cid1 });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.id, sent.data.id);

  // persisted, ordered
  const history = await b.c.call("GET", `/api/matches/${matchId}/messages`);
  assert.deepEqual(history.data.map((m) => m.body), ["hi from web", "hi from phone"]);
  assert.ok(history.data[0].id < history.data[1].id);

  webSock.close();
  phoneSock.close();
});

test("one user on two devices: both receive every message", async () => {
  const { a, b, matchId } = await matchedPair();
  const web2 = new WebClient();
  await web2.call("POST", "/api/auth/login", { email: a.email, password: PASSWORD });
  const dev1 = await webSocket(a.c);
  const dev2 = await webSocket(web2);

  const both = Promise.all([nextEvent(dev1, "new_message"), nextEvent(dev2, "new_message")]);
  await b.c.call("POST", `/api/matches/${matchId}/messages`, { body: "to both", client_id: crypto.randomUUID() });
  const [m1, m2] = await both;
  assert.equal(m1.body, "to both");
  assert.equal(m2.id, m1.id);
  dev1.close();
  dev2.close();
});

test("outsiders cannot read, post to, or receive a match's messages", async () => {
  const { matchId } = await matchedPair();
  const eve = await signUpNative("eve");
  assert.equal((await eve.c.call("GET", `/api/matches/${matchId}/messages`)).status, 403);
  assert.equal((await eve.c.call("POST", `/api/matches/${matchId}/messages`, { body: "x" })).status, 403);
});

test("presence: online while any device is connected, only matches are told", async () => {
  const { a, b } = await matchedPair();
  const stranger = await signUpNative("stranger");
  const strangerSock = await nativeSocket(stranger.c);
  let strangerHeard = false;
  strangerSock.on("status_change", () => (strangerHeard = true));

  const phoneSock = await nativeSocket(b.c);

  const aPhone = new NativeClient();
  const login = await aPhone.call("POST", "/api/auth/login", { email: a.email, password: PASSWORD });
  aPhone.token = login.data.token;

  const heard = nextEvent(phoneSock, "status_change");
  const s1 = await nativeSocket(aPhone);
  assert.deepEqual(await heard, { userId: a.user.id, is_online: true });
  const row = async () => (await db.query("SELECT is_online FROM profiles WHERE id = $1", [a.user.id])).rows[0].is_online;
  assert.equal(await row(), true);

  const s2 = await nativeSocket(aPhone); // second device
  s1.close();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await row(), true, "still online: second device connected");

  const left = nextEvent(phoneSock, "status_change");
  s2.close();
  assert.deepEqual(await left, { userId: a.user.id, is_online: false });
  assert.equal(await row(), false);
  assert.equal(strangerHeard, false, "unmatched users never see presence");
  strangerSock.close();
  phoneSock.close();
});

// ---- discovery, demo, schema -----------------------------------------------------------------

test("protected data routes need credentials; discovery is capped; demo accounts stay hidden", async () => {
  assert.equal((await new WebClient().call("GET", "/api/profiles/discovery")).status, 401);
  assert.equal((await new WebClient().call("GET", "/api/matches")).status, 401);
  const { c } = await signUpWeb("disc");
  await c.call("POST", "/api/auth/complete-setup", { gender: "male", looking_for: "everyone" });

  const demo = await new WebClient().call("POST", "/api/auth/demo", { persona: "alex" });
  assert.equal(demo.status, 200);
  assert.equal(demo.data.user.id, "demo-alex");

  const list = await c.call("GET", "/api/profiles/discovery?limit=100000");
  assert.equal(list.status, 200);
  assert.ok(list.data.length <= 50);
  assert.ok(!list.data.some((p) => p.id.startsWith("demo-")), "real users never see demo accounts");
});

// ---- location privacy (Release Gate A, P1-00) -----------------------------------------
// Other members' precise coordinates must not appear in ANY response. Checked two ways: by key name
// anywhere in the payload, and by the coordinate values themselves under whatever key they are sent.

const COORD_KEY_RE = /^(lat|lng|lon|long|latitude|longitude|coords?|coordinates|location|geo\w*|position)$/i;
function coordinateLeaks(payload, secrets) {
  const leaks = [];
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (COORD_KEY_RE.test(k)) leaks.push(`key ${where}.${k}`);
        walk(x, `${where}.${k}`);
      }
    }
  };
  walk(payload, "$");
  const text = JSON.stringify(payload);
  for (const s of secrets) if (text.includes(s)) leaks.push(`value ${s}`);
  return leaks;
}

test("the leak detector itself catches coordinates (negative control)", () => {
  assert.ok(coordinateLeaks([{ id: "x", lat: 1 }], []).length > 0);
  assert.ok(coordinateLeaks({ a: { Longitude: 1 } }, []).length > 0);
  assert.ok(coordinateLeaks({ note: "at 6.123456" }, ["6.123456"]).length > 0);
  assert.deepEqual(coordinateLeaks({ id: "x", name: "ok", interests: ["a"] }, ["6.123456"]), []);
});

test("other members coordinates never appear in discovery, likes-you, swipes, matches, quick matches or statuses", async () => {
  const lat = (6 + Math.random()).toFixed(6);
  const lng = (79 + Math.random()).toFixed(6);
  const viewer = await signUpWeb("loc-viewer");
  const liker = await signUpNative("loc-liker");
  const other = await signUpNative("loc-other");
  await viewer.c.call("POST", "/api/auth/complete-setup", { gender: "male", looking_for: "everyone" });
  await liker.c.call("POST", "/api/auth/complete-setup", { gender: "female", looking_for: "everyone" });
  await other.c.call("POST", "/api/auth/complete-setup", { gender: "female", looking_for: "everyone" });
  // Coordinates can only be set directly in the database now, which simulates rows saved before the fix.
  for (const u of [viewer, liker, other]) await db.query("UPDATE profiles SET lat = $2, lng = $3 WHERE id = $1", [u.user.id, lat, lng]);
  const secrets = [lat, lng];
  await liker.c.call("POST", "/api/swipes", { swipee_id: viewer.user.id, direction: "like" });

  const discovery = await viewer.c.call("GET", "/api/profiles/discovery?limit=50");
  assert.equal(discovery.status, 200);
  for (const member of [liker, other]) {
    const row = discovery.data.find((p) => p.id === member.user.id);
    assert.ok(row, "discovery still lists the member (functional behaviour preserved)");
    assert.equal(row.name, member.user.name);
    for (const key of ["id", "name", "birthdate", "gender", "looking_for", "bio", "height_cm", "interests", "photos", "is_online", "match_percent"]) {
      assert.ok(key in row, `discovery rows keep the public field "${key}"`);
    }
  }
  assert.deepEqual(coordinateLeaks(discovery.data, secrets), [], "discovery");

  const likes = await viewer.c.call("GET", "/api/profiles/likes-you");
  assert.equal(likes.status, 200);
  assert.ok(likes.data.some((p) => p.id === liker.user.id), "likes-you still lists the member who liked");
  assert.deepEqual(coordinateLeaks(likes.data, secrets), [], "likes-you");

  const swipe = await viewer.c.call("POST", "/api/swipes", { swipee_id: liker.user.id, direction: "like" });
  assert.ok(swipe.data.activeMatch, "mutual like still creates a match");
  assert.deepEqual(coordinateLeaks(swipe.data, secrets), [], "swipe response");

  for (const path of ["/api/matches", "/api/matches/conversations"]) {
    const list = await viewer.c.call("GET", path);
    assert.equal(list.status, 200);
    assert.ok(list.data.some((m) => m.other_user?.id === liker.user.id));
    assert.deepEqual(coordinateLeaks(list.data, secrets), [], path);
  }
  const quick = await viewer.c.call("POST", "/api/matches", { targetUserId: liker.user.id });
  assert.equal(quick.status, 200);
  assert.deepEqual(coordinateLeaks(quick.data, secrets), [], "POST /api/matches");
  const quick2 = await viewer.c.call("POST", "/api/matches/quick", { profile_id: liker.user.id });
  assert.equal(quick2.status, 200);
  assert.deepEqual(coordinateLeaks(quick2.data, secrets), [], "POST /api/matches/quick");

  const media = await (await uploadMedia(liker.c, PNG_1PX, "story")).json();
  assert.equal((await liker.c.call("POST", "/api/stories", { media_id: media.id })).status, 201);
  const stories = await viewer.c.call("GET", "/api/stories");
  assert.equal(stories.status, 200);
  assert.ok(stories.data.some((s) => s.user_id === liker.user.id));
  assert.deepEqual(coordinateLeaks(stories.data, secrets), [], "stories");
});

test("profile setup refuses coordinates, stores nothing, and normal profile updates still work", async () => {
  const { c, user } = await signUpWeb("loc-setup");
  for (const body of [{ lat: 6.9271, lng: 79.8612 }, { lat: 6.9271 }, { lng: "79.8612" }, { lat: 6.9, lng: 79.8, bio: "should not be saved either" }]) {
    const r = await c.call("POST", "/api/auth/complete-setup", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.data.code, "location_not_supported");
  }
  const row = (await db.query("SELECT lat, lng, bio FROM profiles WHERE id = $1", [user.id])).rows[0];
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  assert.equal(row.bio, null, "a rejected request changes nothing");

  const ok = await c.call("POST", "/api/auth/complete-setup", { bio: "Hello there", lat: null, lng: null });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.bio, "Hello there");
  assert.equal((await db.query("SELECT lat FROM profiles WHERE id = $1", [user.id])).rows[0].lat, null);
});

// ---- shared demo login (Release Gate A, P1-00b) -------------------------------------------

test("with the demo login off: no new demo sessions, and sessions already issued to demo accounts stop working", async () => {
  const original = config.demoLoginEnabled;
  try {
    config.demoLoginEnabled = true; // an explicitly enabled (development / isolated demo) environment
    const phone = new NativeClient();
    const login = await phone.call("POST", "/api/auth/demo", { persona: "alex" });
    assert.equal(login.status, 200);
    phone.token = login.data.token;
    assert.equal((await phone.call("GET", "/api/auth/me")).status, 200, "a demo session works while the demo is enabled");
    assert.equal((await new WebClient().call("GET", "/api/auth/demo/status")).data.enabled, true);

    config.demoLoginEnabled = false; // what production now always is, unless DEMO_ENVIRONMENT=isolated
    const closed = await new WebClient().call("POST", "/api/auth/demo", { persona: "alex" });
    assert.equal(closed.status, 404, "no new demo session can be created");
    assert.equal(closed.data.token, undefined);
    assert.deepEqual((await new WebClient().call("GET", "/api/auth/demo/status")).data, { enabled: false, personas: [] });
    const stale = await phone.call("GET", "/api/auth/me");
    assert.equal(stale.status, 401, "the earlier demo token is dead");
    assert.equal(stale.data.code, "session_revoked");
    await assert.rejects(nativeSocket(phone), /invalid or expired/, "and so is its socket");

    // Real members are not affected, and the demo rows are not deleted by turning it off.
    const { c } = await signUpWeb("demo-off-real");
    assert.equal((await c.call("GET", "/api/auth/me")).status, 200);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM profiles WHERE id = 'demo-alex'")).rows[0].n, 1);
  } finally {
    config.demoLoginEnabled = original;
  }
});

// ---- Phase 1: registration, eligibility, onboarding, account status, sockets, OAuth -------------------

const sha256Hex = (v) => crypto.createHash("sha256").update(v).digest("hex");
function dobYearsAgo(years, dayOffset = 0) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}
const profileRow = async (id) => (await db.query("SELECT * FROM profiles WHERE id = $1", [id])).rows[0];
async function expectClosed(client, reason, path = "/api/profiles/discovery", method = "GET") {
  const r = await client.call(method, path);
  assert.equal(r.status, 403, `${method} ${path}: ${JSON.stringify(r.data)}`);
  assert.equal(r.data.code, "not_eligible");
  if (reason) assert.equal(r.data.reason, reason, `${method} ${path}`);
  return r;
}
async function onboardNew(label, { photoOwner } = {}) {
  // Walks the REAL onboarding API (no database shortcuts except reading the e-mail code) to an eligible member.
  const m = await signUpWeb(label, { eligible: false });
  const code = (await accountSecurity.issueCode(m.user.id, "verify_email")).code;
  assert.equal((await m.c.call("POST", "/api/auth/verify-email/confirm", { code })).status, 200);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/gender", { gender: "female" })).status, 200);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/interested_in", { looking_for: "everyone" })).status, 200);
  const img = await (photoOwner || m).c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") });
  assert.equal(img.status, 201);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/photos", { photos: [img.data.url] })).status, 200);
  const done = await m.c.call("POST", "/api/onboarding/complete");
  assert.equal(done.status, 200, JSON.stringify(done.data));
  return { ...m, photo: img.data.url };
}

test("registration needs a real adult date of birth and acceptance of the current policies; nothing is created otherwise", async () => {
  const c = new WebClient();
  const body = (o) => ({ email: email("reg1"), password: PASSWORD, name: "Reg", ...REG, ...o });
  const count = async (e) => (await db.query("SELECT count(*)::int AS n FROM profiles WHERE email = $1", [e])).rows[0].n;

  // missing / impossible / loose / future dates
  for (const birthdate of [undefined, null, "", "2008-02-30", "0001-01-01", "1999-1-1", "2999-01-01", "20001010", "2000-13-01", 19900615, ["1990-06-15"]]) {
    const e = email("reg-bad");
    const r = await c.call("POST", "/api/auth/register", body({ email: e, birthdate }));
    assert.equal(r.status, 400, JSON.stringify(birthdate));
    assert.equal(r.data.code, "invalid_birthdate", JSON.stringify(birthdate));
    assert.equal(await count(e), 0, "no account is created");
  }
  // under 18, including "turns 18 tomorrow"
  for (const birthdate of [dobYearsAgo(17), dobYearsAgo(18, 1), dobYearsAgo(5)]) {
    const e = email("reg-young");
    const r = await c.call("POST", "/api/auth/register", body({ email: e, birthdate }));
    assert.equal(r.status, 400, birthdate);
    assert.equal(r.data.code, "underage", birthdate);
    assert.equal(await count(e), 0, "no account is created for someone under 18");
  }
  // consent
  for (const accepted_policies of [undefined, {}, { terms: POLICY_VERSIONS.terms }, { terms: "old", privacy: POLICY_VERSIONS.privacy }, { terms: POLICY_VERSIONS.terms, privacy: "x" }]) {
    const e = email("reg-consent");
    const r = await c.call("POST", "/api/auth/register", body({ email: e, accepted_policies }));
    assert.equal(r.status, 400);
    assert.equal(r.data.code, "consent_required");
    assert.deepEqual(r.data.policies, POLICY_VERSIONS);
    assert.equal(await count(e), 0);
  }
  // password strength is enforced by the server
  for (const password of ["alllowercase1!", "ALLUPPERCASE1!", "NoNumber!!!!", "NoSymbol1234A", "Sh0rt!"]) {
    const r = await c.call("POST", "/api/auth/register", body({ email: email("reg-pw"), password }));
    assert.equal(r.status, 400, password);
    assert.equal(r.data.code, "weak_password", password);
  }
  // exactly 18 today is allowed
  const ok = await c.call("POST", "/api/auth/register", body({ email: email("reg-ok"), birthdate: dobYearsAgo(18) }));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const row = await profileRow(ok.data.user.id);
  assert.equal(row.birthdate, dobYearsAgo(18), "stored exactly as entered, as a calendar day");
  assert.equal(row.profile_completed_at, null);
  assert.equal(row.email_verified_at, null);
  assert.deepEqual(row.onboarding_done, ["basics", "birthday"]);
  const consents = (await db.query("SELECT kind, version FROM privacy_consents WHERE user_id = $1 ORDER BY kind", [row.id])).rows;
  assert.deepEqual(consents, [{ kind: "privacy", version: POLICY_VERSIONS.privacy }, { kind: "terms", version: POLICY_VERSIONS.terms }]);
  assert.equal(ok.data.user.eligibility.eligible, false);
  assert.deepEqual(ok.data.user.eligibility.reasons, ["email_unverified", "profile_incomplete"]);
  assert.equal(ok.data.user.password, undefined);
  assert.equal(ok.data.user.token_version, undefined);
  assert.equal(ok.data.token, undefined, "web gets a cookie, not a token");
});

test("a new account is closed to EVERY dating feature, REST and sockets, until onboarding is complete", async () => {
  const m = await signUpNative("closed", { eligible: false });
  const someMatch = "match_does_not_matter";
  const requests = [
    ["GET", "/api/profiles/discovery"], ["GET", "/api/profiles/likes-you"],
    ["POST", "/api/swipes", { swipee_id: "usr_x", direction: "like" }], ["POST", "/api/swipes/reset"],
    ["GET", "/api/matches"], ["GET", "/api/matches/conversations"],
    ["POST", "/api/matches", { targetUserId: "usr_x" }], ["POST", "/api/matches/quick", { profile_id: "usr_x" }],
    ["GET", `/api/matches/${someMatch}/messages`], ["POST", `/api/matches/${someMatch}/messages`, { body: "hi" }],
    ["POST", `/api/matches/${someMatch}/read`, { last_read_message_id: 1 }],
    ["GET", "/api/stories"], ["POST", "/api/stories", { media_id: "00000000-0000-4000-8000-000000000000" }],
    ["DELETE", "/api/stories/00000000-0000-4000-8000-000000000000"],
    ["GET", "/api/media/00000000-0000-4000-8000-000000000000"],
    ["POST", "/api/auth/socket-ticket"],
  ];
  for (const [method, path, body] of requests) {
    const r = await m.c.call(method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.data.code, "not_eligible", `${method} ${path}`);
    assert.equal(r.data.reason, "email_unverified");
  }
  assert.equal((await uploadMedia(m.c, PNG_1PX, "story")).status, 403, "media upload");
  await assert.rejects(nativeSocket(m.c), /not_eligible/, "no socket for an ineligible member");

  // What stays open: account recovery, verification, onboarding, own profile, photo upload (adult).
  const me = await m.c.call("GET", "/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.eligibility.eligible, false);
  assert.equal((await m.c.call("GET", "/api/onboarding")).status, 200);
  assert.equal((await m.c.call("POST", "/api/auth/verify-email/request")).status, 200);
  assert.equal((await m.c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") })).status, 201);
  assert.equal((await m.c.call("POST", "/api/auth/logout-all")).status, 200);
});

test("each missing requirement closes dating features on its own, and reopening it reopens them", async () => {
  const m = await signUpNative("each");
  const ok = async () => assert.equal((await m.c.call("GET", "/api/profiles/discovery")).status, 200);
  await ok();
  const toggle = async (sql, reason) => {
    const before = await profileRow(m.user.id);
    await db.query(sql, [m.user.id]);
    await expectClosed(m.c, reason);
    await expectClosed(m.c, reason, "/api/matches");
    await db.query("UPDATE profiles SET email_verified_at = $2, profile_completed_at = $3, birthdate = $4 WHERE id = $1", [m.user.id, before.email_verified_at, before.profile_completed_at, before.birthdate]);
    await ok();
  };
  await toggle("UPDATE profiles SET email_verified_at = NULL WHERE id = $1", "email_unverified");
  await toggle("UPDATE profiles SET profile_completed_at = NULL WHERE id = $1", "profile_incomplete");
  await toggle("UPDATE profiles SET birthdate = NULL WHERE id = $1", "birthdate_required");
  await toggle(`UPDATE profiles SET birthdate = '${dobYearsAgo(17)}' WHERE id = $1`, "not_adult");
  await toggle(`UPDATE profiles SET birthdate = '${dobYearsAgo(18, 1)}' WHERE id = $1`, "not_adult");
});

test("under-18 dates are refused during onboarding and LOCK the date: no second try, no dating features, no photo upload", async () => {
  const m = await signUpWeb("minor", { eligible: false });
  const young = dobYearsAgo(16);
  const first = await m.c.call("PATCH", "/api/onboarding/birthday", { birthdate: young });
  assert.equal(first.status, 403);
  assert.equal(first.data.code, "underage");
  // trying another date is refused, whatever it is
  for (const birthdate of [dobYearsAgo(30), dobYearsAgo(18), young]) {
    const again = await m.c.call("PATCH", "/api/onboarding/birthday", { birthdate });
    assert.equal(again.status, 403, birthdate);
    assert.equal(again.data.code, "underage");
  }
  assert.equal((await profileRow(m.user.id)).birthdate, young, "the date on file is unchanged");
  // every other step and completion are refused too
  for (const [step, body] of [["gender", { gender: "male" }], ["interested_in", { looking_for: "female" }], ["photos", { photos: [] }], ["basics", { name: "X" }]]) {
    assert.equal((await m.c.call("PATCH", `/api/onboarding/${step}`, body)).status, 403, step);
  }
  assert.equal((await m.c.call("POST", "/api/onboarding/complete")).status, 403);
  const state = (await m.c.call("GET", "/api/onboarding")).data;
  assert.equal(state.underage, true);
  assert.equal(state.birthdate_locked, true);
  assert.equal(state.can_complete, false);
  await expectClosed(m.c, "not_adult");
  assert.equal((await m.c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") })).status, 403, "no photo upload for a minor");
  assert.equal((await m.c.call("POST", "/api/auth/complete-setup", { birthdate: dobYearsAgo(30) })).status, 400, "the legacy endpoint cannot change it either");
  assert.equal((await profileRow(m.user.id)).birthdate, young);
});

test("onboarding is server-driven: every step persists, it resumes after a restart, and only the server can complete it", async () => {
  const m = await signUpWeb("onb", { eligible: false });
  const other = await signUpWeb("onb-other");
  let s = (await m.c.call("GET", "/api/onboarding")).data;
  assert.equal(s.complete, false);
  assert.deepEqual(s.steps.filter((x) => x.done).map((x) => x.id), ["consent", "basics", "birthday"], "registration already covered these");
  assert.equal(s.next_step, "verify_email");
  assert.equal(s.email.required, true);
  assert.equal(s.eligibility.eligible, false);

  // The client cannot complete itself or claim values: extra fields are ignored, early completion is refused.
  const sneaky = await m.c.call("PATCH", "/api/onboarding/basics", { name: "Renamed", profile_completed_at: "2020-01-01T00:00:00Z", status: "active", email_verified_at: "2020-01-01T00:00:00Z" });
  assert.equal(sneaky.status, 200);
  const row = await profileRow(m.user.id);
  assert.equal(row.name, "Renamed");
  assert.equal(row.profile_completed_at, null);
  assert.equal(row.email_verified_at, null);
  const early = await m.c.call("POST", "/api/onboarding/complete");
  assert.equal(early.status, 400);
  assert.equal(early.data.code, "onboarding_incomplete");
  assert.deepEqual(early.data.missing, ["verify_email", "gender", "interested_in", "photos"]);
  assert.equal((await profileRow(m.user.id)).profile_completed_at, null);

  // validation per step
  const bad = [
    ["gender", { gender: "Male" }], ["gender", { gender: "" }], ["gender", {}], ["interested_in", { looking_for: "women" }],
    ["intention", { relationship_intention: "marriage" }], ["interests", { interests: "music" }], ["interests", { interests: Array(31).fill("a") }],
    ["about", { bio: "x".repeat(1001) }], ["about", { height_cm: 20 }], ["about", { height_cm: 170.5 }],
    ["preferences", { min_age: 17, max_age: 30 }], ["preferences", { min_age: 40, max_age: 30 }], ["preferences", { min_age: 18, max_age: 100 }],
    ["photos", { photos: "x" }], ["photos", { photos: ["https://images.example.com/a.jpg"] }], ["birthday", { birthdate: "2008-02-30" }], ["birthday", { birthdate: "1999-1-1" }],
    ["verify_email", {}], ["consent", { accepted_policies: { terms: "old", privacy: "old" } }],
  ];
  for (const [step, body] of bad) assert.equal((await m.c.call("PATCH", `/api/onboarding/${step}`, body)).status, 400, `${step} ${JSON.stringify(body)}`);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/nope", {})).status, 404);

  // photos must be this member's own uploads
  const theirs = await other.c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") });
  const mine = await m.c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") });
  assert.equal((await m.c.call("PATCH", "/api/onboarding/photos", { photos: [theirs.data.url] })).data.code, "photo_not_owned");
  assert.equal((await m.c.call("PATCH", "/api/onboarding/photos", { photos: [mine.data.url, mine.data.url] })).status, 400, "duplicates");

  // the e-mail code
  assert.equal((await m.c.call("POST", "/api/auth/verify-email/confirm", { code: "000000" })).status, 400);
  const code = (await accountSecurity.issueCode(m.user.id, "verify_email")).code;
  assert.equal((await m.c.call("POST", "/api/auth/verify-email/confirm", { code })).status, 200);

  assert.equal((await m.c.call("PATCH", "/api/onboarding/gender", { gender: "non_binary" })).status, 200);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/interested_in", { looking_for: "everyone" })).status, 200);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/intention", { relationship_intention: null })).status, 200, "optional: skipping stores nothing");
  assert.equal((await m.c.call("PATCH", "/api/onboarding/photos", { photos: [mine.data.url] })).status, 200);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/interests", { interests: ["Hiking", "hiking", " Tea "] })).status, 200);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/about", { bio: "  Hello  ", height_cm: null })).status, 200);
  assert.equal((await m.c.call("PATCH", "/api/onboarding/preferences", { min_age: 25, max_age: 40 })).status, 200);

  // resume: a brand-new session (another device / after a restart) sees exactly what was saved
  const again = new WebClient();
  assert.equal((await again.call("POST", "/api/auth/login", { email: m.email, password: PASSWORD })).status, 200);
  s = (await again.call("GET", "/api/onboarding")).data;
  assert.equal(s.complete, false);
  assert.equal(s.can_complete, true);
  assert.equal(s.next_step, "review");
  assert.deepEqual(s.profile, {
    name: "Renamed", birthdate: REG.birthdate, gender: "non_binary", looking_for: "everyone", relationship_intention: null,
    photos: [mine.data.url], interests: ["Hiking", "Tea"], bio: "Hello", height_cm: null, min_age: 25, max_age: 40,
  });
  await expectClosed(again, "profile_incomplete");

  const done = await again.call("POST", "/api/onboarding/complete");
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.complete, true);
  assert.equal(done.data.eligibility.eligible, true);
  assert.ok((await profileRow(m.user.id)).profile_completed_at, "set by the server");
  assert.equal((await again.call("POST", "/api/onboarding/complete")).status, 200, "idempotent");
  assert.equal((await again.call("GET", "/api/profiles/discovery")).status, 200, "dating features are open now");
  assert.equal((await again.call("GET", "/api/auth/me")).data.eligibility.eligible, true);

  // after completion the date of birth is fixed
  const dob = await again.call("PATCH", "/api/onboarding/birthday", { birthdate: dobYearsAgo(40) });
  assert.equal(dob.status, 409);
  assert.equal(dob.data.code, "birthdate_locked");
  assert.equal((await profileRow(m.user.id)).birthdate, REG.birthdate);
  // and an eligible member can now open a socket
  const socket = await webSocket(again);
  socket.close();
});

test("the full journey works through the API only: register, verify, onboard, appear to others, match and chat", async () => {
  const a = await onboardNew("journey-a");
  const b = await onboardNew("journey-b");
  const list = await a.c.call("GET", "/api/profiles/discovery?limit=50");
  assert.ok(list.data.some((p) => p.id === b.user.id), "a completed member is discoverable");
  assert.equal((await a.c.call("POST", "/api/swipes", { swipee_id: b.user.id, direction: "like" })).status, 200);
  const done = await b.c.call("POST", "/api/swipes", { swipee_id: a.user.id, direction: "like" });
  assert.ok(done.data.activeMatch);
  const sent = await a.c.call("POST", `/api/matches/${done.data.activeMatch.match.id}/messages`, { body: "hello", client_id: crypto.randomUUID() });
  assert.equal(sent.status, 201);
});

test("existing accounts keep every record, can still sign in, and must confirm what earlier versions guessed", async () => {
  const legacy = await signUpNative("legacy-acct", { eligible: false });
  const partner = await signUpWeb("legacy-partner");
  // How an account looked after the old onboarding: invented values saved, nothing verified, no completion.
  await db.query(
    `UPDATE profiles SET birthdate = '1999-01-01', gender = 'male', looking_for = 'female', bio = $2, height_cm = 175,
            interests = ARRAY['Music','Coffee','Design','Tacos'], photos = ARRAY['https://images.unsplash.com/photo-stock'],
            onboarding_done = '{}', email_verified_at = NULL, profile_completed_at = NULL WHERE id = $1`,
    [legacy.user.id, "Just finished setting up my Dateza profile! Let's connect."]
  );
  const [ua, ub] = [legacy.user.id, partner.user.id].sort();
  const matchId = "match_legacy_" + crypto.randomBytes(4).toString("hex");
  await db.query("INSERT INTO matches (id, user_a, user_b, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')", [matchId, ua, ub]);
  await db.query("INSERT INTO messages (match_id, sender_id, body) VALUES ($1, $2, 'an old message')", [matchId, partner.user.id]);
  await db.query("INSERT INTO swipes (swiper_id, swipee_id, direction) VALUES ($1, $2, 'like')", [legacy.user.id, partner.user.id]);
  const counts = async () => (await db.query(
    "SELECT (SELECT count(*) FROM matches WHERE id = $1)::int AS m, (SELECT count(*) FROM messages WHERE match_id = $1)::int AS msg, (SELECT count(*) FROM swipes WHERE swiper_id = $2)::int AS sw",
    [matchId, legacy.user.id])).rows[0];
  const before = await counts();
  assert.deepEqual(before, { m: 1, msg: 1, sw: 1 });

  // the existing session still works (not signed out), but dating features are closed until they confirm
  assert.equal((await legacy.c.call("GET", "/api/auth/me")).status, 200);
  await expectClosed(legacy.c, "email_unverified");
  await expectClosed(legacy.c, "email_unverified", "/api/matches");

  // nothing invented is shown as if the member had chosen it ...
  let s = (await legacy.c.call("GET", "/api/onboarding")).data;
  assert.deepEqual(
    { ...s.profile, name: undefined },
    { name: undefined, birthdate: null, gender: null, looking_for: null, relationship_intention: null, photos: [], interests: [], bio: "", height_cm: null, min_age: null, max_age: null }
  );
  assert.equal(s.steps.filter((x) => x.done).length, 1, "only consent (already accepted at sign-up) counts");
  // ... but nothing was deleted either
  const kept = await profileRow(legacy.user.id);
  assert.equal(kept.bio, "Just finished setting up my Dateza profile! Let's connect.");
  assert.deepEqual(kept.photos, ["https://images.unsplash.com/photo-stock"]);

  // they walk the steps for real
  const code = (await accountSecurity.issueCode(legacy.user.id, "verify_email")).code;
  assert.equal((await legacy.c.call("POST", "/api/auth/verify-email/confirm", { code })).status, 200);
  assert.equal((await legacy.c.call("PATCH", "/api/onboarding/basics", { name: "Legacy Person" })).status, 200);
  assert.equal((await legacy.c.call("PATCH", "/api/onboarding/birthday", { birthdate: "1992-04-05" })).status, 200);
  assert.equal((await legacy.c.call("PATCH", "/api/onboarding/gender", { gender: "female" })).status, 200);
  assert.equal((await legacy.c.call("PATCH", "/api/onboarding/interested_in", { looking_for: "male" })).status, 200);
  const early = await legacy.c.call("POST", "/api/onboarding/complete");
  assert.deepEqual(early.data.missing, ["photos"], "a stock photo URL is not a photo the member uploaded");
  const img = await legacy.c.call("POST", "/api/images", { data: PNG_1PX.toString("base64") });
  assert.equal((await legacy.c.call("PATCH", "/api/onboarding/photos", { photos: [img.data.url] })).status, 200);
  assert.equal((await legacy.c.call("PATCH", "/api/onboarding/about", { bio: null, height_cm: null })).status, 200, "optional answers can stay empty");
  assert.equal((await legacy.c.call("POST", "/api/onboarding/complete")).status, 200);

  // their old conversation is intact and usable
  assert.deepEqual(await counts(), before);
  const convo = await legacy.c.call("GET", "/api/matches");
  assert.equal(convo.status, 200);
  assert.ok(convo.data.some((m) => m.id === matchId));
  const msgs = await legacy.c.call("GET", `/api/matches/${matchId}/messages`);
  assert.equal(msgs.data[0].body, "an old message");
  const final = await profileRow(legacy.user.id);
  assert.equal(final.bio, null, "the member chose to leave it empty, replacing the guessed text");
  assert.equal(final.height_cm, null);
});

test("e-mail verification can be switched off only through configuration (development), never by a request", async () => {
  const m = await signUpWeb("noverify", { eligible: false });
  await db.query("UPDATE profiles SET profile_completed_at = NOW() WHERE id = $1", [m.user.id]);
  await expectClosed(m.c, "email_unverified");
  const original = config.requireEmailVerification;
  try {
    config.requireEmailVerification = false;
    assert.equal((await m.c.call("GET", "/api/profiles/discovery")).status, 200);
    config.requireEmailVerification = true;
    await expectClosed(m.c, "email_unverified");
  } finally {
    config.requireEmailVerification = original;
  }
});

test("only eligible members are visible to others, can be swiped on, or can receive messages", async () => {
  const viewer = await signUpWeb("vis-viewer");
  const good = await signUpNative("vis-good");
  const incomplete = await signUpNative("vis-incomplete", { eligible: false });
  const unverified = await signUpNative("vis-unverified");
  const minor = await signUpNative("vis-minor");
  const suspended = await signUpNative("vis-suspended");
  const banned = await signUpNative("vis-banned");
  await db.query("UPDATE profiles SET email_verified_at = NULL WHERE id = $1", [unverified.user.id]);
  await db.query("UPDATE profiles SET birthdate = $2 WHERE id = $1", [minor.user.id, dobYearsAgo(17)]);
  await accountStatus.setAccountStatus(io, suspended.user.id, "suspended");
  await accountStatus.setAccountStatus(io, banned.user.id, "banned");
  const hidden = [incomplete, unverified, minor, suspended, banned];

  // they all swiped on the viewer (direct inserts: they cannot use the API)
  for (const h of [good, ...hidden]) await db.query("INSERT INTO swipes (swiper_id, swipee_id, direction) VALUES ($1, $2, 'like')", [h.user.id, viewer.user.id]);

  const discovery = (await viewer.c.call("GET", "/api/profiles/discovery?limit=50")).data.map((p) => p.id);
  assert.ok(discovery.includes(good.user.id));
  for (const h of hidden) assert.ok(!discovery.includes(h.user.id), `${h.user.id} must not be discoverable`);
  const likes = (await viewer.c.call("GET", "/api/profiles/likes-you")).data.map((p) => p.id);
  assert.ok(likes.includes(good.user.id));
  for (const h of hidden) assert.ok(!likes.includes(h.user.id), `${h.user.id} must not appear in likes-you`);

  for (const h of hidden) {
    const r = await viewer.c.call("POST", "/api/swipes", { swipee_id: h.user.id, direction: "like" });
    assert.equal(r.status, 404, "looks exactly like a profile that does not exist");
    assert.equal((await viewer.c.call("POST", "/api/matches", { targetUserId: h.user.id })).status, 404);
    assert.equal((await viewer.c.call("POST", "/api/matches/quick", { profile_id: h.user.id })).status, 404);
  }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM swipes WHERE swiper_id = $1", [viewer.user.id])).rows[0].n, 0, "no swipe was recorded");
  assert.equal((await viewer.c.call("POST", "/api/swipes", { swipee_id: good.user.id, direction: "like" })).status, 200);

  // stories of an ineligible member are not shown to others
  const story = await (await uploadMedia(good.c, PNG_1PX, "story")).json();
  await good.c.call("POST", "/api/stories", { media_id: story.id });
  assert.ok((await viewer.c.call("GET", "/api/stories")).data.some((s) => s.user_id === good.user.id));
  await accountStatus.setAccountStatus(io, good.user.id, "suspended");
  assert.ok(!(await viewer.c.call("GET", "/api/stories")).data.some((s) => s.user_id === good.user.id), "suspended members' stories disappear");
  assert.equal((await fetch(base + story.url, { headers: mediaHeaders(viewer.c) })).status, 404);
});

test("messages cannot be sent to a member who is no longer eligible", async () => {
  const { a, b, matchId } = await matchedPair();
  assert.equal((await a.c.call("POST", `/api/matches/${matchId}/messages`, { body: "before" })).status, 201);
  await accountStatus.setAccountStatus(io, b.user.id, "suspended");
  const r = await a.c.call("POST", `/api/matches/${matchId}/messages`, { body: "after" });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, "unavailable");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM messages WHERE match_id = $1 AND body = 'after'", [matchId])).rows[0].n, 0);
  await accountStatus.setAccountStatus(io, b.user.id, "active");
  assert.equal((await a.c.call("POST", `/api/matches/${matchId}/messages`, { body: "back" })).status, 201, "reachable again once reinstated");
});

test("suspended, banned and deleted accounts cannot sign in, keep a session or hold a socket", async () => {
  for (const status of ["suspended", "banned", "deleted"]) {
    const m = await signUpNative(`st-${status}`);
    const web = await signUpWeb(`st-web-${status}`);
    const socket = await nativeSocket(m.c);
    const ticket = (await web.c.call("POST", "/api/auth/socket-ticket")).data.ticket;
    const dropped = nextEvent(socket, "disconnect");
    await accountStatus.setAccountStatus(io, m.user.id, status);
    await accountStatus.setAccountStatus(io, web.user.id, status);
    await dropped; // the live socket is closed by the server

    const code = { suspended: "account_suspended", banned: "account_banned", deleted: "account_closed" }[status];
    // existing tokens / cookies stop working on every route, including account routes
    for (const [client, label] of [[m.c, "native token"], [web.c, "web cookie"]]) {
      let first = true;
      for (const path of ["/api/auth/me", "/api/profiles/discovery", "/api/onboarding", "/api/matches"]) {
        const r = await client.call("GET", path);
        assert.equal(r.status, 401, `${status} ${label} ${path}`);
        // The server clears a rejected web cookie, so only the first web request still carries a credential.
        if (label === "native token" || first) assert.equal(r.data.code, code, `${status} ${label} ${path}`);
        first = false;
      }
      assert.equal((await client.call("POST", "/api/auth/socket-ticket")).status, 401);
      assert.equal((await client.call("POST", "/api/images", { data: PNG_1PX.toString("base64") })).status, 401);
    }
    // no new session: correct password -> 403 with the reason; wrong password -> the usual generic 401
    const login = await new WebClient().call("POST", "/api/auth/login", { email: m.email, password: PASSWORD });
    assert.equal(login.status, 403);
    assert.equal(login.data.code, code);
    assert.equal(login.data.token, undefined);
    assert.equal((await new WebClient().call("POST", "/api/auth/login", { email: m.email, password: "Wrong#Pass1234" })).data.code, "invalid_credentials");
    // no new socket, neither with the old token nor with a ticket issued before the change
    await assert.rejects(nativeSocket(m.c), /invalid or expired/);
    await assert.rejects(openSocket({ ticket }), /invalid or expired/);
  }
});

test("a suspension that has ended no longer blocks the member; reinstating works with a fresh sign-in", async () => {
  const m = await signUpNative("susp-end");
  await accountStatus.setAccountStatus(io, m.user.id, "suspended", { suspendedUntil: new Date(Date.now() + 3600_000) });
  assert.equal((await new NativeClient().call("POST", "/api/auth/login", { email: m.email, password: PASSWORD })).data.code, "account_suspended");
  await db.query("UPDATE profiles SET suspended_until = NOW() - INTERVAL '1 minute' WHERE id = $1", [m.user.id]);
  const login = await new NativeClient().call("POST", "/api/auth/login", { email: m.email, password: PASSWORD });
  assert.equal(login.status, 200, "the suspension period is over");
  assert.equal(login.data.user.eligibility.eligible, true);
  const viewer = await signUpWeb("susp-end-viewer");
  assert.ok((await viewer.c.call("GET", "/api/profiles/discovery?limit=50")).data.some((p) => p.id === m.user.id));

  // an indefinite suspension, then reinstatement: old tokens stay dead, a new sign-in works
  await accountStatus.setAccountStatus(io, m.user.id, "suspended");
  await accountStatus.setAccountStatus(io, m.user.id, "active");
  assert.equal((await m.c.call("GET", "/api/auth/me")).status, 401, "the earlier token was revoked for good");
  assert.equal((await new NativeClient().call("POST", "/api/auth/login", { email: m.email, password: PASSWORD })).status, 200);
});

test("a member who asked for deletion can sign in (to cancel) but is not eligible for anything", async () => {
  const m = await signUpNative("pend-del");
  await accountStatus.setAccountStatus(io, m.user.id, "pending_deletion");
  const login = await new NativeClient().call("POST", "/api/auth/login", { email: m.email, password: PASSWORD });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user.eligibility.reasons.includes("account_closing"), true);
  const c = new NativeClient();
  c.token = login.data.token;
  await expectClosed(c, "account_closing");
  await assert.rejects(nativeSocket(c), /not_eligible/);
});

test("sockets: an ineligible member is refused, and a ticket cannot outlive a status change", async () => {
  const incomplete = await signUpWeb("sock-incomplete", { eligible: false });
  assert.equal((await incomplete.c.call("POST", "/api/auth/socket-ticket")).status, 403);
  await assert.rejects(nativeSocket((await signUpNative("sock-incomplete2", { eligible: false })).c), /not_eligible/);

  const ok = await signUpWeb("sock-ok");
  const socket = await webSocket(ok.c);
  socket.close();
  const ticket = (await ok.c.call("POST", "/api/auth/socket-ticket")).data.ticket;
  await accountStatus.setAccountStatus(io, ok.user.id, "banned");
  await assert.rejects(openSocket({ ticket }), /invalid or expired/);
});

test("demo accounts stay usable members when the demo is on (they are finished, verified and active)", async () => {
  const phone = new NativeClient();
  const login = await phone.call("POST", "/api/auth/demo", { persona: "elena" });
  assert.equal(login.status, 200);
  phone.token = login.data.token;
  assert.equal(login.data.user.eligibility.eligible, true);
  assert.equal((await phone.call("GET", "/api/profiles/discovery")).status, 200);
  assert.equal((await phone.call("GET", "/api/matches")).status, 200);
  const socket = await nativeSocket(phone);
  socket.close();
});

// ---- Google OAuth: state, PKCE, one-time code exchange ---------------------------------------------

test("google sign-in: secure state and PKCE, a one-time code in the redirect (never a token), single-use exchange", async () => {
  const oauth = require("../oauth");
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  let google = { email: "", verified: true, name: "Gina Google", tokenOk: true };
  const providerCalls = [];
  oauth.setHttpClient(async (url, init) => {
    providerCalls.push({ url, body: init?.body });
    if (url.includes("oauth2.googleapis.com/token")) return { ok: google.tokenOk, json: async () => (google.tokenOk ? { access_token: "at" } : { error: "invalid_grant" }) };
    return { ok: true, json: async () => ({ email: google.email, email_verified: google.verified, name: google.name }) };
  });
  const verifierOf = () => crypto.randomBytes(48).toString("base64url");
  const APP = "dateza://auth-callback";
  const start = async (redirect = APP, challenge) => new WebClient().call("GET", `/api/auth/google/url?redirect_uri=${encodeURIComponent(redirect)}${challenge ? `&code_challenge=${challenge}` : ""}`);
  const callback = (qs) => fetch(`${base}/api/auth/google/callback?${qs}`, { redirect: "manual" });
  const stateOf = (url) => new URL(url).searchParams.get("state");
  const codeFrom = (res) => new URL(res.headers.get("location")).searchParams;

  try {
    // ---- start: validation
    const v = verifierOf();
    const challenge = oauth.s256(v);
    for (const redirect of ["https://evil.example/auth-callback", "dateza://evil", "javascript:alert(1)", "https://app.example.test/auth-callback?x=1", "http://localhost:8081/other"]) {
      const r = await start(redirect, challenge);
      assert.equal(r.status, 400, redirect);
      assert.equal(r.data.code, "redirect_not_allowed");
    }
    assert.equal((await start(APP)).data.code, "pkce_required", "no challenge");
    assert.equal((await start(APP, "short")).data.code, "pkce_required");
    assert.equal((await new WebClient().call("GET", `/api/auth/google/url?redirect_uri=${encodeURIComponent(APP)}&code_challenge=${challenge}&code_challenge_method=plain`)).data.code, "pkce_required");

    // ---- start: success. State is random, only its hash is stored, PKCE is used towards Google too.
    const started = await start(APP, challenge);
    assert.equal(started.status, 200);
    const url = new URL(started.data.url);
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    const state = url.searchParams.get("state");
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.match(url.searchParams.get("redirect_uri"), /\/api\/auth\/google\/callback$/);
    assert.ok(!JSON.stringify(started.data).includes("token"), "no token anywhere in the start response");
    const tx = (await db.query("SELECT * FROM oauth_transactions WHERE state_hash = $1", [sha256Hex(state)])).rows[0];
    assert.ok(tx, "the transaction is stored by the hash of the state");
    assert.equal(tx.redirect_uri, APP);
    assert.equal(tx.client_challenge, challenge);
    assert.equal(oauth.s256(tx.provider_verifier), url.searchParams.get("code_challenge"), "our own PKCE verifier for the Google leg");
    assert.ok(!JSON.stringify(tx).includes(state), "the raw state is not stored");
    const second = await start(APP, challenge);
    assert.notEqual(stateOf(second.data.url), state, "a fresh random state every time");

    // ---- callback: bad states never reach Google and never redirect
    const before = providerCalls.length;
    for (const qs of ["code=abc", "code=abc&state=short", `code=abc&state=${"A".repeat(43)}`, `code=abc&state=${"x".repeat(200)}`]) {
      assert.equal((await callback(qs)).status, 400, qs);
    }
    assert.equal(providerCalls.length, before, "Google was not contacted");
    await db.query("UPDATE oauth_transactions SET expires_at = NOW() - INTERVAL '1 minute' WHERE state_hash = $1", [sha256Hex(stateOf(second.data.url))]);
    assert.equal((await callback(`code=abc&state=${stateOf(second.data.url)}`)).status, 400, "expired state");

    // ---- callback: success. Only a one-time code is redirected.
    google.email = email("google-new");
    const ok = await callback(`code=google-auth-code&state=${state}`);
    assert.equal(ok.status, 302);
    const location = ok.headers.get("location");
    assert.ok(location.startsWith("dateza://auth-callback?code="), location);
    const params = codeFrom(ok);
    assert.deepEqual([...params.keys()], ["code"], "nothing but the code is in the URL");
    assert.ok(!/token|user|email|jwt|eyJ/i.test(location), "no token, user or e-mail in the redirect URL");
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
    assert.equal(await ok.text(), "", "no body with secrets");
    const exchangeCode = params.get("code");
    assert.match(exchangeCode, /^[A-Za-z0-9_-]{43}$/);
    const tokenCall = providerCalls.find((c) => c.url.includes("oauth2.googleapis.com/token"));
    assert.equal(tokenCall.body.get("code_verifier"), tx.provider_verifier, "PKCE verifier sent to Google");
    const stored = (await db.query("SELECT * FROM oauth_exchange_codes WHERE code_hash = $1", [sha256Hex(exchangeCode)])).rows[0];
    assert.ok(stored && !JSON.stringify(stored).includes(exchangeCode), "only the hash of the code is stored");
    assert.ok(Date.parse(stored.expires_at) - Date.now() <= 60_000 + 2000, "valid for about a minute");

    // ---- the state is single use
    assert.equal((await callback(`code=google-auth-code&state=${state}`)).status, 400, "replayed state");

    // ---- exchange: wrong / missing / malformed verifiers do not consume the code
    const native = new NativeClient();
    for (const body of [{}, { code: exchangeCode }, { code: exchangeCode, code_verifier: "short" }, { code: exchangeCode, code_verifier: verifierOf() }, { code: "x", code_verifier: v }, { code: "A".repeat(43), code_verifier: v }, { code: { $ne: 1 }, code_verifier: v }]) {
      const r = await native.call("POST", "/api/auth/oauth/exchange", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.data.code, "invalid_code");
      assert.equal(r.data.token, undefined);
    }
    // ---- exchange: success returns the session (native: token in the body)
    const exchanged = await native.call("POST", "/api/auth/oauth/exchange", { code: exchangeCode, code_verifier: v });
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.data));
    assert.ok(exchanged.data.token);
    assert.equal(exchanged.data.user.email, google.email.toLowerCase());
    assert.equal(exchanged.data.user.password, undefined);
    assert.equal(exchanged.data.user.token_version, undefined);
    assert.equal(exchanged.data.user.email_verified, true, "Google vouched for the address");
    assert.equal(exchanged.data.user.eligibility.eligible, false, "still has to onboard: date of birth, consent, photo ...");
    native.token = exchanged.data.token;
    assert.equal((await native.call("GET", "/api/auth/me")).status, 200);
    await expectClosed(native, "birthdate_required");
    const onboarding = (await native.call("GET", "/api/onboarding")).data;
    assert.equal(onboarding.next_step, "consent", "a Google sign-up accepts the policies in onboarding");
    assert.equal(onboarding.profile.birthdate, null, "no date of birth is invented");
    // ---- the code works once
    assert.equal((await new NativeClient().call("POST", "/api/auth/oauth/exchange", { code: exchangeCode, code_verifier: v })).status, 400, "replayed code");

    // ---- an expired code
    const s3 = await start(APP, challenge);
    await callback(`code=c&state=${stateOf(s3.data.url)}`).then(async (r) => {
      const c3 = codeFrom(r).get("code");
      await db.query("UPDATE oauth_exchange_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE code_hash = $1", [sha256Hex(c3)]);
      assert.equal((await new NativeClient().call("POST", "/api/auth/oauth/exchange", { code: c3, code_verifier: v })).status, 400, "expired code");
    });

    // ---- web: the exchange sets an HttpOnly cookie and returns no token; a web code is refused for a native client
    const wv = verifierOf();
    const webStart = await start("https://app.example.test/auth-callback", oauth.s256(wv));
    assert.equal(webStart.status, 200);
    const wcb = await callback(`code=c&state=${stateOf(webStart.data.url)}`);
    assert.ok(wcb.headers.get("location").startsWith("https://app.example.test/auth-callback?code="));
    const wcode = codeFrom(wcb).get("code");
    assert.equal((await new NativeClient().call("POST", "/api/auth/oauth/exchange", { code: wcode, code_verifier: wv })).data.code, "platform_mismatch");
    const web = new WebClient();
    const wex = await web.call("POST", "/api/auth/oauth/exchange", { code: wcode, code_verifier: wv });
    assert.equal(wex.status, 200);
    assert.equal(wex.data.token, undefined, "web never gets the token in JSON");
    assert.match(wex.headers.get("set-cookie"), /HttpOnly/i);
    assert.equal((await web.call("GET", "/api/auth/me")).status, 200);

    // ---- Google problems: unverified e-mail, provider failure, user cancelled -> redirect with an error, no code
    const errorOf = async (qsExtra, mutate) => {
      mutate?.();
      const st = await start(APP, challenge);
      const r = await callback(`${qsExtra}&state=${stateOf(st.data.url)}`);
      assert.equal(r.status, 302);
      const p = codeFrom(r);
      assert.equal(p.get("code"), null, "no code on failure");
      return p.get("error");
    };
    google = { email: email("google-unverified"), verified: false, name: "X", tokenOk: true };
    assert.equal(await errorOf("code=c"), "sign_in_failed", "unverified Google e-mail");
    assert.equal(await db.query("SELECT 1 FROM profiles WHERE email = $1", [google.email.toLowerCase()]).then((r) => r.rows.length), 0, "no account is created");
    google = { email: email("google-fail"), verified: true, name: "X", tokenOk: false };
    assert.equal(await errorOf("code=c"), "sign_in_failed", "token exchange failed");
    assert.equal(await errorOf("error=access_denied"), "access_denied");

    // ---- linking: a VERIFIED existing account is signed in as itself, its password untouched
    const verified = await signUpNative("google-link-verified");
    google = { email: verified.email, verified: true, name: "Gina", tokenOk: true };
    const lv = verifierOf();
    const lst = await start(APP, oauth.s256(lv));
    const lcode = codeFrom(await callback(`code=c&state=${stateOf(lst.data.url)}`)).get("code");
    const lex = await new NativeClient().call("POST", "/api/auth/oauth/exchange", { code: lcode, code_verifier: lv });
    assert.equal(lex.data.user.id, verified.user.id);
    assert.equal((await new WebClient().call("POST", "/api/auth/login", { email: verified.email, password: PASSWORD })).status, 200, "password still works");
    assert.equal((await verified.c.call("GET", "/api/auth/me")).status, 200, "its other sessions stay valid");

    // ---- pre-registration hijack: an UNVERIFIED account with that e-mail loses its password and sessions
    const squatted = await signUpNative("google-link-squat", { eligible: false });
    google = { email: squatted.email, verified: true, name: "Real Owner", tokenOk: true };
    const sv = verifierOf();
    const sst = await start(APP, oauth.s256(sv));
    const scode = codeFrom(await callback(`code=c&state=${stateOf(sst.data.url)}`)).get("code");
    const sex = await new NativeClient().call("POST", "/api/auth/oauth/exchange", { code: scode, code_verifier: sv });
    assert.equal(sex.status, 200);
    assert.equal(sex.data.user.email_verified, true);
    assert.equal((await new WebClient().call("POST", "/api/auth/login", { email: squatted.email, password: PASSWORD })).status, 401, "the squatter's password is gone");
    assert.equal((await squatted.c.call("GET", "/api/auth/me")).status, 401, "the squatter's session is gone");

    // ---- a suspended account cannot sign in through Google either
    await accountStatus.setAccountStatus(io, verified.user.id, "suspended");
    google = { email: verified.email, verified: true, name: "Gina", tokenOk: true };
    assert.equal(await errorOf("code=c"), "account_suspended");

    // ---- concurrency: one state / one code can be used by exactly ONE of two simultaneous requests
    google = { email: email("google-race"), verified: true, name: "Race", tokenOk: true };
    const rv = verifierOf();
    const rst = await start(APP, oauth.s256(rv));
    const [cb1, cb2] = await Promise.all([callback(`code=c&state=${stateOf(rst.data.url)}`), callback(`code=c&state=${stateOf(rst.data.url)}`)]);
    assert.deepEqual([cb1.status, cb2.status].sort(), [302, 400], "a state works once even when used twice at the same moment");
    const rcode = codeFrom(cb1.status === 302 ? cb1 : cb2).get("code");
    const [x1, x2] = await Promise.all([1, 2].map(() => new NativeClient().call("POST", "/api/auth/oauth/exchange", { code: rcode, code_verifier: rv })));
    assert.deepEqual([x1.status, x2.status].sort(), [200, 400], "a code works once even when exchanged twice at the same moment");

    // ---- Google must say `true` (boolean): the string "true" is not accepted
    google = { email: email("google-strtrue"), verified: "true", name: "Str", tokenOk: true };
    assert.equal(await errorOf("code=c"), "sign_in_failed");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM profiles WHERE email = $1", [google.email.toLowerCase()])).rows[0].n, 0);
    google = { email: verified.email, verified: true, name: "Gina", tokenOk: true };

    // ---- the development account chooser is not available here
    assert.equal((await new WebClient().call("GET", `/api/auth/google/mock-login?state=${state}`)).status, 404);
  } finally {
    oauth.setHttpClient((url, init) => fetch(url, init));
    for (const [k, v] of [["GOOGLE_CLIENT_ID", saved.id], ["GOOGLE_CLIENT_SECRET", saved.secret]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("passwords are checked by the server: reset and change use the same strength rule", async () => {
  const { c, email: e, user } = await signUpNative("pw-rule");
  const weak = await c.call("POST", "/api/auth/change-password", { current_password: PASSWORD, new_password: "alllowercase1!" });
  assert.equal(weak.status, 400);
  const web = new WebClient();
  await db.query("UPDATE auth_codes SET created_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1", [user.id]);
  const { code } = await accountSecurity.issueCode(user.id, "password_reset");
  const r = await web.call("POST", "/api/auth/password-reset/confirm", { email: e, code, new_password: "nouppercase1!" });
  assert.equal(r.status, 400);
});

// ---- review checks: SQL and JS agree on adulthood; upgrading a pre-Phase-1 database loses nothing ---------

test("the SQL adulthood rule and age.js agree for every shared date-of-birth vector (leap days, birthdays, time zone edge)", async () => {
  const vectors = require("./fixtures/age-vectors.json").cases;
  let compared = 0;
  for (const c of vectors) {
    // Compare only vectors both rules express: valid dates that are ok, underage or in the future.
    // (age.js additionally rejects an age over 120, which SQL leaves to the registration rules.)
    if (!(c.ok || c.code === "underage" || c.code === "future")) continue;
    const today = c.now.slice(0, 10);
    const r = await db.query(`SELECT ($1::date <= ${require("../eligibility").adultCutoffSql("$2::date")}) AS adult`, [c.dob, today]);
    assert.equal(r.rows[0].adult, c.ok, `${c.dob} on ${today} (${c.note || ""})`);
    compared++;
  }
  assert.ok(compared >= 20, "enough vectors compared: " + compared);
});

test("migrations 006 and 007 upgrade a pre-Phase-1 database without changing or losing a single existing row", async () => {
  await withScratchDatabase(async ({ pool, dir, databaseUrl }) => {
    // The schema exactly as before Phase 1: base schema + migrations 001-003.
    await pool.query(fs.readFileSync(path.join(__dirname, "../db_init.sql"), "utf8"));
    for (const f of ["001_indexes_and_constraints.sql", "002_account_security.sql", "003_ephemeral_media.sql"]) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    }
    const env = { NODE_ENV: "test" };
    assert.deepEqual(await db.runMigrations({ dir, targetPool: pool, databaseUrl, env }), [
      "001_indexes_and_constraints.sql", "002_account_security.sql", "003_ephemeral_media.sql",
    ]);
    // Also pretend the retired destructive cleanups were applied here once (older databases recorded them).
    await pool.query("INSERT INTO schema_migrations (name) VALUES ('004_remove_requested_mock_profiles.sql'), ('005_remove_additional_mock_profiles.sql')");

    // Realistic legacy data: invented onboarding values, a match with messages, swipes, an image, auth codes.
    const hash = "$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123";
    for (const [id, name, bd] of [["usr_old_a", "Old A", "1999-01-01"], ["usr_old_b", "Old B", "1985-12-31"], ["usr_old_c", "Old C", null]]) {
      await pool.query(
        `INSERT INTO profiles (id, email, password, name, birthdate, gender, looking_for, bio, height_cm, interests, photos, lat, lng, is_online)
         VALUES ($1, $2, $3, $4, $5, 'male', 'female', 'Just finished setting up my Dateza profile! Let''s connect.', 175,
                 ARRAY['Music','Coffee','Design','Tacos'], ARRAY['https://images.unsplash.com/photo-stock'], 6.9, 79.8, false)`,
        [id, `${id}@example.com`, hash, name, bd]
      );
    }
    const img = crypto.randomUUID();
    await pool.query("INSERT INTO images (id, owner_id, content_type, data, bytes) VALUES ($1, 'usr_old_a', 'image/png', $2, $3)", [img, PNG_1PX, PNG_1PX.length]);
    await pool.query("INSERT INTO swipes (swiper_id, swipee_id, direction, message) VALUES ('usr_old_a', 'usr_old_b', 'like', 'hi'), ('usr_old_b', 'usr_old_a', 'like', NULL), ('usr_old_c', 'usr_old_a', 'pass', NULL)");
    await pool.query("INSERT INTO matches (id, user_a, user_b, expires_at) VALUES ('match_old', 'usr_old_a', 'usr_old_b', NOW() + INTERVAL '1 day')");
    await pool.query("INSERT INTO messages (match_id, sender_id, body) VALUES ('match_old', 'usr_old_a', 'hello'), ('match_old', 'usr_old_b', 'hi there')");
    await pool.query("INSERT INTO match_reads (match_id, user_id, last_read_message_id) VALUES ('match_old', 'usr_old_a', 1)");
    await pool.query("UPDATE profiles SET email_verified_at = NOW() WHERE id = 'usr_old_a'");
    await pool.query("INSERT INTO auth_codes (id, user_id, purpose, code_hash, expires_at) VALUES ($1, 'usr_old_b', 'verify_email', 'x', NOW() + INTERVAL '5 minutes')", [crypto.randomUUID()]);

    const tables = ["profiles", "swipes", "matches", "messages", "match_reads", "images", "auth_codes", "ephemeral_media", "stories"];
    const snapshot = async () => {
      const out = {};
      for (const t of tables) out[t] = (await pool.query(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows;
      return out;
    };
    const before = await snapshot();
    const countBefore = Object.fromEntries(tables.map((t) => [t, before[t].length]));
    assert.ok(before.profiles.length === 3 && before.messages.length === 2 && before.swipes.length === 3, "the fixture data is in place");

    // The upgrade: only 006 and 007 are pending; the retired 004/005 rows cause no error and no warning-induced failure.
    const applied = await db.runMigrations({ dir: MIGRATIONS_DIR, targetPool: pool, databaseUrl, env });
    assert.deepEqual(applied, ["006_account_state.sql", "007_consents_oauth.sql"]);
    assert.deepEqual(await db.runMigrations({ dir: MIGRATIONS_DIR, targetPool: pool, databaseUrl, env }), [], "re-running changes nothing");

    const after = await snapshot();
    for (const t of tables) {
      assert.equal(after[t].length, countBefore[t], `${t}: same number of rows`);
      after[t].forEach((row, i) => {
        // every pre-existing column of every pre-existing row is byte-for-byte unchanged
        const old = before[t][i];
        const projected = Object.fromEntries(Object.keys(old).map((k) => [k, row[k]]));
        assert.deepEqual(projected, old, `${t} row ${i} unchanged`);
      });
    }
    // The new columns start neutral: nobody is completed, verified-by-migration, restricted or invented.
    for (const row of after.profiles) {
      assert.equal(row.status, "active");
      assert.equal(row.profile_completed_at, null);
      assert.deepEqual(row.onboarding_done, []);
      assert.equal(row.suspended_until, null);
      assert.equal(row.relationship_intention, null);
    }
    assert.ok(after.profiles.find((p) => p.id === "usr_old_a").email_verified_at, "an existing verification is kept");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_preferences")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM privacy_consents")).rows[0].n, 0, "nobody is recorded as having accepted anything they did not");
    // The new constraints apply to new data only.
    await assert.rejects(pool.query("UPDATE profiles SET status = 'vip' WHERE id = 'usr_old_a'"), /profiles_status_check/);
    await assert.rejects(pool.query("UPDATE profiles SET birthdate = '1800-01-01' WHERE id = 'usr_old_b'"), /profiles_birthdate_range/);
    await pool.query("UPDATE profiles SET bio = 'edited' WHERE id = 'usr_old_c'"); // ordinary updates keep working
    // The recorded history lists exactly the applied files plus the retired names, in order.
    assert.deepEqual(
      (await pool.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name),
      ["001_indexes_and_constraints.sql", "002_account_security.sql", "003_ephemeral_media.sql", "004_remove_requested_mock_profiles.sql", "005_remove_additional_mock_profiles.sql", "006_account_state.sql", "007_consents_oauth.sql"]
    );
  });
});

// ---- migrations ----------------------------------------------------------------------
// The expected list comes from the migrations directory, so adding a migration never needs
// an edit here. Tests that apply deliberately broken or destructive files use a SCRATCH
// database (created and dropped on the same local test cluster), never the main test database.

const MIGRATIONS_DIR = path.join(__dirname, "../migrations");
const expectedMigrations = () => dbSafety.orderMigrationFiles(fs.readdirSync(MIGRATIONS_DIR));

async function withScratchDatabase(fn) {
  const name = `dateza_scratch_${crypto.randomBytes(5).toString("hex")}`;
  const scratchUrl = new URL(url);
  assert.ok(dbSafety.isLocalDatabase(scratchUrl.href), "scratch databases are created on a local cluster only");
  await db.query(`CREATE DATABASE ${name}`);
  scratchUrl.pathname = `/${name}`;
  const scratchPool = new Pool({ connectionString: scratchUrl.href, max: 2 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dateza-migrations-"));
  try {
    return await fn({ pool: scratchPool, dir: tmp, databaseUrl: scratchUrl.href });
  } finally {
    await scratchPool.end();
    fs.rmSync(tmp, { recursive: true, force: true });
    await db.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
}
const writeMigration = (dir, name, sql) => fs.writeFileSync(path.join(dir, name), sql);
const recordedIn = async (pool) => (await pool.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name);

test("every migration file is recorded exactly once, in order, and re-running initialisation does not duplicate them", async () => {
  await db.initDb();
  await db.initDb();
  // A reused local test database may still hold the retired 004/005 rows from before they were archived; ignore only those.
  const { rows: all } = await db.query("SELECT name, applied_at FROM schema_migrations ORDER BY name");
  const rows = all.filter((r) => !dbSafety.RETIRED_MIGRATION_NAMES.has(r.name));
  assert.deepEqual(rows.map((r) => r.name), expectedMigrations(), "recorded names equal the files on disk, no extras, no repeats");
  const byTime = [...rows].sort((a, b) => a.applied_at - b.applied_at || a.name.localeCompare(b.name)).map((r) => r.name);
  assert.deepEqual(byTime, expectedMigrations(), "applied in numeric order");
  const again = await db.runMigrations();
  assert.deepEqual(again, [], "a second run applies nothing");
});

test("a failing migration rolls back completely and is not recorded as applied", async () => {
  await withScratchDatabase(async ({ pool, dir, databaseUrl }) => {
    writeMigration(dir, "001_ok.sql", "CREATE TABLE ok_one (id int);");
    writeMigration(dir, "002_broken.sql", "CREATE TABLE half_done (id int); SELECT * FROM table_that_does_not_exist;");
    writeMigration(dir, "003_after.sql", "CREATE TABLE never_reached (id int);");
    await assert.rejects(db.runMigrations({ dir, targetPool: pool, databaseUrl, env: { NODE_ENV: "test" } }), /table_that_does_not_exist/);
    assert.deepEqual(await recordedIn(pool), ["001_ok.sql"], "only the migration that succeeded is recorded");
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => r.tablename);
    assert.ok(tables.includes("ok_one"));
    assert.ok(!tables.includes("half_done"), "statements before the failure were rolled back");
    assert.ok(!tables.includes("never_reached"), "later migrations were not attempted");

    // After the file is corrected the same run continues from where it stopped.
    writeMigration(dir, "002_broken.sql", "CREATE TABLE half_done (id int);");
    assert.deepEqual(await db.runMigrations({ dir, targetPool: pool, databaseUrl, env: { NODE_ENV: "test" } }), ["002_broken.sql", "003_after.sql"]);
    assert.deepEqual(await recordedIn(pool), ["001_ok.sql", "002_broken.sql", "003_after.sql"]);
  });
});

test("a destructive migration is refused on a non-local or production target, before anything is applied", async () => {
  await withScratchDatabase(async ({ pool, dir, databaseUrl }) => {
    writeMigration(dir, "001_safe.sql", "CREATE TABLE victims (id int); INSERT INTO victims VALUES (1);");
    writeMigration(dir, "002_cleanup.sql", "DELETE FROM victims;");
    const remote = "postgresql://user:pw@ep-example.neon.tech/db";
    await assert.rejects(db.runMigrations({ dir, targetPool: pool, databaseUrl: remote, env: { NODE_ENV: "development" } }), dbSafety.MigrationSafetyError);
    await assert.rejects(db.runMigrations({ dir, targetPool: pool, databaseUrl, env: { NODE_ENV: "production" } }), dbSafety.MigrationSafetyError);
    assert.deepEqual(await recordedIn(pool), [], "nothing was applied, not even the safe file before the destructive one");
    assert.equal((await pool.query("SELECT to_regclass('public.victims') AS t")).rows[0].t, null);

    // A local, non-production database may run it (destructive cleanups are no longer in migrations/, but the rule still applies to any future reviewed one).
    assert.deepEqual(await db.runMigrations({ dir, targetPool: pool, databaseUrl, env: { NODE_ENV: "development" } }), ["001_safe.sql", "002_cleanup.sql"]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM victims")).rows[0].n, 0);
  });
});

test("migration files with duplicate numbers or bad names stop the runner before applying anything", async () => {
  await withScratchDatabase(async ({ pool, dir, databaseUrl }) => {
    writeMigration(dir, "001_a.sql", "CREATE TABLE dup_a (id int);");
    writeMigration(dir, "001_b.sql", "CREATE TABLE dup_b (id int);");
    await assert.rejects(db.runMigrations({ dir, targetPool: pool, databaseUrl, env: { NODE_ENV: "test" } }), /used by both/);
    assert.deepEqual(await recordedIn(pool), []);
  });
});

test("health endpoints", async () => {
  assert.equal((await new WebClient().call("GET", "/healthz")).status, 200);
  assert.equal((await new WebClient().call("GET", "/readyz")).status, 200);
});

void session;


// ---- expiring chat photos and statuses -------------------------------------------------
async function uploadMedia(client, bytes, purpose = "story", matchId) {
  return fetch(base + `/api/media?purpose=${purpose}${matchId ? `&matchId=${encodeURIComponent(matchId)}` : ""}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "dateza", Origin: ORIGIN,
      ...(client.cookie ? { Cookie: client.cookie } : {}), ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}) },
    body: bytes,
  });
}
const mediaHeaders = client => client.token ? { Authorization: `Bearer ${client.token}` } : { Cookie: client.cookie };

test("chat photo upload is private, shared by socket, idempotent, and unavailable at its 12-hour deadline", async () => {
  const { a, b, matchId } = await matchedPair();
  const stranger = await signUpNative("photo-stranger");
  const socket = await nativeSocket(b.c);
  try {
    assert.equal((await uploadMedia(stranger.c, PNG_1PX, "chat", matchId)).status, 403);
    const upload = await uploadMedia(a.c, PNG_1PX, "chat", matchId);
    assert.equal(upload.status, 201);
    const media = await upload.json();
    assert.ok(Math.abs(Date.parse(media.expires_at) - Date.now() - 12 * 3600000) < 10000);
    assert.equal((await fetch(base + media.url)).status, 401);
    assert.equal((await fetch(base + media.url, { headers: mediaHeaders(stranger.c) })).status, 404);
    const got = await fetch(base + media.url, { headers: mediaHeaders(b.c) });
    assert.equal(got.status, 200);
    assert.match(got.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG_1PX);
    const event = nextEvent(socket, "new_message");
    const body = { body: media.url, kind: "image", client_id: crypto.randomUUID() };
    const posted = await a.c.call("POST", `/api/matches/${matchId}/messages`, body);
    assert.equal(posted.status, 201);
    assert.equal((await event).kind, "image");
    assert.equal((await a.c.call("POST", `/api/matches/${matchId}/messages`, body)).status, 200);
    assert.equal(posted.data.expires_at, media.expires_at);
    await db.query("UPDATE ephemeral_media SET expires_at = NOW() WHERE id = $1", [media.id]);
    await db.query("UPDATE messages SET expires_at = NOW() WHERE id = $1", [posted.data.id]);
    assert.equal((await fetch(base + media.url, { headers: mediaHeaders(b.c) })).status, 404);
    assert.equal((await b.c.call("GET", `/api/matches/${matchId}/messages`)).data.length, 0);
    const conversations = await b.c.call("GET", "/api/matches/conversations");
    assert.equal(conversations.data.find(m => m.id === matchId).last_message, null);
    await require("../media").cleanupExpiredMedia(io);
    assert.equal((await db.query("SELECT id FROM ephemeral_media WHERE id = $1", [media.id])).rowCount, 0);
    assert.equal((await db.query("SELECT id FROM messages WHERE id = $1", [posted.data.id])).rowCount, 0);
  } finally { socket.disconnect(); }
});

test("status photos and video support shared feeds, byte ranges, ownership, and physical expiry", async () => {
  const a = await signUpWeb("status");
  const b = await signUpNative("status-reader");
  const video = Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from("ftypisom"), Buffer.alloc(4), Buffer.from("isommp42")]);
  for (const [bytes, type] of [[PNG_1PX, "image"], [video, "video"]]) {
    const uploaded = await uploadMedia(a.c, bytes);
    assert.equal(uploaded.status, 201);
    const media = await uploaded.json();
    const publish = await a.c.call("POST", "/api/stories", { media_id: media.id });
    assert.equal(publish.status, 201);
    assert.equal(publish.data.media_type, type);
    assert.equal((await a.c.call("POST", "/api/stories", { media_id: media.id })).status, 200);
    const feed = await b.c.call("GET", "/api/stories");
    assert.ok(feed.data.some(s => s.id === publish.data.id));
    assert.equal((await b.c.call("DELETE", `/api/stories/${publish.data.id}`)).status, 404);
    const range = await fetch(base + media.url, { headers: { ...mediaHeaders(b.c), Range: "bytes=0-7" } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0,8));
    assert.equal((await fetch(base + media.url, { headers: { ...mediaHeaders(b.c), Range: "bytes=99999-" } })).status, 416);
    await db.query("UPDATE ephemeral_media SET expires_at = NOW() WHERE id = $1", [media.id]);
    assert.equal((await fetch(base + media.url, { headers: mediaHeaders(b.c) })).status, 404);
    assert.ok(!(await b.c.call("GET", "/api/stories")).data.some(s => s.id === publish.data.id));
    await require("../media").cleanupExpiredMedia(io);
    assert.equal((await db.query("SELECT id FROM stories WHERE id = $1", [publish.data.id])).rowCount, 0);
  }
});

test("status owners can delete immediately; media upload rejects invalid types and oversized photos", async () => {
  const a = await signUpWeb("status-validation");
  assert.equal((await uploadMedia(a.c, Buffer.from("not media"))).status, 400);
  assert.equal((await uploadMedia(a.c, Buffer.concat([PNG_1PX, Buffer.alloc(5 * 1024 * 1024)]))).status, 413);
  const media = await (await uploadMedia(a.c, PNG_1PX)).json();
  const publish = await a.c.call("POST", "/api/stories", { media_id: media.id });
  assert.equal((await a.c.call("DELETE", `/api/stories/${publish.data.id}`)).status, 204);
  assert.equal((await fetch(base + media.url, { headers: mediaHeaders(a.c) })).status, 404);
});
