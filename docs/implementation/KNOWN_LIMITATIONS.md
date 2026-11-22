# Dateza — Known limitations

Status after Phase 0 (2026-11-22). Each item is something verified in the repository or by running it. "Planned" points to the task in `IMPLEMENTATION_TRACKER.md`. This list shrinks as phases land; do not describe Dateza as production-ready while the safety items below are open.

## A. Safety and product gaps (the reason the app is not launch-ready)

Fixed in Phase 1 and no longer limitations: age/eligibility gating (REST and sockets), invented onboarding data, unenforced e-mail verification, Google sign-in token in the URL, the placeholder policy's fictional date.

- **No blocking, reporting, unmatch, moderation or admin tools**, and nothing calls `accountStatus.setAccountStatus` yet. Suspended or banned members cannot sign in and have **no appeal channel**. Planned: Phase 2.
- **Age is self-declared.** A minor can type an adult date. Layers that reduce this are in `SECURITY_CHECKLIST.md` §7; identity/age verification is Phase 10.
- **Sockets stay open** if a member's eligibility is lost by a direct database edit (only `setAccountStatus` closes them). Planned: Phase 2.
- **Apple Sign In is missing** (BLOCKED, needs an Apple developer account). It is required on iOS if Google sign-in is offered. The Facebook/Apple placeholder buttons were removed.
- **Google sign-in on the web app is not available** (the app says so); the server supports it. The native flow has not been run on a device or against real Google.
- **Real e-mail delivery (Resend) is untested.** Production now refuses to start without `RESEND_API_KEY` and `MAIL_FROM` — the next production deploy needs them.
- **Policy texts are drafts** (version label `draft-1`, no effective date) and need legal review; no re-acceptance flow, no deletion, no data export. Planned: Phase 6.
- Real, consented distance and discovery filters are not built (P3). The "New" chip in Explore still does not filter. Stored legacy coordinates are not exposed but not cleared.
- Uploaded images are not re-encoded (EXIF/GPS survives) and there is **no content moderation of any kind**; profile images are public by id; stories are visible to every eligible member. Planned: Phase 7.
- Matches carry an `expires_at` that nothing enforces (effectively permanent, matching decision Q1). Planned: Phase 2/4.
- The match percentage can exceed 100 % (shared interests × 20). Planned: P3-02.
- Notifications are built on the client from stored data; no push, no persistence. Planned: Phase 5.
- Chat messages are cached in plaintext AsyncStorage (Phase 4). The edit-profile screen still pre-selects "male/female" when a value is empty (Phase 3).
- Manual e2e scripts `backend/test/chat.e2e.js` / `images.e2e.js` now use the real sign-up + onboarding API. They need a server with `REQUIRE_EMAIL_VERIFICATION=false` (development only); `npm run test:e2e` starts one on a throwaway database. They are not part of CI.

## B. UI that Phase 0 disabled or removed (not "broken": deliberately unavailable)

| Before | Now |
|---|---|
| "Verified Account" under every name | Shows the account email only; no badge until real verification exists |
| Attachment sheet: Document / Audio / Contact, and a "Send Mock" path that posted placeholder messages | Only Camera and Gallery remain |
| Phone/Video buttons in the chat header, `/call/audio` and `/call/video` screens | Hidden; the routes redirect to the chat list (`FEATURES.calls = false` in `mobile/lib/features.ts`) |
| Microphone icon in the chat input ("coming soon" alert) | Hidden (`FEATURES.voiceMessages = false`) |
| Profile menu "Notifications" and "Language" showing a fake alert | Dimmed and labelled "Not available yet" ("Notification settings"); not pressable |
| Edit-profile: editable email and a pre-filled fake phone number, neither saved | Email shown read-only; phone field removed |
| Swipe-card three-dot "Report or Share" alert | Removed |

Existing `location`-kind chat messages (if any exist in a database) still render; no UI can create new ones.

**Observed but intentionally left alone (outside the listed Phase 0 items):** `mobile/app/search.tsx` draws its own on-screen keyboard whose "123", emoji and microphone keys and per-row "…" buttons do nothing; stories offer "preset" and "paste a URL" options (`mobile/app/(tabs)/index.tsx`) — whether pasted URLs go through the secure upload path was not verified. Both belong to the Phase 8 UI pass / Phase 7.

## C. Demo and fixture isolation

