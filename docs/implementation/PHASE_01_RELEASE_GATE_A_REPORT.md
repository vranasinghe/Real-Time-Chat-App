# Phase 1 — Release Gate A report (P1-00 and P1-00b)

**Date:** 2026-11-22 · **Branch:** `phase-0-stabilise` (no new branch; same uncommitted working tree as Phase 0) · **Scope:** only the two Release Gate A fixes. The authentication/onboarding/eligibility rewrite (P1-01 … P1-12) was **not started**.
Nothing was committed, pushed or deployed. No hosted database or service was contacted; no destructive SQL was run anywhere except inside throwaway local databases created by the test harness.

**Status: COMPLETE in code, config and tests; effect on the live service happens only when the owner deploys.**

---

## 1. Protecting existing work (Task 1)

- Working tree inspected first: branch `phase-0-stabilise`, no stash, nothing staged, all Phase 0 changes and the owner's earlier uncommitted work present. Nothing was overwritten, reverted or committed. Two files were temporarily swapped to their `HEAD` versions to prove the new tests fail on the old code; they were restored byte-for-byte from copies (verified by `git diff`).
- **Migrations 004 and 005:** still untracked, still **destructive**, still **not owner-approved**, and still held back by the Phase 0 guard (`backend/dbSafety.js`): they apply only to a local database outside production; any hosted database makes the runner refuse to start. Verified again by `dbSafety.test.js` ("only these two files are destructive and neither carries an approval marker") and the scratch-database integration tests. They were not edited, moved, applied or approved.

**Exact decision needed from the owner (keep blocked until answered):**

> Migrations `004_remove_requested_mock_profiles.sql` and `005_remove_additional_mock_profiles.sql` each run `DELETE FROM profiles WHERE id IN (…)` over nine fixed mock ids (`seed-liana`, `seed-elena`, `seed-aria`, `seed-chloe`, `seed-sophia`, `seed-marcus`, `seed-dev`, `seed-nina`, `seed-james`), cascading to their swipes, matches and messages. Choose one:
> 1. **Recommended:** keep them local-only (never approve for hosted databases); handle the hosted database with `PRODUCTION_CLEANUP_RUNBOOK.md` yourself and record the files as applied (or remove the files) before any hosted deploy.
> 2. Approve them for one hosted deploy: add `-- destructive-approved: by=<you> on=<date>` to each file and set `ALLOW_DESTRUCTIVE_MIGRATIONS=true` for that deploy only, after taking a recovery point.
> 3. Discard them.

Until then a hosted deploy of this code will stop at startup (by design).

---

## 2. P1-00 — Precise location exposure

### 2.1 Audit of every place location could leave the server

| Endpoint / path | Returns other members? | Before | After |
|---|---|---|---|
| `GET /api/profiles/discovery` | yes | **leaked `lat`, `lng`** (selected and returned) | columns removed from the SELECT **and** every row passes through a public-field whitelist |
| `GET /api/profiles/likes-you` | yes | **leaked `lat`, `lng`** | same |
| `GET /api/matches`, `/api/matches/conversations` | yes (`other_user`) | explicit field list, no location | unchanged; now covered by a test |
| `POST /api/matches`, `POST /api/matches/quick` | yes | explicit subset | unchanged; tested |
| `POST /api/swipes` (`activeMatch.profile`) | yes | explicit subset | unchanged; tested |
| `GET /api/stories`, story upload, media | name/avatar only | no location | unchanged; tested |
| Socket events (`status_change`, `match_created`, …) | ids/flags only | no location | unchanged |
| Search | **no server endpoint**; the app filters lists it already received (now location-free) | — | — |
| `GET /api/auth/me`, login, register, change-password, Google callback, demo login, `complete-setup` response | **the caller's own row** | includes the caller's own `lat`/`lng` if stored | unchanged — own data returned only to its owner |
| `POST /api/auth/complete-setup` (input) | — | **accepted and stored any numeric `lat`/`lng`** with no consent | now answers `400 { code: "location_not_supported" }`, stores nothing (also rejects the whole request, so nothing else is half-saved) |

### 2.2 Changes

