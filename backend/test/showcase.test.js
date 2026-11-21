const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const profiles = require("../data/showcase-profiles.json");
const { seedShowcaseProfiles } = require("../showcaseProfiles");

test("showcase contains six adult men and six adult women with complete details and bundled photos", () => {
  assert.equal(profiles.length, 12);
  assert.equal(profiles.filter(p => p.gender === "male").length, 6);
  assert.equal(profiles.filter(p => p.gender === "female").length, 6);
  assert.equal(new Set(profiles.map(p => p.key)).size, 12);
  assert.deepEqual(require("../../mobile/assets/profiles/catalog.json"), profiles);
  const today = new Date("2026-11-21T12:00:00Z");
  for (const p of profiles) {
    const dob = new Date(p.birthdate);
    const age = today.getUTCFullYear() - dob.getUTCFullYear() -
      (today.getUTCMonth() < dob.getUTCMonth() || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate()) ? 1 : 0);
    assert.ok(age >= 24 && age <= 34, `${p.name} is in the requested age range`);
    assert.ok(p.bio && p.height_cm && p.interests.length);
    const serverPhoto = fs.readFileSync(path.join(__dirname, "../public/profiles", `${p.key}.png`));
    const appPhoto = fs.readFileSync(path.join(__dirname, "../../mobile/assets/profiles", `${p.key}.png`));
    assert.ok(serverPhoto.length > 10000);
    assert.ok(serverPhoto.equals(appPhoto), `${p.name}'s photo is consistent in both demos`);
  }
});

test("showcase seeding adds only dedicated sample ids and never overwrites existing accounts", async () => {
  const calls = [];
  await seedShowcaseProfiles(async (sql, params) => { calls.push({ sql, params }); });
  assert.equal(calls.length, 12);
  for (const { sql, params } of calls) {
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
    assert.match(params[0], /^seed-showcase-/);
    assert.match(params[10][0], /^\/public\/profiles\/[a-z]+\.png$/);
  }
});
