# Dateza — Baseline Audit

**Audit date:** 2026-11-22
**Audited revision:** `main` @ `a9cff77` **plus uncommitted working-tree changes** (see §2)
**Scope:** every requirement in the master prompt (`docs/implementation/MASTER_PROMPT.md`) compared with the code that exists today.
**Rule followed:** analysis only. No application code, schema, config or test was modified. The only files created are in `docs/implementation/`. *(This document is the pre-Phase-0 baseline and is kept as written; where Phase 0 has since changed a fact, see `PHASE_00_COMPLETION_REPORT.md`.)*

Status words used here: **COMPLETE** (works and verified), **PARTIAL** (some of it works), **MISSING** (not present), **BROKEN** (present but wrong or fake), **UNVERIFIED** (could not be checked from the repository).

---

## 1. Headline findings

1. **The app is a working chat demo, not yet a safe dating product.** Real-time chat, sessions, CSRF, token revocation, email codes and ephemeral media are solid. Everything the master prompt calls "safety" (age gating, blocking, reporting, moderation, suspension, deletion, privacy controls) does not exist.
2. **No dating endpoint checks eligibility.** Discovery, swipes, matches, messages, stories, media and sockets only check "is signed in". A user with no birthdate, no photos, an unverified email, or an under-18 date of birth is treated like anyone else.
3. **Onboarding invents data.** Name-based gender guess, birthdate `1999-01-01`, height 175, a stock Unsplash photo, a canned bio and four default interests are saved if the user skips steps.
4. **Other members' raw coordinates are returned by the discovery and likes-you APIs**, and the "Nearby" filter only tests `lat != null`.
5. **Profile screen shows "Verified Account" to everyone.** Nothing verifies anyone.
6. **Stories are visible to every signed-in user** and every story change is broadcast to every connected socket.
7. **The Google sign-in redirect carries the bearer token and the full user JSON in the URL**, with the redirect URI reused as `state` (no random state, no PKCE).
8. **The production Render blueprint enables the shared demo login** and the production database may contain seeded profiles (UNVERIFIED — production was deliberately not touched; see §9).
9. **The baseline test failures were reproduced and are all stale assertions, not application bugs** (§3.1): two showcase tests expect 12 profiles (data now has 16), and one integration test hard-codes the migration list (found this session; it only fails because of the uncommitted migrations 004/005).
10. **Privacy Policy is a placeholder** ("Effective Date: December 20, 2028", unsupported security claims). No Terms, no consent record, no account deletion, no data export.

---

## 2. State of the working tree

`git status` at the start of the audit showed uncommitted work from an earlier session. It is part of the baseline and must be preserved (not reverted, not silently committed).

| Path | State | What it is |
|---|---|---|
| `backend/data/showcase-profiles.json`, `mobile/assets/profiles/catalog.json` | modified | showcase catalog grew from 12 to **16** profiles (6 male, 10 female, ages 24–34; the two files are identical) |
| `backend/public/profiles/{brooke,claire,ivy,sadie,tessa}.png`, `mobile/assets/profiles/{brooke,claire,ivy,sadie}.png` | untracked | new photos. `tessa.png` exists only in `backend/public/profiles/` and is **not referenced** by the catalog (orphan) |
| `backend/db.js` | modified (−117 lines) | removed 8 of the 11 dev mock-profile seeds |
| `backend/migrations/004_…`, `005_…` | untracked | delete 9 named `seed-*` mock accounts (`DELETE FROM profiles WHERE id IN (…)`) |
| `mobile/lib/demoData.ts`, `showcaseProfiles.ts`, `store.ts`, `components/ProfileDetailsModal.tsx` | modified | offline demo now uses only the showcase profiles |
| `docs/MASTER_PROMPT.md` | untracked | the master prompt. At audit time it lived at `docs/MASTER_PROMPT.md`; **Phase 0 moved it to `docs/implementation/MASTER_PROMPT.md`** (owner decision Q13). |

Consequence: migrations 004/005 are **destructive** (delete rows) and are not yet committed or applied anywhere known. They must be reviewed before they reach any shared database (master prompt rule 10/19).

---

## 3. Baseline command results (this machine, Windows 11, Node v24.16.0, npm 11.13.0)

