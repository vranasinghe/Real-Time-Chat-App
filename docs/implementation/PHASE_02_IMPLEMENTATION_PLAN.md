# Phase 2 implementation plan: safety, blocking, reporting, moderation

Status: **PLAN FOR REVIEW. No Phase 2 source code has been written.** Prepared 2026-11-22 from `MASTER_PROMPT.md` section 5, `IMPLEMENTATION_PLAN.md` (Phase 2), `IMPLEMENTATION_TRACKER.md` and a fresh reading of the Phase 1 code on the four local commits (see section 12).

Scope (your list): user blocking; user reporting; unmatching; account-suspension enforcement; admin roles and authentication; moderation dashboard; audit logs and appeals; Socket.IO safety enforcement; abuse prevention and rate limiting; database migrations; regression tests.

Standing rules (unchanged): never connect to or modify production infrastructure; migrations are additive and tested only on isolated local PostgreSQL; no deploy to Vercel, Render, Neon or EAS; no push; no commit without your approval of the commit plan; owner-run runbooks stay owner-run; no real user data is deleted; Expo code follows the SDK 54 docs (`AGENTS.md`).

---

## 1. What Phase 2 must prove (acceptance, from the master prompt)

| Acceptance criterion | How it will be proven |
|---|---|
| Blocking works through REST and Socket.IO | Integration tests with real HTTP and real held sockets (section 9, suites B and S) |
| Existing open chats cannot bypass blocks | Block while both members have an open socket and an open conversation; every send, read, media fetch and room join is refused afterwards, including after reconnect |
| Reported content can be reviewed securely | Evidence snapshot at report time; evidence readable only through a staff-only endpoint that logs every view (suites R and A) |
| Moderator actions are audited | Every action writes its audit row in the same transaction; the audit table rejects UPDATE, DELETE and TRUNCATE (suite M) |
| Suspended users cannot use dating features | Already true for REST and sockets in Phase 1; Phase 2 adds the periodic socket sweep (D-44), notices and appeals, and tests that moderators' actions end sessions immediately |
| Ordinary users cannot access the moderation dashboard | A normal user token, a staff token without MFA step-up, an expired staff token and a wrong-audience token each fail on every `/api/admin/*` route (suite A) |
| Reporter privacy is protected | No response to the reported user, no socket event, no e-mail and no moderation notice contains the reporter's identity (suite R) |

## 2. Facts from the current code that shape the design

These were read in the code, not assumed.

