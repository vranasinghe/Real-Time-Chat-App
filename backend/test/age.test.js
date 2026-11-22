// Database-free tests for the date-of-birth / age rules (backend/age.js) and its byte-identical mobile copy.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const age = require("../age");
const vectors = require("./fixtures/age-vectors.json");

test("every shared vector gives the expected result", () => {
  assert.ok(vectors.cases.length >= 40);
  for (const c of vectors.cases) {
    const got = age.validateBirthdate(c.dob, { now: new Date(c.now) });
    const label = `${JSON.stringify(c.dob)} at ${c.now} (${c.note || ""})`;
    assert.equal(got.ok, c.ok, label);
    if (c.ok) assert.equal(got.age, c.age, label);
    else {
      assert.equal(got.code, c.code, label);
      assert.ok(typeof got.message === "string" && got.message.length > 0, label);
    }
  }
});

test("the mobile copy of the age module is byte-identical to the backend copy (line endings ignored)", () => {
  const norm = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  assert.equal(norm(path.join(__dirname, "../../mobile/lib/age.js")), norm(path.join(__dirname, "../age.js")));
});

test("the mobile copy passes the same vectors", () => {
  const mobile = require("../../mobile/lib/age.js");
  for (const c of vectors.cases) {
    const a = age.validateBirthdate(c.dob, { now: new Date(c.now) });
    const b = mobile.validateBirthdate(c.dob, { now: new Date(c.now) });
    assert.deepEqual(b, a);
  }
});

test("the old check's mistakes are rejected: impossible dates, year 1, loose shapes", () => {
  // The previous implementation (new Date(...) compared with a cut-off) accepted all of these.
  for (const dob of ["2008-02-30", "0001-01-01", "1999-1-1", "2000-02-31"]) {
    assert.equal(age.isAdult(dob), false, dob);
  }
});

test("calendar helpers", () => {
  assert.deepEqual([1900, 2000, 2024, 2023, 2100].map(age.isLeapYear), [false, true, true, false, false]);
  assert.equal(age.daysInMonth(2024, 2), 29);
  assert.equal(age.daysInMonth(2023, 2), 28);
  assert.equal(age.parseIsoDate("2024-02-29").day, 29);
  assert.equal(age.parseIsoDate("2023-02-29"), null);
  assert.deepEqual(age.todayUtc(new Date("2026-11-22T23:59:59Z")), { year: 2026, month: 11, day: 22 });
  assert.equal(age.ageOn({ year: 2000, month: 5, day: 5 }, { year: 2026, month: 5, day: 4 }), 25);
  assert.equal(age.ageOn({ year: 2000, month: 5, day: 5 }, { year: 2026, month: 5, day: 5 }), 26);
});

test("a custom minimum age is honoured", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  assert.equal(age.validateBirthdate("2008-11-22", { now, minAge: 21 }).code, "underage");
  assert.equal(age.validateBirthdate("2005-11-22", { now, minAge: 21 }).ok, true);
});