Node 24 is newer than CI/Render (Node 22). Dependencies were already installed, so `npm ci` was **not** re-run (it would delete and reinstall `node_modules`); results are for the installed tree.

| Command | Result |
|---|---|
| `cd backend && npm test` | **21 tests, 19 pass, 2 FAIL** (matches the earlier audit) |
| `cd backend && npm run test:integration` against a throwaway local PostgreSQL 18 (`scripts/test-db.js start`, `127.0.0.1:54329`, stopped afterwards; no remote DB touched) | **25 tests, 24 pass, 1 FAIL** (new finding) |
| `cd mobile && npx tsc --noEmit` | **exit 0, no type errors** |
| `cd mobile && npm run lint` | **0 errors, 30 warnings** (unused imports/variables, `Array<T>` style, 2 `react-hooks/exhaustive-deps` in `matched.tsx` / `SwipeDeck.tsx`) |
| `cd mobile && npx expo export --platform web` | not run (no change under test) |
| `npm audit` (backend / mobile) | not re-run; `docs/AUDIT_AND_FIXES.md` reports backend 4 moderate, mobile 35 (17 high, 1 critical, build tooling) — **UNVERIFIED today** |

### 3.1 The three failing tests — test or implementation?

| Test | Failure | Verdict |
|---|---|---|
| `showcase.test.js` › "six adult men and six adult women…" | `16 !== 12` | **Stale assertion.** Data is intentionally 16 profiles (6 male / 10 female) after the uncommitted catalog extension. All ages are 24–34, catalogs are byte-identical, all `.png` pairs exist for the 16 keys. Fix is a **product decision** (what should the catalog be?) then update the test to state the real invariant (consistent catalog, ages in range, photos present, ids unique) — not just change `12` to `16`. Gender balance is no longer true; decide whether it is still a requirement. |
| `showcase.test.js` › "seeding adds only dedicated sample ids…" | `calls.length` 16 vs 12 | Same root cause. |
| `integration.test.js:480` › "migrations are recorded once…" | actual list includes `004_…` and `005_…` | **Stale assertion.** It hard-codes the migration list; it will break every time a migration is added. Fix: assert that every file in `migrations/` is recorded exactly once. |

None of these is an application bug, and none should be "fixed" by weakening the assertion. The migration-list failure is new relative to the master prompt's baseline (it only appears because of the uncommitted migrations 004/005).

---

## 4. Architecture as found

### 4.1 Authoritative schema

`backend/db_init.sql` (idempotent, runs on **every** boot) then `backend/migrations/*.sql` (ordered, recorded in `schema_migrations`, each in a transaction) via `db.initDb()`. `mobile/db/schema.sql` is an **old Supabase schema** (`auth.users`) and is **not used**; it must be removed or clearly marked archived so nobody deploys it.

Tables today: `profiles`, `swipes`, `matches`, `messages`, `match_reads`, `images`, `auth_codes`, `ephemeral_media`, `stories`, `schema_migrations`.

Notable schema facts:
- `profiles.id` is `VARCHAR(255)` (`usr_<uuid>`, `seed-*`, `demo-*`). All foreign keys are `VARCHAR`.
- `profiles` has **no** account status, role, DOB-verified flag, profile-complete flag, visibility, pause, consent, deleted_at, or location-consent columns.
- `matches.expires_at NOT NULL` is written (24 h) and **never read**.
- `messages.kind` check allows `text | image | location`.
- Most FKs are `ON DELETE CASCADE` from `profiles`; `images.owner_id` is `SET NULL`. A hard `DELETE FROM profiles` would erase all messages on both sides — unsuitable for the safety-record retention the master prompt asks for.
- No indexes for discovery filters beyond `gender` / `looking_for`; no index on `profiles.created_at`, `birthdate`, or geo.

### 4.2 Backend modules and routes (Express 4 + Socket.IO 4, single process)

