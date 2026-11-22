# Dateza — Security checklist

Living checklist, created at Release Gate A and extended in Phase 1 (2026-11-22). Each line says what is enforced **today**, how it is checked, and what is still open. "Tested" means an automated test in this repository exercises it (see `TEST_REPORT.md`); "Open" means not done. Nothing here is a legal or compliance claim.

Status key: ✅ enforced and tested · 🟡 partly / not tested end to end · ⛔ open · 👤 owner action

## 1. Release Gate A — must hold before any real person reaches a production environment

| # | Control | Status | Evidence / next step |
|---|---|---|---|
| A1 | Destructive migrations cannot run on a shared or production database without review | ✅ | `backend/dbSafety.js`; `dbSafety.test.js`; 4 scratch-database integration tests |
| A2 | Fake development accounts are never seeded into a hosted database | ✅ | `canSeedDevData`; `dbSafety.test.js` |
| A3 | No member's raw coordinates reach any other member | ✅ | `toPublicProfile` whitelist in `profiles.js`; integration leak test over discovery, likes-you, swipe, matches, conversations, quick matches, stories (proven to fail on the pre-fix code) |
| A4 | Profile setup cannot store coordinates nobody consented to | ✅ | `validateProfileInput` → `400 location_not_supported`; unit + integration tests |
| A5 | The shared demo login is off in production | ✅ code/config · 👤 deploy | `render.yaml` `"false"`; `config.js` ignores the flag in production without `DEMO_ENVIRONMENT=isolated`; `demoConfig.test.js`. **Takes effect only when the owner deploys.** |
| A6 | Sessions already issued to demo accounts die when the demo login is off | ✅ | `session.js`; unit + integration tests |
| A7 | Production data cleaned of fixture/demo rows | 👤 | `PRODUCTION_CLEANUP_RUNBOOK.md` (prepared, **not executed**) |
| A8 | Destructive cleanups (old migrations 004/005) cannot run on a shared database | ✅ | archived outside `migrations/` (content unchanged), runner guard, test that `migrations/` holds no destructive file; hosted cleanup only via the runbook, executed by the owner |

## 2. Location privacy rules (apply to every future endpoint)

1. Precise coordinates (`lat`, `lng`, anything derived at full precision) are **never** in a response about another member. Responses for other members are built from the whitelist `PUBLIC_PROFILE_FIELDS`; a new field needs a deliberate addition and a test.
2. The member's own location may be returned only to that member.
3. Coordinates are stored only after an explicit consent flow (**not built** — P3-03). Until then `POST /api/auth/complete-setup` refuses them.
4. Distance shown to others will be a server-computed, bucketed label (≥ 5 km granularity), never raw numbers (P3-03/04).
5. Any new endpoint that returns another member must be added to the leak test in `backend/test/integration.test.js`.
6. Existing rows may still hold coordinates (they predate the fix). They are not exposed; deciding whether to clear them is an owner/privacy decision (needs a destructive-class change and a backup) — ⛔ open.

## 3. Demo and fixture isolation rules

1. Production never runs the shared demo login. Enabling it needs `DEMO_LOGIN_ENABLED=true` **and** `DEMO_ENVIRONMENT=isolated`, which means "this is a separate demo service with its own database". The production blueprint contains neither marker (test-enforced).
2. Demo accounts cannot sign in with a password and are hidden from real members (`is_demo`); tokens issued to them stop working when the demo is off.
3. Showcase/mock profiles are seeded only into a local database (`canSeedDevData`). ⛔ Open (D-41): they carry `is_demo = false` on a developer database, and `demo.js` deletes `is_demo` rows that are not a demo persona, so an explicit fixture flag (schema change) is still needed.
4. Never use the demo accounts to test real-member flows in production.

## 4. Migration safety rules

