const { Pool, types } = require("pg");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const logger = require("./logger");

// DATE columns (birthdate) are returned as "YYYY-MM-DD" strings. The driver's default turns them into a
// Date at LOCAL midnight, which shifts the calendar day when serialised, a real problem for an age check.
types.setTypeParser(1082, (value) => value);

const connectionString = config.databaseUrl;

// SSL: Neon and most hosted Postgres put `sslmode=require` in the URL, which pg honours.
// Supabase poolers need relaxed verification.
const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString && (connectionString.includes("supabase.co") || connectionString.includes("supabase.com"))
    ? { rejectUnauthorized: false }
    : undefined,
  max: parseInt(process.env.PG_POOL_MAX, 10) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  logger.error("unexpected error on idle database client", err);
});

const bcrypt = require("bcryptjs");
const dbSafety = require("./dbSafety");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Runs fn(query) in one transaction on `targetPool`: commits if it resolves, rolls back if it throws.
async function transactionOn(targetPool, fn) {
  const client = await targetPool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn((text, params) => client.query(text, params));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

const withTransaction = (fn) => transactionOn(pool, fn);

// Runs the SQL files in migrations/ that have not been applied yet, in name order, each in
// its own transaction, and records them in schema_migrations. Never edit an applied file:
// add a new one. A file that fails rolls back completely and is NOT recorded.
//
// Destructive files (DELETE FROM / DROP / TRUNCATE ...) are refused on any database that is
// not local, unless reviewed and explicitly allowed (see dbSafety.js). The check runs for ALL
// pending files before the first one is applied, so a refusal never leaves a half-applied set.
//
// Options exist so tests can run against a scratch database and directory.
const runMigrations = async ({
  dir = MIGRATIONS_DIR,
  targetPool = pool,
  databaseUrl = connectionString,
  env = process.env,
} = {}) => {
  await targetPool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
     )`
  );
  if (!fs.existsSync(dir)) return [];
  const files = dbSafety.orderMigrationFiles(fs.readdirSync(dir));
  const applied = new Set((await targetPool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const name of applied) {
    if (!files.includes(name) && !dbSafety.RETIRED_MIGRATION_NAMES.has(name)) {
      logger.warn("migration recorded in the database but missing on disk", { file: name });
    }
  }

  const pending = files.filter((f) => !applied.has(f)).map((file) => ({ file, sql: fs.readFileSync(path.join(dir, file), "utf8") }));
  for (const { file, sql } of pending) {
    const decision = dbSafety.assertMigrationAllowed({ file, sql, databaseUrl, env });
    if (decision.destructive) logger.warn("applying destructive migration", { file, reasons: decision.reasons, why: decision.why });
  }

  const done = [];
  for (const { file, sql } of pending) {
    await transactionOn(targetPool, async (q) => {
      await q(sql);
      await q("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    logger.info("migration applied", { file });
    done.push(file);
  }
  return done;
};

// Creates / upgrades tables. Throws on failure so the server never starts half-working
// (callers retry, then exit).
const initDb = async () => {
  {
    const sqlPath = path.join(__dirname, "db_init.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    await pool.query(sql);
    await runMigrations();
    logger.info("database tables verified/created");
    if (config.isProduction) {
      logger.info("production environment: skipping mock profile seeding");
    } else if (!dbSafety.canSeedDevData({ databaseUrl: connectionString })) {
      // A developer machine pointed at a hosted database must not fill it with fake accounts
      // (some of which have a known password). Set ALLOW_REMOTE_DEV_SEED=true to override.
      logger.warn("skipping mock and showcase profile seeding: the database is not local");
    } else {
      await seedMockProfiles();
      await require("./showcaseProfiles").seedShowcaseProfiles((text, params) => pool.query(text, params));
    }
  }
};

const seedMockProfiles = async () => {
  try {
    const check = await pool.query("SELECT COUNT(*) FROM profiles WHERE id LIKE 'seed-%'");
    const count = parseInt(check.rows[0].count);
    if (count > 0) {
      return;
    }

    logger.info("seeding initial mock profiles");
    const mockProfiles = [
      {
        id: "seed-isabelle",
        email: "isabelle@example.com",
        name: "Isabelle",
        birthdate: "2002-09-03",
        gender: "female",
        looking_for: "male",
        bio: "Dancer, foodie, and lover of rainy days. Probably thinking about brunch right now.",
        height_cm: 169,
        interests: ["Dance", "Food", "Rain", "Brunch", "Music"],
        photos: ["https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=600&auto=format&fit=crop&q=80"],
        is_online: false,
      },
      {
        id: "seed-liam",
        email: "liam@example.com",
        name: "Liam",
        birthdate: "1997-09-30",
        gender: "male",
        looking_for: "everyone",
        bio: "Surfer, dog dad, and part-time DJ. Keeping things simple, positive, and active. Let's hit the beach.",
        height_cm: 180,
        interests: ["Surfing", "Dogs", "Music", "Beach"],
        photos: ["https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&auto=format&fit=crop&q=80"],
        is_online: true,
      },
      {
        id: "seed-zoe",
        email: "zoe@example.com",
        name: "Zoe",
        birthdate: "1999-05-21",
        gender: "female",
        looking_for: "male",
        bio: "Plant mum, wellness coach, and sunrise runner. Healthy lifestyle, big laughs, and deeper conversations.",
        height_cm: 166,
        interests: ["Wellness", "Running", "Plants", "Nutrition", "Yoga"],
        photos: ["https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=600&auto=format&fit=crop&q=80"],
        is_online: false,
      },
    ];

    const passwordHash = await bcrypt.hash("password123", 10);

    for (const p of mockProfiles) {
      await pool.query(
        `INSERT INTO profiles (id, email, password, name, birthdate, gender, looking_for, bio, height_cm, interests, photos, is_online)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.email, passwordHash, p.name, p.birthdate, p.gender, p.looking_for, p.bio, p.height_cm, p.interests, p.photos, p.is_online]
      );
    }
    logger.info("mock profiles seeded");
  } catch (err) {
    logger.error("seeding profiles failed", err);
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initDb,
  runMigrations,
  withTransaction,
  close: () => pool.end(),
  ping: () => pool.query("SELECT 1"),
};