| File | Routes / role | Auth check | Eligibility / block / status check |
|---|---|---|---|
| `index.js` | `/healthz`, `/readyz`, mounts, rate limits, socket auth, presence, 30 s media-expiry `setInterval` | socket: ticket or token | none |
| `auth.js` | `POST /api/auth/register`, `/signup`, `/login`, `/logout`, `/socket-ticket`, `/complete-setup`, `GET /me`, Google `/google/url`, `/google/mock-login` (dev), `/google/callback` | `authenticateToken` where needed | none |
| `accountSecurity.js` | `GET /config`, `POST /verify-email/request|confirm`, `/password-reset/request|confirm`, `/change-password`, `/logout-all` | yes | n/a |
| `session.js` | JWT (HS256) + HttpOnly cookie (web) / Bearer (native), CSRF header + Origin allowlist, `token_version`, single-use socket tickets (in-memory `Map`) | — | session valid ⇔ `token_version` matches. **No status check.** |
| `profiles.js` | `GET /api/profiles/discovery`, `/likes-you` | yes | demo isolation only |
| `swipes.js` | `POST /api/swipes`, `/reset` | yes | none |
| `matches.js` | `GET /api/matches`, `/conversations`, `POST /api/matches`, `/quick`, `GET|POST /:id/messages`, `POST /:id/read` | yes; participant check | no block/unmatch/status check |
| `images.js` | `POST /api/images` (base64 JSON ≤ 8 MB), `GET /api/images/:id` (**public**, immutable cache) | upload only | no |
| `media.js` | `POST /api/media`, `GET /api/media/:id`, `/api/stories` CRUD, expiry cleanup | yes | chat: match participant; story: **any signed-in user** |
| `demo.js` | `/api/auth/demo` one-tap login (flag-gated), history trimming | — | — |
| `mailer.js` | Resend delivery; dev logs the code | — | — |
| `realtime.js` | `user:<id>` rooms, `emitToUsers`, `emitToMatch` | — | — |

Socket events actually implemented: server→client `new_message`, `messages_read`, `match_created`, `media_expired`, `stories_changed` (global broadcast), `status_change`; client→server `join_room` (legacy), `leave_room`. **No typing events, no socket-side send** (sends are REST + server emit).

### 4.3 Mobile app (Expo SDK 54, Expo Router 6, React 19, NativeWind, Zustand)

- State: one 1,116-line `lib/store.ts` (Zustand, persisted to **AsyncStorage**: `user`, `session`, `profileSetupComplete`, `isDemo`, `swipes`, `matches`, `messages`, `stories`).
- HTTP: `lib/api.ts` (cookie + CSRF header on web, Bearer from SecureStore on native, retry/timeout handling). Config: `lib/config.ts` (production builds refuse `localhost`/non-https).
- Routing guard is client-side only (`app/_layout.tsx`); profile completeness is computed client-side as `!!name && !!birthdate`.
- Screens: auth (`get-started`, `create-account`, `sign-in`, `verify-code`, `forgot-password`, `reset-password`), onboarding carousel, `profile-setup/{birthday,height,photos,language}`, tabs (`index` = swipe + stories, `explore`, `likes`, `chat`, `profile`), `chat-thread`, `matched`, `notifications`, `search`, `profile/{edit-profile,change-password,help-center,privacy-policy}`, `call/{audio,video}`, `live-demo`, `demo`.
- Onboarding order today: birthday → height → photos → "language" screen (which also collects gender and interested-in, then calls `completeSetup`). Master prompt wants an 11-step flow.

---

## 5. Workflow trace (Task 0.1)

