# Phase 1 — Completion report (authentication, onboarding, eligibility)

> **Update (after this report was written):** Phase 1 is committed locally in `378eac8` (the tooling in `47b8a13`; not pushed, not deployed). Statements below about an uncommitted working tree describe the state when this report was written. Validation: `PRE_PHASE_2_REVIEW.md` and the tracker log.

**Date:** 2026-11-22 · **Branch:** `phase-0-stabilise` (no new branch; same uncommitted working tree as Phase 0 and Release Gate A)
Nothing was committed, pushed or deployed. No hosted database or service was contacted; no credential was read or printed (the developer `backend/.env` was only classified as "hosted", never opened for values, and every local run overrode its sensitive settings).

**Status: PARTIALLY COMPLETE.** The backend work is complete and tested (unit 77, integration 49, also on Node 22). The web app was verified end to end in a browser against a local backend. **Not verified:** native Android/iOS, real Google sign-in, real e-mail delivery. **Blocked:** Apple Sign In.

---

## 1. Task 0 — migration safety and baseline verification

| Item | Result |
|---|---|
| Working tree preserved | A manifest of 63 changed/untracked files (git blob hashes) was taken first; at the end 37 are byte-identical, 23 changed only because this phase edits them, 3 moved or were replaced (see below). No stash, nothing staged, no commits. |
| Migrations 004/005 | Owner preference followed: **local-only**. **Archived** (moved, not edited; SHA-1 identical before and after) to `backend/ops/local-dev-cleanup/` with a README. The runner reads only `migrations/`. |
| Can they be archived without breaking history, ordering or checksums? | **Yes.** The runner stores only the file name in `schema_migrations`; there are **no checksums**. Names recorded in a database are tolerated (`RETIRED_MIGRATION_NAMES`, no "missing on disk" warning); the numbers 4 and 5 stay reserved (`orderMigrationFiles` rejects reuse). |
| Applied state of hosted databases | **Cannot be established** (no hosted access, by rule): documented as unknown; it does not matter for correctness now; the runbook has the read-only query. Not guessed. |
| No automatic destructive SQL on a future hosted deploy | Three layers: files are out of `migrations/`; the guard refuses destructive migrations on non-local/production databases; a test fails if a destructive file ever appears in `migrations/` (and if one of the retired files stopped being destructive or got an approval marker). |
| Node.js 22 | Obtained Node **22.23.5** through npm. Backend unit 77/77, integration 49/49 (throwaway local PG), `tsc`, lint (0 warnings) and web export all pass on it. |
| CI configuration | `.github/workflows/ci-cd.yml` and `render.yaml` parsed with js-yaml: valid; Node from `.nvmrc` (22); Render `NODE_VERSION` 22; demo login `false`. The workflow itself has **not run** on GitHub. |
| Available tests run | `npm run test:all` on Node 24 (5/5) and the same checks on Node 22. |
| Nothing lost before any commit | Manifest comparison above. Moved/replaced: `migrations/004`, `005` (moved, identical), `mobile/app/profile-setup/language.tsx` (replaced by the new gender/interested-in screens; the guessing logic it contained was the defect). `height.tsx` was replaced by `about.tsx`. Both old screens remain in git history (`HEAD`). |

---

## 2. What Phase 1 delivered

### 2.1 Backend

