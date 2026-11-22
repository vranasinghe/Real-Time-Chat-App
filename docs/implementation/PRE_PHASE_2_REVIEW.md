# Pre-Phase 2 review (Phase 1 final review and git preparation)

Date: 2026-11-22 · Branch: `phase-0-stabilise` (from `main` @ `a9cff77`) · When this review was written nothing was committed; the four commits in section 6 were created afterwards with your approval. Nothing is pushed or deployed. No hosted service or database was contacted; `backend/.env` was never read.

## 1. Verdict

| Question | Answer |
|---|---|
| Is Phase 1 complete as specified, apart from external blockers? | **Yes**, except P1-10 Apple Sign In (blocked: no Apple developer credentials). |
| Is the working tree safe to commit? | **Yes.** No secrets, `.env` files, logs, databases or build output are tracked or untracked-unignored; all existing user code and showcase work is preserved (section 5). |
| Ready to start Phase 2 (admin/moderation/appeals work)? | **Yes.** The four commits in section 6 now exist locally, so Phase 2 starts from a clean, reviewable base, once you approve the Phase 2 plan and its pending decisions. |
| Ready to deploy to production? | **No.** See section 7: no native or real-provider (Google, Resend) run, hosted migration state unknown, Apple missing, dependency advisories open. |

## 2. Security review results

Each item names the evidence. "Integration" means the suite in `backend/test/integration.test.js` on a throwaway local PostgreSQL with real sockets.

| Requirement | Result | Evidence |
|---|---|---|
| Strict adult eligibility (18+) | Pass | `age.js` (UTC calendar-date rule) with 53 shared vectors; the SQL rule used in discovery (`adultCutoffSql`) is proven to agree with `age.js` for every shared vector (new integration test); under-18 and future dates refused at registration and onboarding |
| DOB validation | Pass | Real calendar dates only (leap days, impossible dates, > 120 years, future); DOB immutable after onboarding completes; an under-18 value locks the account out of dating features |
| Server-driven onboarding | Pass | 11 steps confirmed by the server; `profile_completed_at` is set only by `POST /api/onboarding/complete`; `complete-setup` no longer accepts it; remote photo URLs refused (`photo_not_owned`) |
| E-mail verification enforced | Pass | Eligibility requires `email_verified_at`; production refuses to start without `RESEND_API_KEY` and `MAIL_FROM`; the `REQUIRE_EMAIL_VERIFICATION=false` switch is ignored in production (unit + integration) |
| Suspension / ban enforcement | Pass | Suspended, banned, deleted: login 403 with reason (wrong password still generic 401), tokens and cookies rejected on every account route, live socket closed, no new socket from an old token or ticket; a finished suspension counts as active; reinstatement needs a fresh sign-in |
| OAuth state + PKCE | Pass (stubbed Google) | Exact redirect allow-list (5 substitution shapes in integration, 30+ in unit); random 256-bit state stored only as a hash; app PKCE S256 required, plus a separate PKCE leg to Google; replay, expiry, wrong verifier and platform mismatch refused; **new:** one state and one exchange code each succeed for exactly one of two simultaneous requests; Google's `email_verified` must be boolean `true` (the string `"true"` is refused, no account created) |
| No tokens in redirect URLs | Pass | Callback redirects with only a one-time code (60 s, hashed, bound to platform and challenge), bare 302, `no-store`; no token, user or e-mail in any URL |
| Protected Socket.IO | Pass | Ineligible member refused (`not_eligible`); web uses single-use tickets that cannot outlive a ban; membership of the match is checked server-side (Eve gets 403 in the e2e script) |
| Secure legacy-account migration | Pass | Migrations 006/007 keep every existing row byte-identical (new integration test); nobody is marked completed, verified-by-migration or consented; older accounts sign in, then must finish onboarding; their old invented values are not offered as choices |
| No fabricated profile information | Pass | The values the old app invented (birthday 1999-01-01, canned bio, four default interests, height 175, stock photos) are not presented as choices; pre-existing rows are not rewritten |
| Privacy-safe discovery | Pass | `candidateSql` hides ineligible, suspended, banned, unfinished and under-age members; coordinates are not exposed (Gate A, P1-00) |
| Production demo disabled | Pass | `demo.js` refuses in production unless explicitly configured; the e2e runner forces `DEMO_LOGIN_ENABLED=false` (Gate A, P1-00b) |
| Route classification | Pass | Unit test fixes the class of every route (`public`, `session`, `adult`, `eligible`); every dating route must be `eligible`; every mounted router must be in the inventory |