| Workflow | Path today | Status | Notes |
|---|---|---|---|
| Registration | `create-account.tsx` → `store.signUp` → `POST /api/auth/register` | **PARTIAL** | Email/password/name only. No DOB, no Terms/Privacy acceptance, no strong-password rule server-side (min 8 / max 72; the client checklist is stricter), no registration-specific rate limit beyond the 100/15 min `/api/auth` limiter. |
| Login | `sign-in.tsx` → `/login` | **COMPLETE** | Constant-time unknown-user compare, per email+IP failed-login limiter, bcrypt cost 12 with rehash. No status check (suspended/deleted). |
| Google auth | `signInWithGoogle` → `/google/url` → WebBrowser → `/google/callback` → redirect with `?token=&user=` | **PARTIAL / insecure** | Native only (web throws). `state` = redirect URI; no nonce/PKCE; token and full row (minus password) in URL; redirect allowlist exists (good) but accepts any `http(s)://localhost` outside production and any `exp:` URL. Existing local account with same email is silently linked. Google users never get `email_verified_at`. Mock chooser is dev-only and correctly blocked in production. Apple Sign In absent. |
| Email verification | `verify-code.tsx` → `/verify-email/request|confirm` | **PARTIAL** | Codes are HMAC-hashed, 10 min TTL, 5 attempts, 60 s cooldown, atomic attempt count — good and tested. **Not enforced anywhere**; the app skips it when `emailVerification` config is false and has a "skip" link; delivery is **UNVERIFIED** (no Resend key tested). |
| Forgot / reset password | `forgot-password.tsx`, `reset-password.tsx` | **COMPLETE** | Same code mechanism, generic response, revokes all sessions. Disabled without mail provider. Delivery UNVERIFIED. |
| Profile onboarding | `profile-setup/*` → `POST /api/auth/complete-setup` | **BROKEN** | See §6 D-03. `completeSetup` swallows backend errors (`console.error`) and the caller navigates on anyway. |
| Profile editing | `edit-profile.tsx` → `completeSetup` | **PARTIAL** | Name, bio, gender, looking_for, main photo. Fallback gender defaults `"male"`/`"female"`, hard-coded fake phone `+1 (555) 019-2834` in state, phone not persisted. No multi-photo manage, interests, prompts, languages, intentions, visibility. |
| Swipe discovery | `(tabs)/index.tsx` + `SwipeDeck` → `GET /discovery`, `POST /swipes` | **PARTIAL** | See D-14, D-15. |
| Likes / likes-you | `likes.tsx` → `GET /likes-you` | **PARTIAL** | Returns lat/lng; "Online now" filter client-side. |
| Mutual matching | `swipes.js` transaction | **PARTIAL** | Transactional with `ON CONFLICT` — good, tested for duplicates. Two other code paths (`POST /api/matches`, `/quick`) duplicate match creation outside a transaction and without `match_created` emit. |
| Chat creation / list | `GET /api/matches(/conversations)` | **COMPLETE** (functionally) | One-query conversation list with unread and read pointer. |
| Send / receive messages | `POST /:id/messages` + `new_message` socket event | **COMPLETE** (functionally) | Idempotent `client_id`, optimistic UI, retry, reconnect catch-up, paging, read receipts — all tested. Missing: block/unmatch/status enforcement, typing indicators, delete/report. |
| Media uploads | `/api/images` (profile), `/api/media` (chat/story) | **PARTIAL** | Magic-byte type check, size/quota limits, 12 h expiry, authz on read. No re-encode, no EXIF/GPS strip, no dimension limit, no moderation state. Profile images are public. |
| Stories | `/api/stories` | **PARTIAL** | Upload/view/delete/expire work. Audience = everyone; no block/report; global `stories_changed` broadcast. Preset / pasted-URL story paths in `(tabs)/index.tsx` exist — **UNVERIFIED** whether they upload server-side or store an external URL. |
| Notifications | `notifications.tsx` | **BROKEN** | Derived on the client from the persisted store (matches, last messages, likes). No server table, no push, no unread state; likes always say "Today"; message text is displayed. The profile "Notifications" menu item is `Alert.alert("…triggered.")`. |
| Logout | `store.signOut` → `/logout` + `clearSessionLocal` | **COMPLETE** | Clears cookie/token and persisted state. Logout-all exists. |
| Web deployment | `mobile/vercel.json`, `render.yaml` | **PARTIAL** | Same-origin `/api` proxy rewrite (good). Backend URL hard-coded in `vercel.json`; no CSP/HSTS header; no staging. Deployed state **UNVERIFIED today** (last verified in `VALIDATION_REPORT.md`, 2026-11-20). |
| Android/iOS config | `app.json`, `eas.json` | **PARTIAL** | Bundle ids set; `eas.json` has one backend URL for all profiles, empty `submit`, no iOS-specific config, no notifications/location/camera/mic plugin config. Native builds **UNVERIFIED** (no build/device run in this audit). |

---

## 6. Confirmed defects and gaps

Severity: **P0** blocks any public launch; **P1** needed for MVP; **P2** quality / later. "Repro" says how it was confirmed this session.

### 6.1 Eligibility, identity and onboarding