| # | Fact | Consequence |
|---|---|---|
| F1 | `backend/db_init.sql` runs on **every boot**. It merges duplicate match rows for the same pair (it **deletes** the extra rows after moving their messages) and then re-adds `matches_user_pair_unique UNIQUE (user_a, user_b)`. | The existing plan's "partial unique index on active pairs, several rows per pair" is unsafe as written: on the next boot the dedupe block would merge the historical unmatched rows away and the constraint would be re-added (or fail the boot). See decision D2.1 |
| F2 | `dbSafety.js` classifies as destructive: `DELETE FROM`, `TRUNCATE`, `DROP TABLE/COLUMN/INDEX/CONSTRAINT/...`, and any `ALTER TABLE ... DROP ...`, which also matches `ALTER COLUMN ... DROP NOT NULL`. Such files are refused on non-local databases unless a reviewed marker and `ALLOW_DESTRUCTIVE_MIGRATIONS=true` are both present. | Making `matches.expires_at` nullable (planned) would be refused on a hosted database. Either avoid it or refine the guard first (task P2-00) |
| F3 | Sockets receive events only through `user:<id>` rooms (plus the legacy per-match room). The only client-to-server events are `join_room` and `leave_room`; messages are sent over REST. | The socket attack surface is small: connection, `join_room` (authorises on match membership and eligibility only, not on match status or blocks), and server emits |
| F4 | `socket.data.tv` (the token version) is never set at connect, yet `join_room` passes it to `loadSession`; the result's `problem` field is ignored, so only account status and eligibility are checked there. | Token-version revocation is not re-checked on a held socket. Fix in P2-05 (new defect D-49) |
| F5 | `setPresence` emits `status_change` to **every match partner** of a member, with no block or status filter. `stories_changed` is emitted to **all sockets** (`io.emit`). | Both leak activity to blocked or unmatched people and must be audience-scoped (D-20 remainder) |
| F6 | `accountStatus.setAccountStatus(io, userId, status, {suspendedUntil})` is already the single place status changes: bumps `token_version`, sets `status`, closes live sockets. No caller exists yet. | Moderation actions will call it inside their transaction wrapper; no second code path |
| F7 | Suspended, banned and deleted accounts cannot sign in or hold a session (owner instruction in Phase 1). | They also cannot appeal through the app. Appeals need a separate, narrowly scoped channel (D-45), see P2-09 |
| F8 | Route classes `public / session / adult / eligible` are asserted by an exact inventory test (`backend/test/eligibility.test.js`); every mounted router must be listed. | Extend the same mechanism with a safety classification so a new route that returns another member's data fails the test unless it declares its block check |
| F9 | Rate limiting is IP-based only (`authLimiter` 100 per 15 minutes, `apiLimiter` 300 per minute, `uploadLimiter`, failed-login limiter, registration limiter). Nothing is per account. | Per-account limits are new work (D-21) |
| F10 | Chat media and stories live in `ephemeral_media` and expire after 12 hours. | A report about expiring media must copy the evidence at report time or it will vanish before review |
| F11 | There is no server-side search endpoint; the app's search screen filters a local list (D-42). Photos are served by unguessable id with no per-viewer check. | Search has nothing to enforce yet (re-check in Phase 3). Photo-id access control belongs to P3-07 and is listed as a known limit, not silently skipped |
| F12 | There is no existing admin concept (no role column, no admin routes). | Greenfield, so the security model below can be chosen cleanly |

## 3. Plan corrections and new items to record in the tracker

| Id | Correction |
|---|---|
| R8 | Migration numbering: 008 match lifecycle, 009 user safety (blocks, reports), 010 moderation and admin, 011 abuse limits. The Phase 3 profile migration moves from 010 to **012**. |
| R9 | Match lifecycle design: prefer one row per pair with a status (decision D2.1) over several rows per pair. Removes the F1 conflict and any `DROP CONSTRAINT`. |
| R10 | Add task **P2-00** (preparation): refine the destructive-SQL guard so `DROP NOT NULL` and `DROP DEFAULT` are not treated as data-destroying, with tests; add the Phase 2 branch and baseline run. |
| D-48 | `db_init.sql` dedupe-and-constraint blocks conflict with any multi-row-per-pair design (F1). |
| D-49 | `socket.data.tv` never set; `join_room` ignores `loadSession().problem` (F4). |
| D-50 | `status_change` and `stories_changed` emit to audiences that include blocked, unmatched or unrelated members (F5). |

## 4. Decisions needed from you (before the slice they gate)

**All ten decisions are PENDING. None is approved unless it is later recorded here as approved by the owner. "My recommendation" is advice only.**

