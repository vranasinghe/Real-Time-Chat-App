# Dateza — Architecture (as built, after Phase 0)

Describes what exists in the repository today, verified by reading the code. Planned changes are in `IMPLEMENTATION_PLAN.md`; this file is updated as phases land. Sources: `backend/`, `mobile/`, `render.yaml`, `mobile/vercel.json`, `mobile/eas.json`, `.github/workflows/ci-cd.yml`.

## 1. Runtime topology

```
 Browser (Expo web, static)        Android / iOS app (Expo, EAS build)
        │  same-origin /api/*                │  HTTPS + Bearer token, WSS
        ▼                                    │
   Vercel (static + rewrite /api → Render)   │
        │                                    │
        └──────────────► Render web service "dateza-api" (Node 22, Express 4 + Socket.IO 4, ONE instance)
                                   │
                                   ▼
                       PostgreSQL (Neon in production; local PG for tests)
```

- Web uses an **HttpOnly session cookie** through the Vercel proxy (first-party), plus a CSRF header (`X-Requested-With: dateza`) and Origin allowlist on writes. Native uses `Authorization: Bearer` from Expo SecureStore. Both carry the same HS256 JWT.
- Sockets: native sends its access token; web first calls `POST /api/auth/socket-ticket` and opens the socket with a single-use, 30-second ticket.
- One backend instance only: socket tickets, presence counts and the media-expiry timer are in process memory.

## 2. Backend (`backend/`)

| Module | Responsibility |
|---|---|
| `index.js` | App wiring: helmet, CORS, request log, health (`/healthz`, `/readyz`), rate limits, route mounting, JSON 404/error handlers, socket auth and events, presence, 30 s media-expiry timer, graceful shutdown |
| `config.js` | Validated environment (fails at boot): `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGIN`, cookie/session settings, `DEMO_LOGIN_ENABLED`, `isProduction` (= `NODE_ENV=production` or `RENDER`) |
| `session.js` | JWT issue/verify, cookie vs bearer extraction, CSRF check, `token_version` revocation, socket tickets, **one query per request** that loads the account (`loadSession`: status, eligibility columns, demo rule) and attaches it as `req.account` |
| `auth.js` | Register (adult DOB + consent + strong password), login (account-status aware), logout, `socket-ticket`, narrow `complete-setup`, `GET /me` (adds `eligibility`) |
| `accountSecurity.js` + `mailer.js` | Email verification codes, password reset, change password, logout-all (codes HMAC-hashed, 10 min, 5 attempts, 60 s cooldown; Resend delivery or dev log) |
| `profiles.js` | `GET /api/profiles/discovery`, `/likes-you` |
| `swipes.js` | `POST /api/swipes` (one transaction: swipe + mutual match + opening messages), `/reset` |
| `matches.js` | Conversation list, message list/send (idempotent `client_id`), read receipts, quick-match endpoints |
| `images.js` | Profile photos in the `images` table (public by id) |
| `media.js` | Chat photos and stories in `ephemeral_media` (12 h expiry, authenticated, range requests), expiry cleanup |
| `realtime.js` | `user:<id>` room helpers, `emitToMatch`, `disconnectUser` |
| `eligibility.js` | **Phase 1.** The single definition of who may use dating features (active, adult, verified e-mail, completed profile), the `requireEligible` / `requireAdult` middleware (tagged `eligible` / `adult`), `candidateSql` for "visible to others" |
| `age.js` | **Phase 1.** Strict date-of-birth and age rules (byte-identical copy in `mobile/lib/age.js`) |
| `onboarding.js` | **Phase 1.** Server-driven onboarding: `GET/PATCH /api/onboarding`, `POST /complete` |
| `oauth.js` | **Phase 1.** Google sign-in: exact redirect allow-list, random one-time state, PKCE, one-time code exchange |
| `accountStatus.js` | **Phase 1.** The one place account status changes; ends sessions and closes sockets |
| `policies.js` | **Phase 1.** Policy version labels (`draft-1`) |
| `demo.js` | Flag-gated one-tap demo accounts (Alex/Elena); `ensureDemoAccounts` deletes any other `is_demo` profile |
| `db.js` | Pool, `withTransaction`, `runMigrations`, `initDb` (base schema → migrations → dev seeding) |
| `dbSafety.js` | **New in Phase 0.** Pure rules for destructive migrations, migration naming/order, and where fake accounts may be seeded |
| `showcaseProfiles.js`, `data/showcase-profiles.json`, `public/profiles/*.png` | Development-only fictional fixtures |
| `scripts/` | `test-db.js` (throwaway local PostgreSQL), `run-integration.js` (new), `import-images.js`, `sync-showcase-profiles.js` |

