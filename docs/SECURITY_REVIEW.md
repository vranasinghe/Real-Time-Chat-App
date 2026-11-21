# Security review

Scope: backend (`backend/`), web and native client auth, deployment configuration. Reviewed by reading the code and by automated tests against a real database. **Not** done: an external penetration test, load testing, review of Neon/Render/Vercel account settings.

| Area | State |
|---|---|
| Password hashing | bcrypt, cost 12 for new hashes. Older hashes keep working and are upgraded when that user next logs in. Passwords 8-72 chars. Hashes and `token_version` never leave the server. |
| Login | Same response and timing for unknown email and wrong password. Failed attempts limited to 10 / 15 min per email + IP. Invalid credentials are 401. |
| Sessions | JWT HS256 (algorithm pinned), 7 days web / 30 days native. `token_version` revocation: password change/reset and `POST /api/auth/logout-all` end every session; tokens issued before this change stay valid. Socket tickets: 30 s, single use. |
| Web credential | HttpOnly, Secure, SameSite=Lax cookie; first-party through the Vercel proxy. JavaScript cannot read it. |
| CSRF | Cookie-authenticated writes need `X-Requested-With: dateza` and an allowlisted `Origin`. Bearer requests carry no ambient credentials. |
| Authorization | Every data route authenticates server-side; match/message routes check participation; tests cover outsiders. |
| CORS | Allowlist from `CORS_ORIGIN` (set in `render.yaml`). If unset in production the server warns and allows any origin without credentials. |
| Input validation | Server-side on sign-up, profile, swipes, messages, images. Parameterised SQL throughout; no string-built queries. JSON bodies capped at 100 KB (images 8 MB, authenticated first). |
| Images | Authenticated, rate limited (40 / 10 min), 5 MB, type from file signature (SVG refused), 50 per user. Reads are public by unguessable id. |
| OTP / reset | 6 digits, HMAC-stored, 10 min, 5 attempts (counted atomically), 60 s resend, single use; reset answers identically for unknown emails. Disabled in production without `RESEND_API_KEY` + `MAIL_FROM`. **Email delivery has never been exercised** (no provider configured here). |
| Errors / logging | Central handler returns generic 500s. Logs are structured, with no bodies, headers, passwords or tokens. |
| Secrets | Server only (`DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY`). Client variables are public by design and documented as such. `JWT_SECRET` must be 32+ chars in production or the server will not start. |
| Headers | `helmet` on the API; `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` on the web app. No CSP yet. |
| Dependencies | Backend: 4 moderate advisories remain (need breaking upgrades). Mobile: 35 advisories in Expo/RN tooling (17 high, 1 critical), not force-upgraded. |
| Incident during this work | A test run created three `chat-e2e-*` accounts in the production Neon database, because the e2e script targeted a locally running old server that used the production `DATABASE_URL`. A test session also created an empty `victim@x.com` profile while exercising the (now closed) Google mock-login hole. Guards were added so this cannot recur; the rows are for the owner to remove. |

## Residual risks and recommendations

1. Rotate `JWT_SECRET` after deploying the Google fix (tokens minted through the old hole stay valid until they expire). Rotating signs everyone out.
2. Configure an email provider before relying on verification or reset, and test delivery.
3. Add a Content-Security-Policy once the set of third-party hosts (fonts, images, video) is settled.
4. Move socket tickets, presence and rate-limit counters to a shared store (e.g. Redis) before running more than one backend instance.
5. Decide whether images should be private to matches; today anyone with the URL can fetch them.
6. Add account deletion and data export (privacy), and a moderation / report flow, before a public launch.
7. The Google flow returns its token in a redirect URL (native only); replace with a one-time code exchange.