| Id | Decision | Gates | My recommendation | Status |
|---|---|---|---|---|
| D2.1 | Match lifecycle: (A) keep one row per pair and flip `status`; a rematch reuses the row, sets `connected_at = now()` and hides older messages from the participants (kept for safety), or (B) several rows per pair with a partial unique index, which needs `db_init.sql` changed and a `DROP CONSTRAINT` on a reviewed marker | P2-01a | **A**: no destructive SQL, no change to the boot-time block, simplest to test | **PENDING** |
| D2.2 | Rematch rule after unmatch: the existing plan says no automatic rematch, the pair is "passed" for 30 days, then may reappear unless blocked or reported | P2-07 | Accept as written | **PENDING** |
| D2.3 | Staff accounts: separate credential store (staff are not consumer profiles) vs a role attached to a consumer profile | P2-08 | **Separate staff credentials** (`admin_users`), so a compromised consumer account or OAuth login can never become staff. Cost: a small enrolment CLI | **PENDING** |
| D2.4 | Staff roster and enrolment: who the first moderators and admin are, and who runs the enrolment script. Credentials are created by you locally; the agent never creates or sees production credentials | P2-08 | You decide; Q4 already approves TOTP | **PENDING** |
| D2.5 | Where the dashboard is hosted (separate origin or sub-domain), and whether an IP allow-list applies | P2-10 | Separate origin, optional allow-list, no link from the consumer app | **PENDING** |
| D2.6 | Retention periods for reports, evidence, messages of unmatched or blocked pairs, and audit logs (Q5 is provisional) | P2-06 | Implement a configurable `retention_until` now; the purge job and final periods wait for your and legal approval (Phase 6) | **PENDING** |
| D2.7 | Handling of `underage_suspected` and any sexual-content-involving-minors evidence (statutory reporting duties, who may view) | P2-06, P2-10 | Needs legal advice. Until then: priority-1 case, evidence hidden behind an explicit click with a view audit, no automatic forwarding anywhere | **PENDING** |
| D2.8 | Suspension and ban notices: send an e-mail through Resend (not yet verified live) or show the notice at the next sign-in attempt only | P2-09 | Show at sign-in attempt in Phase 2; e-mail once Resend is verified | **PENDING** |
| D2.9 | New test tooling for the dashboard (Vitest and React Testing Library, devDependencies only) | P2-10 | Approve; API tests carry the security assertions either way | **PENDING** |
| D2.10 | Image classification provider (master prompt "potentially abusive images") | P2-11 | Not in Phase 2 code: only the `moderation_status` hook; **blocked until a provider is chosen** | **PENDING** |

## 5. Architecture

```text
backend/
  safety/
    blocks.js        SQL helper notBlockedEitherWay(...), isBlockedEitherWay(a,b), block/unblock service
    reports.js       validation, subject access check, evidence snapshot, dedupe, limits
    matchLifecycle.js unmatch, block-driven match ending, rematch rule, match_removed emission
    limits.js        per-account limiter (PostgreSQL fixed-window upsert) + named policies
    triage.js        counters and rules that open or escalate cases, apply only reversible throttles
    routes.js        /api/safety/*  (blocks, reports/me, appeals entry points)
  admin/
    auth.js          staff login, TOTP, step-up, sessions, lockout
    roles.js         role matrix and requireRole()
    api.js           /api/admin/* routers (reports, cases, users, evidence, appeals, audit, metrics)
    actions.js       warn, suspend, ban, reinstate, remove content: one transaction + audit row
    audit.js         append-only audit writer
  migrations/008..011
  scripts/admin-create.js   LOCAL enrolment CLI run by the owner (prints the TOTP secret once, to the terminal)
admin/               separate Vite + React dashboard package (own build, own origin, no shared bundle with the app)
mobile/              block / report / unmatch UI, blocked-users screen, suspended-account and appeal screens
```

Two boundaries matter most. First, **one enforcement primitive** for blocks, imported by every query that returns or acts on another member, guarded by an inventory test (F8). Second, **one status-change path** (`setAccountStatus`, F6), so moderation can never leave a live socket or session behind.

## 6. Work breakdown

Sizes: S under a day, M one to two days, L three to five days, XL more. Order is sequential unless noted.

### P2-00 Preparation (S)

- Create branch `phase-2-safety` from the current HEAD (after your approval; nothing is pushed).
- Refine `dbSafety.js`: `ALTER COLUMN ... DROP NOT NULL` and `DROP DEFAULT` no longer count as destructive; every other `DROP` stays destructive. Tests for each form.
- Record R8 to R10 and D-48 to D-50 in the tracker; baseline `npm run test:all` and `npm run test:e2e` on Node 22.

### P2-01a Migration 008, match lifecycle (M), D-13, D-48

