# Dateza — Test report

Only commands that were actually run are listed, with their real output counts. Environment: Windows 11, **Node v24.16.0**, npm 11.13.0, local PostgreSQL 18 (throwaway cluster on 127.0.0.1:54329, created and stopped by `backend/scripts/test-db.js`). No hosted database, production service, native build or device was used.

## 1. Phase 0 — before and after

| Check | Before (baseline, 2026-11-22, before any change) | After Phase 0 |
|---|---|---|
| `cd backend && npm test` | 21 tests · 19 pass · **2 fail** | **36 tests · 36 pass · 0 fail** |
| `npm run test:integration` (backend, throwaway local PostgreSQL) | 25 tests · 24 pass · **1 fail** | **28 tests · 28 pass · 0 fail** |
| `cd mobile && npx tsc --noEmit` | exit 0 | exit 0 |
| `cd mobile && npm run lint` | 0 errors · **30 warnings** | 0 errors · **0 warnings** (run with `--max-warnings 0`, exit 0) |
| `cd mobile && npx expo export --platform web` | not run | **exit 0**, `Exported: dist` (with `EXPO_PUBLIC_BACKEND_URL=https://api.example.com`, a placeholder that is only inlined) |
| `npm run test:all` (repository root) | did not exist | **PASS** on all 5 steps (unit 2 s, integration 18 s, typecheck 3 s, lint 3 s, export 12 s) |

### 1.1 How the original tests map to the new ones

- Original unit suite = 12 session tests + 7 unit tests + 2 showcase tests = 21. The two showcase tests were the failing ones. They were **replaced by 9 invariant tests** (catalog consistency, adult real-calendar birthdates and the requested 24–34 range at a fixed date, valid identical PNG photos in backend and app, photo map equals catalog, documented-orphan rule, fixture isolation, one insert per fixture with no update/delete and idempotent re-seeding, unusable random passwords). They are stricter than before, not looser; only the literal `12`/`6+6` was dropped, because the catalog intentionally has 16 fixtures (6 male, 10 female).
- 8 new unit tests in `backend/test/dbSafety.test.js` (migration classification, local-vs-hosted decision table, approval marker rules, seeding rule, numbering).
- Original integration suite = 25. The hard-coded migration test was **replaced by 4 tests** (every migration file recorded exactly once, in order, and not duplicated by re-initialising; failing migration rolls back and is not recorded; destructive migration refused on non-local/production targets before anything is applied; duplicate/ill-named migration files stop the run). The other 24 are unchanged. 25 − 1 + 4 = 28.
- The new migration tests that apply deliberately broken or destructive SQL use a **scratch database** created and dropped on the same local cluster, never the main test database.

### 1.2 Web preview check (in-app browser, Expo dev server on localhost)

Offline demo session, observed: profile screen shows the name and email and **no "Verified Account"**; "Notification settings" and "Language" are dimmed with "Not available yet"; `/call/audio` and `/call/video` redirect to `/chat`; the edit-profile screen shows a read-only email and no phone field; no console errors. Not exercised interactively: the chat attachment sheet and header (the offline demo has no conversation to open) — covered only by type-check and lint.

## 2. Dependency vulnerability report (`npm run audit:report`, npm registry, 2026-11-22)

| Package | Scope | Critical | High | Moderate | Total |
|---|---|---|---|---|---|
| backend | all | 0 | 0 | 4 | 4 |
| backend | production only | 0 | 0 | 2 | 2 |
| mobile | all | 1 | 17 | 22 | 40 |
| mobile | production only | 1 | 17 | 17 | 35 |

Production-dependency detail (`npm audit --json --omit=dev`):
- **backend (2 moderate):** `express` (via `qs`), `qs` (denial of service via an attacker-controlled `isBuffer`; `qs.stringify` array-format issue). npm reports a non-breaking fix available.
- **mobile (1 critical):** `shell-quote` (command injection via a line terminator in a token). Non-breaking fix available.
- **mobile (17 high):** `@react-navigation/core`, `@xmldom/xmldom`, `brace-expansion`, `browserslist`, `compression`, `decode-uri-component`, `expo-router` (direct), `image-size`, `js-yaml`, `nanoid`, `node-forge`, `postcss` (direct), `query-string`, `socket.io-parser`, `source-map-js`, `tar`, `undici`. For `expo-router`, `decode-uri-component` and `query-string` npm's suggested fix is a **major** upgrade (`expo-router@58`); for `postcss` it suggests `expo@52`, which is a downgrade and should be disregarded. Most of the rest are build-tooling or transitive packages with non-breaking fixes available.