- `backend/profiles.js`: removed `p.lat, p.lng` from both queries; added `PUBLIC_PROFILE_FIELDS` and `toPublicProfile()` — a **whitelist** applied to every returned row, so a future column added to a query cannot leak by accident (also exported for tests).
- `backend/auth.js`: `validateProfileInput` rejects `lat`/`lng` unless `null`/absent; the `UPDATE` no longer writes location columns (parameters renumbered).
- `mobile/app/(tabs)/explore.tsx`: "Nearby" chip removed (it only tested `lat != null`, which says nothing about distance). "All / New / Recently Active" remain. `mobile/lib/types.ts`: `lat`/`lng` removed from the client `Profile` type so nothing can rely on another member's coordinates.
- Preserved: discovery, likes-you, swiping, matching, chat and the chip behaviour other than Nearby. Existing rows keep whatever coordinates they hold (not exposed; not deleted).

### 2.3 Tests

| Test | What it proves |
|---|---|
| Integration: leak detector negative control | The detector flags `lat`, `Longitude`, and coordinate values under any key, and passes clean payloads |
| Integration: other members' coordinates absent | Users whose rows hold coordinates (set directly in the DB, simulating old rows): discovery, likes-you, swipe response, `/api/matches`, `/conversations`, `POST /api/matches`, `/quick` and the stories feed contain **no location-like key anywhere and none of the coordinate values**; discovery/likes-you still list the expected members with all public fields; a mutual like still creates a match |
| Integration: profile setup refuses coordinates | Four coordinate shapes (including string coordinates and coordinates mixed with a valid `bio`) → `400 location_not_supported`; database unchanged; `lat: null, lng: null` plus a real field still updates normally |
| Unit: `toPublicProfile` | Drops `lat`, `lng`, `latitude`, `longitude`, `email`, `password`, `token_version`, `is_demo`, `email_verified_at` even if selected; whitelist never lists a location field |
| Unit: `validateProfileInput` | Refuses coordinates; tolerates `null` |

**Regression proof:** run against the original `profiles.js`/`auth.js` → 2 of 32 integration tests fail (leak test: coordinate values and keys found in `discovery`; setup test: coordinates accepted); with the fixes 32/32. (My first attempt at this proof failed for the wrong reason — an incorrect assertion in my own test — and was redone after fixing it.)

---

## 3. P1-00b — Production demo access

### 3.1 What was inspected

`render.yaml` set `DEMO_LOGIN_ENABLED: "true"` for the production service. `config.js` honoured the flag in every environment. `backend/demo.js` creates two shared, passwordless demo accounts and trims history. A token issued to a demo account stayed valid for up to 30 days even after the flag was removed (`session.js` checked only `token_version`).

### 3.2 Changes

- `render.yaml`: `DEMO_LOGIN_ENABLED` is now `"false"`, with a comment explaining the separate-service rule.
- `backend/config.js`: new `resolveDemoLogin()`. Outside production the flag works as before. **In production (`NODE_ENV=production` or `RENDER`) the flag is ignored unless `DEMO_ENVIRONMENT=isolated` is also set** — an explicit statement that this is a separate demo service with its own database. The flag is strict (`"true"` only). When production ignores a requested demo, a startup warning says so. This also covers a stale value already set in the Render dashboard, which a blueprint edit alone might not remove.
- `backend/session.js`: a session belonging to an `is_demo` account is rejected (`session_revoked`, REST and socket) whenever the demo login is off, so tokens already issued stop working. Real members are unaffected.
- `backend/.env.example`, `README.md`, `docs/AUTH_AND_DEPLOYMENT.md`, `backend/demo.js` comment: updated to the new rule.
- **No user record was deleted or altered.** Demo rows, if present in a database, stay (they cannot be used to sign in once the demo is off). Cleaning them out is the runbook's job.

### 3.3 Tests (`backend/test/demoConfig.test.js`, plus one integration test)