- Under decision D2.1(A): `matches.status` (`active | unmatched | blocked`, CHECK, default `active`), `unmatched_at`, `unmatched_by` (FK `ON DELETE SET NULL`), `connected_at` (default `now()`, backfilled to `created_at` by a plain UPDATE of the new column only), `messages.removed_at` and `removed_reason` for moderator content removal. No `DROP`, no data rewrite of existing columns. `expires_at` is left untouched (it is not enforced today and Q1 says matches are persistent; stop reading it, drop it later in a reviewed cleanup).
- `db_init.sql` is **not** changed under (A).
- Integration test: upgrade a database built to migration 007 with realistic matches and messages; every existing column of every existing row is unchanged; all matches report `active`; re-running initialisation changes nothing; the duplicate-merge block still behaves as before.

### P2-01b Migration 009, user safety (M)

- `user_blocks (id, blocker_id, blocked_id, reason_code, created_at, UNIQUE (blocker_id, blocked_id), CHECK (blocker_id <> blocked_id))`, index on `blocked_id`.
- `user_reports` (as in the master prompt, plus `evidence jsonb`, `reporter_visible_status`, `dedupe_key`, `retention_until`), `report_evidence_files` (copied bytes for media that would otherwise expire, F10), indexes for the inbox (`status, created_at`) and for dedupe.
- Foreign keys to profiles use `ON DELETE SET NULL` or `RESTRICT` for safety records so they survive account deletion (retention, Phase 6); `NOT NULL` is dropped from nothing existing.

### P2-02 Block primitive and route inventory (M)

- `safety/blocks.js`: `notBlockedEitherWay(viewerParam, otherColumn)` SQL fragment, `isBlockedEitherWay(a, b)`, `blockUser`, `unblockUser`, `listBlocked`.
- Extend `eligibility.test.js` (or a sibling) so each route is also classified `blocks: enforced | not-applicable`, and a new route cannot be mounted without a classification.

### P2-03 Block APIs (S)

- `GET /api/safety/blocks`, `POST /api/safety/blocks` (`{ userId, reason_code? }`), `DELETE /api/safety/blocks/:userId`. Idempotent (a repeat returns the same success), self-block refused, unknown target answered like a successful block of nobody visible (no existence probe), per-account limiter (P2-11). All routes `eligible`.

### P2-04 Enforce blocks on every REST path (L), D-04

Each item gets a test that fails before the change. Blocked or unavailable targets always get the same response shape as a non-existent one (`404 { code: "unavailable" }`), so nobody can tell.

| Route | Rule |
|---|---|
| `GET /api/profiles/discovery`, `GET /api/profiles/likes-you` | exclude blocked either way (extend `candidateSql` use) |
| `POST /api/swipes` | refuse swipes involving a blocked pair; no match created |
| `GET /api/matches`, `/conversations` | blocked and unmatched conversations leave the list for both sides (the blocker sees the person only in the blocked-users list) |
| `POST /api/matches`, `/quick` | refuse; never reuse a blocked row |
| `GET/POST /api/matches/:id/messages`, `POST /:id/read` | require `status = 'active'` and no block, otherwise `404 unavailable` |
| `POST/GET /api/media`, chat media reads | same rule; revoke reads of media from a blocked or unmatched conversation |
| `GET /api/stories` | exclude blocked either way (stories already limited to eligible members) |
| `status_change` presence emits | only to active, unblocked partners (F5) |

### P2-05 Socket.IO safety enforcement (M to L), D-20, D-44, D-49, D-50

- Set `socket.data.tv` and the account snapshot at connect; make `join_room` require `matches.status = 'active'`, no block, eligibility **and** an unrevoked token version; stop ignoring `loadSession().problem`.
- `matchLifecycle.endMatch(io, match, reason)`: remove both members' sockets from the legacy match room (`io.in(userRoom(a)).in(userRoom(b)).socketsLeave(matchId)`), emit a **generic** `match_removed { match_id }` to both (identical for unmatch and block, so a block is not revealed).
- Replace the global `stories_changed` emit with audience-scoped emits (members who may see that story, minus blocks).
- D-44: a sweep every 60 seconds checks the status and token version of all connected user ids with one query and disconnects any socket whose account changed through any path, including a direct database edit. Documented limit: single instance until the Redis adapter work in Phase 9.
- Flood control: per-socket event budget (disconnect on abuse), at most 5 concurrent sockets per member, and a connection-attempt limiter per IP and per account; set `maxHttpBufferSize` to 10 kB because clients send nothing large.
- Tests with real sockets, see suite S.

