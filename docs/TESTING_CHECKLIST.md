# Testing

## Automated (run on every push in CI)

| Command | What it covers | Needs |
|---|---|---|
| `cd backend && npm test` | 19 unit tests: sessions, CSRF, expired/forged tokens, single-use socket tickets, multi-socket users, input validation, image type detection, photo list cleaning | nothing |
| `cd backend && node scripts/test-db.js start` then `TEST_DATABASE_URL=<printed url> npm run test:integration` | 22 integration tests on real PostgreSQL + real sockets: sign-up/login/logout, wrong and unknown credentials, rate limit, session restore, token revocation, password change/reset, email verification, CSRF, profile updates, image upload, matching, web <-> phone messaging both ways, duplicate prevention, history, two devices, outsiders, presence, migrations | PostgreSQL command line tools; the script creates a throwaway cluster (see `scripts/test-db.js`). CI uses a Postgres service. |
| `cd mobile && npx tsc --noEmit && npm run lint` | Types and lint | nothing |
| `cd mobile && EXPO_PUBLIC_BACKEND_URL=https://real-time-chat-app-qsrn.onrender.com npx expo export --platform web` | Web production build | nothing |

Integration tests refuse to run against a non-local database. Stop the throwaway server with `node scripts/test-db.js stop`.

**Not automated:** screen-level UI tests, navigation guards, responsive layout, native keyboard/safe-area, image picker on devices, EAS builds, anything on the deployed services.

## Manual: web (desktop and phone browser)

Prerequisite: backend deployed first, then the Vercel web build, then check `https://<backend>/readyz` is 200.

- [ ] Open the site; landing page loads, no red configuration message.
- [ ] Sign up with a new email; lands in the setup wizard (or the code screen if email is configured). In devtools > Application > Cookies, `dateza_session` is HttpOnly + Secure and **no token** appears in local storage or responses.
- [ ] Reload the page: still signed in. Open a deep link (`/chat-thread...`, `/profile/edit-profile`): loads, does not bounce to the landing page.
- [ ] Sign out, then use the browser back button: signed-in screens are not shown; `/api/auth/me` returns 401.
- [ ] Wrong password: clear message, not "server error". Stop the backend (or use airplane mode): "Can't reach the server" message, and sign-in works again once it is back.
- [ ] Resize to ~375, ~768 and ~1280 px wide: no horizontal scroll; wide screens show a centred column.
- [ ] Safari (macOS or iOS): sign in works (this is why the cookie goes through the Vercel proxy).
- [ ] Profile photo upload from the file picker; photo appears after reload.

## Manual: Android (real device)

1. `cd mobile && eas login`, then `eas build -p android --profile preview` (APK). Install it.
- [ ] Launch: no configuration error. Sign in with a real account.
- [ ] Kill the app, reopen: still signed in (token in secure storage). Change the password on another device: this device is signed out at its next request.
- [ ] Rotate the screen / open the keyboard on the sign-up form: fields stay visible; content is not under the status bar.
- [ ] Pick a photo from the gallery (grant the permission): uploads and shows.
- [ ] Put the app in the background for a few minutes, return: the "Reconnecting..." bar appears and clears; new messages arrive.

## Manual: cross-platform messaging (needs two accounts that are matched)

- [ ] Web A and Android B: A sends, B receives instantly; B replies, A receives instantly.
- [ ] Both stay in the chat; the other user's online dot appears and disappears when they open/close the app.
- [ ] Sign the same account in on web and Android: a message to that account appears on both.
- [ ] Reload the web page and restart the app: the whole conversation is still there, in order.
- [ ] Send while offline, then reconnect: message is delivered once (no duplicate).

## Manual: iOS (not verified)

Requires an Apple Developer account: `eas build -p ios --profile preview`, install via TestFlight/ad hoc, repeat the Android list. Pay attention to the keyboard, safe areas (notch / home indicator) and the photo permission prompt.

## Free-tier cold starts

Render's free plan sleeps after inactivity and takes ~30-60 s to wake. The app waits up to 30 s per request and retries once on network failures; the first login after a long idle can still show "The server took too long to respond. It may be waking up" and succeed on the second try. A paid instance (or an external uptime ping) removes this; neither is configured.
