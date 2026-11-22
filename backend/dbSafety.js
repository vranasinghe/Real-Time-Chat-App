// Safety checks for anything that changes data in bulk at startup: SQL migrations and
// development seed data. Pure functions (no database access) so they are unit-testable.
//
// Rules:
//  - A migration that deletes or drops things is "destructive". It may run automatically
//    only against a LOCAL database outside production. Anywhere else it must carry a
//    review marker AND the operator must set ALLOW_DESTRUCTIVE_MIGRATIONS=true.
//  - Fake development accounts (mock profiles, showcase profiles) are only seeded into a
//    LOCAL database, never into a hosted one, unless ALLOW_REMOTE_DEV_SEED=true.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// "-- destructive-approved: by=<name> on=YYYY-MM-DD" anywhere in the file
const APPROVAL_RE = /^--\s*destructive-approved:\s*by=\S+\s+on=\d{4}-\d{2}-\d{2}\s*$/m;

const DESTRUCTIVE_PATTERNS = [
  [/\bdelete\s+from\b/i, "DELETE FROM"],
  [/\btruncate\b/i, "TRUNCATE"],
  [/\bdrop\s+(table|column|schema|database|index|constraint|type|view|function|trigger|extension|sequence)\b/i, "DROP"],
  [/\balter\s+table\b[^;]*\bdrop\b/i, "ALTER TABLE ... DROP"],
  [/\balter\s+table\b[^;]*\balter\s+column\b[^;]*\btype\b/i, "ALTER COLUMN TYPE"],
  [/\balter\s+table\b[^;]*\brename\b/i, "ALTER TABLE ... RENAME"],
];

// Migration numbers that were used and then retired (the files moved to backend/ops/local-dev-cleanup/
// because they are destructive data cleanups that must not run automatically). The numbers stay reserved
// forever: no new migration may reuse one, and a database that recorded them is not "drifted".
const RETIRED_MIGRATIONS = Object.freeze([
  { number: 4, name: "004_remove_requested_mock_profiles.sql" },
  { number: 5, name: "005_remove_additional_mock_profiles.sql" },
]);
const RETIRED_MIGRATION_NAMES = new Set(RETIRED_MIGRATIONS.map((m) => m.name));
const RETIRED_MIGRATION_NUMBERS = new Set(RETIRED_MIGRATIONS.map((m) => m.number));

class MigrationSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationSafetyError";
  }
}

function databaseHost(url) {
  try {
    return new URL(String(url)).hostname || null;
  } catch {
    return null;
  }
}

/** True only when the connection string points at this machine. Unknown / unparsable = false. */
function isLocalDatabase(url) {
  const host = databaseHost(url);
  return !!host && LOCAL_HOSTS.has(host);
}

const isProductionEnv = (env) => env.NODE_ENV === "production" || !!env.RENDER;

function stripSqlComments(sql) {
  return String(sql).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n\r]*/g, " ");
}

/** Returns { destructive, reasons[], approved } for a migration file's SQL text. */
function classifyMigration(sql) {
  const body = stripSqlComments(sql);
  const reasons = DESTRUCTIVE_PATTERNS.filter(([re]) => re.test(body)).map(([, label]) => label);
  return { destructive: reasons.length > 0, reasons, approved: APPROVAL_RE.test(String(sql)) };
}

/**
 * Throws MigrationSafetyError when `sql` must not run against this database.
 * Returns a small description of the decision (used for logging and tests).
 */
function assertMigrationAllowed({ file, sql, databaseUrl, env = process.env }) {
  const info = classifyMigration(sql);
  if (!info.destructive) return { ...info, allowed: true, why: "not destructive" };

  if (isLocalDatabase(databaseUrl) && !isProductionEnv(env)) {
    return { ...info, allowed: true, why: "local database outside production" };
  }
  if (info.approved && env.ALLOW_DESTRUCTIVE_MIGRATIONS === "true") {
    return { ...info, allowed: true, why: "reviewed marker and ALLOW_DESTRUCTIVE_MIGRATIONS=true" };
  }
  throw new MigrationSafetyError(
    `Refusing to run destructive migration ${file} (${info.reasons.join(", ")}) against a shared or production database. ` +
      `Run the reviewed cleanup procedure by hand, or add the "-- destructive-approved: by=<name> on=<date>" marker after review and set ALLOW_DESTRUCTIVE_MIGRATIONS=true. ` +
      `See docs/implementation/DATABASE_MIGRATIONS.md.`
  );
}

/** Fake accounts (mock/showcase profiles) may only be seeded locally unless explicitly forced. */
function canSeedDevData({ databaseUrl, env = process.env }) {
  if (isProductionEnv(env)) return false;
  if (isLocalDatabase(databaseUrl)) return true;
  return env.ALLOW_REMOTE_DEV_SEED === "true";
}

// Migration file names: three or more digits, underscore, lowercase words. Numbers must be unique
// so the order is unambiguous.
const MIGRATION_NAME_RE = /^(\d{3,})_[a-z0-9_]+\.sql$/;

/** Validates names/numbering of an array of file names and returns them in execution order. */
function orderMigrationFiles(files) {
  const sql = files.filter((f) => f.endsWith(".sql"));
  const seen = new Map();
  for (const f of sql) {
    const m = MIGRATION_NAME_RE.exec(f);
    if (!m) throw new Error(`Migration file name "${f}" must look like 007_short_description.sql`);
    const n = Number(m[1]);
    if (seen.has(n)) throw new Error(`Migration number ${m[1]} is used by both "${seen.get(n)}" and "${f}"`);
    if (RETIRED_MIGRATION_NUMBERS.has(n)) throw new Error(`Migration number ${m[1]} is retired and must not be reused ("${f}")`);
    seen.set(n, f);
  }
  return [...sql].sort();
}

module.exports = {
  LOCAL_HOSTS,
  RETIRED_MIGRATIONS,
  RETIRED_MIGRATION_NAMES,
  MigrationSafetyError,
  isLocalDatabase,
  classifyMigration,
  assertMigrationAllowed,
  canSeedDevData,
  orderMigrationFiles,
};
