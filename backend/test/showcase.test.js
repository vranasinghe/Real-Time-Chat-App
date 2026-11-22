// Showcase profiles are FICTIONAL, development/demo-only fixtures. These tests check the
// invariants that keep them consistent and isolated, not a fixed head-count: adding or
// removing a fixture must not require editing a literal number here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const profiles = require("../data/showcase-profiles.json");
const { seedShowcaseProfiles } = require("../showcaseProfiles");

const SERVER_PHOTOS = path.join(__dirname, "../public/profiles");
const APP_PHOTOS = path.join(__dirname, "../../mobile/assets/profiles");
const APP_CATALOG = path.join(APP_PHOTOS, "catalog.json");
const APP_LOADER = path.join(__dirname, "../../mobile/lib/showcaseProfiles.ts");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Photos that exist in backend/public/profiles but belong to no catalog entry. They are kept on
// purpose (not deleted without owner approval). The test below FAILS when an entry here stops
// being an orphan, or when a new, unlisted orphan appears, so this list cannot go stale.
// See docs/implementation/PHASE_00_COMPLETION_REPORT.md for the recommended resolution.
const KNOWN_ORPHAN_PHOTOS = ["tessa"];

// The owner asked for fixture members aged 24-34 when the catalog was written; measured at a
// fixed date so the assertion does not change as the calendar moves.
const FIXTURE_AGE_RANGE = { reference: "2026-11-22", min: 24, max: 34 };

const GENDERS = new Set(["male", "female"]);
const LOOKING_FOR = new Set(["male", "female", "everyone"]);

function realCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? d : null; // rejects 2000-02-30
}

function ageOn(dob, onIso) {
  const on = new Date(`${onIso}T00:00:00Z`);
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  if (on.getUTCMonth() < dob.getUTCMonth() || (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

test("catalog is non-empty, with unique keys and unique derived ids", () => {
  assert.ok(Array.isArray(profiles) && profiles.length > 0);
  for (const p of profiles) assert.match(p.key, /^[a-z]+$/, `key "${p.key}" is a plain lowercase word`);
  assert.equal(new Set(profiles.map((p) => p.key)).size, profiles.length, "keys are unique");
  assert.equal(new Set(profiles.map((p) => `seed-showcase-${p.key}`)).size, profiles.length, "database ids are unique");
  assert.equal(new Set(profiles.map((p) => p.name)).size, profiles.length, "display names are unique");
});

test("every fixture is a complete, valid adult with a real calendar birthdate", () => {
  const now = new Date();
  for (const p of profiles) {
    const dob = realCalendarDate(p.birthdate);
    assert.ok(dob, `${p.key}: birthdate "${p.birthdate}" is a real YYYY-MM-DD date`);
    const age = ageOn(dob, now.toISOString().slice(0, 10));
    assert.ok(age >= 18 && age <= 100, `${p.key}: is an adult today (age ${age})`);
    const ageThen = ageOn(dob, FIXTURE_AGE_RANGE.reference);
    assert.ok(ageThen >= FIXTURE_AGE_RANGE.min && ageThen <= FIXTURE_AGE_RANGE.max, `${p.key}: ${ageThen} is within the requested ${FIXTURE_AGE_RANGE.min}-${FIXTURE_AGE_RANGE.max}`);
    assert.ok(typeof p.name === "string" && p.name.trim().length > 0, `${p.key}: name`);
    assert.ok(GENDERS.has(p.gender), `${p.key}: gender`);
    assert.ok(LOOKING_FOR.has(p.looking_for), `${p.key}: looking_for`);
    assert.ok(typeof p.bio === "string" && p.bio.trim().length > 0 && p.bio.length <= 1000, `${p.key}: bio`);
    assert.ok(Number.isInteger(p.height_cm) && p.height_cm >= 120 && p.height_cm <= 230, `${p.key}: height`);
    assert.ok(Array.isArray(p.interests) && p.interests.length > 0 && p.interests.every((i) => typeof i === "string" && i.trim() && i.length <= 40), `${p.key}: interests`);
    assert.equal(typeof p.is_online, "boolean", `${p.key}: is_online`);
    assert.ok(Number.isInteger(p.match_percent) && p.match_percent >= 0 && p.match_percent <= 100, `${p.key}: match_percent is bounded`);
  }
});

test("server and app catalogs are identical", () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(APP_CATALOG, "utf8")), profiles);
});