- The 16 showcase profiles and the three older mock profiles are seeded **only into a local, non-production database** (Phase 0 guard). On such a database they have `is_demo = false`, so a developer's test account sees them in discovery as if they were members. Setting `is_demo = true` on them is **not** a safe fix: `backend/demo.js` deletes every `is_demo` profile that is not one of the two live-demo personas. Proper isolation needs an explicit fixture flag (schema change, Phase 1/3). Their ids (`seed-showcase-*`), reserved e-mail domain (`@dateza.local`), random unusable passwords and bundled photo paths are asserted by `backend/test/showcase.test.js`.
- The offline demo in the app uses its own ids (`demo-showcase-*`) and never talks to the backend.
- `backend/public/profiles/tessa.png` is an **orphan**: it exists only in the backend folder and no catalog entry references it. It was kept (nothing is deleted without approval); `showcase.test.js` lists it in `KNOWN_ORPHAN_PHOTOS` and fails if the situation changes. Recommended: either add a "tessa" catalog entry plus `mobile/assets/profiles/tessa.png` and a loader line (an owner decision about a new fictional person and an AI-generated photo), or delete the file after approval.
- The mock-profile seeder still creates three accounts with the known password `password123` on local databases (`backend/db.js`, `seedMockProfiles`); acceptable only because it is now refused on hosted databases. Planned: P9-01 (explicit `SEED_DEV_DATA`).
- The production blueprint now sets `DEMO_LOGIN_ENABLED: "false"` and the backend ignores `DEMO_LOGIN_ENABLED=true` in production unless `DEMO_ENVIRONMENT=isolated` (Release Gate A, P1-00b) — **in the working tree only; not deployed**, so a live service keeps whatever it runs now until the owner deploys. Whether fake profiles or demo rows exist in the live database is **unknown**; see `PRODUCTION_CLEANUP_RUNBOOK.md`. The two demo accounts, if present in a database, are left in place.

## D. Migrations 004 and 005

Retired: archived to `backend/ops/local-dev-cleanup/` (content unchanged), never read by the migration runner, numbers reserved. Hosted data is cleaned only by the owner through `PRODUCTION_CLEANUP_RUNBOOK.md`. See `DATABASE_MIGRATIONS.md` §3.1.

## E. Reliability and scale

- Socket.IO, single-use socket tickets and presence counts live in process memory: run **one** backend instance. Planned: P9-06.
- Background work is an in-process `setInterval` (media expiry, every 30 s). On Render's free plan the service sleeps; nothing reliable runs while asleep. Planned: P5-01.
- Production monitoring, alerting, backups and restore drills are not set up or verified. Planned: Phase 9.
- Rate limiting is per IP (and per email+IP for failed logins); no per-account limits. Planned: P2-11.
- Profile and chat photos live in PostgreSQL (`BYTEA`); videos are accepted for stories (25 MB, 60 s) without any processing. Decision Q11 says video stories stay disabled until secure processing exists — **this is not yet enforced in code**; planned P7-07.

## F. Verification gaps

- No native (Android/iOS) build, device or push test has been run; nothing here claims native compatibility. The Phase 1 onboarding flow was driven only on the **web** build against a local backend (photo upload through the API because a file picker cannot be automated). Web behaviour was checked only on the Expo development server in the in-app browser and by a successful static export.
- No Chrome/Firefox/Safari matrix, no responsive audit, no screen-reader pass.
- Email delivery (Resend) and real Google OAuth are untested.
- The chat attachment sheet, `chat-thread.tsx` changes and the story timer change were checked by type-check and lint only; they were not exercised interactively (the offline demo has no conversations to open).
- There are no mobile unit tests and no end-to-end tests. Planned: see the test strategy in `IMPLEMENTATION_PLAN.md` §5.
- Phase 0 and Release Gate A ran on Node v24.16.0. **In Phase 1 the backend unit and integration suites, `tsc`, lint and the web export were also run under Node 22.23.5** (obtained through npm) and passed; the GitHub workflow itself has still not run.

## G. Dependency vulnerabilities

Reported, not fixed (fixing needs breaking upgrades, which Phase 0 forbids). Numbers and details are in `TEST_REPORT.md` and `PHASE_00_COMPLETION_REPORT.md`: mobile has 1 critical and 17 high advisories in production dependencies (Expo/React Native tooling and client libraries); backend has 2 moderate (`express`/`qs`).
