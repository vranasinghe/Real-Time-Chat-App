// End-to-end test for images stored in the database.
//
// Usage (backend must be running):
//   API_URL=http://localhost:5001 npm run test:images
//
// Creates a throwaway account (images-e2e-*@example.com); run it against a local
// or staging database, not production.

// Safety: these scripts create accounts and delete nothing, and API_URL may be a server
// connected to ANY database. Only run them against a disposable one, and say so:
//   E2E_CONFIRM_DISPOSABLE_DB=1 API_URL=http://localhost:5001 npm run test:chat
// (Prefer `npm run test:integration`, which starts its own app on a throwaway database.)
if (process.env.E2E_CONFIRM_DISPOSABLE_DB !== "1") {
  console.error("Refusing to run: set E2E_CONFIRM_DISPOSABLE_DB=1 to confirm the server uses a disposable database.");
  process.exit(1);
}

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const API = process.env.API_URL || "http://localhost:5001";
const RUN = Date.now().toString(36);

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

(async () => {
  console.log(`Images e2e against ${API}`);
  const reg = await api("POST", "/api/auth/register", null, {
    email: `images-e2e-${RUN}@example.com`,
    password: "ImgTest#" + crypto.randomBytes(4).toString("hex"),
    name: "Images E2E",
  });
  assert.equal(reg.status, 201);
  const token = reg.data.token;

  let uploaded;
  await check("upload a PNG (base64) and get a database image path back", async () => {
    const res = await api("POST", "/api/images", token, { data: PNG.toString("base64") });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.match(res.data.url, /^\/api\/images\/[0-9a-f-]{36}$/);
    uploaded = res.data;
  });

  await check("data: URL uploads work too", async () => {
    const res = await api("POST", "/api/images", token, { data: `data:image/png;base64,${PNG.toString("base64")}` });
    assert.equal(res.status, 201);
  });

  await check("image is served with the right type, bytes and cross-origin header", async () => {
    const res = await fetch(API + uploaded.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.match(res.headers.get("cache-control") || "", /immutable/);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PNG), "bytes round-trip");
  });

  await check("uploads require login", async () => {
    const res = await api("POST", "/api/images", null, { data: PNG.toString("base64") });
    assert.equal(res.status, 401);
  });

  await check("non-images, empty and oversized uploads are rejected", async () => {
    assert.equal((await api("POST", "/api/images", token, { data: Buffer.from("not an image").toString("base64") })).status, 400);
    assert.equal((await api("POST", "/api/images", token, { data: "" })).status, 400);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await api("POST", "/api/images", token, { data: big.toString("base64") })).status, 400);
  });

  await check("unknown or malformed image ids return 404", async () => {
    assert.equal((await fetch(`${API}/api/images/${crypto.randomUUID()}`)).status, 404);
    assert.equal((await fetch(`${API}/api/images/not-a-uuid`)).status, 404);
  });

  await check("profile photos are cleaned up on save", async () => {
    const res = await api("POST", "/api/auth/complete-setup", token, {
      birthdate: "1998-01-01",
      gender: "other",
      looking_for: "everyone",
      bio: "images test",
      photos: [
        `${API}${uploaded.url}`, // full URL to our image -> stored as relative path
        "blob:http://localhost:8082/1234", // device-only -> dropped
        "file:///data/user/0/photo.jpg", // device-only -> dropped
        "https://example.com/photo.jpg", // web URL -> kept
      ],
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.user.photos, [uploaded.url, "https://example.com/photo.jpg"]);
  });

  console.log(`\n${passed} checks passed`);
  process.exit(0);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
