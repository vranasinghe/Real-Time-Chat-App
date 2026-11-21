# Audit and fixes: confirmed bugs, root causes, how each was fixed

Severity: **C** critical, **H** high, **M** medium. "Tested" says how it was checked:
**unit** = DB-free automated test, **integration** = automated test against a real PostgreSQL with real sockets, **manual** = looked at in a browser, **none** = not tested.

| # | Sev | What was wrong | Why it failed | Fix (files) | Tested |
|---|---|---|---|---|---|
| 1 | C | Anyone could sign in as any user | With no `GOOGLE_CLIENT_ID` the Google callback accepted `?mock=true&email=...` and returned a real 30-day JWT | Mock path is opt-in, dev-only, never in production (`backend/auth.js`) | unit (stub) |
| 2 | H | Google flow redirected the token to any URL | `state` / `redirect_uri` were not validated (open redirect) | Allowlist: app scheme, Expo schemes, configured web origins (`backend/auth.js`) | none |
| 3 | H | Android builds could not log in | `eas.json` pointed every profile at a dead Railway URL | Render URL; production profile now an AAB (`mobile/eas.json`) | none (no device/build) |
| 4 | H | "Logged in" without a backend | `signIn`/`signUp`/Google silently fell back to a mock user when the `isUsingSupabase` flag was false; the flag was persisted and derived from whether an env var existed | Mock auth removed; the offline demo is an explicit mode that wipes any real session (`mobile/lib/store.ts`) | manual + tsc |
| 5 | H | Production builds could call `localhost` | `EXPO_PUBLIC_BACKEND_URL \|\| "http://localhost:3000"` | Central config; no fallback outside dev; clear error banner (`mobile/lib/config.ts`) | manual |
| 6 | H | Session token readable by scripts / stored in plain text | JWT in AsyncStorage / localStorage | Web: HttpOnly cookie via Vercel proxy + CSRF header + Origin check. Native: SecureStore (`session.js`, `tokenStore.ts`, `vercel.json`) | integration |
| 7 | H | Sessions could never be revoked | Stateless JWT, no version | `token_version`: password change/reset and "sign out everywhere" end all sessions (`session.js`, migration 002) | integration |
| 8 | H | "Change password" did nothing | The screen only showed a success alert (a timer) | Real endpoint; other devices signed out (`accountSecurity.js`, `change-password.tsx`) | integration |
| 9 | H | OTP was fake | Verify screen accepted any 4 digits; reset flow was a timer | Real 6-digit codes (hashed, 10 min, 5 tries, 60 s resend), password reset; disabled cleanly when no email provider is configured (`accountSecurity.js`, `mailer.js`) | integration (delivery not tested) |
| 10 | H | Partial profile update wiped the profile | `UPDATE ... SET col = $n` with `undefined` -> NULL | Only sent fields change; fields validated (`backend/auth.js`) | integration |
| 11 | M | Edit-profile name/photo never saved | Name not in the endpoint; photo button was a stub | Name saved; real photo change (`edit-profile.tsx`, `imagePicker.ts`) | tsc |
| 12 | M | Real users got four stock photos | `MOCK_GALLERY` used when none uploaded | Removed (`photos.tsx`) | tsc |
| 13 | M | Presence broadcast to everyone, never cleared | `io.emit("status_change")`; `is_online` set at login only | Per-connection counting, sent only to matches, reset on boot (`backend/index.js`) | integration |
| 14 | M | Half-written matches possible | Swipe, match and messages were separate queries | One transaction; input validated; unknown profile -> 404 (`swipes.js`, `db.withTransaction`) | integration |
| 15 | M | Expired token returned 403; client kept stale state | `jwt.verify` error mapped to 403 | 401 with a `code`; client clears the session once (`session.js`, `api.ts`) | unit + integration |
| 16 | M | Android content under the status bar | `SafeAreaView` from `react-native` is iOS-only; SDK 54 is edge-to-edge | `react-native-safe-area-context` in 24 screens | manual (web only) |
| 17 | M | Server started with no tables after a DB error | `initDb` swallowed errors | Retry 4x, then exit; `/readyz` reports DB state (`index.js`, `db.js`) | integration |
| 18 | M | Unbounded discovery `limit`; anonymous 8 MB body reads | no clamp; parse before auth | Clamp 1-50; auth before body parse (`profiles.js`, `images.js`) | integration |
| 19 | M | Phone numbers accepted as "email" | No email validation | Validated client and server; field relabelled "Email" | integration |
| 20 | M | Password hashes could be printed | `backend/_inspect.js` dumped every profile | Deleted | n/a |
| 21 | M | e2e scripts could write to production | They hit whatever server `API_URL` named (this happened once during this work) | They refuse to run without `E2E_CONFIRM_DISPOSABLE_DB=1`; the new suite starts its own app on a local DB and refuses non-local hosts | n/a |

Also: structured logging, centralised config, graceful shutdown, security headers (Vercel), bcrypt cost 12 with transparent upgrade on login, CI now runs unit and PostgreSQL integration tests on Node 22, dependency fixes (backend 8 -> 4 moderate advisories).

## Known remaining items

- Mobile dependencies: `npm audit` reports 35 advisories (17 high, 1 critical), almost all in Expo/React Native build tooling. Not force-upgraded because that means a breaking SDK change.
- Backend: 4 moderate advisories need breaking upgrades (`npm audit fix --force`).
- Socket tickets and presence counts are in memory: run one backend instance.
- Rate limiting by IP is imprecise for web traffic that arrives through the Vercel proxy (the failed-login limit is keyed by email + IP).
- The Google flow still returns its token in a redirect URL (native only).
- Images are stored in PostgreSQL, public by id; no resizing, no orphan cleanup.
- Existing accounts are unverified (`email_verified_at` NULL); verification is offered, not enforced.