### P2-06 Reports API (M)

- `POST /api/safety/reports` with `subject_type` (profile, message, photo, story, chat media) and a fixed category list (harassment, threats, spam, fake, impersonation, inappropriate, underage_suspected, other). Validation: the reporter must legitimately be able to see the subject (participant in the match, or the subject appears in their authorised feed), the subject must exist, the description is length-limited and stored as text only.
- Snapshot at report time: message body plus up to ten messages either side for context, the photo's image id and SHA-256, story or chat-media bytes copied to `report_evidence_files` before they expire.
- Dedupe: an identical open report from the same reporter about the same subject returns the existing report. Limits: reports per day per account, and per target per week.
- `GET /api/safety/reports/me`: the reporter's own reports with a neutral status only. The reported member is never told that a report exists, and no field in any response, socket event or notice they receive can identify the reporter.
- Reporting someone does not block them automatically; the report sheet offers "also block" as a separate choice.

### P2-07 Unmatch (M), D-13

- `DELETE /api/matches/:id`: participant only; sets `status = 'unmatched'`, `unmatched_by`, `unmatched_at`; sends refused immediately; both clients get `match_removed`; messages are retained server-side under the safety window and hidden from both participants. It is not a block and not a deletion, and the response and events say so neutrally.
- Rematch under D2.2: the pair is not offered to each other for 30 days; a later mutual like reactivates the same row (`status = 'active'`, `connected_at = now()`) and the participants see only messages from `connected_at` on. A blocked or reported pair is never reactivated.
- Closes the quick-match and swipe creation paths that bypass status (D-13).

### P2-08 Staff identity, roles and MFA (L), D-04, Q4

- Tables in migration 010: `admin_users` (id, e-mail, password hash, role, status, created_by), `admin_totp` (secret encrypted with a server key, enrolled_at, last_used_step for replay protection), `admin_recovery_codes` (hashed, single use), `admin_sessions` (jti, expiry, revoked) so a staff session can be revoked server-side.
- Roles: `moderator` (reports, cases, warn, remove content, temporary suspension up to a limit), `senior_moderator` (longer suspensions, ban proposals, appeals), `admin` (bans, reinstatement, staff management, audit export). Permission matrix in `admin/roles.js`, tested route by route.
- Authentication: separate endpoint `POST /api/admin/login` (password, then TOTP); tokens carry a different audience and issuer from consumer tokens, so a consumer token can never pass and the reverse; short lifetime (15 minutes) with a sliding refresh bound to the session row; **step-up**: destructive actions (ban, reinstate, staff changes, evidence of a minor) require a TOTP re-entry within the last 5 minutes. HttpOnly, Secure, SameSite=Strict cookie on the admin origin plus a CSRF header and its own CORS allow-list; strict rate limits and lockout; IP and user-agent audit.
- Enrolment: `backend/scripts/admin-create.js`, run **by you** on a machine you control against the database you choose; it prints the TOTP secret and recovery codes once. No staff credential is ever stored in the repository or created by me against production.
- Staff cannot moderate themselves or other staff; every login, failure and logout is audited.

### P2-09 Moderation actions, audit log, appeals (L), D-04, D-45