1. Additive first; destructive statements are classified automatically and need local-only or reviewed approval (`-- destructive-approved: by=… on=…` plus `ALLOW_DESTRUCTIVE_MIGRATIONS=true`).
2. Numbers are reserved by the roadmap and never reused; names validated.
3. Failing migrations roll back and are not recorded.
4. Integration tests run only against a local database; scratch databases for destructive/broken-file tests.
5. Production changes are made by the owner with a recovery point (`PRODUCTION_CLEANUP_RUNBOOK.md`, `DATABASE_MIGRATIONS.md`).

## 5. Existing controls verified by the original test suite (preserved)

✅ HttpOnly cookie session on web, bearer on native; CSRF header + Origin allowlist on cookie writes; JWT algorithm pinned (HS256); token versioning (password change/reset/logout-all end every session); single-use 30-second socket tickets; login brute-force limiter and constant-time unknown-user compare; HMAC-hashed one-time codes with expiry, attempt limit and resend cooldown; magic-byte image validation and size limits; private, expiring chat media; outsiders cannot read or post to a match; bcrypt cost 12.

## 5b. Phase 1 controls: eligibility, onboarding, account status, OAuth

| # | Control | Status | Evidence |
|---|---|---|---|
| E1 | Users under 18 cannot use dating features, on **every** REST route and on sockets | ✅ | `eligibility.js` (`requireEligible`, `requireAdult`, socket check); route-inventory test (every dating route is `eligible`); integration: "closed to EVERY dating feature", "each missing requirement …", "under-18 … LOCK" |
| E2 | Invalid dates cannot bypass the age check (Feb 30, year 1, loose shapes, future, numbers/objects) | ✅ | `age.js` + 53 shared vectors; registration and onboarding integration tests; `complete-setup` refuses `birthdate` entirely |
| E3 | Registration needs an adult date of birth and consent; **nothing is created for a minor** | ✅ | integration "registration needs a real adult date of birth …" (no row for 11 bad dates, 3 under-18 cases, 5 consent cases) |
| E4 | An under-18 date is **locked**: it cannot be re-entered; all other onboarding steps and completion also refuse | ✅ | integration "under-18 dates … LOCK the date" |
| E5 | The date of birth cannot be changed after the profile is completed | ✅ | 409 `birthdate_locked`; integration |
| E6 | Incomplete profiles cannot reach protected endpoints, and cannot be seen, swiped or messaged by others | ✅ | `candidateSql` filters; integration "only eligible members are visible …" |
| E7 | Verified e-mail is **enforced** (server) and is only `email_verified_at`; UI never shows an identity badge | ✅ | eligibility reasons; completion needs it; profile screen shows "Email verified / not verified" only; production config refuses to start without a mail provider |
| E8 | Only the server can complete onboarding; no client field can set completion, status or verification | ✅ | `profile_completed_at` set only in `POST /api/onboarding/complete`; tests send `profile_completed_at` / `status` / `email_verified_at` and see no effect |
| E9 | Nothing invented is stored or presented: no name-based gender, default birthdate, height, bio, interests, stock photos; photos must be the member's own uploads | ✅ | onboarding rewrite; `checkOwnPhotos`; legacy-defaults suppression test; removal of the old guessing screens |
| E10 | Suspended / banned / deleted accounts cannot sign in, keep a token or hold a socket; a finished suspension counts as active; live sockets are closed on status change | ✅ | `session.loadSession`, `login` 403, `accountStatus.setAccountStatus`; integration "suspended, banned and deleted …", "a suspension that has ended …" |
| E11 | A member cannot message, see the stories of, or swipe on a member who stopped being eligible | ✅ | integration "messages cannot be sent …", "only eligible members are visible …" |
| E12 | Sockets enforce account status and eligibility at connect (token and ticket) and on `join_room` | ✅ | integration "sockets: an ineligible member is refused …" |
| E13 | Existing accounts keep all data and sessions and can complete the new steps | ✅ | integration "existing accounts keep every record …" (match, message, swipe counts unchanged; session still valid; stock photo not counted) |
| E14 | Server-side password strength (same rule as the app); registration rate limit | ✅ | `passwordProblem`, unit + integration; `registerLimiter` unit test |
| O1 | Google sign-in uses a random one-time `state`, PKCE (also towards Google), an exact redirect allow-list and a one-time code exchange | ✅ (server, with Google stubbed) | integration "google sign-in: secure state and PKCE …"; `oauth.test.js` (RFC 7636 vector, 30+ rejected redirect shapes) |
| O2 | No session token, user record or e-mail ever appears in an OAuth redirect URL | ✅ | the test asserts the redirect carries only `code`, empty body, `no-store`, `no-referrer` |
| O3 | Replayed, expired, forged, wrong-verifier and wrong-platform codes/states are rejected; the code is single use | ✅ | same test |
| O4 | Only a Google-verified e-mail signs in; an unverified pre-registered account is cut off when the real owner signs in (password replaced, sessions ended) | ✅ | same test |
| O5 | Apple Sign In (required on iOS if Google is offered) | ⛔ **BLOCKED** | needs an Apple developer account; the placeholder Apple/Facebook buttons that showed fake alerts were removed |
| O6 | Native Google flow on a device / with real Google credentials | 🟡 not run | code type-checks; never executed against real Google or on Android/iOS |
| R1 | Route inventory: a new route cannot be added without declaring `public / session / adult / eligible` | ✅ | `eligibility.test.js` table must match exactly |

