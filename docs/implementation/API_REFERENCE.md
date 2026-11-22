# Dateza — API reference

State after Phase 1 (2026-11-22). Every endpoint below exists in `backend/` and is covered by the tests named in `TEST_REPORT.md`; planned endpoints are in `IMPLEMENTATION_PLAN.md` §7 and are **not** listed here.

## Conventions

- Base path `/api`. JSON in, JSON out. Errors: `{ "error": "<message>", "code": "<machine code>" }` (some add `reason`, `reasons`, `missing`, `policies`).
- **Authentication.** Web: HttpOnly session cookie plus `X-Requested-With: dateza` and `X-Client-Platform: web` headers on every call (CSRF defence; an `Origin` header must be on the allow-list). Native: `Authorization: Bearer <token>` (token returned in the response body; web never receives it).
- **Route classes** (enforced by middleware and by a route-inventory test that fails if a route has no declared class):
  - `public` no session needed
  - `session` a valid session of an **active** account (suspended / banned / deleted accounts get **401** with `account_suspended | account_banned | account_closed`; a revoked token gets `session_revoked`)
  - `adult` session + a valid date of birth that makes the member 18 or older
  - `eligible` everything above **plus** verified e-mail and a completed profile (all dating features). Failure: **403** `{ "code": "not_eligible", "reason": "<first reason>", "reasons": [...] }` with reasons from: `birthdate_required`, `invalid_birthdate`, `not_adult`, `email_unverified`, `profile_incomplete`, `account_closing`.
- Rate limits: 100 requests / 15 min on `/api/auth/*`, 300 / min on `/api/*`, failed logins 10 / 15 min per e-mail+IP, registration 20 / hour per IP (`REGISTER_RATE_LIMIT`), OAuth exchange 30 / 15 min. Exceeding any → `429 rate_limited`.
- Dates of birth are `YYYY-MM-DD` strings (calendar days, no time zone). DATE columns are never returned as timestamps.

## Authentication and account (`/api/auth`)

| Method & path | Class | Request | Response / notes |
|---|---|---|---|
| `GET /api/auth/config` | public | — | `{ emailVerification, emailVerificationRequired, passwordReset, policies: { terms, privacy } }` — the policy versions a new member must accept |
| `POST /api/auth/register` (alias `/signup`) | public | `{ email, password, name, birthdate, accepted_policies: { terms, privacy } }` | **201** `{ user, token? }` (token only for native). 400 `invalid_birthdate` (`reason`: `required`, `invalid_format`, `invalid_date`, `out_of_range`, `future`), 400 `underage` (**no account is created**), 400 `consent_required` (returns `policies`), 400 `weak_password`, 409 duplicate e-mail. Password rule: 8–72 chars with upper and lower case, a number and a symbol. Writes the profile and two `privacy_consents` rows in one transaction; marks `basics` and `birthday` confirmed |
| `POST /api/auth/login` | public | `{ email, password }` | `{ user, token? }`. Wrong credentials: generic 401 `invalid_credentials`. **Correct password but suspended / banned / deleted → 403** `account_suspended | account_banned | account_closed` (no session). Sets rate-limit key per e-mail+IP |
| `POST /api/auth/logout` | public | — | clears the cookie |
| `GET /api/auth/me` | session | — | the member's own profile **plus** `email_verified` and `eligibility: { eligible, reasons }`. Never `password` / `token_version` |
| `POST /api/auth/complete-setup` | session | any of `name, gender, looking_for, bio, height_cm (100–250 or null), interests, photos` | Legacy edit endpoint, now narrow: **refuses** `birthdate` (400 `use_onboarding`), `lat`/`lng` (400 `location_not_supported`); `gender` ∈ `male, female, non_binary, other`; `looking_for` ∈ `male, female, everyone`; new photo entries must be images **the member uploaded** (400 `photo_not_owned`); cannot set completion, status or verification. Returns `{ user }` with eligibility |
| `POST /api/auth/socket-ticket` | **eligible** | — | `{ ticket, expires_in }` single-use, 30 s (web sockets) |
| `POST /api/auth/verify-email/request` | session | — | sends a 6-digit code (60 s cooldown → 429 `cooldown`) |
| `POST /api/auth/verify-email/confirm` | session | `{ code }` | 200 and `email_verified_at` set; 400 `invalid_code` (5 attempts, 10 min) |
| `POST /api/auth/password-reset/request` | public | `{ email }` | always `{ ok: true }` |
| `POST /api/auth/password-reset/confirm` | public | `{ email, code, new_password }` | strong-password rule; ends every session |
| `POST /api/auth/change-password` | session | `{ current_password, new_password }` | strong-password rule; other devices signed out, this one gets a fresh session |
| `POST /api/auth/logout-all` | session | — | ends every session |