| Task | Delivered | Status |
|---|---|---|
| P1-01 Migration 006 | `profiles.status/suspended_until/status_changed_at/profile_completed_at/onboarding_step/onboarding_done/relationship_intention`, static birthdate CHECK (`NOT VALID`), `user_preferences`. Additive; every existing member becomes `active`, not completed; nothing deleted. | COMPLETE |
| P1-02 Age rules | `backend/age.js` (strict `YYYY-MM-DD`, real calendar, ≥1900, not future, ≤120, UTC date, leap-day rule), 53 shared vectors, a **byte-identical** `mobile/lib/age.js` (test fails if they differ). | COMPLETE |
| P1-03 Registration | Needs real adult DOB + accepted current policy versions + strong password; under-18/invalid → **no account**; consents and `basics`/`birthday` confirmations written in one transaction; per-IP registration limiter; the server now enforces the password rule the app only previewed. | COMPLETE |
| P1-04 Eligibility | `eligibility.js`: one definition (active, adult from the stored date, verified e-mail, completed profile), `requireEligible`/`requireAdult`, SQL for "visible to others". One query per request loads the account. A **route inventory test** pins every route's class. | COMPLETE |
| P1-05 REST + sockets | Every dating route is `eligible`; socket connect (token and ticket) requires eligibility and an active account; `join_room` re-checks; messages to a member who stopped being eligible are refused; incomplete/underage/unverified/suspended members are invisible to others and cannot be swiped on or matched. `accountStatus.setAccountStatus` ends sessions and closes live sockets. | COMPLETE |
| P1-06 Onboarding API | `GET/PATCH /api/onboarding(/:step)`, `POST /complete`: 11 steps, server-confirmed, resumable, only the server sets `profile_completed_at`; under-18 date locks. | COMPLETE |
| P1-08 Mandatory verification | Eligibility requires `email_verified_at`; production refuses to start without a mail provider; dev switch ignored in production. | COMPLETE (delivery untested) |
| P1-10 OAuth | `oauth.js`: exact redirect allow-list, random one-time state (hash stored), PKCE (also towards Google), verified-e-mail only, one-time exchange code (60 s, single use, bound to the app's challenge and platform), no token/user/e-mail in any URL, unverified-account takeover protection. | PARTIALLY COMPLETE (Apple blocked; real Google untested) |
| P1-11 `complete-setup` | Refuses `birthdate`, `lat/lng`; enums for gender/interested-in; new photos must be the member's own uploads; cannot touch completion/status/verification. | COMPLETE |

Also: `session.js` reports a suspended/banned/deleted status before token age (clearer errors); login returns 403 with the reason only **after** a correct password; demo accounts are finished, verified, active fixtures; `birthdate` is returned as a `YYYY-MM-DD` string everywhere.

### 2.2 Mobile (web verified; native not run)

New server-driven setup flow `app/profile-setup/*` (entry, consent, basics, birthday, gender, interested-in, intention, photos, interests, about, preferences, review) with a shared shell (progress, back, error area, Continue/Skip, accessibility roles) and `ChoiceStep`; state in `lib/onboardingStore.ts` is never persisted (the server is the source of truth, so setup resumes on any device). The create-account screen now collects the date of birth and consent; "Verify later" is gone; the route guard keeps ineligible members in setup; real-time connects only when the server says eligible; the profile screen shows "Email verified / not verified" only; Google sign-in uses PKCE + one-time code (needs `expo-crypto`, installed with `npx expo install`); fake Apple/Facebook buttons and the old guessing screens were removed; privacy policy rewritten as a factual **draft** (fictional date and unsupported claims removed) and a draft Terms screen added.

---

## 3. Modified and new files

**New (backend):** `age.js`, `eligibility.js`, `onboarding.js`, `oauth.js`, `accountStatus.js`, `policies.js`, `migrations/006_account_state.sql`, `migrations/007_consents_oauth.sql`, `ops/local-dev-cleanup/` (+README), tests `age.test.js`, `eligibility.test.js`, `oauth.test.js`, `fixtures/age-vectors.json`.
**Modified (backend):** `auth.js` (rewritten: registration, login, narrow `complete-setup`, `/me`; Google code moved out), `session.js`, `config.js`, `db.js`, `dbSafety.js`, `profiles.js`, `swipes.js`, `matches.js`, `media.js`, `images.js`, `accountSecurity.js`, `passwords.js`, `demo.js`, `realtime.js`, `index.js`, `package.json`, `.env.example`, tests `integration.test.js`, `units.test.js`, `session.test.js`, `demoConfig.test.js`, `dbSafety.test.js`.
**New (mobile):** `lib/age.js`, `lib/onboardingApi.ts`, `lib/onboardingStore.ts`, `components/onboarding/{OnboardingShell,ChoiceStep}.tsx`, `components/LegalDocument.tsx`, `app/profile-setup/{index,consent,basics,gender,interested-in,intention,interests,about,preferences,review}.tsx`, `app/profile/terms.tsx`.
**Modified (mobile):** `lib/store.ts`, `lib/types.ts`, `lib/accountApi.ts`, `lib/validation.ts`, `app/_layout.tsx`, `app/index.tsx`, `app/auth/{create-account,sign-in,get-started,verify-code}.tsx`, `app/profile-setup/{birthday,photos}.tsx`, `app/(tabs)/profile.tsx`, `app/profile/privacy-policy.tsx`, `components/common/ResponsiveFrame.tsx`, `package.json` (+`expo-crypto ~15.0.9`) and lock.
**Removed:** `app/profile-setup/language.tsx`, `app/profile-setup/height.tsx` (replaced).
**Config/docs:** `render.yaml` (comment only), `README.md`; `docs/implementation/`: `API_REFERENCE.md` (new), `DATABASE_MIGRATIONS.md`, `SECURITY_CHECKLIST.md`, `TEST_REPORT.md`, `IMPLEMENTATION_TRACKER.md`, `IMPLEMENTATION_PLAN.md`, `KNOWN_LIMITATIONS.md`, `ARCHITECTURE.md`, `PRODUCTION_CLEANUP_RUNBOOK.md`, this report.
Overall working tree vs `main` @ `a9cff77` (including Phases 0 and Release Gate A and the owner's earlier work): 62 tracked files changed (+2302 / −1789) plus 47 untracked entries. No commits, no stash, nothing staged.

---

## 4. Migrations

`006_account_state.sql`, `007_consents_oauth.sql` — both additive, classified non-destructive by the guard, applied and tested on isolated local databases. **Not** applied to a copy of real data. Details and recovery: `DATABASE_MIGRATIONS.md`. Next free numbers: 008 (match lifecycle) and 009 (safety), reserved for Phase 2.

---

## 5. Test results

| Check | Result |
|---|---|
| Backend unit (`npm test`) | **77 / 77** (Node 24 and Node 22) |
| Backend integration (isolated local PostgreSQL) | **49 / 49** (Node 24 and Node 22) — 32 existing kept passing under the new rules + 17 new |
| `tsc --noEmit` | 0 errors (Node 24 and 22) |
| ESLint `--max-warnings 0` | 0 (Node 24 and 22) |
| Expo web export | success (Node 24 and 22) |
| `npm run test:all` | 5 / 5 steps (Node 24) |
| Dependency audit | unchanged (backend 2 moderate, mobile 1 critical + 17 high in production deps) |
| Browser check of the real web flow | register → under-18 refused → valid sign-up → e-mail code → onboarding steps → review → finish → app; reload resumes at the right step; route guard redirects |

Full list of regression tests: `TEST_REPORT.md` §2c. Existing tests were **updated, not weakened**: they now create members the way the API now requires (adult DOB, consent, strong password, plus a direct database shortcut to "eligible" for tests that are not about onboarding), and the two assertions about `birthdate` in `complete-setup` changed to assert the new refusal.

---

## 6. Security checks (summary; full table in `SECURITY_CHECKLIST.md` §5b)

Under-18 users cannot reach dating features (REST and sockets), and an under-18 date locks. Impossible/loose/future dates cannot bypass validation (53 vectors, same code in the app). Incomplete profiles cannot call protected endpoints and are invisible to others. Suspended/banned/deleted accounts cannot sign in, keep a token, or hold a socket. E-mail verification is enforced. Nothing invented is stored or shown as a choice; photos must be the member's own uploads. Google sign-in uses secure state, PKCE and a one-time code; no token or user record appears in any redirect URL. Real-time connections enforce account status and eligibility. Existing accounts keep all data and sessions and can complete the new steps.

---

## 7. Outstanding external requirements and open issues

| Item | Owner action / note |
|---|---|
| **Resend API key + verified sender domain** | **Required before the next production deploy**: the backend now refuses to start in production without `RESEND_API_KEY` and `MAIL_FROM` (fail closed). Real delivery untested. |
| Google OAuth credentials and registered redirect URI `<backend>/api/auth/google/callback` | Needed to test the native flow for real. |
| **Apple developer account** | Sign in with Apple is **BLOCKED**; required on iOS if Google is offered (check current App Store guidelines). |
| Native devices | Onboarding, photo picker and Google flow were not run on Android/iOS. |
| Legal review | Terms/Privacy are drafts (`draft-1`); consent is recorded against that label. |
| Appeals / data requests for suspended members | D-45: they cannot sign in; Phase 2 (appeals) and Phase 6 (export/delete). |
| Sockets and direct database edits | D-44: only `setAccountStatus` closes sockets. |
| Self-declared age | A minor can type an adult date; identity/age verification is Phase 10. |
| Manual e2e scripts | Updated in the final review (D-47 fixed); run with `npm run test:e2e`; not in CI. |
| Hosted data | Production state unknown; the cleanup runbook is the owner's. |
| `tessa.png`, commit of the working tree | Owner decisions. |
| Time zone | Age uses today's date in UTC; members east of UTC can be held back a few hours on their 18th birthday (safe direction). |

---

## 8. Remaining risks

Dependency advisories (mobile 1 critical + 17 high) unchanged. Registration reveals whether an e-mail exists (409) — accepted. The 11-step onboarding is long; optional steps can be skipped. The new screens were checked on web only, so layout on small phones and native keyboard behaviour are unverified.

---

## 9. Phase 2 readiness verdict

**Ready to start Phase 2 in development.** Phase 2 begins with **migration 008 (match lifecycle)** and then 009 (safety tables), as planned. The pieces Phase 2 depends on exist: account status with enforced session/socket behaviour (`setAccountStatus`), the eligibility predicate and `candidateSql` (to add "not blocked either way"), and the route-inventory test (new safety routes must declare a class).

Conditions: (a) you review and commit the working tree (or confirm Phase 2 may build on it); (b) before any production deploy of this code, configure Resend (the service will not start without it); (c) nothing in Phase 1 is a reason to expose the app to real users — blocking, reporting, moderation, deletion and final policies are still missing (`SECURITY_CHECKLIST.md` §6).
