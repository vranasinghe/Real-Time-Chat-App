# Dateza — Implementation Plan

**Date:** 2026-11-22 (revised after Phase 0 and Phase 1, see §0) · **Inputs:** `docs/implementation/MASTER_PROMPT.md`, `BASELINE_AUDIT.md`, `PHASE_00_COMPLETION_REPORT.md`, `PHASE_01_RELEASE_GATE_A_REPORT.md`, `PHASE_01_COMPLETION_REPORT.md` · **Status of this document:** Phases 0 and 1 are implemented; Phases 2–10 are planned and not started.
**Companion:** `IMPLEMENTATION_TRACKER.md` (task-level status; update it as work lands).

Defect ids (`D-xx`) refer to `BASELINE_AUDIT.md` §6. Task ids (`P<phase>-<nn>`) are tracked in the tracker.

---

## 0. Revision log

**2026-11-22 — corrections made after Phase 0 (owner request).** Each is reflected in the sections named.

| # | Concern | Correction | Where |
|---|---|---|---|
| R1 | Unmatch (Phase 2) needed schema that was scheduled in Phase 4 | The match-lifecycle migration moves to Phase 2 and becomes **migration 008, delivered before unmatch/block**; safety tables become **009**. P4-01 no longer adds schema. | §4 P2, P4, §6 |
| R2 | Numbering and order must stay consistent | Numbers are **reserved in the §6 roadmap and never reused**; a slipped phase keeps its number; `orderMigrationFiles()` (Phase 0) rejects duplicate numbers and bad names, and a gap-free check in `dbSafety.test.js` guards the sequence. | §6 |
| R3 | Suspended/deleted accounts could bypass eligibility through broadly exempt auth/account routes | Replaced "exempt prefixes" with a **default-deny route policy**: every route declares a class; exempt routes are an exact method+path allowlist, further narrowed by account status. Token-issuing paths (login, OAuth exchange, password reset) also check status. | §4 P1 |
| R4 | Raw coordinates in public API payloads | New first task **P1-00** (smallest safe fix, a few lines plus a test), done before any other Phase 1 work. | §4 P1 |
| R5 | File validation was conflated with content moderation | Phase 7 separates **validation/sanitising** from **moderation**; no image is labelled "approved" without a screening step; launch gate defined. | §4 P7 |
| R6 | Job-worker design was thin | Phase 5 now specifies leases, lock expiry, heartbeats, retries with backoff and jitter, crash recovery, idempotency keys, dead-lettering and the tests for each. | §4 P5 |
| R7 | Demo-isolation and destructive-migration safeguards were scheduled late | **Done in Phase 0:** migration guard, seeding guard. **Release Gate A** (new) pulls the remaining production items — demo login off in the production blueprint, owner-run cleanup runbook, coordinates fix — to the very start of Phase 1, before any real-user exposure. | §2, §4 P1, §4 P9 |

**2026-11-22 — Phase 1 outcome and deviations from the plan (owner-visible).**

| # | Deviation | Why | Where |
|---|---|---|---|
| R8 | **Suspended, banned and deleted accounts cannot hold a session at all** (login → 403, tokens/sockets → 401), instead of the planned "limited session for appeals/export". | Owner instruction for Phase 1 ("cannot authenticate"). It also removes the "exempt routes" bypass (R3). **Consequence:** appeals and data requests for those members need a separate channel (D-45: Phase 2 appeals, Phase 6 export/delete). `pending_deletion` may still sign in (to cancel) but is not eligible. | P1-04 |
| R9 | The route policy is **tagged middleware + an exact inventory test**, not a separate `routePolicy.js` registry. | Smaller, and a new route without a declared class fails the test. | P1-04 |
| R10 | `user_preferences` (age range) is created in **migration 006**, not 010. | The onboarding preferences step needed a home; 010 extends it. | §6 |
| R11 | Migrations 004/005 were **retired** (archived outside `migrations/`, numbers reserved). | Owner decision Q14. | §6, DATABASE_MIGRATIONS.md |
| R12 | In production the backend **refuses to start without a mail provider** (e-mail verification is mandatory). | Fail closed; without it nobody could become eligible. The next production deploy needs `RESEND_API_KEY` and `MAIL_FROM`. | config.js |
| R13 | Apple Sign In is **BLOCKED**, not implemented. | No Apple developer credentials. Required on iOS if Google sign-in is offered (verify against current App Store guidelines). | P1-10 |

---

## 1. Ground rules for execution

1. **Preserve what works.** The chat core (idempotent sends, paging, read receipts, reconnect catch-up), the session model (HttpOnly cookie + CSRF + `token_version`, SecureStore on native), config validation, health checks, graceful shutdown and the existing 46 tests are assets. Every phase must keep `npm test`, `npm run test:integration`, `tsc` and `lint` green.
2. **Expand / contract migrations.** Every schema change is a new numbered file in `backend/migrations/` (next free number is **008** after Phase 1: 004/005 are retired and archived in `backend/ops/local-dev-cleanup/`, 006/007 are committed). Additive first (new nullable columns, `NOT VALID` constraints, `CREATE INDEX IF NOT EXISTS`), backfill in a separate step, tighten later. Never edit an applied migration. Each migration ships with a recovery note in `DATABASE_MIGRATIONS.md` (what to restore / what the inverse statement is). No `DROP`/`TRUNCATE`/destructive `DELETE` against shared databases without explicit owner approval.
3. **Local and throwaway databases only.** Integration tests run only against `scripts/test-db.js` (local PostgreSQL 18 is installed) or the CI service container. Production (Render/Neon/Vercel/EAS/stores) is never touched without the owner's explicit instruction.
4. **Server decides.** Eligibility, blocks, status, privacy and moderation are enforced in the backend (REST and Socket.IO). Client guards are only UX.
5. **No fake features.** Anything that looks functional must be functional or be removed/disabled with honest copy.
6. **Expo SDK 54.** Before touching any mobile API, check `docs.expo.dev/versions/v54.0.0/` (note the caveat in `BASELINE_AUDIT.md` §8) and use `npx expo install` so versions match SDK 54. No major framework upgrades.
7. **One phase, one branch, small reviewable commits.** Commit only when the owner asks. After each phase: run all suites, update the tracker and the phase report (template in the tracker), then stop for review.
8. **Definition of complete.** A task is COMPLETE only with backend + frontend integration + migration (if needed) + automated tests + docs, and verified output recorded in `TEST_REPORT.md`. Otherwise PARTIALLY COMPLETE.

---

## 2. Dependency map

```
P0 Stabilise ──► P1 Eligibility & onboarding ──┬─► P2 Safety & moderation ──┬─► P3 Profile & discovery
                 (account status, consent,      │   (blocks, reports,         │
                  age, verified email, OAuth)   │    unmatch, admin)          ├─► P4 Matching & chat ──► P5 Notifications & jobs
                                                │                             │
                                                └─► P6 Privacy & deletion ◄───┘ (needs jobs from P5 for async purge/export)
                                                          │
                                       P7 Media & stories ◄┘ (needs blocks from P2, jobs from P5, storage decision)

P8 UI/UX      – continuous; each phase ships its own screens, P8 is the consistency/accessibility pass.
P9 Deployment – environment separation starts early (P0/P1 config), full hardening after P5.
P10 Advanced  – only after P1–P7 and P9 are COMPLETE.
```

Hard dependencies:
- **Account status column + eligibility middleware (P1-01, P1-04)** before anything that suspends, bans, blocks or deletes.
- **`user_blocks` + the shared "blocked either way" SQL fragment (P2-02)** before the discovery rewrite (P3), stories audience (P7), notifications (P5).
- **Match-lifecycle schema (migration 008)** before block/unmatch behaviour (P2-04, P2-07): both set `matches.status`.
- **Job runner (P5-01)** before account purge/export (P6), media cleanup/orphan sweep (P7), push retries (P5). Moderation does not need it: suspension end is evaluated at request time from `suspended_until`.
- **Release Gate A** (below) before any real person other than the owner can reach a production environment.
- **Storage decision (Q8, §3)** before P7 schema work.
- **Legal text review** gates publication of P6 policies (not their implementation).