- `moderation_cases`, `moderation_actions`, `audit_events` (migration 010). `audit_events` is append-only: a `BEFORE UPDATE OR DELETE` trigger and a `BEFORE TRUNCATE` trigger raise an exception; tests try each as the application's database role.
- `admin/actions.js`: warn, suspend (with an end date), ban, reinstate, remove a message or photo. Each runs in one transaction with its `moderation_actions` and `audit_events` rows and calls `setAccountStatus` (token version bump, sockets closed). A failed audit write rolls the action back.
- Appeals (closes D-45): a suspended or banned member cannot sign in (F7). Login answers `403 { code: "account_suspended" | "account_banned", appeal: true }` with no session. The member requests an e-mailed one-time code (reusing `auth_codes`, `purpose = 'appeal'`) and receives a **30-minute appeal token** that works only on `GET /api/appeals/me` and `POST /api/appeals` (one open appeal per case, text length-limited, rate limited). Moderators decide appeals in the dashboard; reinstatement goes through the same action path. This is not a data-request channel (Phase 6).
- Moderation notices show the reason category and end date only, never the reporter.

### P2-10 Moderation dashboard (L to XL)

- New package `admin/` (Vite, React, TypeScript), own build and origin, strict CSP, no third-party scripts, no link from the consumer app. Screens per the master prompt: staff login with TOTP, report inbox with filters, report detail with evidence, user search and detail with history, actions (warn, suspend, ban, remove content), appeals queue, moderation history, audit log viewer, abuse metrics.
- Evidence rendering: media blurred until an explicit click; each view writes an `evidence_viewed` audit event; the dashboard never autoplays video (video is disabled per Q11).
- Added to CI as a separate job (type check, lint, build). Nothing is deployed.
- Parallelisable: once the admin API contract (P2-08, P2-09) is fixed, this and P2-12 can proceed in separate sessions or worktrees.

### P2-11 Abuse prevention and rate limiting (M to L), D-21

- `safety/limits.js`: per-account limits in PostgreSQL (migration 011, a fixed-window counter table updated with `INSERT ... ON CONFLICT DO UPDATE`), so limits hold across restarts and later across instances. Responses are `429` with `Retry-After`.
- Proposed defaults, all environment-tunable and to be confirmed against measured traffic:

| Action | Proposed limit |
|---|---|
| Swipes | 60 per minute burst, 500 per day |
| Messages | 30 per minute per member, 10 per minute per conversation |
| First messages to different new matches | 20 per hour |
| Identical message repeated | 5 within 10 minutes (then throttle, not ban) |
| Reports | 10 per day, 3 per target per week |
| Blocks | 50 per hour |
| Uploads (photos, chat media, stories) | 30 per hour |
| Registrations | 5 per IP per day, plus a per-IP and per-e-mail-domain burst check |
| Socket connections | 5 concurrent per member, 20 attempts per minute per IP |

- `safety/triage.js`: counters open or escalate a `moderation_case` with a priority and apply only **reversible throttles**; a ban always needs a human. Signals: likes per hour, identical-message repeats, uploads per hour, accounts per IP per day, reports received per week, repeated reports from different reporters. Image classification stays a hook (D2.10).

### P2-12 Mobile UI (M to L)

- Chat header menu (block, report, unmatch) replacing the fake options alert removed in Phase 0; card and profile-modal menus; report sheet with categories and optional "also block"; blocked-users screen (unblock); handling of `match_removed` and of `404 unavailable` without revealing why; suspended-account screen with the appeal flow; accessibility labels, 44-point targets, confirm dialogs with neutral wording. Written against the Expo SDK 54 docs.
- Not run on a device unless one is available; native behaviour stays "unverified" in the report.

### P2-13 Documentation and gate (S)

- Update `API_REFERENCE.md`, `SECURITY_CHECKLIST.md`, `ARCHITECTURE.md`, `DATABASE_MIGRATIONS.md`, `KNOWN_LIMITATIONS.md`, the tracker and a `PHASE_02_COMPLETION_REPORT.md` with exact test results and the unverified list, and a pre-Phase 3 review like this one.

## 7. Migrations

