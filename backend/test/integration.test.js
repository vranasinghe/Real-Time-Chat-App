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
process.env.API_RATE_LIMIT = "100000";
delete process.env.RENDER;
delete process.env.RESEND_API_KEY;

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

async function signUpWeb(label = "w") {
  const c = new WebClient();
  const e = email(label);
  const r = await c.call("POST", "/api/auth/register", { email: e, password: PASSWORD, name: `Web ${label}` });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { c, email: e, user: r.data.user };
}
async function signUpNative(label = "n") {
  const c = new NativeClient();
  const e = email(label);
  const r = await c.call("POST", "/api/auth/register", { email: e, password: PASSWORD, name: `Phone ${label}` });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.token = r.data.token;
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
  assert.equal((await c.call("POST", "/api/auth/register", { email: used, password: PASSWORD, name: "X" })).status, 409);
  assert.equal((await c.call("POST", "/api/auth/register", { email: "nope", password: PASSWORD, name: "X" })).status, 400);
  assert.equal((await c.call("POST", "/api/auth/register", { email: email("s"), password: "short", name: "X" })).status, 400);
  assert.equal((await c.call("POST", "/api/auth/register", { email: email("l"), password: "a".repeat(73), name: "X" })).status, 400);
  assert.equal((await c.call("POST", "/api/auth/register", { email: email("o"), password: { $ne: 1 }, name: "X" })).status, 400);
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
  const { c, user } = await signUpWeb("ev");
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
  const full = await c.call("POST", "/api/auth/complete-setup", {
    birthdate: "1995-05-05", gender: "female", looking_for: "male", bio: "Hello", height_cm: 170, interests: ["a", "b"],
  });
  assert.equal(full.status, 200);
  const photoOnly = await c.call("POST", "/api/auth/complete-setup", { photos: ["https://images.example.com/a.jpg", "blob:x", "file:///y"] });
  assert.equal(photoOnly.status, 200);
  assert.equal(photoOnly.data.user.bio, "Hello");
  assert.equal(photoOnly.data.user.gender, "female");
  assert.deepEqual(photoOnly.data.user.photos, ["https://images.example.com/a.jpg"]);
  assert.equal(photoOnly.data.user.password, undefined);

  assert.equal((await c.call("POST", "/api/auth/complete-setup", { name: "New Name" })).data.user.name, "New Name");
  assert.equal((await c.call("POST", "/api/auth/complete-setup", { birthdate: "2015-01-01" })).status, 400);
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
    await who.c.call("POST", "/api/auth/complete-setup", { birthdate: "1994-04-04", gender: g, looking_for: l });
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
  await c.call("POST", "/api/auth/complete-setup", { birthdate: "1990-01-01", gender: "male", looking_for: "everyone" });

  const demo = await new WebClient().call("POST", "/api/auth/demo", { persona: "alex" });
  assert.equal(demo.status, 200);
  assert.equal(demo.data.user.id, "demo-alex");

  const list = await c.call("GET", "/api/profiles/discovery?limit=100000");
  assert.equal(list.status, 200);
  assert.ok(list.data.length <= 50);
  assert.ok(!list.data.some((p) => p.id.startsWith("demo-")), "real users never see demo accounts");
});

test("migrations are recorded once and re-running initialisation is safe", async () => {
  await db.initDb();
  const { rows } = await db.query("SELECT name FROM schema_migrations ORDER BY name");
  assert.deepEqual(rows.map((r) => r.name), ["001_indexes_and_constraints.sql", "002_account_security.sql", "003_ephemeral_media.sql"]);
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