| ID | Sev | Finding | Evidence / repro | Files |
|---|---|---|---|---|
| D-01 | P0 | **No central eligibility.** No middleware for adult / profile-complete / verified / active / non-suspended. All dating routes and sockets accept any valid session. | Code read of every router; `profiles` has no status column. | `session.js`, `profiles.js`, `swipes.js`, `matches.js`, `media.js`, `index.js` |
| D-02 | P0 | **Age check is wrong at the edges.** Impossible dates are accepted; the year-0001 date is "adult"; cutoff uses `setFullYear` on server-local time. Registration does not collect DOB at all. Client check only tests `1920 ≤ year ≤ 2008` and lets users **Skip**. | Reproduced with the same logic: `2008-02-30 → true` (rolls to 1 Mar), `0001-01-01 → true`, `2000-13-01 → invalid`, `2008-11-23 → false` on 2026-11-22 (correct), `1999-1-1 → true` (non-ISO accepted). | `auth.js` `isAtLeastMinAge`, `mobile/lib/validation.ts`, `profile-setup/birthday.tsx` |
| D-03 | P0 | **Invented profile data is saved.** Name-regex gender guess (`/jane\|female\|girl\|woman/`), assumed interested-in, default birthdate `1999-01-01`, height 175 (also default in height picker), stock Unsplash photo, canned bio, interests `["Music","Coffee","Design","Tacos"]`. Photos screen says "at least 4 photos **to verify your profile**" and allows "Skip Anyway". `completeSetup` errors are swallowed and navigation continues. | Read `language.tsx`, `birthday.tsx`, `height.tsx`, `photos.tsx`, `store.completeSetup`. | those four screens, `lib/store.ts` |
| D-09 | P0 | **Email verification is optional and unused.** No route requires `email_verified_at`; the app skips the step when mail is off. Google accounts are never marked verified. Delivery config unverified. | `accountSecurity.js`, `create-account.tsx` line 110, `verify-code.tsx` skip link. | as listed |
| D-10 | P0 | **"Verified Account" shown unconditionally.** | `(tabs)/profile.tsx`: `user?.gender ? "Verified Account • gender" : "Verified Account"`. | `profile.tsx` |
| D-22 | P1 | Password rule differs by layer: backend `register` accepts any 8–72 chars; only the client checklist demands mixed case + number + symbol. `register` re-implements `passwordProblem`. | `auth.js` vs `passwords.js`, `validation.ts`. | `auth.js`, `passwords.js` |
| D-38 | P1 | Edit-profile initialises gender to `"male"` and looking_for to `"female"` when unset and saves them back; keeps a fake phone number in state. | `edit-profile.tsx` lines 16–19. | `edit-profile.tsx` |

### 6.2 Safety and moderation

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| D-04 | P0 | **No blocking, reporting, unmatch, suspension, moderation or admin surface.** No tables (`user_blocks`, `user_reports`, `moderation_*`, `audit_events`, `admin_roles`), no endpoints, no staff auth. SwipeDeck's "⋯" menu is `Alert.alert("Options", "Report or Share this profile.")` — a secretly non-functional control. | `grep` of backend and mobile; `SwipeDeck.tsx` ~line 228. |
| D-20 | P0 | **Sockets cannot enforce safety.** `join_room` authorises only at join time; there is no revocation path; `stories_changed` is `io.emit` to every socket; ticket-reuse map and presence counts are in process memory (single instance only). | `index.js`, `session.js`, `media.js`. |
| D-21 | P1 | **Abuse limits are IP-only and coarse**: 300 req/min/IP general, 100/15 min auth, 30 uploads/10 min. Nothing per account for swipes, messages, reports, or registrations. Behind the Vercel proxy the client IP is imprecise. | `index.js`. |
| D-34 | P1 | **No retention policy.** Text messages are kept forever; image messages hard-deleted after 12 h; no behaviour defined for unmatch, block, report evidence or deletion. | schema + `media.js` cleanup. |