### Google sign-in (state + PKCE + one-time code)

| Method & path | Class | Request | Response / notes |
|---|---|---|---|
| `GET /api/auth/google/url` (alias `/oauth/google/start`) | public | query `redirect_uri`, `code_challenge` (S256, 43 chars), optional `code_challenge_method=S256` | `{ url }` → Google. 400 `redirect_not_allowed` unless the URI **exactly** matches the allow-list (`dateza://auth-callback`; a configured web origin + `/auth-callback`; in development also `localhost` web and `exp://…/--/auth-callback`); 400 `pkce_required`; 503 if Google is not configured. Stores a random one-time `state` (hash only), the app's challenge and a PKCE verifier for the Google leg; 10-minute life |
| `GET /api/auth/google/callback` | public | query `code`, `state` (called by the browser) | Consumes the state atomically, exchanges the code with Google (with PKCE), **requires a verified Google e-mail**, finds or creates the member, then **302** to the validated app URL with **only** `?code=<one-time code>` (or `?error=access_denied \| account_suspended \| account_banned \| account_closed \| sign_in_failed`). No token, user or e-mail ever appears in the URL; empty body; `Cache-Control: no-store`. An unknown / expired / replayed state → 400 page, no redirect |
| `POST /api/auth/oauth/exchange` | public | `{ code, code_verifier }` | Checks `S256(verifier)` against the stored challenge, consumes the code (single use, 60 s) → `{ user, token? }` like login (web: cookie, no token). 400 `invalid_code`, 400 `platform_mismatch` (a web code cannot be exchanged as native, nor the reverse), 403 `account_*` |
| `GET /api/auth/google/mock-login` | public | `state` | **Development only** account chooser (needs `ALLOW_MOCK_GOOGLE_LOGIN=true`, no client id, not production); 404 otherwise |

Linking rules: a verified existing account with the same e-mail is signed in as itself (password untouched). An existing **unverified** account is verified by the Google proof, gets a random password and loses every session (a pre-registered account cannot be used to hijack it). A new Google member has no date of birth and has not accepted the policies; onboarding asks for both.

## Onboarding (`/api/onboarding`, class `session`)

State shape (returned by `GET`, by every successful `PATCH` and by `complete`):

```json
{
  "complete": false,
  "next_step": "gender",                      // first unconfirmed step, or "review"
  "steps": [{ "id": "consent", "required": true, "done": true }, "..."],
  "profile": { "name": "", "birthdate": null, "gender": null, "looking_for": null,
               "relationship_intention": null, "photos": ["/api/images/<id>"], "interests": [],
               "bio": "", "height_cm": null, "min_age": null, "max_age": null },
  "email": { "address": "", "verified": false, "required": true, "delivery_available": true },
  "consent": { "current_versions": { "terms": "draft-1", "privacy": "draft-1" }, "accepted": { "terms": true, "privacy": true } },
  "photos": { "minimum": 1, "recommended": 3, "maximum": 12 },
  "birthdate_locked": false, "underage": false,
  "missing": ["verify_email", "gender"], "can_complete": false,
  "eligibility": { "eligible": false, "reasons": ["email_unverified", "profile_incomplete"] },
  "options": { "genders": [...], "interested_in": [...], "intentions": [...] }
}
```

