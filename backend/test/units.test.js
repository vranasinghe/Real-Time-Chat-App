// Database-free unit tests for input validation and image handling.
// Run: npm test

process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none"; // never connected to
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");

const swipes = require("../swipes");
const { detectImageType, MAX_IMAGE_BYTES } = require("../images");
const { normalizePhotoList } = require("../photoUtils");

test("validateSwipe accepts a normal like and trims the note", () => {
  const r = swipes.validateSwipe({ swipee_id: " usr_b ", direction: "like", message: "  hi  " }, "usr_a");
  assert.deepEqual(r, { swipeeId: "usr_b", direction: "like", message: "hi" });
});

test("validateSwipe rejects bad direction, self swipes, missing ids and long or non-text notes", () => {
  assert.match(swipes.validateSwipe({ swipee_id: "b", direction: "love" }, "a").error, /like, pass or super/);
  assert.match(swipes.validateSwipe({ swipee_id: "a", direction: "like" }, "a").error, /yourself/);
  assert.match(swipes.validateSwipe({ direction: "like" }, "a").error, /required/);
  assert.match(swipes.validateSwipe({ swipee_id: 5, direction: "like" }, "a").error, /required/);
  assert.match(swipes.validateSwipe({ swipee_id: "b", direction: "like", message: "x".repeat(501) }, "a").error, /500/);
  assert.match(swipes.validateSwipe({ swipee_id: "b", direction: "like", message: { a: 1 } }, "a").error, /text/);
});

test("detectImageType identifies formats from file bytes, not from claims", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "ascii")), "image/webp");
  assert.equal(detectImageType(Buffer.from("GIF89a....", "ascii")), "image/gif");
  assert.equal(detectImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null, "SVG is refused");
  assert.equal(detectImageType(Buffer.from("<?php echo 1; ?>")), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

test("image size limit is 5 MB", () => {
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
});

test("normalizePhotoList keeps own images and web URLs, drops device-only references", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const out = normalizePhotoList([
    `https://real-time-chat-app-qsrn.onrender.com/api/images/${id.toUpperCase()}`,
    `/api/images/${id}`,
    "https://images.example.com/a.jpg",
    "blob:http://localhost/abc",
    "file:///data/user/0/photo.jpg",
    "content://media/external/1",
    "data:image/png;base64,AAAA",
    "",
    42,
  ]);
  assert.deepEqual(out, [`/api/images/${id}`, `/api/images/${id}`, "https://images.example.com/a.jpg"]);
});

const auth = require("../auth");

test("validateProfileInput only returns the fields that were sent (so updates never wipe the rest)", () => {
  const r = auth.router.validateProfileInput({ photos: ["/api/images/123e4567-e89b-12d3-a456-426614174000"] });
  assert.deepEqual(Object.keys(r.fields), ["photos"]);
});

test("validateProfileInput rejects under-18, bad types and oversize values", () => {
  const v = (b) => auth.router.validateProfileInput(b).error;
  const young = new Date(); young.setFullYear(young.getFullYear() - 10);
  assert.match(v({ birthdate: young.toISOString().slice(0, 10) }), /18/);
  assert.match(v({ birthdate: "not a date" }), /valid date/);
  assert.match(v({ bio: "x".repeat(1001) }), /1000/);
  assert.match(v({ height_cm: "tall" }), /height/);
  assert.match(v({ interests: "music" }), /interests/);
  assert.match(v({ interests: Array(31).fill("a") }), /interests/);
  assert.match(v({ photos: Array(13).fill("/api/images/x") }), /photos/);
  assert.match(v({ name: "   " }), /name/);
  assert.match(v({ lat: 999 }), /lat/);
});
