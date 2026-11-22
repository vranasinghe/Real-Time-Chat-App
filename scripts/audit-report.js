// Dependency vulnerability REPORT (`npm run audit:report`). Reports only: it never changes
// dependencies and never runs `npm audit fix`. Many findings need breaking upgrades (for
// example Expo SDK changes) that must be planned separately.
//
//   node scripts/audit-report.js                 print a summary table, exit 0
//   node scripts/audit-report.js --fail-on=high  exit 1 when a high or critical advisory
//                                                affects PRODUCTION dependencies
//   node scripts/audit-report.js --json          machine-readable output
//
// Each package is audited twice: everything, and production dependencies only (--omit=dev).
// Needs network access to the npm registry; it sends package names and versions only.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const failOn = (process.argv.find((a) => a.startsWith("--fail-on=")) || "").split("=")[1];
const asJson = process.argv.includes("--json");
const ORDER = ["info", "low", "moderate", "high", "critical"];

function audit(pkg, omitDev) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  const r = spawnSync("npm", args, { cwd: path.join(root, pkg), encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
  try {
    const data = JSON.parse(r.stdout);
    if (data.error) return { error: data.error.summary || data.error.code || "audit failed" };
    const v = data.metadata?.vulnerabilities || {};
    return { counts: Object.fromEntries(ORDER.map((k) => [k, v[k] || 0])), total: v.total ?? ORDER.reduce((n, k) => n + (v[k] || 0), 0) };
  } catch {
    return { error: (r.stderr || r.stdout || "no output").trim().split("\n")[0].slice(0, 200) };
  }
}

const report = {};
for (const pkg of ["backend", "mobile"]) report[pkg] = { all: audit(pkg, false), production: audit(pkg, true) };

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("package   scope        critical  high  moderate  low  info  total");
  for (const [pkg, scopes] of Object.entries(report)) {
    for (const [scope, r] of Object.entries(scopes)) {
      if (r.error) console.log(`${pkg.padEnd(9)} ${scope.padEnd(12)} ERROR: ${r.error}`);
      else {
        const c = r.counts;
        console.log(`${pkg.padEnd(9)} ${scope.padEnd(12)} ${String(c.critical).padStart(8)}  ${String(c.high).padStart(4)}  ${String(c.moderate).padStart(8)}  ${String(c.low).padStart(3)}  ${String(c.info).padStart(4)}  ${String(r.total).padStart(5)}`);
      }
    }
  }
}

let exit = 0;
if (failOn) {
  const min = ORDER.indexOf(failOn);
  for (const scopes of Object.values(report)) {
    const r = scopes.production;
    if (r.error || ORDER.slice(Math.max(min, 0)).some((k) => r.counts[k] > 0)) exit = 1;
  }
}
process.exit(exit);
