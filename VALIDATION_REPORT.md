# Dateza – Validation Report

**Date:** 2026-11-20  **Branch:** `feature/demo-mode`
**Environment:** Windows 11, Node 24, local PostgreSQL 18, Expo web client (`localhost:8082`) + Express backend (`localhost:5001`), tested in the in-app browser (~630×832 viewport).

**Verdict:** The sign-up flow works end to end. The core app works in the browser. Two real bugs were found and fixed. Three issues remain open; the one that matters is that "verification" is not enforced.

---

## 1. Sign-up flow (live backend)

| # | Check | Result |
|---|-------|--------|
| 1 | Submit empty form | PASS – "Please fill in all fields" |
| 2 | Weak password (`weak`) | PASS – "Password does not meet strength requirements" |
| 3 | Password checklist (8 chars / upper+lower / number+symbol / strong) | PASS – all four tick for a strong password |
| 4 | Valid sign-up | PASS – user row created in Postgres, JWT issued, WebSocket connected, app moves to Verify Code |
| 5 | Verify Code screen (4 boxes, auto-advance, resend countdown) | PASS – digits auto-advance; proceeds to profile setup |
| 6 | Birthday step, under-18 date (15/06/2015) | PASS – "You must be at least 18 years old to join Dateza" |

### Backend API checks

| Request | Expected | Actual |
|---------|----------|--------|
| Register, duplicate email | reject | 400 PASS |
| Register, weak password | reject | 400 PASS |
| Register, malformed email (`notanemail`) | reject | **201 – accepted (FAIL)** |
| Login, wrong password | reject | 400 PASS (see note 6) |
| Login, correct credentials | 200 | 200 PASS |
| Discovery without token | 401 | 401 PASS |
| Discovery with forged token | 401/403 | 403 PASS |

## 2. Demo mode (no sign-in / sign-up)

Entry points: **"Try Demo (no sign in)"** button on the welcome screen, or the deep link `/demo`.

| Check | Result |
|-------|--------|
| `/demo` starts a session and lands on the swipe deck | PASS |
| Demo replaces an existing signed-in session cleanly | PASS (a saved QA login was overridden) |
| No backend traffic in demo (0 requests to `:5001` after `/demo` loaded) | PASS |
| Discovery deck shows 9 demo profiles with match % | PASS |
| Like → match screen ("You Got The Match") | PASS (after fixing bug A) |
| "Lets Chat" → send message → simulated reply after ~2.5s | PASS |
| Chats tab lists the match with the message history | PASS |
| Likes You tab (3 profiles), Explore tab (8 profiles), Profile tab | PASS |
| Session and chat survive a page reload | PASS |
| Logout clears `isDemo`, session, matches; returns to sign-in | PASS |
| `tsc --noEmit` | PASS (exit 0) |

Demo data lives in `mobile/lib/demoData.ts`. State uses an `isDemo` flag in the store, so the demo reuses the app's existing offline mock paths for swipes, matches and chat.

## 3. Bugs found and fixed in this branch

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| A | **High** | `/matched` screen crashed on web ("ScrollView child layout (alignItems, justifyContent) must be applied through contentContainerStyle"). Every new match on web would crash. Affects the live backend too, not just demo. | Moved the two properties into `contentContainerStyle` ([matched.tsx](mobile/app/matched.tsx)) |
| B | Medium | Profile → **Logout was hidden under the floating tab bar** and unreachable on a ~830px-high viewport. | Added `paddingBottom: 120` ([profile.tsx](mobile/app/(tabs)/profile.tsx)) |

## 4. Open issues (not fixed)

| ID | Severity | Issue | Suggestion |
|----|----------|-------|------------|
| 1 | **Medium** | **Server does not validate email format.** `POST /api/auth/register` with `notanemail` returns 201 and creates the account. | Validate email (and phone, since the field says "email or phone") server-side. |
| 2 | **Medium** | **OTP verification is simulated.** [verify-code.tsx](mobile/app/auth/verify-code.tsx) accepts any 4 digits. The account is created and a token issued *before* this step, so the screen verifies nothing. "Verified Account" is shown on every profile. | Either implement real email/SMS verification or remove the step and the "Verified" label. |
| 3 | Low | Error banner on Create Account stays visible while the user edits fields (stale "Please fill in all fields"). | Clear `error` on input change. |
| 4 | Low | Wrong-password login returns **400** rather than 401. | Use 401 for failed authentication. |
| 5 | Low | `npm audit`: backend 8 vulnerabilities (1 critical), mobile 40 (1 critical). | Review with `npm audit`; many will be dev-tooling. |
| 6 | Info | `mobile/.env.example` still references a Supabase URL and a commented-out anon key, but the app now uses the Express backend. | Remove the leftovers. |

## 5. Not tested

- Google, Facebook (stub alert only) and Apple sign-in; Google OAuth needs `GOOGLE_CLIENT_ID/SECRET`, which are not configured locally.
- Forgot / reset password flow, change password.
- Rest of the profile-setup wizard (height, language, photos / image picker) with a valid birthday.
- Stories upload, audio/video call screens, notifications screen.
- Real two-user live chat over WebSockets (only the demo's simulated reply was exercised).
- Native iOS / Android builds; only the web build was run.

## 6. Environment notes

- Metro's file watcher did not pick up edits in this OneDrive-synced folder; the dev server needed a restart (`npx expo start --web --clear`) after each change. Moving the project outside OneDrive would likely fix this.
- A second copy of the app (`MY ALL PROJECTS\Dating App`) was already using ports 5000/8081, so this clone runs on **5001 / 8082**.
- Test data left in the local `dateza` database: one account (`qa.tester.20261120@example.com`). The throwaway `notanemail` account created by the validation probe was deleted.
