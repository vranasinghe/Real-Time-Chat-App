// Database-free unit tests for the migration and seeding safeguards (dbSafety.js) and for
// the properties of the real migration files.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const s = require("../dbSafety");

const LOCAL = "postgresql://postgres@127.0.0.1:5432/dev";
const REMOTE = "postgresql://user:pw@ep-example.neon.tech/db?sslmode=require";
const DEV = { NODE_ENV: "development" };
const PROD = { NODE_ENV: "production" };
const MIGRATIONS = path.join(__dirname, "../migrations");

test("isLocalDatabase: only this machine counts; unparsable or empty is not local", () => {
  assert.equal(s.isLocalDatabase(LOCAL), true);
  assert.equal(s.isLocalDatabase("postgresql://u@localhost/x"), true);
  assert.equal(s.isLocalDatabase("postgresql://u@[::1]:5432/x"), true);
  assert.equal(s.isLocalDatabase(REMOTE), false);
  assert.equal(s.isLocalDatabase("postgresql://u@localhost.evil.example/x"), false);
  assert.equal(s.isLocalDatabase("postgresql://u@10.0.0.5/x"), false);
  assert.equal(s.isLocalDatabase(""), false);
  assert.equal(s.isLocalDatabase(undefined), false);
  assert.equal(s.isLocalDatabase("not a url"), false);
});

test("classifyMigration flags deleting and dropping statements, ignores comments and safe DDL", () => {
  for (const sql of [
    "DELETE FROM profiles WHERE id = 'x';",
    "delete   from profiles",
    "TRUNCATE messages;",
    "DROP TABLE swipes;",
    "ALTER TABLE profiles DROP COLUMN bio;",
    "ALTER TABLE profiles ALTER COLUMN bio TYPE integer;",
    "ALTER TABLE profiles RENAME TO people;",
    "DO $$ BEGIN DELETE FROM matches; END $$;",
  ]) {
    assert.equal(s.classifyMigration(sql).destructive, true, sql);
  }
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS t (id int);",
    "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status text;",
    "CREATE INDEX IF NOT EXISTS i ON t(a);",
    "-- DELETE FROM profiles (explained in a comment)\nSELECT 1;",
    "/* DROP TABLE t */ SELECT 1;",
    "CREATE TABLE a (b int REFERENCES c(id) ON DELETE CASCADE);",
    "UPDATE messages SET expires_at = created_at WHERE expires_at IS NULL;",
  ]) {
    assert.equal(s.classifyMigration(sql).destructive, false, sql);
  }
});

test("a destructive migration may run automatically only on a local database outside production", () => {
  const sql = "DELETE FROM profiles WHERE id = 'seed-x';";
  assert.equal(s.assertMigrationAllowed({ file: "009_x.sql", sql, databaseUrl: LOCAL, env: DEV }).allowed, true);
  assert.throws(() => s.assertMigrationAllowed({ file: "009_x.sql", sql, databaseUrl: REMOTE, env: DEV }), s.MigrationSafetyError);
  assert.throws(() => s.assertMigrationAllowed({ file: "009_x.sql", sql, databaseUrl: LOCAL, env: PROD }), s.MigrationSafetyError);
  assert.throws(() => s.assertMigrationAllowed({ file: "009_x.sql", sql, databaseUrl: LOCAL, env: { RENDER: "true" } }), s.MigrationSafetyError);
  assert.throws(() => s.assertMigrationAllowed({ file: "009_x.sql", sql, databaseUrl: undefined, env: DEV }), s.MigrationSafetyError);
});

test("on a shared database a destructive migration needs BOTH the review marker and the explicit flag", () => {
  const plain = "DELETE FROM profiles WHERE id = 'seed-x';";
  const marked = "-- destructive-approved: by=owner on=2026-12-01\n" + plain;
  assert.throws(() => s.assertMigrationAllowed({ file: "f.sql", sql: marked, databaseUrl: REMOTE, env: { ...PROD } }), s.MigrationSafetyError, "marker alone is not enough");
  assert.throws(() => s.assertMigrationAllowed({ file: "f.sql", sql: plain, databaseUrl: REMOTE, env: { ...PROD, ALLOW_DESTRUCTIVE_MIGRATIONS: "true" } }), s.MigrationSafetyError, "flag alone is not enough");
  assert.equal(s.assertMigrationAllowed({ file: "f.sql", sql: marked, databaseUrl: REMOTE, env: { ...PROD, ALLOW_DESTRUCTIVE_MIGRATIONS: "true" } }).allowed, true);
  assert.throws(() => s.assertMigrationAllowed({ file: "f.sql", sql: "-- destructive-approved: nobody\n" + plain, databaseUrl: REMOTE, env: { ...PROD, ALLOW_DESTRUCTIVE_MIGRATIONS: "true" } }), s.MigrationSafetyError, "malformed marker is ignored");
  assert.equal(s.assertMigrationAllowed({ file: "f.sql", sql: "CREATE TABLE t(a int);", databaseUrl: REMOTE, env: PROD }).allowed, true, "non-destructive files are unaffected");
});