**Release Gate A — before any real-user exposure (blocks every later phase's production rollout).**

| Item | Status |
|---|---|
| Destructive-migration guard on shared/production databases (`dbSafety.js`, tested) | **DONE (Phase 0)** |
| Fake-account seeding refused on non-local databases (`canSeedDevData`, tested) | **DONE (Phase 0)** |
| Other members' coordinates removed from discovery and likes-you payloads (P1-00) | **DONE (Release Gate A; committed locally in `378eac8`)** — tested locally |
| `DEMO_LOGIN_ENABLED` off in the production blueprint, and ignored by the backend in production unless `DEMO_ENVIRONMENT=isolated`; demo, if wanted, runs as a separate service with its own database (P1-00b) | **DONE in code/config (committed locally in `378eac8`, not pushed, not deployed)** — takes effect when the owner deploys |
| Owner-run production cleanup runbook reviewed and executed by the owner (`PRODUCTION_CLEANUP_RUNBOOK.md`, prepared in Phase 0, **not executed**) | PREPARED — execution is the owner's action |
| Migrations 004/005 not applied to any shared database until the owner approves them (the guard enforces this) | ENFORCED |

Parallelism: P2 backend and P3 backend touch overlapping files (`profiles.js`, `matches.js`), so run them **sequentially**. Safe parallel lanes after P1: (a) admin dashboard UI, (b) mobile UI for safety screens, (c) docs/policy drafting — each in its own worktree.

---

## 3. Owner decisions

Recorded 2026-11-22. **Approved for implementation** = the owner has decided; build to it. **Provisional** = the direction is decided but a number, text or legal point still needs owner/legal confirmation; implement the mechanism configurably and do not publish final values.

| # | Decision | Status | Still needed |
|---|---|---|---|
| Q1 | Persistent matches until unmatch, block or account deletion | **Approved** | — |
| Q2 | Stories visible only to authorised active matches | **Approved** | the per-user audience toggle is an addition to confirm |
| Q3 | Keep all 16 showcase profiles as isolated development/demo fixtures; never expose as real members | **Approved** | — (isolation limits are listed in KNOWN_LIMITATIONS) |
| Q4 | TOTP MFA required for privileged moderation staff | **Approved** | staff list, enrolment process |
| Q5 | Documented message-retention and safety-evidence policy | **Provisional** | retention periods need owner + legal approval |
| Q6 | Immediate account disablement; 14-day deletion grace proposed | **Provisional** | grace period subject to policy/legal review |
| Q7 | Production cleanup: runbook only, the agent never executes it | **Approved** (runbook only) | the owner executes |
| Q8 | PostgreSQL media storage for the MVP behind a reusable storage abstraction (S3-compatible later) | **Approved** | — |
| Q9 | Email + Google sign-in; Apple Sign In where applicable to the iOS release | **Approved** (Apple conditional) | Apple developer account; confirm the iOS release includes Google |
| Q10 | At least one authentic profile photo required; three recommended | **Approved** | — |
| Q11 | Video stories disabled until secure processing exists | **Approved** | — |
| Q12 | Plan for an initial Sri Lankan launch | **Provisional** | final owner confirmation; legal review (age of majority, data-protection law including Sri Lanka's Personal Data Protection Act, app-store requirements) |
| Q13 | Move `MASTER_PROMPT.md` into `docs/implementation/` | **Approved — DONE in Phase 0** | — |

---

## 4. Phases

Effort: S ≈ under a day, M ≈ 1–3 days, L ≈ 3–7 days, XL ≈ more than a week (one engineer, including tests and docs).

### Phase 0 — Stabilise and document (P0 priority, effort M)

Goal: a green, trustworthy baseline and honest UI before feature work. No product behaviour changes except removing controls that pretend to work.

| Task | Work | Files | Tests / acceptance |
|---|---|---|---|
| P0-01 | Place docs: decide Q13, commit-ready `docs/implementation/*`. | `docs/` | Folder matches the master prompt §18. |
| P0-02 | **Review uncommitted WIP** (showcase catalog 12→16, db.js seed removal, mobile demo changes, **destructive** migrations 004/005). Owner approves what to commit. Migration 004/005 must be listed-then-deleted by owner on shared DBs; locally harmless. | `backend/migrations/004,005`, `backend/db.js`, catalog files | Owner sign-off recorded; orphan `tessa.png` resolved (add to catalog or delete). |
| P0-03 | Fix stale showcase tests so they assert **real invariants** (ids unique, catalogs identical, ages 24–34 as the catalog states, photos exist in both folders, seeding is `ON CONFLICT DO NOTHING` and one call per profile) using `profiles.length` rather than literals. | `backend/test/showcase.test.js` | `npm test`: 21/21. Not a loosening: invariants listed above are asserted. |
| P0-04 | Integration migrations test derives expected list from the `migrations/` directory (each file recorded exactly once; re-init does not duplicate). | `backend/test/integration.test.js` | `test:integration`: 25/25. |
| P0-05 | Mark `mobile/db/schema.sql` archived (move to `docs/archive/` or delete after approval); write authoritative schema note. | `mobile/db/schema.sql`, `DATABASE_MIGRATIONS.md` | Docs state `db_init.sql` + `migrations/` are authoritative. |
| P0-06 | Lint to **zero warnings** (unused imports; `Array<T>`; two `exhaustive-deps` reviewed by hand — `SwipeDeck` and `matched` are animation code, do not auto-fix blindly). | listed in audit §3 | `npm run lint` 0 warnings; screens manually smoke-checked. |
| P0-07 | Tooling: `.nvmrc`/`engines` pin Node 22 to match CI/Render (local is 24); add `test:all` script; CI adds `expo export --platform web` and a non-blocking `npm audit` report. | root `package.json`, `.github/workflows/ci-cd.yml` | CI green on a PR. |
| P0-08 | **Honesty stop-gaps (minimal diffs):** replace unconditional "Verified Account" with neutral text; remove "Send Mock" attachment path (keep Gallery/Camera); hide call buttons in chat header and the two call routes behind a `FEATURE_CALLS=false` constant; replace SwipeDeck "Options" alert and the Notifications/Language menu stubs with hidden or "Coming soon — not available" **disabled** states. Real replacements arrive in later phases. | `profile.tsx`, `chat-thread.tsx`, `SwipeDeck.tsx`, `call/*`, menu items | tsc + lint; manual check that no control triggers a fake action. Addresses D-10, D-17, D-17b, D-04 (partly). |
| P0-09 | Seed `TEST_REPORT.md` with the baseline numbers from the audit; create empty stubs for the remaining required docs with owners/phase. | `docs/implementation/` | Files exist; no contradictory content. |

Exit criteria: all suites green, tracker updated, WIP decisions recorded.

---

### Phase 1 — Authentication, onboarding, eligibility (P0, effort XL)

Depends on: P0. Addresses D-01, D-02, D-03, D-07, D-09, D-10, D-11 (consent part), D-22, D-38.

**Task order inside Phase 1:** P1-00 and P1-00b first (Release Gate A), then P1-01 onward.

**P1-00 — Smallest safe coordinate fix (do first). ✅ DONE in Release Gate A — see `PHASE_01_RELEASE_GATE_A_REPORT.md`.** `profiles.js` selects `p.lat, p.lng` in both `/discovery` and `/likes-you`. Remove those two columns from the two SELECT lists (no other query returns another member's coordinates: `matches.js` already omits them). Stop `complete-setup` accepting `lat`/`lng` (nothing in the UI sends them). In `explore.tsx` the "Nearby" chip tests `p.lat != null`; with the field gone it would hide every profile, so hide the chip until Phase 3 supplies real distance. Test: a recursive key scan of both responses asserts no `lat`, `lng`, `latitude` or `longitude` anywhere, and that a seeded profile that has coordinates still appears. No schema change, no migration, reversible by revert. Distance labels and consent follow in P3-03.

**P1-00b — Demo isolation in production. ✅ DONE in Release Gate A (code and config; not deployed).** Remove `DEMO_LOGIN_ENABLED: "true"` from the production service in `render.yaml` (the default is off); document the separate-demo-service option. Needs owner go-ahead because it changes the next production deploy. Verify with a config unit test plus the existing integration test that demo accounts stay hidden.

**Design**

- **Account state** (migration `006_account_state.sql`, additive): `profiles.status` (`active | suspended | banned | pending_deletion | deleted`, default `active`, check constraint), `suspended_until`, `profile_completed_at`, `onboarding_step` (small int / text), `terms_version`, `terms_accepted_at`, `privacy_version`, `privacy_accepted_at`; `CHECK (birthdate IS NULL OR (birthdate >= DATE '1900-01-01' AND birthdate <= CURRENT_DATE))` added `NOT VALID` then validated after backfill review. Existing users stay `active` with NULL `profile_completed_at` (they re-enter onboarding on next login; existing data kept, **nothing invented, nothing deleted**). Pre-existing accounts with no birthdate are simply **ineligible** until they provide one.
- **Age** (`backend/age.js`): strict `YYYY-MM-DD` parse, real calendar validation (rejects `2008-02-30`, year < 1900, future), age computed from the date only in UTC, Feb-29 rule documented (adult on 1 March in non-leap years). A shared JSON of test vectors is used by the backend test and the mobile `validation.ts` so both agree.
- **Eligibility** (`backend/eligibility.js`): one query loads `status, suspended_until, birthdate, email_verified_at, profile_completed_at`; `requireEligible({ adult, completeProfile, verifiedEmail, active })` middleware, plus a socket-level `assertEligible(userId)` used at connect and on every privileged event. Error shape: `403 { code: "not_eligible", reason: "age|profile_incomplete|email_unverified|suspended|banned" }` — reasons are generic enough not to reveal other users' state. **Route policy (default deny; replaces exempt prefixes):** every route declares exactly one class in a registry (`backend/routePolicy.js`), and a startup/test check fails if an Express route has no entry. Classes: `public` (register, login, password-reset request/confirm, OAuth start/exchange, config, health); `session` (a valid session of **any** status, exact method+path allowlist only: `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me` with a limited projection; `POST /api/auth/socket-ticket` is **never** available to non-active accounts); `onboarding` (status `active`, profile incomplete); `account-lifecycle` (export, delete, cancel-deletion, appeals, support — allowed per the status matrix below); `eligible` (all dating routes). Status matrix: `active` → by class; `suspended` → `session` + `account-lifecycle` only, no sockets, no onboarding edits; `banned` → `session` + export/delete/appeal only; `pending_deletion` → `session` + cancel-deletion + export only; `deleted` → nothing (login answers like unknown credentials). **Token-issuing paths check status too:** login, OAuth exchange, password-reset confirm and the `change-password` re-issue refuse `deleted`, and give `suspended`/`banned` a session limited to the classes above. A route-inventory test enumerates all routes against the registry and a status × route matrix test asserts the table. Suspension takes effect on the next request/connect and **disconnects live sockets** (`io.in("user:<id>").disconnectSockets(true)` — helper in `realtime.js`).
- **Onboarding** server-driven: `GET /api/onboarding` returns saved fields + current step + validation errors; `PATCH /api/onboarding/:step` validates and saves one step; `POST /api/onboarding/complete` re-validates everything and only then sets `profile_completed_at` — the client can never mark itself complete. Steps (master prompt §4.3): account details → email verification → DOB → gender → interested-in → intentions → photos → interests → bio/prompts → discovery preferences → review. Missing optional fields stay `NULL`/`[]`. `complete-setup` stays for backward compatibility but can no longer set `profile_completed_at` and no longer accepts `lat/lng` (moved to P3 with consent).
- **Verification truthfulness:** `email_verified_at` only. No phone/identity columns now ("add only what is needed"); `identity_verified_at` is added in Phase 10 when a real process exists. UI shows an "Email verified" status in account settings only; the badge component takes an `identityVerified` prop that is always false until then.
- **OAuth** (`oauth_transactions`, migration `007`): random 256-bit `state`, PKCE `code_challenge`/`verifier`, exact-match redirect allowlist (app scheme path, configured web origin paths; localhost only when `APP_ENV=development`), 10-minute single-use rows. Callback issues a **one-time exchange code** (60 s) to the app; the app calls `POST /api/auth/oauth/exchange` with the code + verifier and receives the session (token in body for native, cookie for web). Token and user never appear in a URL. Google `email_verified` is honoured (sets `email_verified_at` only when true). Account linking by email only when the existing account's email is verified (otherwise reject with a safe message). **Apple Sign In** added if Q9 = yes (`expo-apple-authentication`, server verifies the identity token against Apple's keys, needs Apple developer config — marked BLOCKED until credentials exist).
- **Registration hardening:** DOB required (server), `accepted_terms_version`/`accepted_privacy_version` required, server-side password policy identical to the client checklist (`passwords.js` becomes the single source; `register` stops duplicating it), per-IP + per-email registration limiter, same generic error handling, `privacy_consents` rows written in the same transaction (table in `007`).
- **Age assurance strategy** (documented in `SECURITY_CHECKLIST.md`): self-declared DOB is a gate, not proof. Layers: server-side date validation → email ownership → report category "suspected underage" → moderation case (P2) → automatic suspension pending review → identity/age check through a provider when Phase 10 verification exists. Escalation path and evidence handling are written down before launch.

| Task | Work | Files | Migration | API | Tests |
|---|---|---|---|---|---|
| P1-01 | Account-state migration + backfill review | `migrations/006` | 006 | — | migration test; existing-user login still works |
| P1-02 | Age module + shared vectors | `backend/age.js`, `mobile/lib/validation.ts`, `shared/age-vectors.json` | — | — | unit: leap years, Feb-30, future, 17y364d / 18y0d, year 0001, non-ISO, timezone boundaries |
| P1-03 | Register: DOB, consents, password policy, limiter | `auth.js`, `passwords.js`, `consents` | 007 | `POST /api/auth/register` (changed, backward-tolerant until client ships) | integration: under-18 rejected, impossible date rejected, weak password rejected, consent rows written |
| P1-04 | Eligibility middleware + status in session check (short TTL cache, invalidated on status change) | `eligibility.js`, `session.js` | — | all dating routes | unit + integration |
| P1-05 | Apply to routes and sockets; socket disconnect on suspend | `index.js`, `profiles.js`, `swipes.js`, `matches.js`, `media.js`, `realtime.js` | — | — | security tests #1, #2, #6 |
| P1-06 | Onboarding API + server-side completion | `onboarding.js` | 006 | `GET/PATCH /api/onboarding…`, `POST /api/onboarding/complete` | integration: cannot bypass via `complete-setup`/direct API; resume |
| P1-07 | Mobile onboarding rewrite (reuse existing screens/components; remove all invented data; back/next; progress; validation; photo errors; server-confirmed completion; route guard reads `eligibility` from `/me`) | `profile-setup/*`, `_layout.tsx`, `index.tsx`, `store.ts`, new step screens | — | — | unit for validators; manual web + Android walkthrough; no stock data saved (assert via API) |
| P1-08 | Email verification enforced for eligibility; remove "skip"; production config fails if verification is required but mail is not configured | `accountSecurity.js`, `config.js`, `verify-code.tsx` | — | — | integration: unverified user blocked from discovery; resend cooldown/attempt/expiry already covered, add expiry-by-clock test |
| P1-09 | Truthful verification UI | `profile.tsx`, `Badge` | — | `/me` exposes `email_verified`, `identity_verified:false` | tsc; screenshot check |
| P1-10 | OAuth redesign (+ Apple per Q9) | `auth.js` → `oauth.js`, `store.ts`, `auth-callback.tsx` | 007 | `GET /api/auth/oauth/google/start`, `POST /api/auth/oauth/exchange` | integration with a stubbed Google token endpoint: forged `state`, replayed code, wrong verifier, foreign redirect, token-in-URL absent |
| P1-11 | Replace `complete-setup` lat/lng + completion side-effects; keep route for field edits | `auth.js` | — | `POST /api/auth/complete-setup` (narrowed) | regression: profile updates still change only sent fields |
| P1-12 | Age-assurance + onboarding docs | `SECURITY_CHECKLIST.md` | — | — | — |

Acceptance (from master prompt): underage cannot reach dating features; incomplete profiles cannot bypass onboarding via API; verified status reflects backend; email/password login, password reset and logout unchanged; OAuth redirect substitution rejected; nothing invented is saved.

Risks: breaking existing users (mitigated: no destructive backfill, grace UX); onboarding rewrite regressions (mitigated: server API first, then UI); Apple/Google credentials unavailable (BLOCKED items documented, local stub tests still run).

---

### Phase 2 — Safety, blocking, reporting, moderation (P0, effort XL)

Depends on: P1 (status, eligibility). Addresses D-04, D-20, D-21, parts of D-34.

**Design**

- **Migration `008_match_lifecycle.sql` (moved here from Phase 4, delivered first):** `matches.status` (`active|unmatched|blocked`), `unmatched_at`, `unmatched_by`, `expires_at` made nullable and no longer read (Q1: persistent; the column is kept, nothing is dropped), the old `UNIQUE(user_a,user_b)` replaced by a **partial unique index on active pairs** (create the new index first, then drop the old constraint in the same migration after verifying there are no duplicates), `messages.deleted_at`. It must be applied and tested before any block/unmatch code that writes `matches.status`.
- **Migration `009_safety.sql`:** `user_blocks (id, blocker_id, blocked_id, reason_code, created_at, UNIQUE(blocker_id, blocked_id), CHECK(blocker_id <> blocked_id))` + index on `blocked_id`; `user_reports` (as the master prompt, plus `evidence jsonb` snapshot, `reporter_visible_status`); `moderation_cases`, `moderation_actions`, `audit_events` (append-only via a trigger rejecting `UPDATE/DELETE`), `admin_roles (user_id, role, mfa_secret_enc, mfa_enrolled_at, created_by)`, `appeals`. All FKs `ON DELETE RESTRICT/SET NULL` for safety records (they must survive user deletion per retention policy, P6).
- **One enforcement primitive:** SQL fragment/helper `notBlockedEitherWay(viewerParam, otherColumn)` and `isBlockedEitherWay(a, b)` in `backend/safety/blocks.js`; every query that returns or acts on another user imports it, and a test enumerates routes to ensure none is missed (a route inventory test fails when a new route that reads `profiles` of other users does not declare a safety check).
- **Block semantics:** blocking hides both directions (discovery, likes-you, search, stories, match list entry for the blocker is retained as "blocked" in the settings list only), ends the active match (`status='blocked'`), disables sending, revokes chat-media reads, removes both users' sockets from the legacy match room and emits a generic `match_removed` (no mention of a block). API errors for blocked targets are the **same** as for non-existent/unavailable targets (`404 { code: "unavailable" }`) so nobody can detect being blocked.
- **Reports:** categories (profile, message, photo, story, harassment, threats, spam, fake, impersonation, inappropriate, underage_suspected). Validate that the reporter can legitimately see the subject (participant in match, or subject appears in their authorised feed), snapshot evidence (message body/media reference/photo reference) at report time, dedupe identical open reports, per-account rate limit, reported user is **never** told who reported them. `GET /api/safety/reports/me` returns the reporter's own report status only.
- **Unmatch:** `DELETE /api/matches/:id` → match `status='unmatched'`, `unmatched_by`, `unmatched_at`; sends blocked; messages retained server-side for the safety window (not deletion); both clients get `match_removed`; rematching rule (default): **no automatic rematch** — the pair appears as "passed" for 30 days, then may reappear in discovery only if neither blocked/reported; a fresh mutual like creates a *new* match row. (Unique constraint on `(user_a,user_b)` is replaced by a partial unique index on active matches — migration `008`, delivered at the start of this phase, before this task.)
- **Admin:** separate protected API `/api/admin/*` (staff = profile + `admin_roles`; roles `moderator`, `senior_moderator`, `admin`), **TOTP MFA** step-up (`otplib`; secret encrypted with a server key) required for every request class; admin API uses short-lived bearer tokens in a different JWT audience so a normal user token can never pass; strict rate limits and IP/audit logging. Dashboard is a **separate static SPA** (`admin/`, Vite + React) deployed separately from the consumer app; no link to it from the consumer UI. Features per master prompt §5.4: report inbox + filters, detail with evidence, user search/detail, warn / suspend (with end date) / ban / remove content, appeals, history, audit log viewer, abuse metrics. Actions run in a transaction with their `audit_events` row; suspension/ban sets `profiles.status`, bumps `token_version`, disconnects sockets.
- **Automated triage (rules, not verdicts):** counters in PostgreSQL (likes per hour, identical-message repeats, uploads per hour, account creations per IP/day, reports received per week) create/escalate a `moderation_case` with a priority and apply only *reversible throttles*; bans always require a human. Image classification is a provider integration (BLOCKED until a provider is chosen) — plan includes the `media_assets.moderation_status` hook.
- **Per-account limits** in addition to the IP limits (D-21): swipes, messages, reports, uploads, registrations.

| Task | Work | Key files |
|---|---|---|
| P2-01a | Migration 008 match lifecycle (status, unmatch columns, partial unique index) — **first Phase 2 task** | `migrations/008` |
| P2-01b | Migration 009 safety tables (+ append-only trigger tests) | `migrations/009` |
| P2-02 | Block helper + route inventory test | `safety/blocks.js` |
| P2-03 | Block APIs `GET/POST /api/safety/blocks`, `DELETE /api/safety/blocks/:userId` | `safety/routes.js` |
| P2-04 | Enforce blocks in discovery, likes-you, swipes, matches, messages, read, media, stories, search, presence, socket join/emit | many |
| P2-05 | Socket revocation + `match_removed` | `index.js`, `realtime.js` |
| P2-06 | Reports API + evidence snapshot + dedupe + limits | `safety/reports.js` |
| P2-07 | Unmatch endpoint + semantics | `matches.js` |
| P2-08 | Staff auth, roles, TOTP, admin API | `admin/api` |
| P2-09 | Moderation actions, appeals, audit events | `admin/actions.js` |
| P2-10 | Admin SPA | `admin/` |
| P2-11 | Triage rules + per-account limiters | `safety/triage.js` |
| P2-12 | Mobile: block/report/unmatch menu (chat header, card menu, profile modal), report sheet, blocked-users screen, suspended-account screen | `chat-thread.tsx`, `SwipeDeck.tsx`, `ProfileDetailsModal.tsx`, new screens |

Tests (security suite, all in `backend/test/security.test.js`): block hides both ways and returns indistinguishable errors; blocked cannot send/read/fetch chat media even with a held socket; reconnect after block still refused; reports validated and rate-limited; reporter identity never in any response to the reported user; non-admin gets 403/404 on every `/api/admin/*`; admin without MFA step-up rejected; moderator actions produce audit rows and the audit table rejects UPDATE/DELETE; suspended user's existing token and socket stop working; user C cannot read A–B chat (#3).

Acceptance: master prompt §5 acceptance list, verified by the tests above plus a manual two-browser run.

Blockers: staff identity/MFA operational decisions (Q4), moderation staffing, image-classification provider.

---

### Phase 3 — Profile management and discovery (P1; privacy fixes P0; effort XL)

Depends on: P1, P2-02. Addresses D-05, D-14, D-15, D-36, D-38.

**Design**

- **Migration `010_profile_preferences.sql`:** new columns on `profiles`: `relationship_intention`, `languages text[]`, `prompts jsonb` (max 3, length-limited), `city`, `location_updated_at`, `location_consent_at`; keep `lat/lng` but they become **private** (never selected by public queries; a unit test greps the SQL strings/response shapes). New `user_preferences (user_id PK, min_age, max_age, max_distance_km, interested_in text[], intentions text[], profile_visible bool, paused_at, hide_distance bool, show_recently_active bool, notify_*…)`. Indexes: `profiles(created_at)`, `(status, profile_completed_at)`, expression/btree on a coarse `geo_cell` (computed from lat/lng rounded to ~5 km) to allow a bounding-box prefilter without PostGIS.
- **Location privacy:** explicit consent endpoint stores coordinates (rounded to 3 decimals ≈ 100 m at rest, never returned to others); backend computes distance, returns `{ city, distance_label }` with 5 km buckets ("Less than 5 km away"; values below the bucket are never shown) and omits distance entirely if the viewer or subject has `hide_distance`. Declining location keeps the app usable (distance filter disabled, city optional).
- **Discovery query** (`GET /api/profiles/discovery?cursor=&limit=`): one parameterised query returning only fields intended for public display; server-computed `age`; filters: viewer's min/max age, `interested_in`, distance, intentions, completeness, visibility/pause, status active, adult, **reciprocal** (candidate's `interested_in` includes viewer's gender and the viewer's age is within the candidate's range), blocks either way, existing swipes (likes always excluded; passes excluded for 30 days), demo isolation. Keyset pagination on `(sort_key, id)`; sort options `recommended | new | active | nearby` are real (new = `created_at`, active = `last_active_at` with privacy toggle). `explore` filters become API parameters.
- **Compatibility** (`backend/compat.js`, pure function, unit-tested): `score = round(100 × (0.7 × jaccard(interests) + 0.3 × intentionMatch))`, 0–100, deterministic, documented. UI copy changes from "NN% Match" to "NN% shared interests & goals" (or hide when both lists empty). No sensitive attributes. Never exceeds 100.
- **Profile management API:** `PATCH /api/profiles/me`, photo list management (`POST/DELETE/PATCH order` against `/api/profiles/me/photos`), `POST /api/profiles/me/pause`, `PUT /api/preferences`. Profile completion indicator computed server-side from the same validator as onboarding.
- **Mobile:** edit-profile expanded (multi-photo with reorder/delete, interests, prompts, languages, intentions, gender/interested-in, visibility, hide distance, pause); filter panel in Explore wired to the API; discovery deck paginates; "Nearby/New/Recently active" real; empty/loading/error states.

| Task | Work |
|---|---|
| P3-01 | Migration 010 + indexes (EXPLAIN checked on seeded data) |
| P3-02 | `compat.js` + tests |
| P3-03 | Location consent + private storage + distance helper + bucket labels |
| P3-04 | Discovery rewrite (cursor, filters, reciprocity, blocks, demo isolation) |
| P3-05 | Likes-you rewrite (same projection, no coordinates, blocks) |
| P3-06 | Preferences API + profile PATCH + pause/visibility enforcement |
| P3-07 | Photo management API (ownership, order, delete; remote-URL photos removed from accepted input) |
| P3-08 | Mobile profile/edit/preferences/filter UI + pagination |
| P3-09 | Search endpoint server-side (names/interests) with same constraints |

Tests: unit (compat bounds incl. >5 shared interests, empty lists; age/distance label rounding; reciprocity truth table); integration (discovery honours every filter, cursor has no dupes/gaps, nobody's `lat/lng` appears in any public payload — recursive key scan, paused/hidden/suspended/blocked/underage absent, new profiles ordered by `created_at`, nearby ordering by real distance) — security tests #8.

---

### Phase 4 — Matching and real-time chat (P0/P1, effort L)

Depends on: P2 (block, unmatch semantics), P3-04. Addresses D-13, D-17, D-19, D-20, D-34, parts of D-18.

- **Lifecycle (schema delivered in Phase 2 as migration `008_match_lifecycle.sql`; Phase 4 uses it):** `matches.status` (`active|unmatched|blocked`), `unmatched_at`, `unmatched_by`; `expires_at` made nullable and ignored (Q1 = persistent; column retained for backward compatibility, no destructive change); replace `UNIQUE(user_a,user_b)` with a **partial unique index on active matches** so a later fresh match is possible; message `deleted_at`, `reply_to` (optional); `message_reports` link via `user_reports`.
- **Single creation path:** `matchService.createFromMutualLike(tx, a, b)`; `POST /api/matches` and `/quick` stop creating rows (return the existing match or `403`), all creation happens in the swipe transaction with `SELECT … FOR UPDATE`-style ordering to make concurrent mutual swipes yield one match (security test #12). Swipe endpoint checks eligibility, blocks, active target, and per-account rate.
- **Messaging guarantees:** every send/read/list checks `match.status='active'` + both accounts eligible + not blocked; same for media; duplicate `client_id` behaviour unchanged (preserved test); ordering by server `id`; typing indicator events `typing:start|stop` (membership check each time, 3 s TTL, rate-limited, not persisted); soft delete own message ("message deleted" tombstone, evidence copy kept if reported); report-message via P2 API; read receipts unchanged.
- **Attachments:** remove the mock location/other options for good; chat photos stay (12 h ephemeral decision Q5 unchanged for now). Voice is Phase 10.
- **Client data protection:** persist only non-sensitive session flags in AsyncStorage; stop persisting `matches`, `messages`, `stories`, `swipes` (rebuild from API on launch; in-memory cache only); namespace/clear on account switch; keep token in SecureStore. Offline behaviour: show cached in-memory thread, queue failed sends with "Tap to retry" (exists), explicit banner on disconnect; optional encrypted offline cache (SecureStore-wrapped key + MMKV/SQLite) is **out of scope for MVP** and listed in Known Limitations.
- **Socket hardening:** remove legacy `join_room` once all clients ≥ current build (deprecate with version log first); `stories_changed` becomes per-audience emit; `disconnectSockets` on status change; emit-time re-check is unnecessary because room membership is server-managed by user, but fan-out to the *other* participant is skipped when blocked.

| Task | Work |
|---|---|
| P4-01 | Complete lifecycle semantics on the Phase 2 schema (no new migration): rematch rule, `expires_at` ignored everywhere, read paths honour `status` |
| P4-02 | Match service, endpoint consolidation, concurrency test |
| P4-03 | Enforcement in messages/media/read |
| P4-04 | Typing indicators (server + client) |
| P4-05 | Message soft delete + report entry point |
| P4-06 | Client store diet (no chat persistence) + account-switch clearing tests |
| P4-07 | Chat UI: states (sending/failed/retry), empty, context menu (copy/report/delete), match-ended view |
| P4-08 | Matched/celebration + list unmatch confirmation |
| P4-09 | Socket cleanup (legacy room, targeted emits) |

Tests: preserve all 3 existing chat integration tests; add: C cannot read/post (#3), block/unmatch stops sends and media immediately and after reconnect (#4, #5), concurrent swipes → one match (#12), duplicate send idempotent across reconnect, history after restart (new login sees server history), typing events refused for non-participants.

---

### Phase 5 — Notifications and background work (P1, effort L)

Depends on: P2 (blocks), P4. Addresses D-16, jobs part of D-24.

- **Migration `011_notifications_jobs.sql`:** `notification_events (id uuid, user_id, type, title, body, related_entity_id, dedupe_key UNIQUE, is_read, created_at)`, `device_tokens (id, user_id, platform, token UNIQUE, last_seen_at, disabled_at)`, `notification_prefs` (columns in `user_preferences`), `jobs (id, type, payload jsonb, run_at, attempts, max_attempts, locked_at, locked_by, last_error, status)`.
- **Job runner (delivery semantics: at-least-once; handlers must be idempotent):**
  - `jobs`: `id uuid`, `type`, `payload jsonb`, `status` (`queued|running|succeeded|failed|dead`), `run_at`, `attempts`, `max_attempts`, `locked_by`, `locked_until` (a **lease**), `heartbeat_at`, `last_error`, `idempotency_key` (**UNIQUE**), `created_at`, `finished_at`. Index on `(status, run_at)`.
  - **Claim:** one statement — `UPDATE jobs SET status='running', locked_by=$w, locked_until=now()+lease, attempts=attempts+1 WHERE id IN (SELECT id FROM jobs WHERE (status='queued' AND run_at<=now()) OR (status='running' AND locked_until<now()) ORDER BY run_at LIMIT $n FOR UPDATE SKIP LOCKED) RETURNING *`. Two workers can never claim the same row.
  - **Lock expiry / crash recovery:** a `running` job whose lease has expired (worker crashed, host slept or was redeployed) is reclaimable by the same claim query; long handlers extend the lease with a heartbeat. A job reclaimed past `max_attempts` becomes `dead` instead of retrying forever.
  - **Retries:** failures set `status='queued'` with `run_at = now() + min(cap, base·2^attempts) ± jitter` and record `last_error`; permanent errors (validation) go straight to `dead`. The count of `dead` jobs drives an alert.
  - **Idempotency:** enqueue is `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` (keys such as `notify:match:<id>:<user>`, `purge:account:<id>`, `expire:media:<hour>`); effects use natural unique keys or `ON CONFLICT` so a re-run after a crash between "side effect done" and "marked succeeded" changes nothing; the final status write checks `locked_by` so a stale worker cannot overwrite a newer attempt.
  - **Schedules:** recurring work (media expiry, token cleanup, receipts) is enqueued by a tick that uses a per-period idempotency key, so overlapping ticks create one job.
  - **Invocation:** (a) an in-process loop while the service is awake and (b) an **external scheduler** calling a secret-protected `POST /api/internal/jobs/run` (Render Cron Job or a GitHub Actions schedule) with a concurrency cap, so work survives sleep and restart. The free Render plan sleeps, so reliable background work needs an always-on plan or the external cron; the in-memory `setInterval` stays only as an optimisation, never as the sole trigger.
  - **Tests (local test database):** two concurrent workers → each job runs once; a worker "killed" before finishing (lease expired) → the job is reclaimed and completes once; retry/backoff schedule; dead-lettering at max attempts; duplicate enqueue → one row; handler re-run is a no-op; a stale worker cannot overwrite; the runner endpoint rejects a missing or wrong secret.
- **Events:** new match, new message (coalesced per match, body redacted in push), like (if product allows; default **count only**), security events (password change, new sign-in), verification result, moderation notice. `dedupe_key` (e.g. `match:<id>:<user>`) makes retries idempotent (security test #13). Block/status/preferences checked at **enqueue and send** time.
- **Push (native):** `expo-notifications` + `expo-device`; registration on login with permission prompt after context, token refresh, removal on logout and on `DeviceNotRegistered` receipts; server uses Expo Push API (`expo-server-sdk`), batches, retries with backoff, reads receipts job. **Requires a development build on Android** (no remote push in Expo Go) and FCM/APNs credentials in EAS — BLOCKED until configured; local tests use a stub transport.
- **Web:** in-app notification centre only for MVP (polled/socket-driven from the server table). Browser Web Push (service worker + VAPID) is explicitly deferred and listed in Known Limitations.
- **Client:** `notifications.tsx` reads the server (`GET /api/notifications`, `PATCH …/read`, mark-all-read), badge counts, preferences screen, tap-to-navigate from push (`Notifications.addNotificationResponseReceivedListener` → router), quiet hours only if added to prefs.
- Other jobs registered here: expired media/story cleanup (replaces `setInterval`), token cleanup, email send retry, moderation timers (suspension end), deletion/export processing (P6).

Tests (in addition to the runner tests above): notification dedupe key, blocked recipient suppressed, preference respected, invalid-token cleanup, notification history consistent after restart.

---

### Phase 6 — Privacy, account settings, deletion, export, policy (P0 for launch, effort L)

Depends on: P1, P2, P5. Addresses D-11, D-12, D-34.

- **Settings** (all persisted server-side): pause, profile visibility, distance visibility, notification prefs, blocked users, links to policies, report a problem (support ticket to `support_requests`, rate-limited), export, delete.
- **Deletion** (`account_deletion_requests`, migration `012`): `DELETE /api/account` requires reauth (password; email code for OAuth-only users) + typed confirmation; sets `status='pending_deletion'`, hides profile, bumps `token_version`, disconnects sockets, ends matches (`unmatched`), unregisters device tokens, schedules a job. After the grace period (Q6) the job **anonymises** the profile row (name→"Deleted user", PII nulled, email replaced with a tombstone hash, photos/media deleted, messages bodies redacted for the deleted side per policy, stories deleted), retains only reviewed safety records (`user_reports`, `moderation_*`, `audit_events` keep ids but no PII beyond what policy allows). Deleted accounts cannot authenticate (login/refresh/socket/OAuth link all check status — security test #11). Because most FKs cascade, deletion is **anonymise-then-purge-by-table in a job**, never a bare `DELETE FROM profiles`. Cancel within grace by signing in.
- **Public deletion page** `/delete-account` in the web build (static, no login) explaining the in-app path and a request form (email + verification code) for people who cannot sign in — required by store policies; verify wording against current Apple/Google requirements before submission.
- **Export:** `POST /api/account/export` queues a job producing a JSON (profile, preferences, photos metadata + files, own messages, matches list with first names only, own reports/blocks, consents, notification events); download via a one-time, 24 h, authenticated link; excludes other users' private data.
- **Policy and consent:** versioned `Privacy Policy`, `Terms`, `Community Guidelines`, retention and safety pages authored from *actual behaviour*; every legal claim marked `[LEGAL REVIEW REQUIRED]`; no invented effective date (use the release version/commit date only after legal sign-off); `privacy_consents` rows on accept; re-acceptance flow when version bumps; in-app screens render the same source files as the public web pages (`/legal/*`).

Tests: deletion end-to-end (disabled immediately, tokens/socket dead, anonymised after job, safety records kept, cannot log in, email reusable only per policy); export contains only own data (recursive check for other users' ids); consent versions recorded; reauth required; rate limits.

---

### Phase 7 — Media, stories, content security (P0/P1, effort L)

Depends on: P2, P5, Q8/Q11. Addresses D-18, D-36, D-06.

- **`media_assets` (migration `013`)** with `owner_id`, `kind`, `content_type`, `width`, `height`, `bytes`, `sha256`, `storage` (`pg|s3`), `storage_key`, `moderation_status`, `deleted_at`; `images` rows are backfilled by a one-off job; **`/api/images/:id` URLs keep working** (contract preserved). `moderation_status` in this table is the moderation track above (default `not_screened`), not file validity.
- **Two separate things — do not conflate them:**
  1. **File validation and sanitising (technical safety, automatable, built here):** detect type by magic bytes, enforce size and pixel limits (`sharp` with `limitInputPixels`, max dimension 2048, decompression-bomb guard), decode and **re-encode** (strips EXIF/GPS and embedded payloads), generate main + thumbnail, reject unsupported/animated formats, store a content hash. This proves the file is a well-formed image. It says **nothing** about what the image shows.
  2. **Content moderation (policy review of what is depicted: nudity, minors, violence, harassment, impersonation):** not provided by validation. Moderation status is tracked separately: `not_screened | pending | cleared | rejected`. Until a classifier provider or a human review queue exists, every upload is `not_screened`, must not be described anywhere (UI, docs, store disclosures) as "approved" or "screened", and relies on reports, triage rules (P2-11) and staff removal (`rejected` removes it from feeds). **Launch gate:** before public launch choose one — human review of profile photos before they become visible to others, or an integrated classifier plus human escalation (provider needed; BLOCKED until chosen). Hash matching against known-abuse lists is likewise a provider integration.
  Uploads are blocked for suspended/ineligible users (security tests #1, #6, #9).
- **Access:** profile photos readable by authenticated users who can see that profile (block/visibility/status checked) — public immutable caching is replaced by authenticated, `private` cache headers with short max-age and opaque ids; thumbnails for lists. Chat media keeps participant check **plus** active-match and block checks.
- **Stories:** audience = matches only (Q2) with an owner toggle; feed query joins active matches and excludes blocked/suspended; per-story view endpoint rechecks; report story; delete own; expiry job + immediate 404 after `expires_at` (already true); `stories_changed` emitted only to the audience; external-URL/"preset" story paths removed unless they go through the same upload pipeline.
- **Cleanup jobs:** orphaned images (not referenced by profile/photo lists after N days), media of deleted accounts, expired ephemeral media.
- **Videos (Q11):** until transcoding exists, story video is flag-gated; size/duration limits stay; metadata cannot be stripped client-side reliably (documented).
- **Mobile:** upload progress/error/retry UI, remove from queue, image preview; photo grid manage screen (shared with P3-07).

Tests: JPEG with GPS EXIF → stored bytes contain no EXIF; polyglot/renamed files rejected; oversize dimensions rejected; ownership on delete; story invisible to non-match/blocked/after expiry via old URL; suspended upload refused; failed upload recoverable.

---

### Phase 8 — UI/UX consistency and accessibility (continuous, effort L)

Not a gate for the safety phases, but each phase must meet this checklist for the screens it touches; the final pass verifies the whole app.

- Preserve branding (existing tokens in `constants/theme.ts` / `tailwind.config.js`); introduce no new visual language.
- Shared primitives: `Screen` (safe area + keyboard avoid), `FormField` with error/help text, `ListEmpty`, `LoadingState`, `ErrorState` with retry, `ConfirmSheet` (exists), `ActionSheet`, `ReportSheet`.
- Targets ≥ 44 px, `accessibilityRole/Label/State` on all pressables, focus order and web keyboard support, dynamic type respected, reduced-motion check (`AccessibilityInfo.isReduceMotionEnabled`) on `SwipeDeck`/`matched` animations, contrast review of `text-secondary` on `bg-surface`.
- Screen list from the master prompt §11 mapped to phases: Auth/Onboarding (P1), Discovery/filters (P3), Matches/Chat (P4), Profile/settings (P3/P6), Admin (P2).
- Verification: manual scripts at 375/768/1280 widths, screen-reader pass (VoiceOver/TalkBack where devices exist; otherwise documented as not tested), screenshots stored under `docs/implementation/evidence/` (non-sensitive demo data only).

---

### Phase 9 — Deployment, environments, reliability (P1, effort L)

Depends on: P5 (jobs). Addresses D-08, D-24, D-25, D-28, D-29.

- **Environments:** introduce `APP_ENV=development|staging|production` (explicit; `NODE_ENV`/`RENDER` no longer imply seeding). Dev seeding only when `SEED_DEV_DATA=true` **and** `APP_ENV=development` (fixes D-25 and the known `password123` seed). Separate Render services + Neon branches/databases for staging and production; `render.yaml` gains a staging service; **removing `DEMO_LOGIN_ENABLED` from production is already scheduled earlier, in Release Gate A / P1-00b**, and this phase only adds a separate demo service with its own database if wanted; `eas.json` gets `development/staging/production` profiles with their own `EXPO_PUBLIC_BACKEND_URL`; `vercel.json` rewrite destination parameterised per Vercel environment; config fails closed when `CORS_ORIGIN` is empty in staging/production.
- **Web security:** CSP, HSTS and `Permissions-Policy` headers on Vercel; confirm cookie flags (`HttpOnly`, `Secure`, `SameSite=Lax`), CSRF header on all cookie writes, same-origin API proxy preserved.
- **Reliability:** structured logs kept (add request id), error reporting provider (decision), alerting on `/readyz`, queue depth and error rate; backups (Neon point-in-time restore) with a **restore drill into a scratch branch** recorded in `DEPLOYMENT_GUIDE.md`; pool sizing review; indexes from P3/P5 verified with `EXPLAIN`; multi-instance readiness: Socket.IO Redis adapter plan, shared socket-ticket store and presence in the database/Redis (single instance until then — stated in Known Limitations).
- **Secrets:** checklist for rotating anything that may have left the machine (Neon password, `JWT_SECRET`, Resend key, Google secret) — **owner executes**; confirm `.env*` ignored (already true) and archives exclude them.
- **Production cleanup runbook (Q7):** read-only query to list `seed-*`/`demo-*`/showcase rows in the live DB → owner review → owner-run delete in a transaction with a backup point recorded first. Not executed by the agent.
- **Compatibility test plans:** Chrome/Firefox/Safari scripts (session refresh, cookies, socket reconnect, media, OAuth redirect, deletion); Android/iOS device scripts (login restore, push, camera/photo permissions, uploads, deep links, keyboard, background/resume, network loss, logout/account switch). Results recorded **only if actually run**.
- **Store readiness checklist:** privacy disclosures, age rating, working deletion, reporting, blocking, moderation contact, permission strings in `app.json` (camera, photos, location when added, microphone when voice added), test credentials, support URL, privacy policy URL — each verified against *current* Apple/Google policy text at submission time.

---

### Phase 10 — Advanced features (P2/P3, only after P1–P7 and P9 are COMPLETE)

| Feature | Design notes | Blockers |
|---|---|---|
| Voice messages | `expo-audio` record/preview/upload/playback, duration, permissions, upload retry, uses the media pipeline (audio type validation, size cap, report/retention) | Confirm `expo-av` vs `expo-audio` status for SDK 54 (see audit §8); mic permission strings |
| Audio/video calls | WebRTC via `react-native-webrtc` + web `RTCPeerConnection`; authenticated signalling over Socket.IO (offer/answer/ICE, ring timeout, busy, reject, end, block check on every signal), STUN + TURN (provider needed), mute/camera/speaker controls | Needs EAS development builds (no Expo Go), TURN provider/credentials. **If unavailable: calls stay disabled (P0-08) and the blocker is documented.** |
| Verification | Selfie + liveness via provider or human review; consent, minimal retention, appeal; sets `identity_verified_at` only on success; badge shown only then | Provider selection, legal review (biometrics) |
| Premium | Server-side entitlements; store-billing receipt validation (RevenueCat or native IAP); safety features never gated | Product decisions, provider accounts; **no real payments** until approved |

---

## 5. Test strategy

| Layer | Tooling | Scope | Where it runs |
|---|---|---|---|
| Backend unit | `node --test` | age, compat, validators, block helper, eligibility decision table, notification dedupe, job locking | `npm test` (no DB) |
| Backend integration | `node --test` + real PostgreSQL + real `socket.io-client` | all flows in the master prompt §16 | `npm run test:integration` against `scripts/test-db.js` or CI service DB — never production |
| Security regression | `backend/test/security.test.js` | the 13 numbered cases (mapping below) | integration job |
| Mobile logic | add `jest-expo` + `@testing-library/react-native` | validators, store reducers (no-persist, account switch), onboarding step logic | new CI job (P1) |
| Web E2E | Playwright against local web build + local backend + throwaway DB, two browser contexts | register → verify → onboard → discover → like → match → chat → unmatch/block/report → privacy → delete | new CI job when P4 done |
| Native E2E | Maestro/Detox on EAS development builds | smoke: login restore, push, photo upload | **only when a device/emulator and builds exist; otherwise recorded as NOT RUN** |
| Static | `tsc`, `eslint` (0 warnings), `npm audit` (reported) | | CI |

Security test mapping: #1 under-18 → P1-05; #2 incomplete bypass → P1-05/06; #3 outsider chat → P4-03; #4 block + media → P2-04/P4-03; #5 block after reconnect → P2-05; #6 suspended token → P1-05/P2-09; #7 non-admin → P2-08; #8 coordinates absent → P3-04; #9 invalid media → P7; #10 OAuth redirect → P1-10; #11 deleted accounts → P6; #12 concurrent swipes → P4-02; #13 notification retries → P5.

Every phase report records exact commands and counts (`pass/fail/skipped`) in `TEST_REPORT.md`.

---

## 6. Database migration roadmap (authoritative order)

Existing: `001_indexes_and_constraints`, `002_account_security`, `003_ephemeral_media`, `004_remove_requested_mock_profiles` and `005_remove_additional_mock_profiles` (both destructive data cleanups, now **retired and archived** in `backend/ops/local-dev-cleanup/`; the runner never executes them and numbers 4 and 5 stay reserved; `006` and `007` were added in Phase 1 — see `DATABASE_MIGRATIONS.md`). **Numbers are reserved by this table and never reused**, even if a phase slips; if a number is skipped, record why.

| # | Name | Phase | New / changed objects | Rollback / recovery note |
|---|---|---|---|---|
| 006 | `account_state` | P1 — **applied in Phase 1** | `profiles.status, suspended_until, status_changed_at, profile_completed_at, onboarding_step, onboarding_done, relationship_intention`; static birthdate range CHECK `NOT VALID`; **`user_preferences`** (interim age range, extended by 010) | Columns unused by old code → safe to leave; drop only after backup. |
| 007 | `consents_oauth` | P1 — **applied in Phase 1** | `privacy_consents`, `oauth_transactions`, `oauth_exchange_codes` | New tables; drop is safe before launch. |
| 008 | `match_lifecycle` | **P2 (first)** | `matches.status/unmatched_*`, `expires_at` nullable, partial unique index on active pairs, `messages.deleted_at` | Create and verify the new index before dropping the old constraint, in one transaction; the old constraint can be re-added from `db_init.sql` history. |
| 009 | `safety` | P2 | `user_blocks`, `user_reports`, `moderation_cases`, `moderation_actions`, `audit_events` (+ append-only trigger), `admin_roles`, `appeals` | After launch these are records of truth — **never drop**; disable by feature flag. |
| 010 | `profile_preferences` | P3 | profile columns + `user_preferences` + indexes | Additive. |
| 011 | `notifications_jobs` | P5 | `notification_events`, `device_tokens`, `jobs` | Additive. |
| 012 | `deletion_export_support` | P6 | `account_deletion_requests`, `data_export_requests`, `support_requests` | Records; retained per policy. |
| 013 | `media_assets` | P7 | `media_assets` + backfill job from `images` | `images` stays until the backfill is verified; no deletion in this migration. |
| 014+ | per need | P9/P10 | e.g. `identity_verified_at`, entitlements | |

Rules per migration: written idempotently, tested by (a) applying to an empty DB and (b) applying to a DB loaded with the pre-migration schema plus seed rows; recorded in `schema_migrations`; reviewed for lock impact on Neon (use `CREATE INDEX CONCURRENTLY` in a separate non-transactional step if tables are large); data backfills are separate, resumable jobs.

---

## 7. API additions (final paths decided at implementation, following existing `/api/<area>` convention)

`/api/onboarding` (GET, PATCH `/:step`, POST `/complete`) · `/api/auth/oauth/*` · `/api/preferences` (GET/PUT) · `/api/profiles/me` (PATCH), `/api/profiles/me/photos`, `/api/profiles/me/pause` · `/api/profiles/discovery` (cursor) · `/api/safety/blocks`, `/api/safety/reports`, `/api/safety/reports/me`, `/api/safety/appeals` · `DELETE /api/matches/:id` · `/api/notifications`, `/api/notification-preferences`, `/api/devices` · `/api/account/export`, `DELETE /api/account`, `/api/support` · `/api/admin/*` · `POST /api/internal/jobs/run` (secret). Each endpoint ships with: input validation, authN/authZ, eligibility/block/privacy enforcement, consistent `{ error, code }` responses, rate limit, tests, and an entry in `API_REFERENCE.md`.

---

## 8. Documentation deliverables (master prompt §18)

| File | Created in | Notes |
|---|---|---|
| `BASELINE_AUDIT.md` | P0 | done (this audit) |
| `IMPLEMENTATION_TRACKER.md` | P0 | done; updated continuously |
| `IMPLEMENTATION_PLAN.md` | P0 | this file |
| `ARCHITECTURE.md` | P0 stub → each phase | module map, data flow, socket model, auth model |
| `API_REFERENCE.md` | P1 onward | request/response shapes per endpoint |
| `DATABASE_MIGRATIONS.md` | P0 | authoritative schema, migration list, recovery notes |
| `SECURITY_CHECKLIST.md` | P1 | age assurance, threat model, secret handling, per-phase checks |
| `TEST_REPORT.md` | P0 | exact results per run |
| `DEPLOYMENT_GUIDE.md` | P9 (update existing `docs/AUTH_AND_DEPLOYMENT.md`) | envs, rotation, restore drill |
| `RELEASE_CHECKLIST.md` | P9 | store + legal + ops gates |
| `KNOWN_LIMITATIONS.md` | P0 → grows | single-instance sockets, no web push, no E2E device tests, etc. |

Existing `README.md`, `docs/AUTH_AND_DEPLOYMENT.md`, `docs/TESTING_CHECKLIST.md`, `docs/SECURITY_REVIEW.md`, `VALIDATION_REPORT.md` are updated when their facts change (the README still describes port 5000 and the demo login as a feature; `VALIDATION_REPORT.md` is dated 2026-11-20 and must not be presented as current).

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Eligibility rollout locks out existing users | M | H | Backfill is non-destructive; clear "finish your profile" path; staging dry-run on a copy |
| Destructive migrations 004/005 reach production unreviewed | M | H | P0-02 owner review; deletes listed before executed |
| Production already holds fake/seeded profiles and a live demo login | M | H | Q7 runbook; not touched by the agent |
| Single-instance Socket.IO / in-memory tickets on a sleeping free plan | H | M | Documented; jobs via external cron; Redis adapter plan |
| Native push/calls cannot be verified without builds and devices | H | M | Mark BLOCKED/NOT RUN; keep features disabled instead of faking |
| Image re-encode library (`sharp`) deployment on Render/Neon | L | M | Verify prebuilt binaries on Render Node 22 in staging first |
| Scope size (XL phases) | H | M | Phase gates; each task independently shippable behind eligibility rather than a big bang |
| Legal/regulatory unknowns (age of majority, biometrics, retention) | H | H | Policy text marked for legal review; launch gated on sign-off |
| Credentials possibly exposed in a shared archive | ? | H | Owner rotates; guide in P9 |

---

## 9a. Next action

Phases 0 and 1 are implemented (see `PHASE_00_COMPLETION_REPORT.md`, `PHASE_01_RELEASE_GATE_A_REPORT.md`, `PHASE_01_COMPLETION_REPORT.md`). **Next: Phase 2 starts with migration 008 (match lifecycle) as its first task.** Earlier note: the owner reviews and commits Phase 0 and decides the open items in the report; then Phase 1 starts with **P1-00 / P1-00b (Release Gate A)** before the eligibility work, because that work changes behaviour across every router.
