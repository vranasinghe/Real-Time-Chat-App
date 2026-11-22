// One command for every automated check: `npm run test:all` from the repository root.
//
//   backend unit tests            no database
//   backend integration tests     a throwaway LOCAL PostgreSQL cluster, started and stopped here
//   mobile type check             tsc --noEmit
//   mobile lint                   zero warnings allowed
//   web export                    expo export --platform web (skip with --skip-export)
//
// Every step runs even if an earlier one fails; the summary at the end lists all results and
// the exit code is non-zero when any step failed. Nothing here talks to a hosted service.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const skipExport = process.argv.includes("--skip-export");

const steps = [
  ["backend unit tests", ["--prefix", "backend", "test"]],
  ["backend integration tests", ["--prefix", "backend", "run", "test:integration:local"]],
  ["mobile type check", ["--prefix", "mobile", "run", "typecheck"]],
  ["mobile lint (0 warnings)", ["--prefix", "mobile", "run", "lint", "--", "--max-warnings", "0"]],
];
if (!skipExport) steps.push(["web export", ["--prefix", "mobile", "run", "export:web"]]);

const results = [];
for (const [name, args] of steps) {
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  const r = spawnSync("npm", args, { cwd: root, stdio: "inherit", shell: true });
  results.push({ name, ok: r.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log("\n=== summary ===");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.seconds}s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} step(s) failed.` : "\nAll steps passed.");
process.exit(failed ? 1 : 0);