| File | Contents | Destructive? | Safety checks |
|---|---|---|---|
| `008_match_lifecycle.sql` | status, unmatched_at, unmatched_by, connected_at, messages.removed_at/removed_reason | No (add-only, constant defaults) | Upgrade test on legacy data; boot re-run test (F1) |
| `009_user_safety.sql` | user_blocks, user_reports, report_evidence_files | No | Constraint tests (self-block, duplicate block, FK behaviour) |
| `010_moderation_admin.sql` | admin_users, admin_totp, admin_recovery_codes, admin_sessions, moderation_cases, moderation_actions, audit_events (+ immutability triggers), appeals | No (`CREATE FUNCTION/TRIGGER` only) | Trigger tests for UPDATE, DELETE, TRUNCATE; guard classification test |
| `011_abuse_limits.sql` | rate-limit counters, abuse events | No | Concurrency test for the upsert |

Rules: numbers 4 and 5 stay retired; never edit an applied file; every file is run first through `dbSafety` classification in a test; applied only to throwaway local clusters in this phase; **applying anything to a hosted database is your decision and is never done by me**. A hosted rollout will need a backup, a restore rehearsal and a reviewed run, to be written into the runbook in P2-13.

## 8. Security model summary

| Threat | Control |
|---|---|
| A blocked user probing for the block | Identical `404 unavailable` for blocked, unmatched, deleted and non-existent targets; the same `match_removed` event for block and unmatch; tests compare bodies and status codes (timing difference is documented as a known side channel) |
| A held socket after a block or suspension | Room removal, `match_removed`, per-join and per-60-second revalidation, token-version check (F4) |
| Reporter exposure | No reporter field is ever joined into a response the reported member can reach; dedicated tests scan every member-facing response |
| Report spam and harassment through reports | Per-account and per-target limits; reports never auto-penalise anyone |
| Staff account takeover | Separate credentials and audience, TOTP with replay protection, step-up for destructive actions, lockout, server-side session revocation, enrolment only by the owner |
| Insider abuse | Role matrix, no self-moderation, append-only audit, evidence-view audit, senior approval for bans |
| Audit tampering | Triggers refuse UPDATE, DELETE and TRUNCATE; the application database role has no permission to disable them (documented for the hosted setup) |
| Evidence expiry and data loss | Evidence copied at report time; retention is configurable and purged only by a reviewed job (Phase 6) |
| Mass abuse | Per-account and per-IP limits, reversible throttles, human-only bans |
| Dashboard supply chain | Separate package, minimal dependencies, strict CSP, no third-party scripts, audited in CI |

## 9. Regression and security test plan

All run on Node 22 on throwaway PostgreSQL, wired into `npm run test:all`.

| Suite | Location | Key assertions |
|---|---|---|
| **B** blocks | `backend/test/safety.blocks.test.js` | Both directions hidden in discovery, likes-you, swipes, matches, messages, read, media, stories; indistinguishable errors; idempotent block and unblock; self-block refused; unblock restores visibility only if no other restriction; a direct API call cannot bypass the app |
| **S** sockets | `backend/test/safety.sockets.test.js` | Two real sockets with an open conversation: after a block neither receives `new_message`, presence or story events; `join_room` refused; reconnect refused; `match_removed` identical for block and unmatch; unmatch and suspend close or remove as specified; the 60-second sweep closes a socket whose status was edited directly in the database (with a shortened interval in the test); event flood disconnects |
| **R** reports | `safety.reports.test.js` | Validation, subject-access check, snapshot content, dedupe, limits, reporter identity absent from every response and event reaching the reported member, expiring media copied before cleanup |
| **U** unmatch | `safety.unmatch.test.js` | Participant only; sends refused at once; 30-day rule; rematch reuses the row and hides old messages; a blocked or reported pair is never reactivated; the three match-creation paths respect status |
| **A** admin auth | `admin.auth.test.js` | Every `/api/admin/*` route returns 403 or 404 to a consumer token, no token, a wrong audience, an expired or revoked staff session and a staff token lacking step-up; TOTP replay refused; lockout; role matrix route by route |
| **M** moderation and audit | `admin.actions.test.js` | Each action writes its audit row in the same transaction; a failing audit write rolls the action back; the audit table rejects UPDATE, DELETE and TRUNCATE; suspension ends tokens and sockets at once; staff cannot act on themselves |
| **P** appeals | `appeals.test.js` | Appeal token scope limited to the appeal routes; one open appeal per case; code single use and expiring; decisions reinstate through the normal action path |
| **L** limits | `limits.test.js` | Each policy returns 429 with `Retry-After`; counters correct under concurrent requests; windows reset; throttles are reversible; no limit locks out moderators' reads |
| **MIG** migrations | `integration.test.js` additions | 008 to 011 upgrade a legacy database without changing any existing row; re-running initialisation does not merge or delete historical matches; the guard classifies none of them as destructive |
| **INV** inventory | `eligibility.test.js` additions | Every route has a protection class and a block classification |
| **E2E** | extend `chat.e2e.js` | Match, message, block, verify refusal, unblock, unmatch, rematch rules, report |
| Existing | all Phase 0 and 1 suites | Unchanged and green |