| Method & path | Body | Notes |
|---|---|---|
| `GET /api/onboarding` | — | Resume point. Values earlier app versions **invented** (birth date `1999-01-01`, the canned bio, the four default interests, height 175, stock photo URLs) are **not** shown as the member's answers; gender, interested-in and intention are only shown once the member has confirmed them. Nothing is deleted |
| `PATCH /api/onboarding/consent` | `{ accepted_policies: { terms, privacy } }` | must equal the current versions |
| `PATCH /api/onboarding/basics` | `{ name }` (1–100) | |
| `PATCH /api/onboarding/birthday` | `{ birthdate }` | strict validation. **Under 18 → 403 `underage`; the date is recorded and locked, no re-entry, every other step and completion also 403.** After completion → 409 `birthdate_locked` |
| `PATCH /api/onboarding/gender` | `{ gender }` | `male, female, non_binary, other` |
| `PATCH /api/onboarding/interested_in` | `{ looking_for }` | `male, female, everyone` |
| `PATCH /api/onboarding/intention` | `{ relationship_intention }` | `long_term, short_term, friendship, figuring_out`, or `null` (skip) |
| `PATCH /api/onboarding/photos` | `{ photos: ["/api/images/<id>", …] }` | up to 12; every image must be **uploaded by this member** (400 `photo_not_owned`); duplicates refused. At least one is required to complete (three recommended) |
| `PATCH /api/onboarding/interests` | `{ interests: [...] }` | ≤ 30 items, ≤ 40 chars, case-insensitive de-duplication; `[]` allowed |
| `PATCH /api/onboarding/about` | `{ bio, height_cm }` | both nullable; height 100–250 |
| `PATCH /api/onboarding/preferences` | `{ min_age, max_age }` | 18–99, min ≤ max, both nullable |
| `PATCH /api/onboarding/verify_email` | — | always 400 `use_verification_endpoints` (verify via `/api/auth/verify-email/*`) |
| `POST /api/onboarding/complete` | — | Re-validates everything. 400 `onboarding_incomplete` with `missing` and `next_step`; 403 `underage`; **only here does the server set `profile_completed_at`** (idempotent). Extra fields such as `profile_completed_at` in any body are ignored |

Required to complete: consent accepted, name, verified e-mail (when verification is required), valid adult date of birth, gender, interested-in, at least one own photo — each confirmed by the member.

## Dating features (all class `eligible`)

| Method & path | Notes |
|---|---|
| `GET /api/profiles/discovery?limit=` | other members who are themselves eligible (active, completed, adult, verified), not yet swiped, demo-isolated. **Public fields only**: `id, name, birthdate, gender, looking_for, bio, height_cm, interests, photos, is_online, match_percent, swipe_message`. No coordinates |
| `GET /api/profiles/likes-you` | same projection and eligibility filter |
| `POST /api/swipes` `{ swipee_id, direction: like\|pass\|super, message? }` | target must be an eligible member, otherwise **404 "That profile no longer exists"** (indistinguishable from a missing profile); mutual like creates the match in one transaction |
| `POST /api/swipes/reset` | |
| `GET /api/matches`, `GET /api/matches/conversations` | conversation list |
| `POST /api/matches` `{ targetUserId }`, `POST /api/matches/quick` `{ profile_id }` | returns an existing match, or creates one only after a mutual like **and** if the other member is eligible (404 otherwise) |
| `GET /api/matches/:matchId/messages?limit=&before=` | participants only |
| `POST /api/matches/:matchId/messages` `{ body, kind?, client_id? }` | participants only; **403 `unavailable`** if the other participant is no longer eligible (suspended, banned, deleted, …); idempotent by `client_id` |
| `POST /api/matches/:matchId/read` | |
| `POST /api/media?purpose=chat\|story[&matchId=]` (raw bytes), `GET /api/media/:id` | 12-hour private media; story media of a member who is no longer eligible is hidden |
| `GET/POST/DELETE /api/stories` | statuses; the feed omits members who are no longer eligible (your own are always shown to you) |

## Images and misc

| Method & path | Class | Notes |
|---|---|---|
| `POST /api/images` `{ data: <base64> }` | **adult** | profile photo upload (JPEG/PNG/WebP/GIF by content, ≤ 5 MB, 50 per member). Needed *during* onboarding, so it does not require a finished profile; a minor or inactive account gets 403 / 401 |
| `GET /api/images/:id` | public | image bytes (still public by id; moderation/ACL work is Phase 7) |
| `GET /api/auth/demo/status`, `POST /api/auth/demo` | public | one-tap demo login; **disabled in production unless `DEMO_ENVIRONMENT=isolated`**; demo accounts are finished, verified, active members |
| `GET /healthz`, `GET /readyz`, `GET /` | public | liveness, readiness (database), banner |

## Real-time (Socket.IO)

- Connect with `auth: { token }` (native) or `auth: { ticket }` (web, from `socket-ticket`). The server accepts a connection only for a member who is **eligible** and whose account is **active**; otherwise `connect_error` (`not_eligible` or "Authentication token is invalid or expired").
- Setting a member to `suspended | banned | deleted | pending_deletion` (`backend/accountStatus.js`) ends every session and **closes every live socket** of that member. `join_room` re-checks eligibility on every call.
- Events (server → client): `new_message`, `messages_read`, `match_created`, `media_expired`, `stories_changed`, `status_change`.

## Not available yet

Blocking, reporting, unmatching, moderation/admin, notifications and push, account deletion and export, distance and location, discovery filters, typing indicators, voice and calls. See `IMPLEMENTATION_PLAN.md`.