### 6.3 Profile, discovery and matching

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| D-05 | P0 | **Raw `lat` / `lng` of other members returned** by `GET /discovery` and `/likes-you` (`SELECT … p.lat, p.lng`). Nothing in the UI appears to set them, so exposure is latent, but the API contract leaks them and `complete-setup` accepts them with no consent model. "Nearby" = `p.lat != null`. | `profiles.js`, `explore.tsx` line 31. |
| D-15 | P1 | **Discovery is not real filtering.** Only `gender = looking_for`. No age range, distance, relationship intention, reciprocity, completeness, visibility, pause or block filter. Passes are excluded forever via `NOT IN (swipes)` (until the destructive `/swipes/reset`, which deletes all swipes including likes). "New" filter returns `true`; "Recently Active" uses `is_online`. No cursor, client loads a batch and filters in memory. | `profiles.js`, `explore.tsx`, `swipes.js /reset`. |
| D-14 | P1 | **Match percentage is unbounded and inconsistent.** `count(shared interests) * 20` → 6 shared = 120 %, 0 shared = 0 %, null interests = 50 %; no definition of what it means. Displayed as "NN% Match". | SQL in `profiles.js`; `SwipeDeck.tsx` badge. |
| D-13 | P1 | **Match expiry is stored but never enforced**; three code paths create matches (swipe transaction, `POST /api/matches`, `POST /api/matches/quick`) with duplicated logic, the latter two non-transactional and not emitting `match_created`. Demo documentation says matches expire in 24 h; behaviour is persistent. | `swipes.js`, `matches.js`. |
| D-36 | P2 | Profile photo lists accept **any `http(s)` URL**, enabling hot-linked/tracking/inappropriate remote content and defeating ownership/moderation. | `photoUtils.js`. |

### 6.4 Chat, media and attachments

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| D-17 | P1 | **Fake attachments.** Attachment sheet items other than Gallery/Camera show "Attachment Triggered" and **send a mock message** (`📎 Mock <type> attachment`, `📍 Current Location shared`, kind `location` with no coordinates). The backend accepts `kind: "location"` with arbitrary text. Voice shows "coming soon". | `chat-thread.tsx` ~lines 126–148, 385. |
| D-17b | P1 | **Call screens are fake.** `call/audio.tsx` and `call/video.tsx` show a hard-coded "Elena", an Unsplash photo and a local stopwatch; mute/speaker buttons do nothing; the chat header routes to them for every conversation. | `call/*.tsx`, `chat-thread.tsx` lines ~298–307. |
| D-18 | P0/P1 | **Media hygiene.** No re-encoding, so **EXIF/GPS survives** in stored profile and chat images; no dimension cap; no moderation status; images and videos live in PostgreSQL `BYTEA` (profile quota 50 images; 250 MB ephemeral per user); no orphan cleanup; `GET /api/images/:id` is public with a one-year immutable cache, so blocked/deleted users' photos stay fetchable by id; chat media remains readable by a former match until expiry. | `images.js`, `media.js`. |
| D-19 | P1 | **Sensitive data cached in plaintext AsyncStorage** (profile with email and birthdate, all matches and chat messages, stories, swipes). Cleared on logout, but chats persist on the device otherwise and are not scoped per account. | `store.ts` `partialize`. |
| D-16 | P1 | **Notifications are not a system** (see §5). No device tokens, no preferences, no push, no persistence, no web notification story. | `notifications.tsx`. |

### 6.5 Privacy, policy and account lifecycle

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| D-11 | P0 | **Policy text is placeholder and inaccurate**: "Effective Date: December 20, 2028"; claims "advanced security protocols, encryption methods, and regular audits" and "usage analytics and cookies" that the code does not substantiate. No Terms of Service, Community Guidelines, retention text, consent storage or acceptance step at sign-up. Help center lists an unverified support address. | `privacy-policy.tsx`, `help-center.tsx`. |
| D-12 | P0 | **No account deletion or data export**, and no public deletion-request page (an Apple/Google store requirement). Hard `DELETE` would cascade through messages on both sides. | schema; grep. |

### 6.6 Auth hardening

| ID | Sev | Finding |
|---|---|---|
| D-07 | P0 | Google callback redirect carries `token` and `user` (full profile row incl. `token_version`) in the URL query; `state` is the client-supplied redirect URI; no PKCE; no one-time code exchange; web unsupported; Apple Sign In absent although a third-party login is offered (Apple review guideline requires an equivalent option on iOS — **verify against current App Store guidelines before submission**). |
| D-23 | P2 | Registration reveals whether an email exists (`409`). Acceptable trade-off if documented; revisit with email-first verification. |

### 6.7 Deployment, secrets and environments