test("every fixture has a valid PNG photo in the backend and in the app, and the files are identical", () => {
  for (const p of profiles) {
    const serverPhoto = fs.readFileSync(path.join(SERVER_PHOTOS, `${p.key}.png`));
    const appPhoto = fs.readFileSync(path.join(APP_PHOTOS, `${p.key}.png`));
    assert.ok(serverPhoto.length > 10000, `${p.key}: server photo is a real image, not a stub`);
    assert.ok(serverPhoto.subarray(0, 8).equals(PNG_SIGNATURE), `${p.key}: is a PNG by content`);
    assert.ok(serverPhoto.equals(appPhoto), `${p.key}: photo is identical in the backend and the app`);
  }
});

test("the app's static photo map covers exactly the catalog keys", () => {
  const source = fs.readFileSync(APP_LOADER, "utf8");
  const mapped = [...source.matchAll(/^\s*([a-z]+):\s*require\("\.\.\/assets\/profiles\/([a-z]+)\.png"\)/gm)].map((m) => {
    assert.equal(m[1], m[2], `photo map key "${m[1]}" points at ${m[2]}.png`);
    return m[1];
  });
  assert.deepEqual([...mapped].sort(), profiles.map((p) => p.key).sort());
});

test("photos without a catalog entry are only the documented, deliberately kept orphans", () => {
  const keys = new Set(profiles.map((p) => p.key));
  for (const [label, dir] of [["backend", SERVER_PHOTOS], ["app", APP_PHOTOS]]) {
    const orphans = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).filter((k) => !keys.has(k));
    for (const k of orphans) {
      assert.ok(KNOWN_ORPHAN_PHOTOS.includes(k), `${label}: ${k}.png is not in the catalog and not in KNOWN_ORPHAN_PHOTOS`);
    }
  }
  const backendFiles = new Set(fs.readdirSync(SERVER_PHOTOS));
  for (const k of KNOWN_ORPHAN_PHOTOS) {
    assert.ok(backendFiles.has(`${k}.png`), `${k}.png is listed as a known orphan but no longer exists: remove it from KNOWN_ORPHAN_PHOTOS`);
    assert.ok(!keys.has(k), `${k} is now in the catalog: remove it from KNOWN_ORPHAN_PHOTOS`);
  }
});

test("fixtures are isolated from real members: dedicated id, email domain and photo paths", async () => {
  const calls = [];
  await seedShowcaseProfiles(async (sql, params) => { calls.push({ sql, params }); });
  for (const { params } of calls) {
    assert.match(params[0], /^seed-showcase-[a-z]+$/, "id is in the dedicated fixture namespace");
    assert.match(params[1], /^[a-z]+\.showcase@dateza\.local$/, "email uses the reserved .local domain");
    assert.deepEqual(params[10].length, 1);
    assert.match(params[10][0], /^\/public\/profiles\/[a-z]+\.png$/, "photo is a bundled file, not a user upload or remote URL");
  }
  // The offline demo in the app uses a different namespace, so the two can never collide.
  assert.match(fs.readFileSync(APP_LOADER, "utf8"), /`demo-showcase-\$\{key\}`/);
});

test("seeding performs exactly one insert per fixture, never updates or deletes, and is idempotent", async () => {
  const run = async () => {
    const calls = [];
    await seedShowcaseProfiles(async (sql, params) => { calls.push({ sql, params }); });
    return calls;
  };
  const first = await run();
  assert.equal(first.length, profiles.length, "one statement per fixture");
  assert.deepEqual(first.map((c) => c.params[0]), profiles.map((p) => `seed-showcase-${p.key}`), "in catalog order");
  for (const { sql } of first) {
    assert.match(sql, /^\s*INSERT INTO profiles\b/i);
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/, "never overwrites an existing row");
    assert.doesNotMatch(sql, /\bDO UPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b|;\s*UPDATE\b/i);
  }
  const second = await run();
  assert.deepEqual(second.map((c) => [c.sql, c.params.slice(0, 1).concat(c.params.slice(3))]), first.map((c) => [c.sql, c.params.slice(0, 1).concat(c.params.slice(3))]),
    "a second run issues the same statements (the only per-run difference is the random password hash)");
});

test("fixture accounts get an unusable random password, not a known one", async () => {
  const calls = [];
  await seedShowcaseProfiles(async (sql, params) => { calls.push(params); });
  for (const params of calls) {
    assert.match(params[2], /^\$2[aby]\$\d{2}\$/, "stored as a bcrypt hash");
    assert.equal(bcrypt.compareSync("password123", params[2]), false);
  }
});
