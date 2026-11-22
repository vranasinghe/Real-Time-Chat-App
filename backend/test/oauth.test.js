// Database-free tests for the OAuth building blocks: the exact redirect allowlist and PKCE.
process.env.JWT_SECRET = process.env.JWT_SECRET || "oauth-test-secret-oauth-test-secret-123";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://nobody:nobody@127.0.0.1:1/none"; // never connected to
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRedirect, s256 } = require("../oauth");

const WEB = ["https://app.example.test"];
const prod = (uri) => checkRedirect(uri, { production: true, webOrigins: WEB });
const dev = (uri) => checkRedirect(uri, { production: false, webOrigins: WEB });

test("PKCE S256 matches the RFC 7636 example", () => {
  assert.equal(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("redirect allowlist: only the app's own callback is accepted in production", () => {
  assert.deepEqual(prod("dateza://auth-callback"), { ok: true, platform: "native", url: "dateza://auth-callback" });
  assert.deepEqual(prod("dateza://auth-callback/"), { ok: true, platform: "native", url: "dateza://auth-callback" });
  assert.equal(prod("https://app.example.test/auth-callback").ok, true);
  assert.equal(prod("https://app.example.test/auth-callback").platform, "web");
});

test("redirect allowlist: substitutions are rejected", () => {
  for (const uri of [
    "https://evil.example/auth-callback",                    // another site
    "https://app.example.test.evil.example/auth-callback",   // look-alike host
    "https://app.example.test@evil.example/auth-callback",   // credentials trick
    "https://user:pw@app.example.test/auth-callback",        // credentials
    "https://app.example.test/auth-callback?next=//evil",    // query string
    "https://app.example.test/auth-callback#frag",           // fragment
    "https://app.example.test/other",                        // wrong path
    "https://app.example.test/auth-callback/extra",
    "https://app.example.test/",
    "http://app.example.test/auth-callback",                 // wrong scheme for that origin (not configured)
    "dateza://evil",                                         // our scheme, wrong host
    "dateza://auth-callback/steal",                          // our scheme, extra path
    "dateza://auth-callback?x=1",
    "dateza://",
    "myapp://auth-callback",                                 // someone else's scheme
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "//evil.example/auth-callback",
    "http://localhost:8081/auth-callback",                   // localhost only outside production
    "http://127.0.0.1:8081/auth-callback",
    "exp://192.168.1.5:8081/--/auth-callback",               // Expo Go only outside production
    "", "   ", "not a url", null, undefined, 42, {}, [], "dateza://auth-callback" + "a".repeat(400),
  ]) {
    assert.equal(prod(uri).ok, false, String(uri).slice(0, 80));
  }
});

test("redirect allowlist: development additionally allows localhost web and Expo Go, still exactly", () => {
  assert.equal(dev("http://localhost:8081/auth-callback").ok, true);
  assert.equal(dev("http://127.0.0.1:19006/auth-callback").ok, true);
  assert.equal(dev("exp://192.168.1.5:8081/--/auth-callback").ok, true);
  assert.equal(dev("http://localhost:8081/other").ok, false);
  assert.equal(dev("http://localhost.evil.example/auth-callback").ok, false);
  assert.equal(dev("exp://192.168.1.5:8081/--/other").ok, false);
  assert.equal(dev("https://evil.example/auth-callback").ok, false);
});
