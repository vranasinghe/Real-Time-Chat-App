// Runs the manual end-to-end scripts (test/chat.e2e.js, test/images.e2e.js) against an ISOLATED local stack:
// a throwaway PostgreSQL cluster (scripts/test-db.js) and a backend started here on its own port.
//
//   npm run test:e2e:local
//
// Every sensitive setting of the spawned backend is overridden explicitly, so backend/.env is never used for them:
// the database is the throwaway one, there is no mail provider and no Google client, the demo login is off, and
// e-mail verification is switched off (development only) because a script cannot read the code. If
// TEST_DATABASE_URL is set it is used (it must point at THIS machine) and the cluster is neither started nor stopped.

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const { isLocalDatabase } = require("../dbSafety");

const root = path.join(__dirname, "..");
const run = (script, args = []) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: root, encoding: "utf8" });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForReady(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url + "/readyz")).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

(async () => {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let startedHere = false;
  if (databaseUrl) {
    if (!isLocalDatabase(databaseUrl)) {
      console.error("Refusing to run: TEST_DATABASE_URL must point at this machine.");
      process.exit(1);
    }
  } else {
    const started = run("test-db.js", ["start"]);
    if (started.status !== 0) {
      console.error("Could not start the throwaway PostgreSQL cluster.\n" + (started.stderr || started.stdout));
      process.exit(1);
    }
    databaseUrl = started.stdout.trim().split(/\r?\n/).pop();
    startedHere = true;
  }

  const port = await freePort();
  const apiUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["index.js"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "e2e-local-secret-e2e-local-secret-123456",
      NODE_ENV: "development",
      PORT: String(port),
      CORS_ORIGIN: "",
      RENDER: "",
      RESEND_API_KEY: "",
      MAIL_FROM: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      DEMO_LOGIN_ENABLED: "false",
      REQUIRE_EMAIL_VERIFICATION: "false",
      AUTH_RATE_LIMIT: "100000",
      REGISTER_RATE_LIMIT: "100000",
      API_RATE_LIMIT: "100000",
      LOG_LEVEL: "error",
    },
  });

  let status = 1;
  try {
    if (!(await waitForReady(apiUrl))) throw new Error("the local backend did not become ready");
    status = 0;
    for (const script of ["test/chat.e2e.js", "test/images.e2e.js"]) {
      const r = spawnSync(process.execPath, [script], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, API_URL: apiUrl, E2E_CONFIRM_DISPOSABLE_DB: "1" },
      });
      if (r.status !== 0) status = 1;
    }
  } catch (err) {
    console.error(err.message);
  } finally {
    server.kill();
    if (startedHere) run("test-db.js", ["stop"]);
  }
  process.exit(status);
})();
