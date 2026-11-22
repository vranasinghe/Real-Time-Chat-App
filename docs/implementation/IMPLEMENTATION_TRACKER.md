# Dateza — Implementation Tracker

Durable status file so work can resume across sessions. **Update it in the same change as the work it describes.**
Design and rationale: `IMPLEMENTATION_PLAN.md`. Evidence for each `D-xx`: `BASELINE_AUDIT.md`. Phase results: `PHASE_00_COMPLETION_REPORT.md`.

**Last updated:** 2026-11-22 · **Branch:** `phase-0-stabilise` (from `main` @ `a9cff77`). Phase 0, Release Gate A and Phase 1 are committed **locally** in `2b8c384`, `b11eb4b`, `378eac8`, `47b8a13`; a fifth, documentation-only commit finalises tracking. **Nothing is pushed or deployed.**
**Current phase:** Phase 1 is committed and validated locally (backend and web; native not run). **Phase 2: plan prepared (`PHASE_02_IMPLEMENTATION_PLAN.md`); decisions D2.1 to D2.10 are PENDING owner approval; no Phase 2 code, migration or dependency exists.**

Status values: `COMPLETE` · `PARTIALLY COMPLETE` · `BLOCKED` · `NOT STARTED`. A task is COMPLETE only when it is implemented **and** verified as far as the environment allows; anything not verified is stated next to it.

**Verification status (as of the final commit)**

| Validated locally (isolated local PostgreSQL, Node 22.23.5, web build) | Not verified (needs something outside this machine) |
|---|---|
| Backend unit 77/77 and integration 51/51; chat and image E2E (10 + 8 checks); mobile type check 0 errors; lint 0 warnings; web export; each commit checked in a clean worktree | Native Android and iOS builds, devices, emulators, photo picker, native Google return |
| Eligibility, onboarding, account-status and socket enforcement, OAuth state/PKCE/one-time code (Google stubbed), migrations 006/007 upgrade of synthetic legacy data | Real Google OAuth consent and redirect registration; Apple Sign In (BLOCKED, not built) |
| Destructive-SQL guard, seeding guard, demo login off in production (config and tests) | Real Resend e-mail delivery; the GitHub Actions run; any hosted database, including what 004/005 recorded there; the production deployment of any of this |

---

## 1. Phase overview

| Phase | Name | Priority | Effort | Depends on | Status |
|---|---|---|---|---|---|
| 0 | Stabilise & document | P0 | M | — | **COMPLETE locally** (all 9 tasks implemented and committed in `2b8c384`, `b11eb4b`, `47b8a13`; validated on Node 22; remote CI run outstanding) |
| 1 | Authentication, onboarding, eligibility (starts with Release Gate A: P1-00, P1-00b) | P0 | XL | 0 | **PARTIALLY COMPLETE** (committed in `378eac8`; all backend work and the web app verified; Apple Sign In BLOCKED; native devices and real Google/mail not exercised) |
| 2 | Safety, blocking, reporting, moderation (starts with P2-00 and migration 008) | P0 | XL | 1 | **PLAN PREPARED, awaiting owner review** (`PHASE_02_IMPLEMENTATION_PLAN.md`); no code started |
| 3 | Profile management & discovery | P1 (privacy P0) | XL | 1, 2 | NOT STARTED |
| 4 | Matching & real-time chat | P0/P1 | L | 2, 3-04 | NOT STARTED |
| 5 | Notifications & background jobs | P1 | L | 2, 4 | NOT STARTED |
| 6 | Privacy, deletion, export, policies | P0 (launch) | L | 1, 2, 5 | NOT STARTED |
| 7 | Media, stories, content security | P0/P1 | L | 2, 5 | NOT STARTED |
| 8 | UI/UX & accessibility | continuous | L | per phase | NOT STARTED |
| 9 | Deployment, environments, reliability | P1 | L | 5 | NOT STARTED |
| 10 | Advanced (voice, calls, verification, premium) | P2/P3 | XL | 1–7, 9 | NOT STARTED |

---

## 2. Test numbers

| Suite | Baseline (before Phase 0) | After Phase 0 | After Release Gate A | After Phase 1 |
|---|---|---|---|---|
| `backend npm test` | 21 · 2 fail | 36 · all pass | 44 · all pass | **77 · all pass** (Node 24 **and** Node 22) |
| `backend` integration (throwaway local PG) | 25 · 1 fail | 28 · all pass | 32 · all pass | **51 · all pass** (Node 24 **and** Node 22; 49 at first, +2 in the final review) |
| `mobile tsc --noEmit` | 0 errors | 0 | 0 | **0** (Node 24 and 22) |
| `mobile lint` | 30 warnings | 0 | 0 | **0 warnings** (Node 24 and 22) |
| web export | not run | success | success | **success** (Node 24 and 22) |
| `npm run test:all` | n/a | 5/5 | 5/5 | **5/5** (Node 24) |