Repository hygiene: a connection-string and secret-assignment scan of all 210 non-ignored text files found only placeholders (11) and **0 items to review**. No `.env`, key, log, SQLite or `dist/` file is tracked or would be added. `git diff --check` reports no whitespace errors (only the usual LF/CRLF notices from `core.autocrlf` on Windows).

## 3. Migration review

| Item | Finding |
|---|---|
| `001`-`003` | Untouched; already-applied files are never edited. |
| `004`/`005` (mock-profile removal) | Contained destructive `DELETE`s. They are **archived** in `backend/ops/local-dev-cleanup/` (with a README) and are no longer in `migrations/`. The runner records names only (no checksums), tolerates the retired names, and numbers 4 and 5 are reserved so they cannot be reused. A hosted database that already applied them keeps the history rows; one that never did will never run them. **What a hosted database actually recorded is unknowable from here; check it yourself (runbook).** |
| `006_account_state.sql`, `007_consents_oauth.sql` | Additive only: new columns with neutral defaults, new tables, new constraints that apply to new data (`status` values, DOB range). No `DROP`, `DELETE`, `TRUNCATE` or data rewrite. Ordering is sound: 006 before 007; both depend only on the base schema and 001-003. |
| History compatibility | New integration test: a database built exactly as before Phase 1 (base schema + 001-003, plus 004/005 recorded) with realistic legacy data (profiles with invented values, swipes, match, messages, reads, image, auth code) is upgraded; only 006 and 007 run; every pre-existing column of every pre-existing row is identical; re-running changes nothing; history lists the applied files plus the retired names in order. |
| Destructive-SQL guard | `dbSafety.js` refuses destructive statements on non-local or production databases unless a marker and `ALLOW_DESTRUCTIVE_MIGRATIONS=true` are both present; a test fails if a destructive file is placed in `migrations/`. |
| Hosted databases | Not contacted. No SQL of any kind was run anywhere except throwaway local clusters. |
| `mobile/db/schema.sql` | Deleted from the app folder and kept as `docs/archive/legacy-supabase-schema.sql` (it described a retired Supabase schema and could mislead). Review this deletion when you read the diff. |

## 4. Test results

All run on this machine against throwaway local PostgreSQL; nothing hosted.

| Suite | Node 24.16.0 | Node 22.23.5 (the pinned major) |
|---|---|---|
| Backend unit (8 files) | 77/77 | 77/77 |
| Backend integration | 51/51 | 51/51 |
| Manual E2E: chat (`npm run test:e2e`) | 10 checks | 10 checks |
| Manual E2E: images | 8 checks | 8 checks |
| Mobile TypeScript (`tsc --noEmit`) | 0 errors | 0 errors |
| Mobile lint (`--max-warnings 0`) | 0 warnings | 0 warnings |
| Web export (`expo export --platform web`) | OK | OK |
| `npm run test:all` | 5/5 steps PASS | (steps run individually, as above) |

Changes made in this review to get there:

- **E2E scripts (D-47, fixed):** `chat.e2e.js` and `images.e2e.js` now register through the real API with a date of birth, accepted policies and a strong password, and finish onboarding (`backend/test/e2eHelpers.js`). All three chat members, including the outsider, are onboarded so the outsider's 403 comes from match membership, not from ineligibility. `backend/scripts/run-e2e.js` (`npm run test:e2e`) starts a throwaway PostgreSQL and its own backend and overrides every sensitive setting (database, JWT secret, no mail provider, no Google client, demo off, development-only `REQUIRE_EMAIL_VERIFICATION=false`); it refuses a non-local `TEST_DATABASE_URL`. The scripts still need `E2E_CONFIRM_DISPOSABLE_DB=1` and tell you if the server requires verified e-mail.
- **New tests:** OAuth concurrency and strict-boolean checks; SQL-vs-JS adulthood agreement; 006/007 upgrade without data loss. The previous count was 49 integration tests; it is now 51 (the OAuth additions sit inside an existing test).
- **Code change:** `eligibility.js` exports `adultCutoffSql(todayExpr)`; the existing constant is built from it, so behaviour is unchanged.

### Not verified (external integrations and environments)

