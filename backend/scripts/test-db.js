// Starts / stops a THROWAWAY local PostgreSQL cluster for integration tests. It is created
// in the OS temp folder with its own data directory, on its own port, with trust auth
// (no password, localhost only). It never touches any existing database.
//
//   node scripts/test-db.js start   -> prints the TEST_DATABASE_URL to use
//   node scripts/test-db.js stop
//
// Needs the PostgreSQL command line tools (initdb, pg_ctl, createdb). Set PG_BIN to their
// folder if they are not on PATH (default tried on Windows: C:\Program Files\PostgreSQL\*\bin).

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.TEST_DB_PORT || "54329";
const DATA = path.join(os.tmpdir(), "dateza-test-pg");
const DB = "dateza_test";

function binDir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const root = "C:\\Program Files\\PostgreSQL";
  if (fs.existsSync(root)) {
    const versions = fs.readdirSync(root).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const dir = path.join(root, v, "bin");
      if (fs.existsSync(path.join(dir, "initdb.exe"))) return dir;
    }
  }
  return ""; // rely on PATH
}

const tool = (name) => path.join(binDir(), name);
const run = (name, args) => execFileSync(tool(name), args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const url = `postgresql://postgres@127.0.0.1:${PORT}/${DB}`;

const cmd = process.argv[2];
if (cmd === "start") {
  if (!fs.existsSync(path.join(DATA, "PG_VERSION"))) {
    run("initdb", ["-D", DATA, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  }
  // stdio must not be piped here: the long-lived server would inherit the pipe and the
  // call would never return.
  try {
    execFileSync(tool("pg_ctl"), ["-D", DATA, "-o", `-p ${PORT} -c listen_addresses=127.0.0.1`, "-l", path.join(DATA, "server.log"), "-w", "start"], { stdio: "ignore" });
  } catch {
    /* already running; createdb below fails loudly if the server really is down */
  }
  try {
    run("createdb", ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", DB]);
  } catch (e) {
    if (!/already exists/i.test(String(e.stderr || e.message))) throw e;
  }
  console.log(url);
} else if (cmd === "stop") {
  try {
    run("pg_ctl", ["-D", DATA, "-m", "fast", "-w", "stop"]);
    console.log("stopped");
  } catch (e) {
    console.log(String(e.stderr || e.message).trim());
  }
} else {
  console.error("usage: node scripts/test-db.js start|stop");
  process.exit(1);
}
