# Phase 0 — Completion report

**Date:** 2026-11-22 · **Branch:** `phase-0-stabilise` (created from `main` @ `a9cff77`) · **Status: PARTIALLY COMPLETE** — all nine tasks are implemented and verified locally; owner review/commit, a remote CI run and a Node 22 run are outstanding (§9).
Nothing was committed or pushed. No hosted service (Render, Neon, Vercel, EAS, stores) was contacted, nothing was deployed, no credential was read or printed.

---

## 1. Executive summary

Phase 0 made the baseline trustworthy and removed the pieces of the product that pretended to work.

- **All checks are green:** backend unit 36/36 (was 19 of 21), integration 28/28 (was 24 of 25), `tsc` 0 errors, lint 0 warnings (was 30), web export succeeds, and `npm run test:all` runs all of it in one command.
- **Most important finding:** the developer `backend/.env` points at a **hosted** database. Before this phase, running `npm run dev` would have applied the two uncommitted **destructive** migrations (004, 005) and seeded fake accounts (three with a known password) into that database. Two guards now prevent both on any non-local database, with tests.
- **Misleading UI removed:** the "Verified Account" label, mock attachment sending, call/voice controls and routes, stub menu items, a fake pre-filled phone number, and the swipe-card "Report or Share" alert.
- **Not changed, deliberately (scope):** other members' raw coordinates are still returned by discovery/likes-you (smallest fix defined as P1-00), onboarding still invents data, the production blueprint still enables the demo login. These are the first items of Phase 1 ("Release Gate A").
- **Nothing real was lost:** all 16 showcase profiles, all their images (including the orphan `tessa.png`), the uncommitted work from the earlier session and migrations 004/005 are intact.

---

## 2. Completed tasks

| Task | Status | Notes |
|---|---|---|
| P0-01 Move master prompt, update references | **COMPLETE** | `docs/implementation/MASTER_PROMPT.md`, 43,816 bytes, content unchanged; references updated |
| P0-02 Review existing work | **PARTIALLY COMPLETE** | review in §6 and docs; owner must approve commits, 004/005 and the `tessa.png` resolution |
| P0-03 Showcase tests | **COMPLETE** | 2 stale tests → 9 invariant tests |
| P0-04 Migration integration test | **COMPLETE** | 1 stale test → 4 tests (order, once-only, failure atomicity, guard) on a scratch database |
| P0-05 Authoritative schema | **COMPLETE** | documented; legacy schema archived with a "do not deploy" banner |
| P0-06 Lint | **COMPLETE** | 30 → 0 warnings; hook effects reviewed by hand |
| P0-07 Node/CI/`test:all` | **PARTIALLY COMPLETE** | works locally; GitHub workflow not executed; Node 22 not run |
| P0-08 Misleading UI | **COMPLETE** | verified in the web preview (not on native) |
| P0-09 Documentation | **COMPLETE** | five required docs + cleanup runbook + this report |
| Extra: migration guard, seeding guard, runbook | **COMPLETE** | pulled forward from Phase 9 by the owner's correction list |
| Extra: plan corrections R1–R7 | **COMPLETE** | §11 |

---

## 3. Modified files

