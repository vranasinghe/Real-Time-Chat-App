// Session / CSRF / socket-ticket tests. No database needed: the DB URL points at a
// closed port and none of these routes read from it. Run: npm run test:session

process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none"; // never connected to
process.env.CORS_ORIGIN = "https://app.example.test";
process.env.NODE_ENV = "test";
delete process.env.RENDER;

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { io: connect } = require("socket.io-client");

const { server, io } = require("../index");
const session = require("../session");
const config = require("../config");

// No database here: pretend every user exists with token_version 0
session.setUserLookup(async () => ({ token_version: 0 }));

let base;
test.before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => io.close(r));
});

const accessToken = (overrides = {}, opts = { expiresIn: "1h" }) =>
  jwt.sign({ id: "usr_test", email: "t@example.com", typ: "access", ...overrides }, config.jwtSecret, opts);

const call = (method, path, { headers = {}, body } = {}) =>
  fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

test("liveness works without the database; readiness reports it is down", async () => {
  assert.equal((await call("GET", "/healthz")).status, 200);
  assert.equal((await call("GET", "/readyz")).status, 503);
});

test("protected route without credentials is 401", async () => {
  const res = await call("GET", "/api/auth/me");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, "no_token");
});

test("expired token is 401 token_expired (not 403)", async () => {
  const expired = accessToken({}, { expiresIn: -10 });
  const res = await call("GET", "/api/auth/me", { headers: { Authorization: `Bearer ${expired}` } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, "token_expired");
});

test("token signed with another secret or algorithm is rejected", async () => {
  const forged = jwt.sign({ id: "usr_test" }, "other-secret", { expiresIn: "1h" });
  assert.equal((await call("GET", "/api/auth/me", { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
  const none = jwt.sign({ id: "usr_test" }, "", { algorithm: "none" });
  assert.equal((await call("GET", "/api/auth/me", { headers: { Authorization: `Bearer ${none}` } })).status, 401);
});

test("socket ticket cannot be used as an API token", async () => {
  const ticket = session.createSocketTicket("usr_test");
  const res = await call("GET", "/api/auth/me", { headers: { Authorization: `Bearer ${ticket}` } });
  assert.equal(res.status, 401);
});

test("cookie session: state-changing request needs the CSRF header and an allowed Origin", async () => {
  const cookie = `${config.cookie.name}=${accessToken()}`;
  const ok = { Cookie: cookie, "X-Requested-With": "dateza", Origin: "https://app.example.test" };

  assert.equal((await call("POST", "/api/auth/socket-ticket", { headers: { Cookie: cookie } })).status, 403, "no header");
  assert.equal(
    (await call("POST", "/api/auth/socket-ticket", { headers: { ...ok, Origin: "https://evil.example" } })).status,
    403,
    "bad origin"
  );
  const res = await call("POST", "/api/auth/socket-ticket", { headers: ok });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).ticket);
});

test("bearer (native) requests are not subject to the CSRF header", async () => {
  const res = await call("POST", "/api/auth/socket-ticket", { headers: { Authorization: `Bearer ${accessToken()}` } });
  assert.equal(res.status, 200);
});

test("logout clears the cookie", async () => {
  const res = await call("POST", "/api/auth/logout", {
    headers: { Cookie: `${config.cookie.name}=${accessToken()}`, "X-Requested-With": "dateza" },
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("set-cookie") || "";
  assert.match(setCookie, new RegExp(`${config.cookie.name}=;`));
  assert.match(setCookie, /HttpOnly/i);
});

test("unknown API route is a JSON 404 and bad JSON is a 400", async () => {
  assert.equal((await call("GET", "/api/nope")).status, 404);
  const bad = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(bad.status, 400);
});

const open = (auth, extra = {}) =>
  new Promise((resolve) => {
    const s = connect(base, { auth, reconnection: false, transports: ["websocket"], ...extra });
    s.on("connect", () => resolve({ s, ok: true }));
    s.on("connect_error", (e) => resolve({ s, ok: false, error: e.message }));
  });

test("socket: ticket works once, then is rejected (single use)", async () => {
  const ticket = session.createSocketTicket("usr_test");
  const first = await open({ ticket });
  assert.equal(first.ok, true);
  first.s.close();
  const second = await open({ ticket });
  assert.equal(second.ok, false);
  second.s.close();
});

test("socket: access token (native) works; missing/forged credentials are rejected", async () => {
  const good = await open({ token: accessToken() });
  assert.equal(good.ok, true);
  good.s.close();
  assert.equal((await open({})).ok, false);
  assert.equal((await open({ token: "garbage" })).ok, false);
  assert.equal((await open({ ticket: accessToken() })).ok, false, "access token is not a ticket");
});

test("socket: one user can hold several simultaneous connections", async () => {
  const a = await open({ ticket: session.createSocketTicket("usr_multi") });
  const b = await open({ token: accessToken({ id: "usr_multi" }) });
  assert.equal(a.ok && b.ok, true);
  const got = [a.s, b.s].map((s) => new Promise((r) => s.once("ping_test", r)));
  io.to("user:usr_multi").emit("ping_test", 1);
  await Promise.all(got);
  a.s.close();
  b.s.close();
});