| Not run | Consequence |
|---|---|
| Native Android and iOS builds, devices, emulators | No claim is made about native onboarding, photo picker, deep-link return from Google, or secure storage. Only the web build was driven (in a browser against a local backend). |
| Real Google OAuth | Backend flow tested with a stubbed Google; real consent screen, redirect URIs and client configuration unproven. |
| Real Resend e-mail delivery | Codes are tested through the data layer, not delivered mail. |
| Apple Sign In | Not built (blocked). Required by Apple if Google sign-in ships on iOS. |
| The GitHub Actions workflow | Edited but never executed on GitHub. |
| Hosted database state and 006/007 on a copy of real data | Never touched. The upgrade is proven on synthetic legacy data only. |
| `npm ci` from scratch, browser matrix | Installed `node_modules` were used; Chrome-class browser only. |
| Mobile unit or device E2E tests | None exist. |

## 5. Git status and preservation

131 changed paths (including this report): 61 modified, 3 deleted (`mobile/db/schema.sql`, `mobile/app/profile-setup/height.tsx`, `mobile/app/profile-setup/language.tsx`), 67 new untracked files. Nothing was reverted, stashed or overwritten.

Your earlier work is preserved; the showcase part is the first commit (`2b8c384`): the showcase catalogue (`backend/data/showcase-profiles.json`, `mobile/assets/profiles/catalog.json`, 12 → 16 profiles), the four new profile images (brooke, claire, ivy, sadie) in backend and mobile, `tessa.png` (an orphan; `showcase.test.js` lists it as a known orphan), `mobile/lib/demoData.ts`, `mobile/lib/showcaseProfiles.ts`, `mobile/components/ProfileDetailsModal.tsx`. Your removal of mock seed data in `backend/db.js` is in `b11eb4b`, and of mock stories in `mobile/lib/store.ts` in `378eac8`, inside those files.

The two deleted profile-setup screens (`height`, `language`) are replaced by the new server-driven steps (`basics`, `about`, `preferences`, ...); no other screen routes to them (the typed-routes check and `tsc` pass).

## 6. The four commits (created locally after approval; not pushed)

| Order | Hash | Message |
|---|---|---|
| 1 | `2b8c384` | Add showcase profiles and demo catalogue |
| 2 | `b11eb4b` | Add migration safety guard and retire local-only cleanup scripts |
| 3 | `378eac8` | Implement Phase 1: adult eligibility, server-driven onboarding, verified e-mail, account status and Google sign-in |
| 4 | `47b8a13` | Add Node 22 pin, test runner and strict CI gates (Phase 0) |

A fifth, documentation-only commit followed (see `git log`). Below is the plan as it was approved; the results of the clean-worktree check run after committing are in the tracker session log and the phase reports.

Order: **1 showcase, 2 migration safety, 3 Phase 1, 4 tooling and CI.** Your preference was showcase, tooling, migration safety, Phase 1. I moved tooling to the end for one reason: its gates (zero lint warnings, type check, web export, `test:all`) cannot pass until the mobile fixes that sit inside the Phase 1 screens are in, so tooling placed earlier would leave a red repository state. In this order every state is green on the backend, and states 3 and 4 are green end to end.