| ID | Sev | Finding |
|---|---|---|
| D-08 | P0 | `render.yaml` sets `DEMO_LOGIN_ENABLED: "true"` for the production service. README tells operators to turn it off once real users join. Demo users are `is_demo` and hidden from real users, but the shared demo login has no business in a consumer production environment. **Also:** `VALIDATION_REPORT.md` records 34 profiles (incl. seeds and showcase) migrated from a local DB into Neon on 2026-11-20. If those rows still exist in production they appear to real users as fake profiles (`is_demo = false`). **UNVERIFIED — no production access was used.** |
| D-24 | P1 | Single hard-coded backend URL in `vercel.json` and every `eas.json` profile; no staging or per-environment separation; Render `free` plan sleeps (in-memory jobs, socket tickets and presence do not survive); no scheduler for cleanup other than an in-process `setInterval`; Vercel headers lack CSP and HSTS. |
| D-25 | P1 | Dev seeding runs whenever `NODE_ENV !== production && !RENDER`. A staging host that sets neither would seed accounts with a **known password** (`password123`) and showcase profiles. |
| D-27 | P1 | `mobile/db/schema.sql` (Supabase) is misleading. |
| D-28 | P1 | **Secrets:** `backend/.env` and `mobile/.env` exist on disk and are git-ignored; `git log --all -- '*.env'` shows **no** `.env` was ever committed; only `.env.example` files are tracked. Values were not read. The master prompt says an uploaded archive once contained a backend env file — if it was shared outside this machine, its credentials (Neon, `JWT_SECRET`, Resend) should be rotated **by the owner** (not done here). `scratch/` is git-ignored but holds local logs — confirm it is not zipped into archives. |
| D-29 | P2 | `CORS_ORIGIN` unset in production only warns; `render.yaml` sets it, but config should fail closed. |

### 6.8 Tests and tooling

| ID | Sev | Finding |
|---|---|---|
| D-30 | P1 | Two stale showcase tests and one stale migration-list integration test (§3.1). |
| D-31 | P1 | CI runs unit, integration and mobile type/lint, but **not** a web export, `npm audit`, E2E, or any security regression suite. There are **no mobile tests** at all (no jest/RTL/Playwright config). |
| D-32 | P2 | 30 lint warnings, 2 real hook-dependency warnings. |
| D-33 | P2 | `expo-av` is a dependency (used by video/audio?); Expo has been moving audio to `expo-audio`. The Expo-docs fetch could not confirm SDK 54 status (see §8) — check before voice-message work. |

---

## 7. Feature status against the master prompt

| Phase | Requirement area | Status | Summary |
|---|---|---|---|
| 0 | Baseline docs, test baseline | **PARTIAL → this audit** | Baselines recorded here; stale tests to fix in Phase 0. |
| 1 | Secure registration (DOB, terms, strong password, rate limit) | PARTIAL | email/password/hash/uniqueness/error-safety/login limiter exist; DOB, terms, server-side strength, status checks missing. |
| 1 | Eligibility middleware (REST + socket) | MISSING | |
| 1 | Honest onboarding (11 steps, resume, server-confirmed) | BROKEN | invents data; 4-screen flow; client-computed completeness. |
| 1 | Email verification | PARTIAL | mechanism good; unenforced; delivery unverified. |
| 1 | OAuth hardening, Apple Sign In | BROKEN / MISSING | |
| 2 | Blocking | MISSING | |
| 2 | Reporting | MISSING | |
| 2 | Unmatch | MISSING | |
| 2 | Admin / moderation dashboard, roles, MFA, audit | MISSING | |
| 2 | Automated safety checks | MISSING | only generic IP rate limits. |
| 3 | Profile management | PARTIAL | name/bio/gender/main photo only. |
| 3 | Location privacy | BROKEN | raw coordinates in API. |
| 3 | Real filters + reciprocity + pagination | MISSING / BROKEN | |
| 3 | Match score | BROKEN | unbounded, undefined. |
| 4 | Matching lifecycle | PARTIAL | transactional swipe match good; expiry unenforced; duplicate creation paths; no unmatch/block awareness. |
| 4 | Real-time chat core (text, ids, ordering, reads, paging, reconnect) | **COMPLETE** (tested) | the strongest area; preserve. |
| 4 | Typing, delete, report, retry UI | PARTIAL | retry yes; typing/delete/report no. |
| 4 | Media access authorisation | PARTIAL | participant check only; no block/unmatch revocation. |
| 4 | Local data protection | PARTIAL | token in SecureStore (good); chat in AsyncStorage (bad). |
| 5 | Notifications (persistent, push, prefs, web, jobs) | MISSING | |
| 6 | Privacy settings, deletion, export, policies, consent | MISSING / BROKEN | |
| 7 | Secure photos, stories policy, real attachments | PARTIAL | see D-17, D-18. |
| 8 | UI/UX consistency and accessibility | PARTIAL | likes screen has roles/labels; most others do not; fake controls must go. |
| 9 | Environments, secrets, demo isolation, reliability | PARTIAL | good config validation, health checks, graceful shutdown, pooling; no staging, jobs, backups, monitoring, multi-instance sockets. |
| 10 | Voice, calls, verification, subscriptions | MISSING | calls are fake UI. |

