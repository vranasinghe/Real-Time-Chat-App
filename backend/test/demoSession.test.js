// Database-free test: on web, live demo sessions are per tab (bearer token), never the shared
// cookie. With a cookie, signing in as Elena in a second tab turned the Alex tab into Elena, so
// "Alex" never received her messages.

process.env.JWT_SECRET = process.env.JWT_SECRET || "demo-session-test-secret-demo-session-test-123";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://nobody:nobody@127.0.0.1:1/none"; // never connected to
process.env.DEMO_LOGIN_ENABLED = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const db = require("../db");
const images = require("../images");
const config = require("../config");
const session = require("../session");

config.demoLoginEnabled = true;
images.storeImage = async () => ({ url: "/api/images/demo" });
db.query = async (sql, params) => {
  if (/SELECT \* FROM profiles WHERE id/.test(sql)) {
    return {
      rows: [{
        id: params[0], email: `${params[0]}@dateza.local`, password: "x", token_version: 0, is_demo: true,
        status: "active", birthdate: "1998-03-12", email_verified_at: new Date(), profile_completed_at: new Date(),
      }],
    };
  }
  return { rows: [] };
};
require("../showcaseProfiles").seedShowcaseProfiles = async () => {};
session.setUserLookup(async (id) => ({
  token_version: 0, is_demo: true, status: "active", birthdate: "1998-03-12",
  email_verified_at: new Date(), profile_completed_at: new Date(), id,
}));

const demo = require("../demo");
const auth = require("../auth");

function startApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth/demo", demo.router);
  app.use("/api/auth", auth.router);
  app.get("/whoami", session.authenticateToken, (req, res) => res.json({ id: req.user.id }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const webHeaders = { "Content-Type": "application/json", "X-Client-Platform": "web", "X-Requested-With": "dateza" };

test("web demo login returns a per-tab token and sets no shared cookie", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());

  const login = async (persona) => {
    const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: webHeaders, body: JSON.stringify({ persona }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("set-cookie"), null, "demo login must not overwrite the browser's shared cookie");
    const body = await r.json();
    assert.equal(typeof body.token, "string");
    assert.equal(body.user.password, undefined);
    return body.token;
  };
  const alex = await login("alex");
  const elena = await login("elena");

  // Same browser: whatever cookie is present, each tab's bearer token decides who it is.
  const elenaCookie = `${config.cookie.name}=${encodeURIComponent(elena)}`;
  const who = async (token) =>
    (await (await fetch(`${base}/whoami`, { headers: { Authorization: `Bearer ${token}`, Cookie: elenaCookie } })).json()).id;
  assert.equal(await who(alex), "demo-alex");
  assert.equal(await who(elena), "demo-elena");

  // Signing a demo tab out must not clear a real member's cookie in the same browser.
  const out = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...webHeaders, Authorization: `Bearer ${alex}` } });
  assert.equal(out.status, 200);
  assert.equal(out.headers.get("set-cookie"), null);
});

test("native demo login still returns a token", async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona: "elena" }) });
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json()).token, "string");
});