test("fake development accounts are seeded only into a local database", () => {
  assert.equal(s.canSeedDevData({ databaseUrl: LOCAL, env: DEV }), true);
  assert.equal(s.canSeedDevData({ databaseUrl: REMOTE, env: DEV }), false);
  assert.equal(s.canSeedDevData({ databaseUrl: REMOTE, env: { ...DEV, ALLOW_REMOTE_DEV_SEED: "true" } }), true);
  assert.equal(s.canSeedDevData({ databaseUrl: LOCAL, env: PROD }), false);
  assert.equal(s.canSeedDevData({ databaseUrl: REMOTE, env: { ...PROD, ALLOW_REMOTE_DEV_SEED: "true" } }), false, "never in production");
  assert.equal(s.canSeedDevData({ databaseUrl: LOCAL, env: { RENDER: "true" } }), false);
});

test("orderMigrationFiles sorts by number and rejects bad names and duplicate numbers", () => {
  assert.deepEqual(s.orderMigrationFiles(["010_b.sql", "002_a.sql", "readme.md", "001_x.sql"]), ["001_x.sql", "002_a.sql", "010_b.sql"]);
  assert.throws(() => s.orderMigrationFiles(["001_a.sql", "001_b.sql"]), /used by both/);
  assert.throws(() => s.orderMigrationFiles(["1_a.sql"]), /must look like/);
  assert.throws(() => s.orderMigrationFiles(["002_Bad Name.sql"]), /must look like/);
});

test("retired migration numbers cannot be reused", () => {
  assert.throws(() => s.orderMigrationFiles(["001_a.sql", "004_something_new.sql"]), /retired/);
  assert.throws(() => s.orderMigrationFiles(["005_x.sql"]), /retired/);
  assert.deepEqual(s.RETIRED_MIGRATIONS.map((m) => m.number), [4, 5]);
});

test("the real migrations directory has valid, unique numbering with no gaps other than the retired numbers", () => {
  const ordered = s.orderMigrationFiles(fs.readdirSync(MIGRATIONS));
  assert.ok(ordered.length > 0);
  const retired = new Set(s.RETIRED_MIGRATIONS.map((m) => m.number));
  let expected = 0;
  for (const f of ordered) {
    do { expected++; } while (retired.has(expected));
    assert.equal(Number(f.slice(0, f.indexOf("_"))), expected, `${f} is the next migration number`);
  }
});

test("the retired destructive cleanups are archived outside the migrations directory, unchanged, and are never picked up by the runner", () => {
  const ARCHIVE = path.join(__dirname, "../ops/local-dev-cleanup");
  for (const { name } of s.RETIRED_MIGRATIONS) {
    assert.ok(!fs.existsSync(path.join(MIGRATIONS, name)), `${name} must not be in migrations/`);
    const sql = fs.readFileSync(path.join(ARCHIVE, name), "utf8");
    assert.equal(s.classifyMigration(sql).destructive, true, "still the destructive cleanup it always was");
    assert.equal(s.classifyMigration(sql).approved, false);
  }
  assert.ok(!s.orderMigrationFiles(fs.readdirSync(MIGRATIONS)).some((f) => s.RETIRED_MIGRATION_NAMES.has(f)));
});

test("no migration in the migrations directory is destructive (a hosted deploy cannot run cleanup SQL automatically)", () => {
  const destructive = s.orderMigrationFiles(fs.readdirSync(MIGRATIONS)).filter((f) => s.classifyMigration(fs.readFileSync(path.join(MIGRATIONS, f), "utf8")).destructive);
  assert.deepEqual(destructive, [], "a destructive change needs an explicit, reviewed exception to this test");
});