Socket events: server→client `new_message`, `messages_read`, `match_created`, `media_expired`, `stories_changed` (global broadcast), `status_change` (to matches only); client→server `join_room`/`leave_room` (legacy per-match rooms). Every socket also joins `user:<id>`. Message **sends are REST**, the server then emits.

Authorization today: every route declares a class — `public`, `session` (valid session of an **active** account), `adult`, or `eligible` (adult + verified e-mail + completed profile) — enforced by middleware and by an inventory test. Suspended, banned and deleted accounts cannot hold a session or a socket. Chat reads/writes/media additionally need match participation. There is no block layer yet (Phase 2).

### 2b. Eligibility flow (Phase 1)

```
register (DOB + consent) ──► verify e-mail ──► onboarding steps (server-confirmed) ──► POST /onboarding/complete
      │                          │                       │                                   │
  under 18: no account      eligibility.reasons      each step stored,                   server sets profile_completed_at
                            email_unverified         resumable on any device             ⇒ eligibility.eligible = true
Google: start(state+PKCE) ─► Google ─► callback ─► one-time code ─► exchange(code+verifier) ─► same journey
```

## 3. Database

Authoritative: `backend/db_init.sql` + `backend/migrations/` (001–003, 006, 007; 004/005 retired). Tables: `profiles`, `swipes`, `matches`, `messages`, `match_reads`, `images`, `auth_codes`, `ephemeral_media`, `stories`, `schema_migrations`, `user_preferences`, `privacy_consents`, `oauth_transactions`, `oauth_exchange_codes`. Details, migration safety rules and recovery: `DATABASE_MIGRATIONS.md`.

## 4. Mobile / web client (`mobile/`)

- Expo SDK 54, Expo Router 6 (file-based routes under `app/`), React 19, NativeWind styling, Zustand store in `lib/store.ts`.
- `lib/api.ts` is the single HTTP client (cookie/CSRF on web, bearer on native, timeouts, retry for safe requests, central 401 handling). `lib/config.ts` resolves backend URLs and refuses unsafe production configurations.
- State persistence: the whole store slice (`user`, `session`, `matches`, `messages`, `stories`, `swipes`, …) is persisted in AsyncStorage; the native session token is in SecureStore; the web session lives only in the cookie.
- `lib/features.ts` (new) holds flags for features that are not implemented (`calls`, `voiceMessages`); they gate UI and routes.
- Navigation guard is client-side only (`app/_layout.tsx`): a signed-in member the server does not consider eligible only sees profile setup, e-mail verification and the policy pages; the backend independently refuses every dating request.
- Onboarding screens (`app/profile-setup/*`) read and write the server through `lib/onboardingApi.ts` / `lib/onboardingStore.ts`; nothing is persisted locally, so setup resumes on any device.
- Offline demo (`isDemo`) runs entirely on-device with the bundled showcase catalog (`demo-showcase-*` ids).

## 5. Build, test and delivery

| Concern | How |
|---|---|
| Node | 22 (`.nvmrc`, `engines`); matches Render (`NODE_VERSION=22`) and CI |
| One-command verification | `npm run test:all` (root): backend unit → backend integration (starts/stops a throwaway local PostgreSQL) → mobile typecheck → lint with `--max-warnings 0` → web export |
| CI (`.github/workflows/ci-cd.yml`) | Jobs: backend validation (unit), backend integration (PostgreSQL 16 service), mobile validation (types, lint, web export), dependency audit report (informational) |
| Dependency report | `npm run audit:report` (never changes dependencies) |
| Web deploy | Vercel builds `npx expo export --platform web`; `/api/*` rewritten to the Render service |
| Backend deploy | Render blueprint `render.yaml` (`rootDir: backend`, `node index.js`, health check `/readyz`) |
| Native builds | `mobile/eas.json` profiles `development`, `preview`, `production`, all pointing at the same backend URL (no staging yet) |

## 6. Safety rules built in Phase 0 (and how to see them)

1. Destructive migrations never run on a hosted database without review (`dbSafety.assertMigrationAllowed`; `db.runMigrations`).
2. Fake accounts are never seeded into a hosted database (`dbSafety.canSeedDevData`; `db.initDb`).
3. Migration files must have unique, well-formed numbers.
4. Misleading UI is switched off by flags or removed (see `KNOWN_LIMITATIONS.md` §B).