**Nothing was upgraded** (Phase 0 forbids forced/breaking upgrades). Whether each advisory is reachable in the shipped app was not analysed. Tracked in the tracker under dependency follow-up.

## 2b. Release Gate A (2026-11-22) — before and after

| Check | After Phase 0 | After Release Gate A |
|---|---|---|
| `cd backend && npm test` | 36 · 36 pass | **44 · 44 pass** (+2 location unit tests, +6 demo-config tests) |
| Integration (throwaway local PostgreSQL) | 28 · 28 pass | **32 · 32 pass** (+4: leak detector control, other members' coordinates absent from every endpoint, profile setup refuses coordinates, demo login off) |
| `tsc --noEmit` | 0 errors | 0 errors |
| Lint (`--max-warnings 0`) | 0 | 0 |
| Web export | success | success |
| `npm run test:all` | 5/5 | **5/5** (unit 2 s, integration 20 s, typecheck 3 s, lint 11 s, export 23 s) |

**Regression proof.** The two location integration tests were run against the pre-fix `profiles.js` and `auth.js` (restored from `HEAD` for the run, then the fixed files were put back): **30 pass, 2 fail** — the leak test failed on `discovery` with both the coordinate values and the `lat`/`lng` keys detected, and the profile-setup test failed because coordinates were accepted. With the fixes: 32/32. The blueprint test was likewise shown to fail on the original `render.yaml` (`DEMO_LOGIN_ENABLED: "true"`). (An earlier attempt at this proof failed for the wrong reason — a mistaken assertion in my own test about `photos` being an array on brand-new accounts — and was redone after fixing the assertion.)

**What the new tests check**
- `backend/test/integration.test.js`: with real users whose rows hold coordinates, the responses of discovery, likes-you, swipe, `GET /api/matches`, `/api/matches/conversations`, `POST /api/matches`, `POST /api/matches/quick` and the stories feed contain no location-like key anywhere in the payload (`lat`, `lng`, `latitude`, `longitude`, `coords`, `location`, `geo*`, …) and none of the coordinate **values** under any key; discovery and likes-you still list the expected members with all public fields; mutual likes still create matches. Profile setup answers `400 location_not_supported` for every coordinate shape, stores nothing and changes nothing else; ordinary updates still work. With the demo login off: no new demo session (404), status `enabled:false`, an earlier demo token and its socket are rejected, real members unaffected, demo rows not deleted.
- `backend/test/units.test.js`: `toPublicProfile` whitelist drops coordinates and account internals even when selected; `validateProfileInput` refuses coordinates.
- `backend/test/demoConfig.test.js` (new): decision table; the real `config.js` loaded in child processes with production-like environments (`NODE_ENV=production`, `RENDER`, with and without the isolation marker, development, strict `"true"` matching) including the startup warning; `render.yaml` (comments ignored) never enables the demo and carries no isolation marker or dangerous overrides; `.env.example` defaults to off; tokens issued to demo accounts stop working when the demo login is off.
- Web preview (offline demo): Explore shows only "All / New / Recently Active" and still lists profiles; no console errors.

## 2c. Phase 1 (2026-11-22)

| Check | Result |
|---|---|
| `cd backend && npm test` | **77 tests, 77 pass** — session 12, units 12, showcase 9, dbSafety 10, demoConfig 8, age 6, eligibility 16, oauth 4 |
| `npm run test:integration:local` (throwaway local PostgreSQL 18) | **49 tests, 49 pass** — 32 existing + 17 new Phase 1 tests |
| `mobile npx tsc --noEmit` | 0 errors |
| `mobile npm run lint -- --max-warnings 0` | 0 errors, 0 warnings |
| `mobile expo export --platform web` | success (`Exported: dist`) |
| `npm run test:all` (Node v24.16.0) | **5/5 steps pass** (unit 2 s, integration 36 s, typecheck 3 s, lint 5 s, export 12 s) |
| **Node 22.23.5** (obtained through npm): backend unit 77/77, integration 49/49, `tsc` 0, lint 0, web export success | **all pass** |
| CI workflow `.github/workflows/ci-cd.yml` and `render.yaml` | parsed with js-yaml (syntax valid; Node from `.nvmrc` = 22; Render `NODE_VERSION` 22; demo login `false`). **The workflow has not run on GitHub** |
| `npm run audit:report` | unchanged: backend 2 moderate (production), mobile 1 critical + 17 high (production); `expo-crypto` added no advisory |
| Browser check (Expo web dev server + local backend on the throwaway database, in-app browser) | create-account shows date-of-birth fields and the consent checkbox with no Apple/Facebook buttons; an under-18 date is refused with a message; a valid sign-up → verify-code screen with no "verify later"; correct code → gender (nothing pre-selected, Continue disabled until chosen) → interested-in → optional intention skipped → photos (Continue disabled with 0 photos; a remote URL is rejected by the server; an own upload is accepted) → interests/about/preferences skipped → review (summary, age 36, e-mail verified) → Finish → lands in the app with discovery; a full page reload resumes at the exact next step; opening `/explore` while not eligible redirects to the setup step. The photo **file picker** was not driven (the upload went through the API from the page) |

### Security regression tests added in Phase 1 (all in `backend/test/`)

- **Registration** (integration): no account for 11 invalid/missing/impossible dates, for under-18 incl. "turns 18 tomorrow", for missing/old/partial consent, or weak passwords; exactly-18-today works; consent rows and `onboarding_done` recorded; no token for web.
- **Closed doors** (integration): a new account gets 403 `not_eligible` on 16 REST routes + media upload + socket; each of e-mail, completion, date of birth (missing, 17, "18 tomorrow") closes them individually and reopens them.
- **Under 18** (integration): date locked, re-entry refused, all steps/completion/upload refused; `complete-setup` cannot change it; date immutable after completion.
- **Onboarding** (integration): validation per step (19 bad bodies), ownership of photos, client cannot set completion/status/verification, early completion lists `missing`, resume from a brand-new session, completion idempotent, socket opens only afterwards; full journey through the API only (register → verify → onboard → discoverable → match → message).
- **Existing accounts** (integration): an account shaped like the old onboarding output (invented values, unverified, existing match/message/swipe) keeps every record and its session, is closed to dating features, shows no invented value as a choice, must upload a real photo, then completes and still sees its old conversation.
- **Visibility** (integration): incomplete, unverified, minor, suspended and banned members are absent from others' discovery and likes-you, cannot be swiped on / matched (indistinguishable 404), their stories vanish; messages to a member who stops being eligible are refused (403 `unavailable`) and work again after reinstatement.
- **Account status** (integration): suspended / banned / deleted — login 403 with the reason (wrong password still a generic 401), tokens and cookies 401 on account routes too, live socket closed, no new socket (token or earlier ticket); a finished suspension counts as active; reinstatement needs a fresh sign-in; `pending_deletion` may sign in but is not eligible.
- **Sockets** (integration): ineligible member refused (`not_eligible`), web ticket refused, a ticket cannot outlive a ban.
- **OAuth** (integration, Google stubbed; unit for the allow-list): redirect substitution rejected (5 shapes in the integration test, 30+ in the unit test), PKCE required, state random and stored only as a hash, forged/short/expired/replayed state refused without contacting Google, redirect carries only a one-time code (empty body, no-store), wrong/missing/malformed verifier and replayed/expired codes refused, platform mismatch, web gets a cookie and no token, unverified Google e-mail refused with no account created, provider failure and user cancel handled, linking keeps a verified account's password, **pre-registered unverified account is cut off**, suspended account refused through Google, dev mock chooser 404.
- **Route inventory** (unit): 42 routes must match a table of declared classes exactly; every dating route must be `eligible`; every mounted router must be in the inventory.
- **Other**: password strength on register/change/reset; registration rate limit; `age` vectors (53 cases, byte-identical mobile copy); production refuses to start without a mail provider; the verification switch is ignored in production.

### Not run in Phase 1

Native Android/iOS builds, devices and emulators (so no native onboarding, photo picker or Google flow); real Google OAuth; real Resend e-mail delivery; Apple Sign In (blocked); the GitHub workflow; applying 006/007 to a copy of real data. (The two manual e2e scripts were updated and run in the final review: see `PRE_PHASE_2_REVIEW.md`.)

## 3. Not run

Native builds and devices; the GitHub workflow itself (Node 22 was run locally in the final review); Chrome/Firefox/Safari matrix; real email delivery; real Google OAuth; any hosted database; mobile unit/E2E tests (none exist); `npm ci` from scratch (the installed `node_modules` were used).

## 4. How to reproduce

```powershell
npm run test:all          # everything above except the audit, from the repository root
npm run audit:report      # vulnerability report (needs network)
```