## 6. Still open (tracked in `IMPLEMENTATION_TRACKER.md`)

| Area | Open item | Task |
|---|---|---|
| Age assurance | A date of birth is self-declared; nothing checks it against identity. An adult-looking date is accepted | P1-12 doc, Phase 10 |
| Safety | No blocking, reporting, unmatch, moderation, audit log; no admin tool calls `setAccountStatus` yet; suspended members have no appeal channel (they cannot sign in) | Phase 2 |
| Content | No content moderation of images (validation ≠ moderation); EXIF not stripped; profile images public by id; stories visible to all eligible members | Phase 7 |
| Abuse | Rate limits are per IP only (plus per-IP registration, per-IP exchange) | P2-11 |
| Privacy | No deletion, export, accurate final policy; policy text is **draft** and consent versions are the label `draft-1` | Phase 6 |
| Sockets | Sockets stay open for a member whose eligibility is lost by a direct database edit (only `setAccountStatus` closes them) | Phase 2 |
| Operations | No monitoring, backups or restore drill; single-instance sockets; no job runner; Resend (mail) and Google credentials untested | Phases 5, 9 |
| Supply chain | Mobile: 1 critical + 17 high advisories in production dependencies; backend: 2 moderate | DEP-1, DEP-2 |
| Secrets | No `.env` was ever committed (checked in git history). If an archive containing one left the owner's machine, rotation is an owner action | 👤 P9-07 |

## 7. Age-assurance approach

A self-declared date of birth is a gate, not proof. What exists now: strict server-side date validation (`age.js`, shared vectors, same code in the app); the date is required at registration and re-validated in onboarding; **an under-18 date is stored, locked and ends the journey** (no retry with another date, no dating features, no photo upload, nothing created at registration); the date cannot change after completion; a verified e-mail is required; every dating route and socket re-checks adulthood from the stored date on each request.
What does not exist yet: a "suspected underage" report category and a moderation case with automatic suspension pending review (Phase 2), and an identity/age check through a provider (Phase 10). The escalation process and evidence handling must be written down and reviewed by counsel before launch (Sri Lanka, per provisional decision Q12). A determined minor can still type an adult date; the layers above reduce but do not remove that.

Time zone: age is computed against today's date in UTC, so a member east of UTC (for example Sri Lanka, UTC+5:30) is held back for up to a few hours on the day they turn 18. That is the safe direction and is documented in `age.js`.

## 8. How to extend this checklist

Add a line whenever a phase lands a control: what is enforced, the test that proves it, and what remains. Remove nothing without a replacement; mark superseded lines instead.
