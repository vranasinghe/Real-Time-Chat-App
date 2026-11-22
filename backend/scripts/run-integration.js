// Runs the integration suite against a THROWAWAY local PostgreSQL cluster:
// starts it (scripts/test-db.js), runs the tests, then stops it again.
//
//   npm run test:integration:local          start, test, stop
//   npm run test:integration:local -- --keep   leave the database running afterwards
//
// It never reads backend/.env or DATABASE_URL and never connects to a hosted database.
// If TEST_DATABASE_URL is already set it is used as-is (it must still be local; the test
// file refuses anything else), and the cluster is neither started nor stopped.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const keep = process.argv.includes("--keep");
let url = process.env.TEST_DATABASE_URL;
let startedHere = false;

if (!url) {
  const started = spawnSync(process.execPath, [path.join(__dirname, "test-db.js"), "start"], { cwd: root, encoding: "utf8" });
  if (started.status !== 0) {
    console.error("Could not start the throwaway PostgreSQL test cluster.\n" + (started.stderr || started.stdout || "") +
      "\nInstall the PostgreSQL command line tools (set PG_BIN if they are not on PATH) or set TEST_DATABASE_URL to a LOCAL database.");
    process.exit(1);
  }
  url = started.stdout.trim().split(/\r?\n/).pop();
  startedHere = true;
}

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "test/integration.test.js"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, TEST_DATABASE_URL: url },
});

if (startedHere && !keep) spawnSync(process.execPath, [path.join(__dirname, "test-db.js"), "stop"], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
