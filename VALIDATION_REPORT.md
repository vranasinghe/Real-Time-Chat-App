# Dateza – Validation Report

**Last updated:** 2026-11-20 (first run, plus live deployment test)  **Branch:** `main` (commit `cf91a0e`)

| | Local test | Live test |
|---|---|---|
| Web app | Expo web, `localhost:8082` | Vercel, https://real-time-chat-app-tau-six.vercel.app |
| Backend | Express + Socket.io, `localhost:5001` | Render (free), https://real-time-chat-app-qsrn.onrender.com |
| Database | PostgreSQL 18 (local) | Neon PostgreSQL 18.7, US East (Ohio) |
| Tools | In-app browser, scripted API/socket tests | In-app browser, scripted API/socket tests |

**Verdict:** The app works end to end in production. Two people on two devices can use the Live Demo and chat in real time, with read receipts, and profile photos come from the database. Six bugs were found and fixed along the way. The remaining open issues are about hardening; the most important are that email "verification" is not enforced and the backend accepts requests from any website.

---

## 1. Live deployment test (Vercel + Render + Neon)

| # | Check | Result |
|---|-------|--------|
| L1 | Backend health check (`GET /`) | PASS – 200, backend running |
| L2 | Backend connected to Neon | PASS – existing Alex ↔ Elena chat and history served from Neon |
| L3 | Data migration local → Neon | PASS – all tables match row-for-row (profiles 34, swipes 27, matches 7, messages 75, read receipts 8, images 18); image bytes identical by checksum; message id sequence carried over |
| L4 | Live Demo enabled on Render | PASS – `/api/auth/demo/status` lists Alex and Elena |
| L5 | Photos served from the database | PASS – `image/webp`/`image/jpeg` over https, `Cross-Origin-Resource-Policy: cross-origin`, long-lived cache |
| L6 | Discovery returns database photos | PASS – 29 profiles, photos as `/api/images/<id>` |
| L7 | Protected routes without login | PASS – 401 |
| L8 | Real-time delivery through Render | PASS – socket connected over WebSocket; message delivered in **353 ms** |
| L9 | Vercel build points at the Render backend | PASS – only `real-time-chat-app-qsrn.onrender.com` in the bundle; no Railway or localhost addresses |
| L10 | Vercel build contains the new features | PASS – Live Demo screen and image upload code present |
| L11 | Deep links on Vercel (`/live-demo`, `/chat-thread?...`, unknown paths) | PASS – all 200 |
| L12 | Live Demo picker on the live site | PASS – both persona photos load from Render/Neon |
| L13 | Continue as Alex | PASS – lands directly in the chat with Elena, full history loaded |
| L14 | Elena → Alex (sent from another client) | PASS – appeared on Alex's screen live, no reload |
| L15 | Alex → Elena (sent from the live site) | PASS – stored as message #96, visible from Elena's side, bubble shows "Sent" |
| L16 | Read receipts | PASS – opening the chat moved Alex's read pointer to Elena's latest message (#95) |
| L17 | CORS | WORKS, NOT LOCKED – backend answers `Access-Control-Allow-Origin: *` because `CORS_ORIGIN` isn't set on Render (open issue 2) |

Not tested live on purpose (they would create real records in the production database): sign-up and photo upload. Both pass locally (sections 2 and 5).

## 2. Sign-up flow (local)

| # | Check | Result |
|---|-------|--------|
| 1 | Submit empty form | PASS – "Please fill in all fields" |
| 2 | Weak password (`weak`) | PASS – "Password does not meet strength requirements" |
| 3 | Password checklist (8 chars / upper+lower / number+symbol / strong) | PASS – all four tick for a strong password |
| 4 | Valid sign-up | PASS – user row created, JWT issued, WebSocket connected, app moves to Verify Code |
| 5 | Verify Code screen (4 boxes, auto-advance, resend countdown) | PASS – digits auto-advance; proceeds to profile setup (but see open issue 1) |
| 6 | Birthday step, under-18 date (15/06/2015) | PASS – "You must be at least 18 years old to join Dateza" |

### Backend API checks

| Request | Expected | Actual |
|---------|----------|--------|
| Register, duplicate email | reject | 400 PASS |
| Register, weak password | reject | 400 PASS |
| Register, malformed email (`notanemail`) | reject | **201 – accepted (FAIL, open issue 3)** |
| Login, wrong password | reject | 400 PASS (open issue 6) |
| Login, correct credentials | 200 | 200 PASS |
| Discovery without token | 401 | 401 PASS |
| Discovery with forged token | 401/403 | 403 PASS |

## 3. Real-time chat (local)

Automated: `npm run test:chat` (two real users, real sockets) – **10/10 PASS**:

- mutual like creates a match and notifies both users live
- messages reach the other user without joining per-match rooms
- retrying with the same `client_id` returns the original (no duplicate)
- someone else re-using a `client_id` is rejected (409)
- conversation list has last message and unread count in one request
- marking read clears unread and notifies the sender ("Seen")
- read pointer never moves backwards or past the newest message
- message paging with `?limit` and `?before`
- input validation (empty, >2000 chars, bad kind, bad `client_id`, bad cursor)
- outsiders cannot read, send, mark read or receive

Manual, two users in the browser:

| Check | Result |
|-------|--------|
| Chat list updates live while on the list (preview + unread count) | PASS |
| Thread opens at the newest message; older messages load on scroll up | PASS – all 35, "Start of your conversation" shown |
| Sent message shows "Sent", flips to "Seen" when the other user reads | PASS |
| Reply arrives live while the thread is open, and is marked read | PASS |
| Backend down → "Not sent · Tap to retry"; backend back → tap → delivered exactly once | PASS |

## 4. Demo modes (local)

### Live Demo (two devices, no sign-up)

| Check | Result |
|-------|--------|
| Picker shows Alex and Elena with photos | PASS |
| One tap logs in and opens the Alex ↔ Elena chat | PASS (after fixing bug C) |
| Two separate sessions chat in real time both ways, with "Seen" | PASS |
| Demo accounts can't be logged into with a password | PASS – 400 |
| Real users never see demo accounts in discovery | PASS |
| Retired persona (Sam) removed automatically with its chat | PASS |

### Offline demo (one device, no server)

| Check | Result |
|-------|--------|
| `/demo` lands on the swipe deck with 9 demo profiles; no backend traffic | PASS |
| Like → match screen → chat → simulated reply | PASS (after fixing bug A) |
| Likes You, Explore, Chats, Profile tabs; survives reload; Logout clears demo | PASS |

## 5. Images in the database (local)

Automated: `npm run test:images` – **7/7 PASS**:

- upload a PNG (base64) and get `/api/images/<id>` back
- `data:` URL uploads work too
- image served with the right type, identical bytes, cross-origin header and long cache
- uploads require login (401)
- non-images, empty and oversized (>5 MB) uploads rejected (400)
- unknown or malformed image ids return 404
- profile save keeps database images and web URLs, drops device-only references (`blob:`, `file:`)

Import: `npm run images:import` copied all 22 existing profile photo links into the database (15 unique images, ~1 MB, 0 failures); afterwards no profile links to an outside image host.

## 6. Bugs found and fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| A | **High** | Match screen crashed on web (ScrollView layout props). Every new match on web crashed. | Moved props into `contentContainerStyle` ([matched.tsx](mobile/app/matched.tsx)) |
| B | Medium | Profile → Logout hidden under the floating tab bar, unreachable on ~830px-high screens. | Added bottom padding ([profile.tsx](mobile/app/(tabs)/profile.tsx)) |
| C | Medium | Welcome screen's auto-redirect overrode navigation from screens above it (Live Demo went to the swipe deck instead of the chat). | Redirect only runs while the welcome screen is focused ([index.tsx](mobile/app/index.tsx)) |
| D | Medium | Behind Render's proxy, every visitor shared one rate limit (100 logins / 15 min for all users combined). | Trust the proxy on Render ([index.js](backend/index.js)) |
| E | Medium | Photos picked during profile setup never left the device (device-only URIs saved to the profile). | Upload to the database at pick time; server drops device-only references ([photos.tsx](mobile/app/profile-setup/photos.tsx), [images.js](backend/images.js)) |
| F | Medium | Chat: closing a thread stopped live updates in the chat list; failed sends vanished silently; unread count always 0. | Per-user socket rooms, optimistic send with retry, real unread counts and receipts ([store.ts](mobile/lib/store.ts), [matches.js](backend/matches.js)) |

## 7. Open issues

| ID | Severity | Issue | Suggestion |
|----|----------|-------|------------|
| 1 | **Medium** | **Email/OTP verification is simulated.** [verify-code.tsx](mobile/app/auth/verify-code.tsx) accepts any 4 digits; the account is created and logged in before this step, and every profile shows "Verified Account". | Implement real email/SMS verification, or remove the step and the "Verified" label. |
| 2 | **Medium** | **Backend accepts requests from any website** (`CORS_ORIGIN` not set on Render → `*`). | On Render set `CORS_ORIGIN=https://real-time-chat-app-tau-six.vercel.app`. |
| 3 | **Medium** | **Server does not validate email format** (`notanemail` accepted with 201). | Validate email (and phone) server-side. |
| 4 | Low | Swipe card collapses to zero height at some in-between window sizes (seen at 550×731); fine at phone (375×667) and desktop sizes. On phone size the text panel covers most of the photo. | Make the deck height responsive to available space. |
| 5 | Low | Error banner on Create Account stays visible while the user edits fields. | Clear `error` on input change. |
| 6 | Low | Wrong-password login returns 400 rather than 401. | Use 401 for failed authentication. |
| 7 | Low | `npm audit`: backend 8 vulnerabilities (1 critical), mobile 40 (1 critical). | Review with `npm audit`; many are dev tooling. |
| 8 | Low | No push notifications, typing indicator or online status; the chat header always says "Offline". | Phase 2. |
| 9 | Info | Free Render instance sleeps after ~15 min idle; first request afterwards takes up to ~50 s. | Accept for demos, or use a paid instance. |
| 10 | Info | Render logs a `pg` notice that `sslmode=require` is treated as `verify-full`. Connection is encrypted. | Optionally change the Neon URL to `sslmode=verify-full` to silence it. |
| 11 | Info | Story bubbles on the home screen are hard-coded sample content loading from an outside image host. | Real stories would need upload + storage like profile photos. |
| 12 | Info | `mobile/.env.example` still references Supabase. | Remove the leftovers. |

## 8. Not tested

- Sign-up and photo upload on the **live** site (pass locally; skipped to avoid creating production records).
- Photo picker UI itself (the upload path was tested via the API).
- Google, Facebook (stub) and Apple sign-in; Google needs `GOOGLE_CLIENT_ID/SECRET`.
- Forgot / reset / change password.
- Stories upload, call screens, notifications screen.
- Native iOS / Android builds; only the web build was tested.

## 9. Environment and data notes

- **Production database (Neon) is a full copy of the local database**, so it also contains test records from local testing: accounts `qa.tester…`, `chat-e2e-…`, `ui-alice/bob-…`, `images-e2e-…` and their test images/messages. They can be deleted on Neon if unwanted.
- Demo chat contains test messages from the live test ("Render live check ✅", "Hi Alex! Live from Vercel + Render test", Alex's reply); demo messages are deleted automatically after 24 hours.
- The local backend (`backend/.env`) now points at Neon. The local PostgreSQL database still holds its data and is used by the other copy of the app (`MY ALL PROJECTS\Dating App`), which runs on ports 5000/8081 (this copy uses 5001/8082 locally).
- Metro's and nodemon's file watchers don't reliably notice edits in this OneDrive-synced folder; restart the dev servers after changes (`npx expo start --web --clear`, `node index.js`).