Manual and unverified by design: a two-browser run of block and unmatch against a local stack; native devices; dashboard in non-Chrome browsers; real e-mail delivery; real image classification.

## 10. Order, gates and commits

1. P2-00, then P2-01a, P2-01b (schema first, each with its upgrade test).
2. P2-02, P2-03, P2-04 (block service, APIs, enforcement), then P2-05 (sockets), P2-07 (unmatch) and P2-06 (reports).
3. P2-11 (limits) alongside, since blocks, reports and appeals depend on it.
4. P2-08, P2-09 (staff, actions, audit, appeals).
5. P2-10 and P2-12 in parallel tracks once the API contracts are fixed.
6. P2-13.

After each slice: `npm run test:all` and `npm run test:e2e` on Node 22 and a short note in the tracker. Commits are small, one per slice, reviewed by you before anything leaves the machine; each commit must build and pass its own tests (the clean-worktree check used for Phase 1 will be repeated, including regenerating Expo route types).

Phase 2 is complete when the section 1 table is fully proven, every Phase 2 task in the tracker is COMPLETE or explicitly BLOCKED with a reason, and `PHASE_02_COMPLETION_REPORT.md` lists exact results and what was not verified.

## 11. Risks and blockers

| Risk or blocker | Mitigation |
|---|---|
| Match-lifecycle migration and the boot-time dedupe block (F1) | Decision D2.1(A); explicit boot re-run test |
| Guard blocks legitimate migrations (F2) | P2-00 refinement; no destructive SQL planned in 008 to 011 |
| Info-leak through response differences or timing | Uniform responses, comparison tests, residual timing risk documented |
| Staff credential handling | Owner-run enrolment only; nothing in the repository; no production access |
| Evidence handling for minors | Decision D2.7 and legal advice before any real use |
| Retention periods unapproved | Configurable now, purge later (Phase 6) |
| Single-instance sockets | Sweep and limits designed to move to a shared store; scale-out in Phase 9 |
| No staffing, hosting or domain for the dashboard | Decisions D2.4 and D2.5; build and test locally regardless |
| Image classification | Hook only (D2.10) |
| Large scope | Slices are independently shippable; dashboard and mobile UI are separate tracks |

## 12. Baseline this plan starts from

Four local implementation commits on branch `phase-0-stabilise` (not pushed), on top of `a9cff77`, followed by a fifth documentation-only commit that records them (see `git log`):

| Order | Commit | Title |
|---|---|---|
| 1 | `2b8c384` | Add showcase profiles and demo catalogue |
| 2 | `b11eb4b` | Add migration safety guard and retire local-only cleanup scripts |
| 3 | `378eac8` | Implement Phase 1: adult eligibility, server-driven onboarding, verified e-mail, account status and Google sign-in |
| 4 | `47b8a13` | Add Node 22 pin, test runner and strict CI gates (Phase 0) |

Test baseline on Node 22.23.5: backend unit 77, integration 51, E2E 10 and 8 checks, type check 0 errors, lint 0 warnings, web export OK. Still unverified from Phase 1 and carried into Phase 2: native devices, real Google OAuth, real Resend delivery, the GitHub workflow, any hosted database, Apple Sign In (blocked).

No Phase 2 code, migration or dependency has been added.