---

## 8. Expo SDK 54 documentation notes (AGENTS.md requirement)

`AGENTS.md` says to read the SDK 54 docs before writing code. No code is written in this phase, but the API pages needed by the plan were fetched through a sub-agent. **Caveat:** the pages served at the `v54.0.0` URLs displayed "Reference (v58.0.0)" navigation, so they may describe a newer SDK. Treat everything below as **to be re-checked against the installed package versions before each use** (`npx expo install` resolves the correct SDK-54 versions).

| Need | Package | Notes from the fetch (unconfirmed for 54) |
|---|---|---|
| Push notifications | `expo-notifications` | Remote push unavailable in Expo Go on Android since SDK 53 → needs a development build; web push not covered by the page (separate service-worker/VAPID work). |
| Voice messages | `expo-audio` | Included in Expo Go; web needs a secure context. `expo-av` is currently a dependency; its SDK 54 status could not be confirmed. |
| Image re-encode / EXIF strip | `expo-image-manipulator` | Legacy `manipulateAsync` marked deprecated in favour of `ImageManipulator.manipulate`. `expo-image-picker` documents **no** metadata-strip option, so **server-side re-encoding is the reliable control**. |
| Location | `expo-location` | Foreground only needed; Expo Go limits background services. |
| OAuth | `expo-auth-session` + `expo-crypto` | PKCE (S256) is the default. Native Google handoff should use authorization code + server exchange, not a token in the URL. |
| Apple Sign In | `expo-apple-authentication` | iOS only; page states Apple sign-in is required when other third-party sign-in is offered. |
| Secure storage | `expo-secure-store` | Native only (no web); some iOS releases rejected values > ~2 KB. Fine for the session token; not for chat caches. |

---

## 9. What was NOT verified (and why)

- Production (Render / Neon / Vercel): not contacted. Production data state, `DEMO_LOGIN_ENABLED` effect, seeded rows, backups and monitoring are unknown.
- Native builds, devices, push, camera/photo permission flows, deep links: nothing was built or run.
- Email delivery (Resend) and Google OAuth with real credentials.
- Browser matrix (Chrome/Firefox/Safari) and responsive behaviour.
- `npm audit` today.
- Preset / pasted-URL story paths.

---

## 10. Decisions needed from the product owner

Each affects scope; see `IMPLEMENTATION_PLAN.md` §"Decisions" for the recommended default.

1. Persistent matches (recommended) or time-limited?
2. Story audience: matches-only (recommended) or all members?
3. Showcase catalog: keep 16 (6 M / 10 F) as development fixtures? Is gender balance still a requirement?
4. Moderation staff: who, how many, and which MFA method?
5. Chat media retention: keep the 12-hour ephemeral model for photos? Text retention period?
6. Account-deletion retention window and which safety records are kept, for how long (legal review).
7. Production cleanup authorisation: may the owner-approved process remove seeded/demo rows from the live database and set `DEMO_LOGIN_ENABLED=false`?
8. Object storage provider for images (R2/S3-compatible) or stay on PostgreSQL for MVP?
9. Whether to ship Google sign-in on iOS (then Apple Sign In is required) or email-only for iOS v1.
10. Target launch markets (age of majority and data-protection law differ; legal review needed).