Node 22.23.5 was obtained through npm for the Phase 1 runs; the GitHub workflow itself has not run. Details: `TEST_REPORT.md`.

---

## 3. Task checklist

Format: `ID · task · defect(s) · size · status`.

### Phase 0 — Stabilise & document
- [x] **P0-01** Move `MASTER_PROMPT.md` to `docs/implementation/`, update references · — · S · **COMPLETE** (no stale references remain in `docs/`; the file's content is byte-for-byte unchanged, 43,816 bytes)
- [x] **P0-02** Review uncommitted WIP; keep the 16-profile catalog; document orphan `tessa.png`; keep 004/005 out of shared databases · — · S · **COMPLETE** — review written; catalog kept; fixtures isolated from hosted DBs by guard + tests. **004/005 resolved in Phase 1 (Task 0):** owner decision local-only → archived to `backend/ops/local-dev-cleanup/` unchanged. `tessa.png` still an owner decision (nothing deleted).
- [x] **P0-03** Replace stale showcase assertions with invariant tests · D-30 · S · **COMPLETE** (2 failing tests replaced by 9 stricter ones; all pass)
- [x] **P0-04** Directory-driven migration test + scratch-DB failure/guard tests · D-30 · S · **COMPLETE** (integration 28/28)
- [x] **P0-05** Authoritative schema documented; legacy Supabase schema archived with warning banner · D-27 · S · **COMPLETE** (`mobile/db/schema.sql` → `docs/archive/legacy-supabase-schema.sql`, content unchanged)
- [x] **P0-06** Lint warnings 30 → 0, hook-dependency warnings handled by hand · D-32 · S · **COMPLETE** (`--max-warnings 0` passes; tsc 0 errors; story timer/animation effects reviewed — see report §5; web smoke-checked)
- [~] **P0-07** Node 22 pin, `test:all`, CI extended (unit, integration, tsc, lint, web export, audit report) · D-31 · S · **PARTIALLY COMPLETE** — everything works locally; the **GitHub workflow has not run** (no remote execution possible here) and **Node 22 was not available locally**
- [x] **P0-08** Remove misleading UI (Verified label, mock attachments, call buttons/routes, stub menu items, voice stub, fake edit-profile fields, swipe-card alert) · D-10, D-17, D-17b, D-04 (partly), D-38 (partly) · S · **COMPLETE** — checked in the web preview (profile, edit-profile, call routes, swipe card, chat header, attachment sheet); **web only, no native run**
- [x] **P0-09** `TEST_REPORT`, `DATABASE_MIGRATIONS`, `KNOWN_LIMITATIONS`, `ARCHITECTURE`, tracker, completion report · — · S · **COMPLETE**
- [x] **P0-S1** Destructive-migration guard + naming/order validation (`backend/dbSafety.js`, `db.runMigrations`) · Release Gate A · **COMPLETE** (unit + integration tests)
- [x] **P0-S2** Fake-account seeding refused on hosted databases (`canSeedDevData`) · Release Gate A · **COMPLETE** (unit tests; behaviour on a hosted DB not exercised against a real hosted DB by design)
- [x] **P0-S3** `PRODUCTION_CLEANUP_RUNBOOK.md` (owner-run, **not executed**) · Q7 · **COMPLETE** (as a runbook)
- [x] Plan corrections R1–R7 applied to `IMPLEMENTATION_PLAN.md` · — · **COMPLETE**
- [ ] Plan corrections R8–R10 (migration numbering 008 to 011, one row per pair, guard refinement) are **proposed** in `PHASE_02_IMPLEMENTATION_PLAN.md` and will be applied to `IMPLEMENTATION_PLAN.md` once the owner approves that plan

### Phase 1 — Authentication, onboarding, eligibility
- [x] **P1-00** Remove `lat`/`lng` from discovery and likes-you payloads (public-field whitelist); hide "Nearby" chip; `complete-setup` refuses coordinates; leak regression tests · D-05 · S · **COMPLETE** (unit + integration tests; regression tests proven to fail on the pre-fix code; web preview checked). Stored coordinates in existing rows are untouched; own coordinates are still returned to their owner only.
- [x] **P1-00b** Shared demo login off in production: `render.yaml` sets it `false`; backend ignores `DEMO_LOGIN_ENABLED=true` in production unless `DEMO_ENVIRONMENT=isolated`; sessions already issued to demo accounts stop working when it is off · D-08 (config part) · S · **COMPLETE in code and config** (config/blueprint/session tests). **Not deployed** — the effect on the live service happens only when the owner deploys; the production *data* cleanup remains the owner's runbook (P9-08).
- [x] **P1-01** Migration 006 account state (+ `user_preferences`) · D-01 · M · **COMPLETE** — additive; existing members preserved; applied and tested on isolated local databases (never on a copy of real data)
- [x] **P1-02** Strict age module + shared test vectors (backend + mobile, byte-identical copies) · D-02 · S · **COMPLETE** (6 tests, 53 vectors)
- [x] **P1-03** Register: DOB, Terms/Privacy acceptance, server password policy, limiter (migration 007 consents) · D-02, D-11 (consent part), D-22 · M · **COMPLETE** (backend + create-account screen). Policy **texts are drafts** (`draft-1`), legal review outstanding
- [x] **P1-04** Eligibility rules + middleware + route-policy inventory (default deny by test) · D-01 · L · **COMPLETE** — implemented as tagged middleware (`session / adult / eligible`) and an exact inventory test, not a separate `routePolicy.js` registry; suspended/banned/deleted accounts cannot hold a session at all (owner instruction), so no "exempt route" bypass exists for them
- [x] **P1-05** Eligibility on REST + Socket.IO; sockets closed on status change · D-01, D-20 (partly) · M · **COMPLETE** — `accountStatus.setAccountStatus` closes live sockets; no admin tool calls it yet (Phase 2)
- [x] **P1-06** Server-driven onboarding API + server-side completion · D-01, D-03 · L · **COMPLETE**
- [~] **P1-07** Mobile onboarding rewrite (no invented data, resume, validation) · D-03, D-38 · L · **PARTIALLY COMPLETE** — all screens written and type-checked; the real web flow (register → e-mail code → gender → interested-in → skip optional → photos → review → finish, plus reload-resume and the route guard) was driven in a browser against a local backend. **Not run:** native Android/iOS; the photo file picker (upload was done through the API in that run); the under-18 lock screen; non-skip paths of interests/about/preferences
- [x] **P1-08** Enforce e-mail verification; remove "verify later"; production config guard · D-09 · M · **COMPLETE** — enforcement tested; **real mail delivery (Resend) not tested**; production now refuses to start without `RESEND_API_KEY`/`MAIL_FROM`
- [x] **P1-09** Truthful verification UI · D-10 · S · **COMPLETE** (profile shows "Email verified / not verified" only)
- [~] **P1-10** OAuth redesign (state, PKCE, one-time exchange, exact redirects); Apple Sign In where applicable (Q9) · D-07 · L · **PARTIALLY COMPLETE** — server flow complete and tested with Google stubbed; native client implemented, type-checked, **not run** against real Google or on a device; web Google UI still unsupported; **Apple Sign In BLOCKED** (needs an Apple developer account); the fake Apple/Facebook buttons were removed
- [x] **P1-11** Narrow `complete-setup` (no birthdate, no completion, own photos only, enums) · D-05 · S · **COMPLETE**
- [x] **P1-12** Age-assurance + onboarding documentation (`SECURITY_CHECKLIST.md`, `API_REFERENCE.md`) · D-02 · S · **COMPLETE**

### Phase 2 — Safety & moderation
- [ ] **P2-00** Preparation: refine the destructive-SQL guard (`DROP NOT NULL` / `DROP DEFAULT` not destructive), branch, baseline · R10 · S · NOT STARTED
- [ ] **P2-01a** Migration 008 match lifecycle (status, unmatch columns, `connected_at`; **one row per pair**, decision D2.1(A), no `DROP`) — **first** · D-13, D-48 · M · NOT STARTED
- [ ] **P2-01b** Migration 009 user safety (blocks, reports, evidence files); moderation, audit and admin tables move to migration 010, limits to 011 · R8 · D-04 · M · NOT STARTED
- [ ] **P2-02** Block helper + route-inventory test · D-04 · M · NOT STARTED
- [ ] **P2-03** Block APIs · D-04 · S · NOT STARTED
- [ ] **P2-04** Enforce blocks across all REST paths · D-04 · L · NOT STARTED
- [ ] **P2-05** Socket revocation + generic `match_removed`, `socket.data.tv`, 60-second status sweep, audience-scoped presence and story events, flood control · D-20, D-44, D-49, D-50 · M to L · NOT STARTED
- [ ] **P2-06** Reports API (validation, evidence snapshot, dedupe, limits) · D-04 · M · NOT STARTED
- [ ] **P2-07** Unmatch `DELETE /api/matches/:id` · D-04, D-13 · M · NOT STARTED
- [ ] **P2-08** Separate staff credentials, roles, TOTP MFA with step-up (Q4), admin API; owner-run enrolment CLI · D-04 · L · NOT STARTED
- [ ] **P2-09** Moderation actions, append-only audit log, appeals via a scoped appeal token · D-04, D-45 · L · NOT STARTED
- [ ] **P2-10** Admin SPA · D-04 · L · NOT STARTED
- [ ] **P2-11** Triage rules + per-account rate limits · D-21 · M · NOT STARTED
- [ ] **P2-12** Mobile block/report/unmatch UI, blocked-users and suspended screens · D-04 · M · NOT STARTED

### Phase 3 — Profile & discovery
- [ ] **P3-01** Migration 010 profile/preferences/indexes · D-15 · M · NOT STARTED
- [ ] **P3-02** Bounded, documented compatibility function · D-14 · S · NOT STARTED
- [ ] **P3-03** Location consent, private storage, bucketed distance · D-05 · M · NOT STARTED
- [ ] **P3-04** Discovery rewrite (cursor, filters, reciprocity, blocks) · D-05, D-15 · L · NOT STARTED
- [ ] **P3-05** Likes-you rewrite · D-05 · S · NOT STARTED
- [ ] **P3-06** Preferences, `PATCH /profiles/me`, pause/visibility · D-15 · M · NOT STARTED
- [ ] **P3-07** Photo management API (remove arbitrary URLs) · D-36 · M · NOT STARTED
- [ ] **P3-08** Mobile profile/edit/preferences/filter UI + pagination · D-15, D-38 · L · NOT STARTED
- [ ] **P3-09** Server-side search · D-15 · S · NOT STARTED

### Phase 4 — Matching & chat
- [ ] **P4-01** Lifecycle semantics on the Phase 2 schema (no new migration) · D-13 · S · NOT STARTED
- [ ] **P4-02** Single match-creation path + concurrency test · D-13 · M · NOT STARTED
- [ ] **P4-03** Enforce active-match/block/status on messages, reads, media · D-20 · M · NOT STARTED
- [ ] **P4-04** Typing indicators · — · S · NOT STARTED
- [ ] **P4-05** Message soft delete + report entry point · — · S · NOT STARTED
- [ ] **P4-06** Stop persisting chat in AsyncStorage; account-switch clearing · D-19 · M · NOT STARTED
- [ ] **P4-07** Chat UI states, context menu, match-ended view · D-17 · M · NOT STARTED
- [ ] **P4-08** Match celebration/list unmatch confirmation · — · S · NOT STARTED
- [ ] **P4-09** Socket cleanup (legacy room, targeted emits) · D-20 · S · NOT STARTED

### Phase 5 — Notifications & jobs
- [ ] **P5-01** Migration 011 + job runner (lease, expiry, retries, crash recovery, idempotency keys, dead-letter) + secured trigger endpoint · D-24 · L · NOT STARTED
- [ ] **P5-02** Notification events with dedupe + block/pref checks · D-16 · M · NOT STARTED
- [ ] **P5-03** Device tokens + Expo push sender, receipts, cleanup · D-16 · L · NOT STARTED (needs dev build + FCM/APNs credentials to verify)
- [ ] **P5-04** Mobile notification centre, prefs, tap navigation · D-16 · M · NOT STARTED
- [ ] **P5-05** Web in-app notifications (browser push deferred) · D-16 · S · NOT STARTED
- [ ] **P5-06** Move media expiry/token cleanup/email retry onto jobs · D-24 · M · NOT STARTED

### Phase 6 — Privacy, deletion, export, policy
- [ ] **P6-01** Migration 012 + settings API · — · M · NOT STARTED
- [ ] **P6-02** Account deletion (reauth, grace period — provisional Q6, anonymise-then-purge job) · D-12 · L · NOT STARTED
- [ ] **P6-03** Public `/delete-account` page · D-12 · S · NOT STARTED
- [ ] **P6-04** Data export job + temporary authenticated download · D-12 · M · NOT STARTED
- [ ] **P6-05** Policies from real behaviour; consent versioning UI · D-11 · M · NOT STARTED (**legal review required**; Q5/Q6/Q12 provisional)
- [ ] **P6-06** Mobile settings screens · D-11, D-12 · M · NOT STARTED

### Phase 7 — Media, stories, content security
- [ ] **P7-01** Migration 013 `media_assets` + `images` backfill behind a storage abstraction (Q8) · D-18 · M · NOT STARTED
- [ ] **P7-02** Validation/sanitising pipeline (type, limits, re-encode, EXIF strip, thumbnails) — **not moderation** · D-18 · L · NOT STARTED
- [ ] **P7-02b** Content-moderation track (`not_screened/pending/cleared/rejected`) + launch gate decision · D-18 · M · NOT STARTED (BLOCKED on provider or review-queue decision)
- [ ] **P7-03** Authenticated, block-aware photo delivery · D-18 · M · NOT STARTED
- [ ] **P7-04** Stories: matches-only audience (Q2), block/suspension checks, targeted events, report · D-06 · M · NOT STARTED
- [ ] **P7-05** Orphan/expired media cleanup jobs · D-18 · S · NOT STARTED
- [ ] **P7-06** Mobile upload progress/retry/remove · D-18 · M · NOT STARTED
- [ ] **P7-07** Enforce "video stories disabled" (Q11) in code · D-18 · S · NOT STARTED

### Phase 8 — UI/UX & accessibility
- [ ] **P8-01** Shared primitives · — · M · NOT STARTED
- [ ] **P8-02** Accessibility pass (incl. the fake on-screen keyboard in `search.tsx`) · — · M · NOT STARTED
- [ ] **P8-03** Responsive/screen-reader verification with evidence · — · M · NOT STARTED

### Phase 9 — Deployment & reliability
- [ ] **P9-01** `APP_ENV`, explicit `SEED_DEV_DATA`, fail-closed CORS · D-25, D-29 · M · NOT STARTED
- [ ] **P9-02** Staging service/DB; per-env EAS/Vercel config; separate demo service if wanted · D-24 · M · NOT STARTED (owner action on hosting)
- [ ] **P9-03** CSP/HSTS/Permissions-Policy; cookie/CSRF re-verification · D-24 · S · NOT STARTED
- [ ] **P9-04** Monitoring, alerting, request ids · — · M · NOT STARTED (provider decision)
- [ ] **P9-05** Backups + restore drill · — · M · NOT STARTED (owner/Neon access)
- [ ] **P9-06** Socket scale plan · D-20 · M · NOT STARTED
- [ ] **P9-07** Secret-rotation checklist · D-28 · S · NOT STARTED (owner executes)
- [ ] **P9-08** Owner executes the cleanup runbook; verify · D-08 · S · NOT STARTED (**owner action**; runbook is ready)
- [ ] **P9-09** Browser + device test scripts; run what is possible · — · M · NOT STARTED
- [ ] **P9-10** Store-readiness checklist vs current Apple/Google policy · — · M · NOT STARTED

### Phase 10 — Advanced
- [ ] **P10-01** Voice messages · — · L · NOT STARTED
- [ ] **P10-02** Audio/video calls · — · XL · NOT STARTED (BLOCKED: dev builds + TURN provider)
- [ ] **P10-03** Photo/profile verification · — · XL · NOT STARTED (BLOCKED: provider + legal)
- [ ] **P10-04** Premium/entitlements · — · XL · NOT STARTED (BLOCKED: product decisions + store accounts)

### Dependency follow-up (not tied to a phase)
- [ ] **DEP-1** Plan upgrades for the mobile advisories (1 critical, 17 high in production deps; Expo/React Native tooling) — needs a planned SDK/tooling upgrade, not a forced fix · NOT STARTED
- [ ] **DEP-2** Backend `express`/`qs` moderate advisories (npm reports a non-breaking fix) · NOT STARTED

---

## 4. Defect register

| ID | Sev | Defect (short) | Task(s) | State |
|---|---|---|---|---|
| D-01 | P0 | No central eligibility / account status | P1-01, 04, 05, 06 | **fixed (Phase 1)** — enforced on every dating route and socket; tested |
| D-02 | P0 | Age check wrong (Feb-30, year 1, no DOB at signup) | P1-02, 03, 12 | **fixed (Phase 1)** — strict validation, required at registration, under-18 locked; self-declaration remains a gate, not proof |
| D-03 | P0 | Onboarding invents data | P1-06, 07 | **fixed (Phase 1)** — guessing screens removed, server-driven confirmed steps; legacy invented values are not presented as chosen (web flow verified; native not run) |
| D-04 | P0 | No block/report/unmatch/moderation/suspension | P2-* | open (fake "Options" alert removed in Phase 0) |
| D-05 | P0 | Raw coordinates in discovery / likes-you | **P1-00**, P3-03/04/05 | **fixed (P1-00)** for all member-facing payloads; consented, bucketed distance still planned in P3-03 |
| D-06 | P0 | Stories visible to all; global broadcast | P7-04 | open |
| D-07 | P0 | Google OAuth: no state/PKCE, token in URL; no Apple | P1-10 | **server fixed (Phase 1)**; native client not run on device/with real Google; **Apple BLOCKED** |
| D-08 | P0 | Production blueprint enables demo login; possible fake rows live (unverified) | **P1-00b**, P9-08 | **demo login: fixed in code/config** (not deployed); fake rows: **open** — runbook ready, nothing executed |
| D-09 | P0 | Email verification optional/unenforced | P1-08 | **fixed (Phase 1)** — enforced; real delivery untested |
| D-10 | P0 | Unconditional "Verified Account" | P0-08, P1-09 | **fixed** (Phase 0 stop-gap, Phase 1 permanent: e-mail status only) |
| D-11 | P0 | Placeholder policy, no terms/consent | P1-03, P6-05 | **partly fixed (Phase 1)** — fictional date and unsupported claims removed, draft banner, consent versions recorded and required; final legal text, retention and re-acceptance still Phase 6 |
| D-12 | P0 | No account deletion / export / deletion page | P6-02, 03, 04 | open |
| D-13 | P1 | Match `expires_at` unenforced; 3 creation paths | P2-01a, P2-07, P4-01, 02 | open |
| D-14 | P1 | Match % unbounded/undefined | P3-02 | open |
| D-15 | P1 | Discovery filters fake, no reciprocity/cursor | P3-* | open |
| D-16 | P1 | Notifications derived client-side, no push | P5-* | open |
| D-17 | P1 | Fake attachments | P0-08, P4-07 | **fixed** in Phase 0 (only Camera/Gallery remain) |
| D-17b | P1 | Fake call screens | P0-08, P10-02 | **mitigated** in Phase 0 (flagged off, routes redirect); real calls = Phase 10 |
| D-18 | P0/P1 | Media: no re-encode/EXIF strip, public images, **no moderation** | P7-* | open |
| D-19 | P1 | Chat cached in plaintext AsyncStorage | P4-06 | open |
| D-20 | P0 | Sockets can't revoke; global emits; in-memory state | P1-05, P2-05, P4-09, P9-06 | **partly fixed (Phase 1)** — status/eligibility enforced at connect and join, live sockets closed on status change; global `stories_changed`, in-memory state still open |
| D-21 | P1 | IP-only abuse limits | P2-11 | open |
| D-22 | P1 | Server password rule weaker than client | P1-03 | **fixed (Phase 1)** |
| D-23 | P2 | Registration reveals existing emails | — | accepted-risk |
| D-24 | P1 | Single URL/env, sleeping host, in-process jobs, no CSP/HSTS | P5-01, P9-* | open |
| D-25 | P1 | Dev seeding inferred from env; known-password seeds | P9-01 | **mitigated** in Phase 0 (not seeded into hosted DBs); explicit flag still planned |
| D-27 | P1 | Misleading Supabase schema | P0-05 | **fixed** (archived with banner) |
| D-28 | P1 | Secret handling (no `.env` in git history; rotate if an archive was shared) | P9-07 | open (owner) |
| D-29 | P2 | CORS only warns when unset | P9-01 | open |
| D-30 | P1 | Stale tests (showcase ×2, migrations ×1) | P0-03, 04 | **fixed** |
| D-31 | P1 | CI lacked export/audit | P0-07 | **fixed locally; remote CI run pending**; mobile unit/E2E tests still absent |
| D-32 | P2 | 30 lint warnings | P0-06 | **fixed** |
| D-33 | P2 | `expo-av` status for SDK 54 unconfirmed | P10-01 | open |
| D-34 | P1 | No retention policy | P4, P6 (Q5 provisional) | open |
| D-36 | P2 | Arbitrary remote photo URLs accepted | P3-07 | open |
| D-38 | P1 | Edit-profile invented gender defaults / fake phone | P1-07, P3-08 | **partly fixed** (fake phone and unsaved e-mail field removed in Phase 0; gender is now an enum on the server; the edit screen still pre-selects "male/female" when empty — revisit in Phase 3) |
| **D-40** | **P0** | **Developer `.env` points at a hosted database; before Phase 0 `npm run dev` would have run migrations 004/005 and seeded fake accounts (some with a known password) there** | P0-S1, P0-S2 | **fixed** in Phase 0 (guards) — found in Phase 0 |
| **D-41** | P1 | `demo.js` `ensureDemoAccounts()` deletes every `is_demo` profile that is not a demo persona on each demo login (cascading) — unsafe if fixtures or other rows are ever flagged `is_demo` | P1-00b / P3 (explicit fixture flag) | open — documented in `KNOWN_LIMITATIONS.md` |
| **D-42** | P2 | `search.tsx` draws a fake on-screen keyboard with non-working keys and per-row "…" buttons; stories offer "preset"/"paste URL" options of unverified safety | P8-02, P7-04 | open — observed, deliberately untouched in Phase 0 |
| **D-43** | P1 | Dependency advisories: mobile 1 critical + 17 high (production deps), backend 2 moderate | DEP-1, DEP-2 | open — reported, not fixed |

| **D-44** | P1 | A socket stays open if a member's eligibility is lost by a direct database edit (only `setAccountStatus` closes sockets) | Phase 2 (admin tools call it) | open |
| **D-45** | P1 | Suspended / banned members cannot sign in, so they have **no appeal or data-request channel** yet | Phase 2 (appeals), Phase 6 (export/delete) | open |
| **D-46** | P1 | Apple Sign In missing (required on iOS if Google sign-in is offered) | P1-10 | **BLOCKED** (Apple developer account) |
| **D-47** | P2 | Manual e2e scripts `backend/test/chat.e2e.js` and `images.e2e.js` register without a date of birth / policies / strong password and were updated for the new registration + onboarding flow; `npm run test:e2e` runs them on a throwaway local stack (chat 10 checks, images 8 checks pass) | — | **fixed** (final review) |
| **D-48** | P1 | `db_init.sql` runs on every boot and merges (deletes) duplicate match rows per pair, then re-adds `UNIQUE (user_a, user_b)`: incompatible with several match rows per pair (found while planning Phase 2) | P2-01a (design D2.1 A) | open |
| **D-49** | P1 | `socket.data.tv` is never set and `join_room` ignores `loadSession().problem`: token-version revocation is not re-checked on a held socket | P2-05 | open |
| **D-50** | P1 | `status_change` presence and global `stories_changed` are emitted to audiences that include blocked, unmatched or unrelated members | P2-05 | open |

---

## 5. Decisions log

Recorded 2026-11-22. **Approved** = implementation approval (build to it). **Provisional** = direction decided, details need owner/legal confirmation; implement as configuration, do not publish final values.

| # | Decision | Type | Detail still needed |
|---|---|---|---|
| Q1 | Persistent matches until unmatch, block or account deletion | **Approved** | — |
| Q2 | Stories visible only to authorised active matches | **Approved** | per-user audience toggle is an addition to confirm |
| Q3 | Preserve all 16 showcase profiles as isolated dev/demo fixtures; never real members | **Approved** (done: kept, tested, guarded) | explicit fixture flag is future schema work (D-41) |
| Q4 | TOTP MFA for privileged moderation staff | **Approved** | staff list, enrolment process |
| Q5 | Documented message-retention and safety-evidence policy | **Provisional** | periods need owner + legal approval |
| Q6 | Immediate account disablement; 14-day deletion grace | **Provisional** | grace period subject to policy/legal review |
| Q7 | Production cleanup: runbook only | **Approved** (runbook delivered, not executed) | owner executes (P9-08) |
| Q8 | PostgreSQL media storage for the MVP behind a storage abstraction (S3-compatible later) | **Approved** | — |
| Q9 | Email + Google; Apple Sign In where applicable to the iOS release | **Approved** (Apple conditional) | Apple account; confirm iOS release includes Google |
| Q10 | ≥ 1 authentic profile photo required, 3 recommended | **Approved** | — |
| Q11 | Video stories disabled until secure processing exists | **Approved** | enforcement in code: P7-07 |
| Q12 | Plan for an initial Sri Lankan launch | **Provisional** | owner confirmation; legal review (age of majority, data-protection law, store requirements) |
| Q13 | Move `MASTER_PROMPT.md` into `docs/implementation/` | **Approved — DONE** | — |
| Q14 | Migrations 004/005 (destructive mock-account cleanups) stay **local-only**; hosted data is cleaned only through the reviewed runbook | **Approved** (done: archived to `backend/ops/local-dev-cleanup/`, unchanged) | the owner executes the runbook on hosted data (P9-08) |

---

## 6. Blockers and external requirements

| Item | Needed from | Affects |
|---|---|---|
| ~~Review and commit of the working tree~~ — **done locally** (`2b8c384`, `b11eb4b`, `378eac8`, `47b8a13` and the documentation commit); **pushing is the owner's decision**. Decision on `tessa.png` still open (kept, nothing deleted) | Owner | Phase 2 start (can proceed in development without it) |
| **Phase 2 decisions D2.1 to D2.10** (`PHASE_02_IMPLEMENTATION_PLAN.md` section 4): match lifecycle, rematch rule, staff credentials, staff roster and enrolment, dashboard hosting, retention, suspected-minor evidence, suspension notices, dashboard test tooling, image classification. **All PENDING; none approved.** | Owner (and counsel for D2.6, D2.7) | D2.1: P2-01a; D2.3 to D2.5: P2-08, P2-10; D2.6, D2.7: P2-06 |
| ~~Go-ahead to edit `render.yaml`~~ — done and committed locally in `378eac8`; **deploying it is the owner's decision** | Owner | P1-00b |
| Execution of the production cleanup runbook; recovery point | Owner | before any real-user exposure |
| A GitHub run of the updated CI workflow; a Node 22 run | Owner / CI | P0-07 |
| **Resend API key + verified sender domain — now REQUIRED before the next production deploy** (the backend refuses to start in production without them) | Owner | any production deploy; P1-08 live test |
| Google OAuth client id/secret + the redirect URI `<backend>/api/auth/google/callback` registered with Google; Apple developer account for Sign in with Apple | Owner | P1-10 live test / iOS release |
| A run of the native app on Android and iOS devices/emulators (onboarding, Google sign-in, photo picker) | Owner | P1-07, P1-10 verification |
| Legal review of the draft Terms/Privacy text and the consent versions | Owner / counsel | P6-05, launch |
| FCM/APNs credentials in EAS; development builds | Owner / EAS | P5-03, P10 |
| Image-moderation provider **or** review-queue decision | Owner | P7-02b, launch gate |
| Monitoring provider; Neon backup/restore access | Owner | P9 |
| Legal review (policies, retention, age assurance, biometrics, Sri Lanka) | Owner / counsel | P6-05, P10-03, launch |
| Physical devices / emulators | Owner | any "tested on device" claim |

---

## 7. Phase report template

```
### Phase N — <name> — <STATUS> — <date>
1. Features completed:
2. Files modified:
3. Database migrations added:
4. API endpoints implemented:
5. Frontend screens updated:
6. Tests run and exact results: (command → pass/fail/skip counts)
7. Security concerns addressed:
8. Remaining blockers:
9. Next phase:
```

---

## 8. Session log

| Date | Work | Result |
|---|---|---|
| 2026-11-22 | Audit and planning: baseline audit, implementation plan, tracker. No code changed. | Planning complete. |
| 2026-11-22 | **Phase 0 implemented** on branch `phase-0-stabilise`: master prompt moved; migration/seeding safety guards; stale tests replaced; lint 30 → 0; Node pin, `test:all`, CI extension, audit report; misleading UI removed; legacy schema archived; docs, cleanup runbook and plan corrections written. | `npm run test:all` 5/5 pass; unit 36/36, integration 28/28. Not committed at that time (committed later in `2b8c384`, `b11eb4b` and `47b8a13`); not pushed; no hosted service contacted. See `PHASE_00_COMPLETION_REPORT.md`. |
| 2026-11-22 | **Phase 1 implemented**: Task 0 (archived 004/005, Node 22 run), migrations 006/007, age module, registration + consent, eligibility on REST/sockets, onboarding API + screens, mandatory e-mail verification, OAuth state/PKCE/one-time code, restricted `complete-setup`; docs. | Unit 77/77, integration 49/49 (also on Node 22), tsc 0, lint 0, export OK; web journey driven in a browser against a local backend. Native, real Google/Resend, Apple not run. See `PHASE_01_COMPLETION_REPORT.md`. |
| 2026-11-22 | **Phase 1 final review** (git/security/migration review): OAuth race and strict-boolean tests, SQL-vs-JS adulthood agreement test, 006/007 upgrade-without-data-loss test, manual e2e scripts updated + `npm run test:e2e`, commit plan prepared. | Node 24 `test:all` 5/5; Node 22.23.5: unit 77/77, integration 51/51, e2e 10+8, tsc 0, lint 0, export OK. Nothing pushed or deployed (the commits were made afterwards, see the next row). See `PRE_PHASE_2_REVIEW.md`. |
| 2026-11-22 | **Release Gate A implemented** (P1-00 coordinates, P1-00b demo isolation) on the same uncommitted branch. | Unit 44/44, integration 32/32, tsc 0 errors, lint 0 warnings, web export OK. Not committed at that time (committed later in `378eac8`); not pushed or deployed; no hosted service contacted. See `PHASE_01_RELEASE_GATE_A_REPORT.md`. |
| 2026-11-22 | **Four local commits created** (not pushed) on `phase-0-stabilise`: `2b8c384` showcase, `b11eb4b` migration safety, `378eac8` Phase 1, `47b8a13` tooling and CI. Each commit checked in a clean worktree on Node 22 with Expo route types regenerated. | Commit 1: unit 28/28, tsc pass, lint fails on main's existing 30 warnings. Commit 2: unit 38/38, integration 25/25, tsc pass, same 30 lint warnings. Commits 3 and 4: unit 77/77, integration 51/51, tsc 0, lint 0, web export OK. Final `npm run test:all` 5/5 and `npm run test:e2e` (10 + 8 checks) on Node 22; tree clean. See `PRE_PHASE_2_REVIEW.md`. |
| 2026-11-22 | **Documentation commit** (fifth, docs only): tracker and Phase 2 plan finalised, outdated "uncommitted" statements corrected, Phase 2 decisions D2.1 to D2.10 recorded as pending. | No application code, migration or dependency changed; no new test run needed. |
| 2026-11-22 | **Phase 2 implementation plan prepared** (`PHASE_02_IMPLEMENTATION_PLAN.md`): no code changed; decisions D2.1 to D2.10 await the owner. | Plan only. |