- Decision table for `resolveDemoLogin` (production with/without marker, marker without flag, wrong marker values, strict `"true"`, development).
- The real `config.js` loaded in child processes with production-like environments (every relevant variable set explicitly so a developer's `.env` cannot affect the result): production + flag → off with the startup warning; `RENDER` alone → off; production default → off; production + flag + marker → on; development unchanged.
- `render.yaml` (comments stripped) never sets the demo on, carries no `DEMO_ENVIRONMENT`, `ALLOW_REMOTE_DEV_SEED` or `ALLOW_DESTRUCTIVE_MIGRATIONS` — and the test checks it is really parsing the production service (proven to fail on the original file).
- `.env.example` defaults to off; marker commented out.
- Lingering demo tokens (unit, with a stubbed lookup): rejected when off (REST + socket), accepted when on, real users unaffected.
- Integration (real app and database): demo works while enabled; when off → `POST /api/auth/demo` 404 with no token, status `{enabled:false, personas:[]}`, the earlier demo token → `401 session_revoked`, its socket refused, a real member still signs in, the demo rows are still in the database.

---

## 4. Validation results (Task 4)

All run locally, Node v24.16.0, throwaway local PostgreSQL 18 (started and stopped by the harness).

| Check | Result |
|---|---|
| Backend unit (`npm test`) | **44 / 44 pass** (was 36: +2 location, +6 demo-config) |
| Backend integration (isolated local DB) | **32 / 32 pass** (was 28: +4) |
| `tsc --noEmit` | 0 errors |
| ESLint `--max-warnings 0` | 0 warnings, 0 errors |
| Expo web export | success |
| `npm run test:all` | 5 / 5 steps pass |
| Web preview (offline demo) | Explore shows All / New / Recently Active and lists profiles; no console errors |

Not run: native builds/devices, Node 22, the GitHub workflow, any hosted service.

---

## 5. Vulnerabilities resolved

| ID | Issue | Resolution |
|---|---|---|
| D-05 | Other members' precise coordinates returned by discovery and likes-you | Removed; whitelist guard; tests |
| D-05b (new, this phase) | Profile setup stored coordinates with no consent | Refused |
| D-08 (config part) | Production blueprint enabled the shared passwordless demo login | Off in blueprint; ignored by the backend in production without explicit isolation; tests |
| D-08b (new, this phase) | Demo sessions outlived the flag (up to 30 days) | Rejected when the demo is off; tests |

Misleading "Nearby" filter: removed from the UI.

---

## 6. Remaining issues

| Item | Notes |
|---|---|
| Nothing deployed | The live service keeps its current behaviour (demo login on, coordinates exposed) until the owner deploys this branch. **Do not treat production as fixed yet.** |
| Hosted deploy stops at 004/005 | By design until the owner decides (§1) |
| Production data unknown/uncleaned | Fake rows, demo accounts and applied migrations in the live database are unverified; runbook ready, owner executes |
| Stored coordinates in existing rows | Not exposed to others; still stored. Clearing them is a privacy/owner decision |
| Real distance + consent | P3-03/04 (distance labels, consent, filters) |
| "New" chip in Explore does nothing | Pre-existing; returns every profile |
| Deploy effect on users | When deployed, the Live Demo button disappears from the production app and existing demo sessions end — intended, but visible |
| D-41 | `demo.js` deletes every `is_demo` row that is not a demo persona on each demo login (cascading); unchanged, only matters on an environment where the demo is enabled |
| Everything else in Phase 1 | Eligibility, age validation, onboarding honesty, email verification, OAuth hardening — not started |
| Unverified | Node 22 run, GitHub CI run, native behaviour |

---

## 7. Modified and new files (this phase)

Modified: `backend/profiles.js`, `backend/auth.js`, `backend/config.js`, `backend/session.js`, `backend/demo.js` (comment), `backend/.env.example`, `backend/package.json` (test script), `render.yaml`, `README.md`, `docs/AUTH_AND_DEPLOYMENT.md`, `mobile/app/(tabs)/explore.tsx`, `mobile/lib/types.ts`, `backend/test/integration.test.js`, `backend/test/units.test.js`, and the docs below.
New: `backend/test/demoConfig.test.js`, `docs/implementation/SECURITY_CHECKLIST.md`, this report.
Updated docs: `IMPLEMENTATION_TRACKER.md`, `IMPLEMENTATION_PLAN.md`, `TEST_REPORT.md`, `KNOWN_LIMITATIONS.md`.
Overall working tree vs `main` @ `a9cff77` (including Phase 0 and the owner's earlier work): 44 tracked files changed (+820 / −565) plus new untracked files. No commits, no stash, nothing staged.

---

## 8. Phase 1 readiness

**Release Gate A: code-complete, tested, and ready for owner review.** It is **not yet effective in production** until deployed, and the rest of the gate is the owner's: (a) decide on 004/005 (§1), (b) run the cleanup runbook against the hosted database (after a recovery point), (c) review/commit and deploy this branch.

**Ready to begin P1-01 onward in development** (account-state migration, age module, registration and eligibility). Recommended order stays as in the plan: P1-01 migration 006, P1-02 strict age module, P1-03 registration, then the default-deny route policy and eligibility middleware.

**Not ready for any real-user exposure**: eligibility, onboarding honesty, safety/moderation, deletion and policies are all still open (see `SECURITY_CHECKLIST.md` §6).