Every changed path is covered (131 of 131). Three files are split by hand because their final content mixes commits: `backend/db.js` (commit 2 has everything except the step that writes migration 006's columns), `backend/package.json` (versions for commits 2 and 3, final in 4) and `mobile/package.json` (version for 3, final in 4). They are staged from exact blobs, not by editing your working tree, which stays untouched. Commits 4's tree is byte-identical to your working tree (checked with a temporary index; see below).

### State-by-state results (Node 22.23.5, fresh throwaway database each time)

| After commit | Backend unit | Integration | Mobile type check | Lint | Web export |
|---|---|---|---|---|---|
| 1 showcase | 28/28 | n/a (no DB code) | see note | see note | not run |
| 2 migration safety | 38/38 | 25/25 | see note | see note | not run |
| 3 Phase 1 | 77/77 | 51/51 | 0 errors | 0 warnings | OK |
| 4 tooling (= working tree) | 77/77 | 51/51 | 0 errors | 0 warnings | OK |

Note on commits 1 and 2: the app code is still `main`'s, so lint reports `main`'s existing 30 warnings (fixed in commit 3, inside the screens it rewrites). The type check shows only 3 route-type lines (`/profile-setup/height`, `/profile-setup/language`); those routes exist on `main`, and the errors appear only because my check reused the final tree's generated route types, so I treat them as a test-harness artefact, not a defect. I could not make the mobile checks clean at those two states without splitting Phase 1 screens line by line. The first web-export attempt at state 4 failed with "No routes found" and passed on retry with `--clear` (a stale bundler cache shared between my temporary copies; the working-tree export also passes).

Full run on the real working tree, Node 22.23.5: `npm run test:all` 5/5 (unit, integration, type check, lint with 0 warnings, web export) and `npm run test:e2e` (chat 10 checks, images 8 checks). A secret scan of 211 files: 0 items to review.

#### Commit 1 (15 files)

```text
Add showcase profiles and demo catalogue

Sixteen fictional showcase profiles (up from twelve) with four new portrait images, the matching mobile catalogue, the
showcase loader and the profile details modal. Mock demo profiles with stock photos are removed from the demo data.
The showcase test now checks invariants (valid adults, matching server and app catalogues, valid PNGs, no unlisted
orphans) instead of a fixed head-count. Existing work, committed as it was.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Files (M modified, D deleted, ?? new):

```text
M  backend/data/showcase-profiles.json
M  mobile/assets/profiles/catalog.json
?? backend/public/profiles/brooke.png
?? backend/public/profiles/claire.png
?? backend/public/profiles/ivy.png
?? backend/public/profiles/sadie.png
?? backend/public/profiles/tessa.png
?? mobile/assets/profiles/brooke.png
?? mobile/assets/profiles/claire.png
?? mobile/assets/profiles/ivy.png
?? mobile/assets/profiles/sadie.png
M  mobile/lib/demoData.ts
M  mobile/lib/showcaseProfiles.ts
M  mobile/components/ProfileDetailsModal.tsx
M  backend/test/showcase.test.js
```

#### Commit 2 (12 files)

```text
Add migration safety guard and retire local-only cleanup scripts

Refuse destructive SQL (DELETE FROM, DROP, TRUNCATE ...) on non-local or production databases unless a reviewed marker and
ALLOW_DESTRUCTIVE_MIGRATIONS=true are both present; check every pending file before applying any. Gate development seeding
to local databases. Reserve migration numbers 4 and 5 and tolerate their recorded names. Move the two mock-profile cleanup
scripts out of migrations/ into ops/local-dev-cleanup/ so no startup can run them. Run the integration tests on a throwaway
local PostgreSQL (scripts/run-integration.js). Archive the retired Supabase schema. Remove 8 of 11 mock seed profiles.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Files (M modified, D deleted, ?? new):

```text
?? backend/dbSafety.js
M  backend/db.js   (intermediate version; final in commit 3)
M  backend/package.json   (intermediate version; final in commit 4)
?? backend/scripts/run-integration.js
?? backend/test/dbSafety.test.js
?? backend/ops/local-dev-cleanup/004_remove_requested_mock_profiles.sql
?? backend/ops/local-dev-cleanup/005_remove_additional_mock_profiles.sql
?? backend/ops/local-dev-cleanup/README.md
?? docs/archive/legacy-supabase-schema.sql
D  mobile/db/schema.sql
?? docs/implementation/DATABASE_MIGRATIONS.md
?? docs/implementation/PRODUCTION_CLEANUP_RUNBOOK.md
```

#### Commit 3 (96 files)

```text
Implement Phase 1: adult eligibility, server-driven onboarding, verified e-mail, account status and Google sign-in

Server: strict 18+ rule on a UTC calendar date; consent policies; migrations 006 (account state) and 007 (consents, OAuth
state and codes), both additive; eligibility and account-status modules gate every dating route and Socket.IO connection;
suspended, banned and deleted members cannot hold a session or socket; ineligible members are hidden from discovery;
complete-setup is restricted; the server-driven onboarding API (11 steps) replaces invented profile defaults; e-mail
verification is mandatory and production refuses to start without a mail provider; the shared demo login is off in
production; no coordinates in discovery.
Google sign-in: exact redirect allow-list, hashed random state, app PKCE plus PKCE to Google, verified e-mail only, one-time
exchange code bound to platform and challenge, nothing sensitive in any URL, takeover protection.
App: onboarding screens and store driven by the server, consent and terms screens, under-18 and birth-date lock handling,
updated sign-in and sign-up, expo-crypto for PKCE, zero lint warnings.
Tests: age vectors, eligibility, OAuth, route inventory, demo config, account status, migration upgrade of legacy data,
SQL and JS adulthood agreement; manual chat and image E2E scripts updated and runnable with npm run test:e2e.
Docs: tracker, API reference, architecture, security checklist, test report, known limitations, Phase 1 reports and the
pre-Phase 2 review.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Files (M modified, D deleted, ?? new):

```text
M  backend/.env.example
M  backend/accountSecurity.js
M  backend/auth.js
M  backend/config.js
M  backend/demo.js
M  backend/images.js
M  backend/index.js
M  backend/matches.js
M  backend/media.js
M  backend/passwords.js
M  backend/profiles.js
M  backend/realtime.js
M  backend/session.js
M  backend/swipes.js
M  backend/test/chat.e2e.js
M  backend/test/images.e2e.js
M  backend/test/integration.test.js
M  backend/test/session.test.js
M  backend/test/units.test.js
M  docs/AUTH_AND_DEPLOYMENT.md
M  docs/TESTING_CHECKLIST.md
M  mobile/app/(tabs)/explore.tsx
M  mobile/app/(tabs)/index.tsx
M  mobile/app/(tabs)/profile.tsx
M  mobile/app/_layout.tsx
M  mobile/app/auth/create-account.tsx
M  mobile/app/auth/get-started.tsx
M  mobile/app/auth/sign-in.tsx
M  mobile/app/auth/verify-code.tsx
M  mobile/app/call/audio.tsx
M  mobile/app/call/video.tsx
M  mobile/app/chat-thread.tsx
M  mobile/app/index.tsx
M  mobile/app/matched.tsx
M  mobile/app/onboarding.tsx
M  mobile/app/profile-setup/birthday.tsx
D  mobile/app/profile-setup/height.tsx
D  mobile/app/profile-setup/language.tsx
M  mobile/app/profile-setup/photos.tsx
M  mobile/app/profile/edit-profile.tsx
M  mobile/app/profile/privacy-policy.tsx
M  mobile/app/search.tsx
M  mobile/components/OtpInput.tsx
M  mobile/components/SwipeDeck.tsx
M  mobile/components/common/ResponsiveFrame.tsx
M  mobile/lib/accountApi.ts
M  mobile/lib/store.ts
M  mobile/lib/types.ts
M  mobile/lib/validation.ts
M  mobile/package-lock.json
M  render.yaml
?? backend/accountStatus.js
?? backend/age.js
?? backend/eligibility.js
?? backend/migrations/006_account_state.sql
?? backend/migrations/007_consents_oauth.sql
?? backend/oauth.js
?? backend/onboarding.js
?? backend/policies.js
?? backend/scripts/run-e2e.js
?? backend/test/age.test.js
?? backend/test/demoConfig.test.js
?? backend/test/e2eHelpers.js
?? backend/test/eligibility.test.js
?? backend/test/fixtures/age-vectors.json
?? backend/test/oauth.test.js
?? docs/implementation/API_REFERENCE.md
?? docs/implementation/ARCHITECTURE.md
?? docs/implementation/IMPLEMENTATION_TRACKER.md
?? docs/implementation/KNOWN_LIMITATIONS.md
?? docs/implementation/PHASE_01_COMPLETION_REPORT.md
?? docs/implementation/PHASE_01_RELEASE_GATE_A_REPORT.md
?? docs/implementation/PRE_PHASE_2_REVIEW.md
?? docs/implementation/SECURITY_CHECKLIST.md
?? docs/implementation/TEST_REPORT.md
?? mobile/app/profile-setup/about.tsx
?? mobile/app/profile-setup/basics.tsx
?? mobile/app/profile-setup/consent.tsx
?? mobile/app/profile-setup/gender.tsx
?? mobile/app/profile-setup/index.tsx
?? mobile/app/profile-setup/intention.tsx
?? mobile/app/profile-setup/interested-in.tsx
?? mobile/app/profile-setup/interests.tsx
?? mobile/app/profile-setup/preferences.tsx
?? mobile/app/profile-setup/review.tsx
?? mobile/app/profile/terms.tsx
?? mobile/components/LegalDocument.tsx
?? mobile/components/onboarding/ChoiceStep.tsx
?? mobile/components/onboarding/OnboardingShell.tsx
?? mobile/lib/age.js
?? mobile/lib/features.ts
?? mobile/lib/onboardingApi.ts
?? mobile/lib/onboardingStore.ts
M  backend/db.js
M  backend/package.json   (intermediate version; final in commit 4)
M  mobile/package.json   (intermediate version; final in commit 4)
```

#### Commit 4 (12 files)

```text
Add Node 22 pin, test runner and strict CI gates (Phase 0)

Pin Node 22 (.nvmrc, engines), add npm run test:all, test:e2e and audit:report, and make CI use .nvmrc, run the type check,
lint with zero warnings and the web export, and report dependency advisories without failing the build. Add the Phase 0
planning documents: master prompt, baseline audit, implementation plan and completion report; update the README.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Files (M modified, D deleted, ?? new):

```text
?? .nvmrc
M  package.json
M  mobile/package.json
M  backend/package.json
?? scripts/test-all.js
?? scripts/audit-report.js
M  .github/workflows/ci-cd.yml
M  README.md
?? docs/implementation/MASTER_PROMPT.md
?? docs/implementation/BASELINE_AUDIT.md
?? docs/implementation/IMPLEMENTATION_PLAN.md
?? docs/implementation/PHASE_00_COMPLETION_REPORT.md
```

**What the pre-commit checks established**

1. Nothing is staged and there is no stash; the branch is `phase-0-stabilise`. All 131 paths are accounted for; no existing file is dropped or reverted.
2. No `.env`, key, log, database, throwaway cluster or build output would be committed (`mobile/dist` is ignored; the web exports and the temporary copies live outside the repository).
3. Migrations 004 and 005 are only in `backend/ops/local-dev-cleanup/`. The runner reads only `backend/migrations/`, which holds 001-003, 006 and 007; it contains no `DROP`, `TRUNCATE` or `DELETE FROM`; `dbSafety.js` refuses destructive SQL on non-local databases and only mentions the ops folder in a comment.
4. Migrations 006 and 007 are in commit 3, together with every file that depends on them. Commit 2 contains no code that needs them (the db.js step that writes their columns is held back to commit 3).
5. Tests ride with their implementation: `showcase.test.js` in 1, `dbSafety.test.js` in 2, all other tests, the E2E scripts and the Phase 1 documentation in 3. Documentation in commits 2 and 4 describes the final state of the project, so a few sentences refer forward to files from commit 3.
6. A dry run built all four cumulative trees with a temporary index and compared the last one to the whole working tree: the trees were **identical**. It only wrote Git objects, no refs, and left the real index and your working tree untouched.

**Caveats**

- Commit 1 contains binary images and the owner's mock-removal in `demoData.ts`; the mock stories removal in `mobile/lib/store.ts` stays in commit 3 with the other changes to that file.
- Git will warn about LF to CRLF on Windows (`core.autocrlf`); content is unaffected.
- Nothing is pushed.

## 7. Remaining Phase 1 blockers and open items

| Id | Item | Blocks |
|---|---|---|
| D-46 | Apple Sign In not implemented (no Apple developer account/keys) | iOS release with Google sign-in |
| D-45 | Suspended/banned members cannot sign in, so they have no appeal or data-request channel | Phase 2 (appeals), Phase 6 (export/delete) |
| D-44 | A socket stays open if eligibility is lost through a direct database edit (only `setAccountStatus` closes sockets) | Phase 2 (admin tools call it) |
| — | Hosted database history for 004/005 unknown; applying 006/007 to hosted data needs a backup and a reviewed run | Any deploy |
| — | Real Google, real Resend, native devices unverified | Any release |
| D-43 | Dependency advisories: mobile 1 critical + 17 high (production deps), backend 2 moderate; reported, not fixed | Release |
| — | Self-declared age only; identity/age verification is Phase 10 | Policy decision |
| — | `mobile/.env` targets `http://localhost:3000`, where an unrelated app answers on this machine; use another backend port locally. No credentials were ever sent there. | Local dev convenience |

None of these blocks starting Phase 2 on a local, unreleased branch. D-44 and D-45 are Phase 2's own inputs.

## 8. Phase 2 readiness

**Ready to begin once you approve the Phase 2 plan and decisions (the commit plan was approved and executed).** The server enforces eligibility and account status on REST and sockets, the migration path is additive and tested against legacy data, the test suites pass on Node 22 and 24, and the manual E2E scripts work again. Phase 2 starts from the committed base, then takes D-44 and D-45 first because the admin and appeal tools depend on them.

Not started: Phase 2, any deployment, any hosted-database access.
