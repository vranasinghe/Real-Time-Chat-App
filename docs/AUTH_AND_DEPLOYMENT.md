# Auth architecture and deployment notes

## How sign-in works

| | Web (Vercel) | Android / iOS (EAS) |
|---|---|---|
| Credential | `dateza_session` cookie: HttpOnly, Secure, SameSite=Lax. JavaScript never sees the token. | Bearer token in the OS secure store (expo-secure-store). |
| REST calls | Same origin `/api/*`; `mobile/vercel.json` rewrites them to the Render backend, so the cookie is first-party and works in Safari. | Directly to `EXPO_PUBLIC_BACKEND_URL`. |
| CSRF | Cookie-authenticated writes need `X-Requested-With: dateza` and an allowed `Origin`. | Not applicable (no ambient credentials). |
| Socket.IO | Page calls `POST /api/auth/socket-ticket` (30 s, single use) and connects straight to Render with the ticket, on every reconnect. | Connects with the access token. |
| Expiry | 7 days (`WEB_SESSION_DAYS`) | 30 days (`NATIVE_SESSION_DAYS`) |

Endpoints: `POST /api/auth/login | register | logout | socket-ticket`, `GET /api/auth/me`. Unauthenticated or expired credentials return **401** (`code`: `no_token`, `token_expired`, `invalid_token`); CSRF failures return 403.

Known limits: sessions are stateless JWTs (no server-side revocation until they expire); socket tickets are tracked in memory, so run a single backend instance or add a shared store before scaling out; Google sign-in is native-only and still returns its token in a redirect URL.

## Environment variables

Backend (Render): `DATABASE_URL` (secret), `JWT_SECRET` (32+ chars), `NODE_ENV=production`, `CORS_ORIGIN` (web origin(s), comma separated), `DEMO_LOGIN_ENABLED`, optional `WEB_SESSION_DAYS`, `NATIVE_SESSION_DAYS`, `LOG_LEVEL`. Dev-only: `ALLOW_MOCK_GOOGLE_LOGIN=true`.
Client (build time, public): `EXPO_PUBLIC_BACKEND_URL` (required in production), optional `EXPO_PUBLIC_WEB_API_BASE`. See `mobile/.env.example`.

## Deploy order (matters)

1. Deploy the backend to Render first (it accepts both old bearer clients and the new cookie clients).
2. Check `https://real-time-chat-app-qsrn.onrender.com/readyz` returns 200.
3. Deploy the web app to Vercel (build: `cd mobile && npx expo export --platform web`, output `dist`, with `EXPO_PUBLIC_BACKEND_URL` set).
4. Build Android: `cd mobile && eas build -p android --profile preview` (APK) or `--profile production` (AAB). iOS: `eas build -p ios --profile production` (needs an Apple developer account).

## Tests

`cd backend && npm test`: 12 automated tests (sessions, CSRF, expired/forged tokens, single-use socket tickets, multi-device sockets). No database needed.
Integration tests that write data (`test:chat`, `test:images`) must only run against a local or throwaway database, never the production Neon database.

## Realtime, database and images (Phases 5-8)

- **Config:** all backend URLs come from `mobile/lib/config.ts`; all REST calls go through `mobile/lib/api.ts`. No other file builds a backend URL.
- **Messaging:** the database is the source of truth. Sends are idempotent (`client_id` UUID), history is paged, read receipts are tracked per match. Sockets reconnect with fresh credentials, and on every reconnect or return to the foreground the app re-fetches conversations and the open thread.
- **Presence:** a user is online while at least one socket is connected (phone and web both count). Changes go only to that user's matches. Counts are in memory, so keep a single backend instance. On boot all `is_online` flags are reset, because no sockets exist yet.
- **Migrations:** `backend/migrations/*.sql` run once each, in name order, inside a transaction, and are recorded in `schema_migrations`. Never edit an applied file; add a new one. `001` only adds indexes and `NOT VALID` constraints (existing rows are never rejected or rewritten).
- **Swipes** (swipe + match + opening messages) now commit in one transaction. Discovery is capped at 50 per request, likes-you at 100.
- **Profile updates** change only the fields sent. Previously a partial update would have blanked the rest of the profile.
- **Images:** stay in PostgreSQL. 5 MB limit, JPEG/PNG/WebP/GIF only (checked by file signature, SVG refused), max 50 per user, authenticated and rate limited. `mobile/lib/imagePicker.ts` gives web and native the same validation. Not done: upload progress (`fetch` cannot report it), image resizing, cleanup of images no profile references, access control on reads (images are public by id, as before).

## Account security endpoints (Phase 10)

`GET /api/auth/config` (what the app should offer), `POST /api/auth/verify-email/request | confirm`, `POST /api/auth/password-reset/request | confirm`, `POST /api/auth/change-password`, `POST /api/auth/logout-all`. Migration `002_account_security.sql` adds `profiles.token_version`, `profiles.email_verified_at` and the `auth_codes` table (additive; existing sessions stay valid). Email needs `RESEND_API_KEY` and `MAIL_FROM`; without them verification is skipped and password reset is hidden in production.