**Already modified/untracked before this phase (owner's earlier work — preserved):** `backend/data/showcase-profiles.json`, `mobile/assets/profiles/catalog.json` (12 → 16 profiles), `backend/db.js` (8 of 11 mock seeds removed), `mobile/lib/demoData.ts`, `mobile/lib/showcaseProfiles.ts`, `mobile/lib/store.ts`, `mobile/components/ProfileDetailsModal.tsx`, migrations `004`/`005`, nine new profile PNGs (`brooke`, `claire`, `ivy`, `sadie` in both folders; `tessa` backend only).

**Changed by Phase 0 (33 tracked files modified/deleted per `git diff --shortstat`: +580 −541, which includes the earlier uncommitted work above):**

| Area | Files |
|---|---|
| Backend | `db.js` (safe runner, scratch-pool support, seeding guard), `package.json`, `test/showcase.test.js`, `test/integration.test.js` |
| Mobile UI | `app/(tabs)/profile.tsx`, `app/chat-thread.tsx`, `app/call/audio.tsx`, `app/call/video.tsx`, `app/profile/edit-profile.tsx`, `components/SwipeDeck.tsx` |
| Mobile lint-only | `app/(tabs)/index.tsx`, `app/_layout.tsx`, `app/auth/sign-in.tsx`, `app/auth/verify-code.tsx`, `app/matched.tsx`, `app/onboarding.tsx`, `app/profile-setup/{birthday,language,photos}.tsx`, `app/search.tsx`, `components/OtpInput.tsx` |
| Config/CI | `package.json` (root), `mobile/package.json`, `.github/workflows/ci-cd.yml`, `README.md`, `docs/TESTING_CHECKLIST.md` |
| Removed (moved) | `mobile/db/schema.sql` → `docs/archive/legacy-supabase-schema.sql` |

**New files:** `.nvmrc`, `backend/dbSafety.js`, `backend/test/dbSafety.test.js`, `backend/scripts/run-integration.js`, `scripts/test-all.js`, `scripts/audit-report.js`, `mobile/lib/features.ts`, `docs/archive/legacy-supabase-schema.sql`, and under `docs/implementation/`: `MASTER_PROMPT.md` (moved), `BASELINE_AUDIT.md`, `IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_TRACKER.md`, `ARCHITECTURE.md`, `DATABASE_MIGRATIONS.md`, `KNOWN_LIMITATIONS.md`, `TEST_REPORT.md`, `PRODUCTION_CLEANUP_RUNBOOK.md`, `PHASE_00_COMPLETION_REPORT.md`. (A git-ignored `.claude/launch.json` was created locally for the preview server.)

---

## 4. Existing functionality preserved

- Backend: no route, query, schema or API shape changed. The only runtime changes are in startup (`db.js`): migration safety checks and the seeding guard. The 24 original integration tests (sessions, cookies/CSRF, login, password reset, email codes, matching, real-time chat both ways, two devices, outsiders, presence, media, stories, health) and all original unit tests other than the two stale showcase ones pass unchanged.
- Mobile: no navigation, store, API-client or messaging logic changed. Gallery and Camera attachments, photo sending, the existing client-side notifications screen, stories, matching and the offline demo all remain. Visual style and branding are untouched; the only layout adjustment is evenly spacing the two remaining attachment options.
- Data: nothing deleted. All showcase assets kept. 004/005 were not edited, moved or applied anywhere shared.

---

## 5. Bugs fixed

1. **Stale showcase tests** (expected 12 profiles; data is 16) — replaced with invariants, not loosened (§7).
2. **Stale migration-list test** — now derived from the directory; also proves failure atomicity and the guard.
3. **Hazard: destructive migrations reaching shared databases** (D-40, new) — guard + tests.
4. **Hazard: fake accounts (known password) seeded into a hosted dev database** (D-40, new) — guard + tests.
5. **Lint (30 warnings):** unused imports/variables removed; `Array<T>` style; `matched.tsx` duplicate import merged. Hook-dependency fixes, each reasoned: `_layout.tsx` and `(tabs)/index.tsx` add `initializeStore` / `fetchDiscoveryProfiles` (stable store actions — no re-run change); `matched.tsx` adds the reanimated shared values (stable) so the entrance animation still runs once; `SwipeDeck.tsx` extracts `topProfileId` and lists `tx`/`ty` so the reset still fires only when the top card changes; the **story auto-advance timer** in `(tabs)/index.tsx` now reads the latest handler through a ref and depends on the story count/type, which keeps its restart conditions the same while removing a stale-closure risk. An unused `eslint-disable` in `verify-code.tsx` was removed. Checked: typecheck, lint, export, and the home deck, match screen and chat thread in the web preview. **Not exercised interactively:** the story viewer timer.
6. **Misleading UI** (D-10, D-17, D-17b, part of D-04, D-38): see `KNOWN_LIMITATIONS.md` §B for the before/after table.
7. **Stale docs:** README test instructions and testing checklist updated to the real commands and counts.

---

## 6. Migration safety review

**Review of the uncommitted work (Task 2):**

| Item | Finding | Disposition |
|---|---|---|
| Catalog 12 → 16 (JSON ×2) | Identical in backend and app; 6 male + 10 female; ages 24–34; all dates real; every key has an identical valid PNG in both folders; the app's photo map covers exactly the catalog | **Kept** (Q3). Invariant-tested |
| New PNGs | `brooke`, `claire`, `ivy`, `sadie` present in both folders and referenced | Kept |
| `tessa.png` | Only in `backend/public/profiles/`; referenced nowhere (orphan) | **Kept, not deleted.** Registered as a known orphan in the test, which fails if it ever stops being one. Recommendation: either add a "tessa" entry + app asset + loader line (needs your decision on a new fictional person) or delete it after approval. Low risk meanwhile (a static file, reachable only by its direct URL; no list or screen references it) |
| `backend/db.js` (−117 lines) | Removes the data of 8 mock seeds; the seeder now keeps three (`isabelle`, `liam`, `zoe`) | Kept. Phase 0 additionally gates all seeding to local databases |
| `mobile/lib/demoData.ts`, `store.ts` | Offline demo now only uses showcase profiles; mock stories removed | Kept |
| `ProfileDetailsModal.tsx` | New: starts on a "profile-galleries" photo if present and labels it "AI-generated additional photo". No such assets exist in the repo, so the branch is inert today | Kept; flagged here |
| Migrations 004/005 | Each is one `DELETE FROM profiles WHERE id IN (…)` over nine exact `seed-*` ids; cascades to swipes (also swipes real members made on those ids), matches, messages, `match_reads`, `auth_codes`, media, stories; `images.owner_id` → `NULL` | **Untouched, held back from shared databases by the guard.** Not approved |

**How the runner behaved (Task 3):** it applied every unapplied file in name order at every startup, in a transaction each, with **no environment awareness** — so it would have run 004/005 on any database `DATABASE_URL` pointed at. The developer `.env` points at a hosted host (classified only; value not read).

**Now:** destructive files (classified by statement, comments ignored) run automatically only on a local database outside production; elsewhere they need a review marker **and** `ALLOW_DESTRUCTIVE_MIGRATIONS=true`; otherwise the runner refuses before applying anything. Names/numbers are validated; a failing file rolls back and is not recorded. **Consequence to plan for:** a hosted deploy of this branch will stop at startup until you run the cleanup by hand (runbook) and record 004/005 as applied, or remove those two files.

**Testing:** only an isolated local PostgreSQL and per-test scratch databases were used. Production/staging were never contacted. Full details and recovery strategy: `DATABASE_MIGRATIONS.md`; owner procedure: `PRODUCTION_CLEANUP_RUNBOOK.md` (not executed).

**Gaps in migration history (BLOCKED items):** none blocking. What cannot be established from the repository is which migrations the hosted database has already applied (that needs its `schema_migrations` table, which was not read). The runbook's read-only queries cover it.

---

## 7. Before-and-after test results

| Check | Before | After |
|---|---|---|
| Backend unit | 21 · 19 pass · 2 fail | **36 · 36 pass** |
| Integration | 25 · 24 pass · 1 fail | **28 · 28 pass** |
| `tsc --noEmit` | 0 errors | 0 errors |
| Lint | 0 errors · 30 warnings | 0 errors · 0 warnings |
| Web export | not run | success |
| `npm run test:all` | n/a | 5/5 steps pass |

The unit count grew because the two stale tests became 9 stronger ones and 8 safety tests were added; the original 19 passing tests are unchanged. Integration: 24 unchanged + 4 new − 1 replaced. See `TEST_REPORT.md` §1.1 for the mapping. Environment: Node v24.16.0; nothing run on Node 22, native or hosted services.

---

## 8. Dependency vulnerabilities (reported, not fixed)

| Package | Scope | Critical | High | Moderate | Total |
|---|---|---|---|---|---|
| backend | production | 0 | 0 | 2 | 2 |
| backend | all | 0 | 0 | 4 | 4 |
| mobile | production | 1 | 17 | 17 | 35 |
| mobile | all | 1 | 17 | 22 | 40 |

Mobile critical: `shell-quote`. Mobile high (production): `@react-navigation/core`, `@xmldom/xmldom`, `brace-expansion`, `browserslist`, `compression`, `decode-uri-component`, `expo-router`, `image-size`, `js-yaml`, `nanoid`, `node-forge`, `postcss`, `query-string`, `socket.io-parser`, `source-map-js`, `tar`, `undici`. Backend: `express`/`qs`. Most have non-breaking fixes available; the `expo-router`/`decode-uri-component`/`query-string` chain needs a major upgrade; npm's `postcss` suggestion (`expo@52`) is a downgrade and should be ignored. No upgrades were made. Reachability was not analysed. Follow-ups DEP-1/DEP-2.

---

## 9. Remaining blockers and outstanding verification

1. Owner review and commit of the working tree (nothing is committed).
2. Owner decision on 004/005, and execution of the cleanup runbook before any hosted deploy of this code.
3. The updated GitHub workflow has not run; Node 22 has not been run locally.
4. Native (Android/iOS) behaviour unverified; story-viewer timer not exercised interactively.
5. Decisions still provisional: Q5, Q6, Q12 (retention periods, deletion grace, Sri Lankan launch/legal).
6. Production state is **unknown** (fake rows, demo login, applied migrations).

---

## 10. Security risks (still open after Phase 0)

| Risk | Where it stands |
|---|---|
| Other members' coordinates in discovery/likes-you payloads (D-05) | **Open** — latent (nothing in the app sets coordinates); fix is P1-00 |
| No age/eligibility/suspension gating anywhere (D-01) | Open — Phase 1 |
| Onboarding saves invented data (D-03) | Open — Phase 1 |
| Production blueprint enables shared demo login; possible fake rows live (D-08) | Open — P1-00b + owner-run runbook |
| `demo.js` deletes `is_demo` rows on every demo login (D-41) | Open, documented |
| No blocking/reporting/moderation; stories global; no image moderation (D-04, D-06, D-18) | Open — Phases 2 and 7 |
| Google OAuth token in redirect URL (D-07); verification unenforced (D-09) | Open — Phase 1 |
| Dependency advisories (D-43) | Reported |
| Secrets: no `.env` was ever committed (checked in git history); if an archive containing one left the machine, rotate (owner) | Open (owner) |

**Do not expose any environment to real users until Release Gate A and Phases 1–2 are complete.**

---

## 11. Implementation-plan corrections made

Applied in `IMPLEMENTATION_PLAN.md` §0 (revision log) and the sections it names:

- **R1** match-lifecycle schema moved to Phase 2 as migration **008**, delivered before unmatch/block; safety tables are **009**; P4-01 adds no schema.
- **R2** migration numbers reserved and never reused; order/numbering enforced by `orderMigrationFiles()` and tests.
- **R3** exempt routes replaced by a **default-deny route-policy registry** with an exact allowlist and a status × route matrix; token-issuing paths check status.
- **R4** coordinate fix defined as **P1-00** (remove two columns from two SELECTs, stop accepting coordinates, hide "Nearby", recursive-key test) and scheduled first.
- **R5** file validation separated from content moderation; no image may be called "approved"/"screened" without a screening step; launch gate defined.
- **R6** job worker specified with leases, expiry, heartbeat, retry/backoff/jitter, crash recovery, idempotency keys, dead-lettering, stale-writer protection and tests.
- **R7** **Release Gate A** added: guard and seeding protection done now; coordinate fix, demo-login removal and cleanup runbook execution come before any real-user exposure.
- Decision table rewritten to distinguish approved from provisional (also in the tracker).

---

## 12. Git diff summary

- Branch `phase-0-stabilise`, no commits beyond `a9cff77`, no stash, nothing staged.
- Tracked files: **33 changed, +580 / −541** (includes the owner's earlier uncommitted edits to 7 files; `mobile/db/schema.sql` shows as deleted because it was moved to `docs/archive/`).
- Untracked: **19 entries** (new code/scripts/docs/assets listed in §3, plus migrations 004/005 and nine PNGs from before).
- Line endings: git warns that some edited files will be converted LF→CRLF on next touch; existing CRLF files were edited preserving CRLF.
- Suggested commit split when you are ready (not done): (1) docs and master-prompt move; (2) migration/seeding safety + tests; (3) showcase catalog and assets (your earlier work); (4) mobile lint and honesty fixes; (5) CI/Node/scripts. Migrations 004/005 should stay out of the commit until you decide on them.

---

## 13. Recommended next actions

1. Review the diff; decide what to commit (split above) and the fate of `tessa.png`.
2. Decide on migrations 004/005 (approve with marker, keep local-only, or drop).
3. Run the updated CI on a pull request (this also tests Node 22).
4. Review `PRODUCTION_CLEANUP_RUNBOOK.md`; take a recovery point and run it yourself on a Neon branch copy first. Do this before any hosted deploy.
5. Approve P1-00b (remove `DEMO_LOGIN_ENABLED` from the production blueprint).
6. Start Phase 1 with P1-00 (coordinates), then migration 006 and the eligibility work.
7. Plan the dependency upgrade path (DEP-1/DEP-2) separately.

---

## 14. Phase 1 readiness verdict

**READY TO START in development, with conditions.** The baseline is green, the destructive-data and fake-account hazards are guarded, the plan dependencies are corrected, and the first Phase 1 tasks are specified.

Conditions before starting: (a) you review/commit Phase 0 (or confirm Phase 1 may build on the uncommitted tree); (b) you decide on 004/005 so they do not block deploys; (c) you approve P1-00b. **Not ready for any production or real-user exposure** — that requires Release Gate A and Phases 1–2.
