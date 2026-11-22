# DATEZA — MASTER FULL-STACK IMPLEMENTATION PROMPT

## ROLE AND OBJECTIVE

Act as a Principal Full-Stack Software Engineer, Senior React Native Developer, Backend Architect, Database Engineer, Security Engineer, Product Designer, QA Engineer, and DevOps Engineer.

You are working on an existing project named **Dateza**, a cross-platform dating application.

Your objective is to transform the existing codebase into a complete, secure, reliable, production-ready dating application supporting:

- Web browsers
- Android devices
- iOS devices
- One shared backend
- One shared PostgreSQL database
- Real-time messaging
- Safe dating discovery and matching
- User privacy, moderation, and account management

**This is an existing application, not a greenfield project.**

Do not rebuild it from scratch.

Do not replace working systems unnecessarily.

Preserve the existing visual identity, navigation, technology stack, database relationships, and functioning application workflows.

Your job is to inspect, fix, extend, integrate, test, and document the existing implementation.

Do not stop after producing a development plan. Implement the changes directly in the repository, phase by phase.

---

# 1. EXISTING PROJECT ARCHITECTURE

The existing project uses the following technologies.

### Frontend

- React Native 0.81
- Expo SDK 54
- Expo Router 6
- React 19
- TypeScript
- NativeWind
- Zustand
- Socket.IO Client
- React Native Web
- Expo SecureStore
- AsyncStorage

### Backend

- Node.js
- Express.js
- Socket.IO
- PostgreSQL
- JWT authentication
- bcrypt
- Helmet
- express-rate-limit

### Deployment

- Vercel for the web application
- Render for the backend
- Neon PostgreSQL
- Expo Application Services for mobile builds

First inspect the exact installed versions and repository instructions before modifying dependencies.

Read `AGENTS.md`, which directs developers to the versioned Expo SDK 54 documentation.

Use compatible APIs and dependencies.

Do not upgrade major framework versions without a demonstrated need.

## Important existing files

### Backend

```text
backend/
  index.js
  auth.js
  accountSecurity.js
  session.js
  profiles.js
  swipes.js
  matches.js
  images.js
  media.js
  realtime.js
  db.js
  db_init.sql
  migrations/
  test/
```

### Frontend

```text
mobile/
  app/
    (tabs)/
      index.tsx
      explore.tsx
      likes.tsx
      chat.tsx
      profile.tsx

    auth/
    profile-setup/
    profile/
    call/

    chat-thread.tsx
    matched.tsx
    notifications.tsx
    search.tsx

  lib/
    api.ts
    accountApi.ts
    config.ts
    store.ts
    tokenStore.ts
    types.ts

  components/
  constants/
```

### Deployment

```text
render.yaml
mobile/vercel.json
mobile/eas.json
.github/workflows/ci-cd.yml
```

Treat these paths as starting points, not assumptions that every implementation must remain in one file.

Inspect actual module relationships before editing.

---

# 2. NON-NEGOTIABLE ENGINEERING RULES

Follow all of these requirements.

1. Preserve existing working features and database records.
2. Reuse existing architecture wherever practical.
3. Never silently replace PostgreSQL with Firebase, Supabase, MongoDB, or another database.
4. Maintain one shared backend for web, Android, and iOS.
5. Use reusable, maintainable components and service modules.
6. Do not implement frontend-only security checks.
7. Enforce authentication, authorization, user eligibility, privacy, and moderation in the backend.
8. Use parameterized SQL queries and transactions for multi-step data modifications.
9. Use versioned, backward-compatible database migrations.
10. Never reset or drop production tables to make development easier.
11. Avoid exposing credentials, JWTs, private coordinates, sensitive messages, or personal data in logs.
12. Do not hardcode API credentials or environment secrets.
13. Do not fabricate user profiles, user information, relationships, or verification states.
14. Do not introduce simulated features that appear functional in production.
15. Keep mock/demo accounts isolated from real users.
16. Use accessible components, responsive layouts, and proper loading/error states.
17. Every completed feature must include backend implementation, frontend integration, database changes where necessary, and tests.
18. Never claim a feature is complete if it has not been verified.
19. Do not access, change, or erase production user data without explicit authorization.
20. Do not silently modify live hosting, billing, identity-provider, or app-store accounts.

Preserve existing UI styling unless a design change is needed for consistency, usability, responsiveness, or accessibility.

---

# 3. PHASE 0 — BASELINE ANALYSIS AND PROJECT STABILIZATION

Before implementing new features, inspect the repository.

## Task 0.1 — Understand existing functionality

Trace the following workflows:

- Registration
- Login
- Google authentication
- Email verification
- Forgot password
- Profile onboarding
- Profile editing
- Swipe discovery
- Likes
- Mutual matching
- Chat creation
- Sending messages
- Receiving Socket.IO messages
- Media uploads
- Stories
- Notifications
- Logout
- Web deployment
- Android/iOS configuration

Identify actual backend endpoints, frontend state transitions, database tables, and authorization middleware.

Do not duplicate existing implementations.

## Task 0.2 — Fix baseline problems

Review known audit findings:

- The backend unit-test suite previously ran 21 tests with 19 passing and 2 failing.
- `backend/test/showcase.test.js` expects 12 showcase profiles, while the source contains 16.
- Some profile information is populated using invented defaults.
- Profile UI displays an unconditional verified badge.
- Discovery filters include placeholder logic.
- Audio/video calling screens are not functional.
- Some chat attachment options are mockups.
- Matching expiry behavior is inconsistent.
- The deployment configuration enables a shared demo login.
- The privacy policy includes inaccurate placeholder information.
- Web and mobile deployment state must be independently verified.

Reproduce these issues before modifying them.

Determine whether a test assertion or underlying implementation is incorrect.

Do not weaken tests simply to obtain passing results.

## Task 0.3 — Establish working baseline

Run:

```bash
cd backend
npm ci
npm test
```

Then, from the project root:

```bash
cd mobile
npm ci
npx tsc --noEmit
npm run lint
```

Record the results.

Inspect integration-test configuration without connecting to production services.

Create:

```text
docs/implementation/BASELINE_AUDIT.md
docs/implementation/IMPLEMENTATION_TRACKER.md
```

Record existing features, missing features, confirmed defects, relevant files, and implementation priorities.

---

# 4. PHASE 1 — AUTHENTICATION, ONBOARDING, AND USER ELIGIBILITY

Priority: P0 — Critical.

## 4.1 Secure registration

Improve the existing registration system.

Required functionality:

- Email and password signup
- Strong password validation
- Email uniqueness
- Secure password hashing
- Mandatory real date of birth
- Accurate minimum-age validation
- Verified email ownership
- Terms and Privacy Policy acceptance
- Account status checks
- Safe error handling
- Rate limiting and abuse prevention

For the initial product, dating interactions must be available only to eligible users aged 18 or above.

Calculate age using the full date rather than birth year alone.

Validate impossible dates, leap-year cases, future dates, missing dates, and boundary birthdays.

The backend must enforce eligibility, regardless of what the frontend submits.

Do not assume a submitted birthdate proves someone's identity or age. Document an appropriate age-assurance strategy and escalation process.

## 4.2 Fix invented onboarding information

Inspect:

```text
mobile/app/profile-setup/language.tsx
mobile/app/profile-setup/birthday.tsx
```

Remove incorrect behavior including:

- Name-based gender inference
- Default birthdate `1999-01-01`
- Automatically assumed dating preferences
- Automatically inserted stock profile photos
- Invented height
- Invented biography
- Invented interests

Use real, explicitly selected member information.

Support optional fields using appropriate null/empty values.

Never silently invent personal data.

## 4.3 Improve onboarding workflow

Implement a consistent multi-step onboarding system:

1. Basic account details
2. Email verification
3. Date of birth and eligibility
4. Gender identity
5. Interested-in preferences
6. Relationship intentions
7. Profile photos
8. Interests
9. Biography or profile prompts
10. Discovery preferences
11. Profile review and completion

Support:

- Back/Next navigation
- Input validation
- Save progress
- Resume incomplete onboarding
- Loading indicators
- Validation messages
- Photo upload errors
- Server-confirmed completion

Users with incomplete or ineligible accounts must not access dating interactions.

However, allow them to access appropriate account recovery, profile completion, support, and deletion functionality.

## 4.4 Central backend eligibility middleware

Create reusable authorization checks for:

- Authenticated users
- Eligible adults
- Completed profiles
- Verified contact information
- Active account status
- Non-suspended users

Apply the appropriate checks to discovery, swiping, matching, messaging, stories, and media interactions.

Protect REST and Socket.IO paths.

Do not rely on client-side navigation guards.

## 4.5 Email verification

Reuse existing functionality in:

```text
backend/accountSecurity.js
backend/mailer.js
```

Verify:

- Email delivery configuration
- One-time verification codes
- Code expiry
- Resend cooldowns
- Attempt limits
- Duplicate requests
- Expired codes
- Incorrect codes
- Verification status persistence

Separate:

```text
email_verified_at
phone_verified_at
identity_verified_at
```

Only add fields actually needed by the implemented workflows.

Do not display an identity-verification badge for email verification alone.

## 4.6 OAuth security

Review the existing Google OAuth implementation.

Replace insecure OAuth state handling with cryptographically random, short-lived, server-validated state.

Validate redirect destinations.

Use PKCE where applicable.

Avoid placing bearer authentication tokens in redirect URLs or query strings.

Use a secure one-time authorization-code exchange pattern for native authentication handoff where appropriate.

Preserve supported login methods and test web/native session behavior separately.

Check whether Apple Sign In is required for the intended iOS sign-in configuration and implement it if applicable.

## Acceptance criteria

- Underage users cannot access dating functionality.
- Incomplete profiles cannot bypass onboarding using API calls.
- Verified status accurately reflects the backend.
- Existing email/password authentication continues working.
- OAuth redirects cannot be substituted by arbitrary redirect URLs.
- No invented profile information is saved.
- Existing password reset and logout workflows remain functional.

---

# 5. PHASE 2 — USER SAFETY, BLOCKING, REPORTING, AND MODERATION

Priority: P0 — Critical.

This is mandatory before accepting public dating users.

## 5.1 User blocking

Implement a complete blocking system.

Suggested table:

```text
user_blocks
-----------
id
blocker_id
blocked_id
reason_code
created_at
```

Requirements:

- Block another user.
- Unblock a user.
- View blocked users.
- Prevent duplicate block records.
- Prevent self-blocking.
- Immediately enforce block relationships.
- Prevent blocked users from messaging each other.
- Remove blocked profiles from discovery in both directions.
- Prevent new swipes and matches.
- Prevent exposure through likes and match recommendations.
- Prevent blocked-user stories from appearing.
- Restrict access to protected chat and media resources.
- Disconnect or invalidate relevant real-time room access.

Enforcement must work even if a malicious client directly calls backend APIs.

Blocking must not allow users to discover whether another user has blocked them through detailed error messages.

## 5.2 Reporting system

Build in-app reporting for:

- User profiles
- Chat messages
- Profile photos
- Stories
- Harassment
- Threats
- Spam
- Fake profiles
- Impersonation
- Inappropriate content
- Suspected underage accounts

Suggested table:

```text
user_reports
------------
id
reporter_id
reported_user_id
subject_type
subject_id
category
description
status
created_at
updated_at
```

Validate ownership, access, target existence, and report category.

Prevent report spam.

Allow authorized moderators to review restricted evidence safely.

Reporting must not automatically notify the reported user of the reporter's identity.

## 5.3 Unmatch feature

Implement:

```text
DELETE /api/matches/:id
```

Or use the repository's existing API convention.

Unmatching should:

- Terminate the active dating connection.
- Prevent future messages through the old match.
- Update the match list.
- Update active Socket.IO rooms.
- Invalidate further message sends.
- Define clearly how rematching works.
- Handle historical messages according to privacy, safety, and evidence-retention policies.

Unmatch must not be treated as identical to blocking or account deletion.

## 5.4 Admin moderation dashboard

Build a separate, protected moderation interface.

Suggested functionality:

- Secure staff login
- Role-based authorization
- MFA for privileged accounts
- User search
- Report inbox
- Report detail pages
- Review evidence
- Warning actions
- Temporary suspension
- Permanent ban
- Content removal
- Appeals handling
- Moderation history
- Audit logs
- Abuse metrics

Suggested tables:

```text
admin_roles
moderation_cases
moderation_actions
audit_events
```

Normal users must never access admin endpoints.

Never rely only on hiding admin navigation links.

## 5.5 Automated safety checks

Introduce safeguards for:

- Excessive likes
- Repetitive spam messages
- Mass account creation
- Suspicious upload activity
- Repeated reports
- Harassing content
- Impersonation indicators
- Potentially abusive images

Use automated moderation as a triage mechanism, not as an unquestionable source of truth.

Provide human review for serious enforcement decisions.

## Acceptance criteria

- Blocking works through REST and Socket.IO.
- Existing open chats cannot bypass blocks.
- Reported content can be reviewed securely.
- Moderator actions are audited.
- Suspended users cannot use dating features.
- Ordinary users cannot access the moderation dashboard.
- Reporter privacy is protected.

---

# 6. PHASE 3 — PROFILE MANAGEMENT AND DISCOVERY

Priority: P1, with critical privacy fixes treated as P0.

## 6.1 Complete profile management

Improve:

```text
mobile/app/(tabs)/profile.tsx
mobile/app/profile/edit-profile.tsx
backend/profiles.js
```

Add or complete:

- Profile picture upload
- Multiple photos
- Photo rearranging
- Photo deletion
- Biography
- Profile prompts
- Interests
- Languages
- Relationship intentions
- Gender and dating preferences
- Profile completion indicators
- Profile visibility controls
- Pause discovery
- Hide approximate distance
- Verified status indicators based on real checks

Use database persistence rather than local-only state.

## 6.2 Fix precise location disclosure

Do not expose raw coordinates of other members.

Review:

```text
backend/profiles.js
```

Remove other users' raw latitude and longitude from public discovery API responses.

Store location privately where necessary and consented to.

Calculate approximate distance on the backend.

Return privacy-safe display values such as:

```json
{
  "city": "Colombo",
  "distance_label": "Around 10 km away"
}
```

Do not expose an unnecessarily precise distance that enables location triangulation.

Provide location permission and visibility controls.

The application should remain usable when a member declines precise location access, using safe alternatives.

## 6.3 Real discovery filters

Replace placeholder frontend filtering with real backend filtering.

Support:

- Minimum age
- Maximum age
- Maximum approximate distance
- Gender preferences
- Reciprocal dating preferences
- Relationship intentions
- Recently active profiles
- New profiles
- Completed profiles only
- Visible profiles only
- Eligible adults only
- Non-suspended accounts only
- Exclusion of blocked accounts
- Exclusion of already dismissed profiles as appropriate

Use indexed and parameterized PostgreSQL queries.

Add pagination or cursor-based fetching.

Prevent unnecessary loading of every profile into client memory.

## 6.4 Reciprocal compatibility

The recommendation system must consider the preferences of both participants.

For example, User A should not be shown User B solely because User B matches A's filters when A is outside B's eligible preferences, unless the product explicitly defines otherwise.

## 6.5 Matching score corrections

Inspect the existing interest-based compatibility calculation.

Fix cases where the calculated percentage can exceed 100%.

Use a deterministic, documented scoring method.

If compatibility is displayed as a percentage, clearly define what that percentage means.

Do not imply that a heuristic score scientifically predicts relationship success.

Optional scoring factors:

- Shared interests
- Relationship intentions
- Compatible stated preferences
- Approximate location
- Optional profile prompts

Never use sensitive attributes for hidden discriminatory profiling.

## Acceptance criteria

- Nearby is based on real distance calculations.
- New profiles are genuinely ordered or filtered by creation time.
- Discovery is privacy-safe.
- Blocked and suspended users never appear.
- Search respects server-side constraints.
- Match scores are bounded and consistently computed.
- Profile visibility settings are enforced.

---

# 7. PHASE 4 — MATCHING AND REAL-TIME CHAT

Priority: P0/P1.

Preserve the existing Socket.IO and PostgreSQL messaging foundation.

## 7.1 Matching lifecycle

Inspect:

```text
backend/swipes.js
backend/matches.js
```

Maintain:

- Like
- Pass
- Super-like where supported
- Mutual match creation
- Match listing
- Likes-you functionality

Add:

- Reliable match state
- Unmatch
- Block awareness
- Match status checks
- Duplicate prevention
- Transactional mutual match creation
- Concurrent swipe handling

Review existing `expires_at` usage.

The current implementation stores match expiry information without consistently enforcing it.

Choose one explicit product rule:

- Persistent matches; or
- Time-limited matches with accurately enforced expiry.

For Dateza V1, prefer persistent matches unless the product already has a deliberate expiry concept that users understand.

Do not silently expire conversations.

## 7.2 Secure real-time messaging

Maintain existing Socket.IO functionality.

Ensure:

- Only authorized match participants can read messages.
- Only active eligible matches can send messages.
- Blocked users cannot send or receive further messages.
- Unmatched users cannot continue conversations.
- Suspended accounts lose message access.
- Message sends are validated in the backend.
- Duplicate client send events do not create duplicate messages.
- Chat reconnects correctly after network loss.
- Messages remain available after app restart according to retention policy.
- Message ordering is reliable.
- Read receipts are consistent.
- Pagination works correctly.

## 7.3 Complete chat features

Implement or finish:

- Text messaging
- Image messaging
- Typing indicators
- Message timestamps
- Read receipts
- Message reporting
- Message deletion behavior
- Attachment loading states
- Retry failed messages
- Offline handling
- Network reconnect handling
- Chat empty states
- Block/report/unmatch menu

Optional after core stability:

- Voice messages
- Reactions
- Reply to message
- Message search

Do not introduce features that conflict with the existing chat protocol without updating all clients.

## 7.4 Media access authorization

Verify every private attachment request.

A user must not be able to retrieve an unrelated private image merely by guessing or obtaining its media identifier.

Protect media API endpoints independently from the UI.

Consider revoked permissions after blocks, unmatches, suspensions, and account deletion.

## 7.5 Local data protection

Review:

```text
mobile/lib/store.ts
mobile/lib/tokenStore.ts
```

The existing application persists sensitive client state.

Minimize storing private chat data in unencrypted AsyncStorage.

Prefer in-memory state for unnecessary caches and suitable secure storage for sensitive retained information.

Ensure cached information is cleared or separated correctly across logout, account changes, and deletion.

Preserve existing native SecureStore and web cookie behavior unless security improvements require changes.

## Acceptance criteria

- Two users can match and communicate reliably.
- A third user cannot access their conversation.
- Blocking immediately prevents messaging.
- Reconnection does not duplicate messages.
- Message history follows documented retention rules.
- Web, Android, and iOS clients use consistent message contracts.

---

# 8. PHASE 5 — NOTIFICATIONS AND BACKGROUND OPERATIONS

Priority: P1.

Implement a real notifications system.

## 8.1 Persistent notifications

Suggested table:

```text
notification_events
-------------------
id
user_id
type
title
body
related_entity_id
is_read
created_at
```

Support:

- New match
- New message
- New like where product rules allow
- Account security events
- Verification updates
- Moderation and support events where appropriate

Avoid duplicate notifications.

## 8.2 Mobile push notifications

Implement platform-compatible push notifications using Expo push infrastructure or an appropriate FCM/APNs integration.

Requirements:

- Device token registration
- Token refresh
- Token removal on logout
- Notification permissions
- Background push delivery
- Retry and failure handling
- Invalid-token cleanup
- Notification preferences
- Notification tap navigation
- Quiet hours if included in product settings

Never include unnecessarily sensitive message content in push notifications.

Never send a dating or message notification that violates block, privacy, or account-status rules.

## 8.3 Web notifications

Implement an appropriate in-app notification experience for web.

Browser push notifications may be implemented when the platform, hosting, permissions, and service-worker architecture support them.

Do not assume that native Expo push automatically implements browser push.

## 8.4 Background jobs

Create appropriate background processing for:

- Notification delivery
- Email delivery
- Expired story cleanup
- Deleted media cleanup
- Moderation processing
- Token cleanup
- Account deletion processing

Use a reliable mechanism that works with the intended hosting environment.

Do not rely on in-memory background jobs for critical tasks if the deployed service may restart or sleep.

## Acceptance criteria

- New match notifications are persistent.
- Offline users can receive supported mobile push notifications.
- Invalid push tokens are handled.
- Notification preferences are respected.
- Blocked or deleted accounts do not generate inappropriate notifications.
- In-app notification history remains consistent.

---

# 9. PHASE 6 — PRIVACY, ACCOUNT SETTINGS, AND ACCOUNT DELETION

Priority: P0/P1.

## 9.1 Complete privacy settings

Add:

- Pause discovery
- Profile visibility
- Approximate distance visibility
- Notification preferences
- Blocked users management
- Privacy policy
- Terms of service
- Community guidelines
- Report a problem
- Account data export
- Account deletion

All settings must persist correctly on the backend.

## 9.2 Account deletion

Implement a secure self-service deletion workflow.

Requirements:

1. User opens account settings.
2. User chooses Delete Account.
3. Display the consequences clearly.
4. Require appropriate reauthentication.
5. Confirm deletion intent.
6. Immediately disable or hide the dating account.
7. Revoke active sessions and Socket.IO access.
8. Process deletion or anonymization according to documented retention rules.
9. Handle profile images, matches, messages, stories, notification tokens, and caches.
10. Preserve only legally necessary or justified safety records for documented periods.

Add an accessible public account-deletion request page for store compliance.

Never perform destructive cascading deletion without reviewing schema dependencies and retention obligations.

## 9.3 Data export

Add a protected workflow for exporting personal data.

Include appropriate profile, preference, account, and user-generated information.

Do not include another user's private information beyond what the requesting user is authorized to receive.

Use authenticated, temporary, secure downloads.

## 9.4 Policy and consent

Replace inaccurate placeholder privacy information.

Create or update:

- Privacy Policy
- Terms of Service
- Community Guidelines
- Account deletion explanation
- Data retention explanation
- User safety guidance

Policies must describe actual application behavior.

Do not invent legal compliance claims or publish a fictional effective date.

Mark text requiring legal review clearly.

Store policy version and acceptance timestamps.

## Acceptance criteria

- Users can manage discovery visibility.
- Users can view and manage blocked accounts.
- Data export is authenticated.
- Account deletion works end to end.
- Deleted accounts cannot authenticate.
- Policies accurately reflect implemented data handling.

---

# 10. PHASE 7 — MEDIA, STORIES, AND CONTENT SECURITY

Priority: P0/P1.

Inspect:

```text
backend/images.js
backend/media.js
```

## 10.1 Secure profile photos

Implement:

- Server-side file type validation
- Image size limits
- Image dimension limits
- Safe image processing
- EXIF/GPS metadata removal
- Optimized image formats
- Thumbnail generation where appropriate
- Ownership validation
- Photo deletion
- Media cleanup
- Abuse reporting
- Moderation status
- Safe image delivery

Consider object storage instead of storing unlimited binary content inside PostgreSQL.

Preserve existing media access contracts during migration.

## 10.2 Stories

Improve existing ephemeral stories.

Required features:

- Upload
- View
- Expiry
- Delete own story
- Report story
- Restrict blocked users
- Restrict suspended accounts
- Control visibility
- Enforce media permissions
- Cleanup expired data

Determine a clear story audience policy, such as matches-only by default.

Avoid exposing private stories globally without informed user consent.

## 10.3 Chat attachments

Replace simulated attachment actions with real implementations or remove them from production UI.

No placeholder message should pretend that a real image, location, voice note, or other attachment was sent.

## Acceptance criteria

- Files are safely validated.
- Metadata does not expose exact location.
- Media ownership is enforced.
- Story visibility is enforced.
- Expired stories cannot be accessed through old URLs.
- Suspended accounts cannot upload content.
- Failed uploads have clear recovery behavior.

---

# 11. PHASE 8 — PROFESSIONAL UI/UX IMPROVEMENTS

Improve the existing interface without redesigning Dateza into a different product.

## Design rules

- Preserve Dateza branding.
- Preserve existing primary colors unless inconsistent.
- Maintain consistent typography.
- Maintain reusable spacing rules.
- Use consistent borders and component styles.
- Support small and large screens.
- Respect safe areas.
- Support keyboard avoidance.
- Support accessible touch targets.
- Include appropriate screen-reader labels.
- Support reduced-motion preferences where feasible.

## Screens to improve

### Authentication
- Signup
- Login
- Password reset
- Verification
- Errors and loading states

### Onboarding
- Progress indicators
- Clear input descriptions
- Selection states
- Validation messages
- Resume workflow

### Discovery
- Responsive profile cards
- Filter panel
- Empty state
- Loading state
- Swipe feedback
- Better profile details

### Matches
- Match celebration
- Match list
- Unmatch confirmation
- Safety controls

### Chat
- Message bubbles
- Media previews
- Sending states
- Retry states
- Typing indicators
- Context menus
- Report/block/unmatch actions

### Profile and settings
- Editable profile fields
- Privacy controls
- Account management
- Verification indicators
- Help and support

### Admin dashboard
- Report tables
- Filters
- User detail panel
- Moderation actions
- Audit history

## UX requirements

Never display false account verification.

Do not show clickable actions that are secretly nonfunctional.

Use clear empty states, confirmations, and recoverable error messages.

Avoid excessive animations that reduce usability.

Do not remove accessibility to achieve visual effects.

---

# 12. PHASE 9 — PRODUCTION DEPLOYMENT AND CROSS-PLATFORM FIXES

Priority: P1.

The target architecture is:

```text
        Dateza Web
         (Vercel)
             |
        HTTPS REST
             |
       Express API
         (Render)
             |
        PostgreSQL
          (Neon)
             |
      Shared backend
         /       \
    Android       iOS
       Expo / EAS Builds
```

Socket.IO must use the appropriate real-time connection configuration.

## 12.1 Environment configuration

Maintain separate configurations for:

```text
development
staging
production
```

Review:

```text
mobile/lib/config.ts
mobile/vercel.json
render.yaml
mobile/eas.json
```

The frontend must use correct backend URLs in all environments.

Preserve the existing same-origin web API approach where appropriate.

Ensure:

- Secure web session cookies
- Correct cookie SameSite/Secure behavior
- CSRF protection for cookie-authenticated state changes
- Correct CORS configuration
- Native bearer-token handling
- Correct WSS connections
- Safe socket authentication
- Correct logout and session expiry
- Secure production environment variables

Never expose backend secrets through `EXPO_PUBLIC_*` variables.

## 12.2 Secret management

The uploaded project archive previously contained a backend environment file.

Inspect secret-handling practices without printing credential values.

Ensure:

- `.env` files are ignored.
- Production credentials are not included in exported archives.
- Secrets are not exposed in Git history or logs.
- Exposed credentials are identified for rotation.
- Development and production databases are separated.

Do not rotate live credentials without authorization.

## 12.3 Demo environment isolation

Review the existing:

```text
DEMO_LOGIN_ENABLED
```

setting.

Disable shared demo authentication in the real consumer production environment.

If demo functionality is needed for a portfolio, use a separate isolated demo environment and data set.

Demo users must not mix with real dating accounts.

## 12.4 Backend reliability

Implement or improve:

- Liveness and readiness checks
- Structured error logging
- Monitoring
- Alerting
- Graceful shutdown
- Database connection pooling
- Safe schema migrations
- Backup procedures
- Restore testing
- Retry handling
- Database indexes
- Abuse rate limits

Review Socket.IO scalability before deploying multiple backend instances.

## 12.5 Web compatibility

Test:

- Chrome
- Firefox
- Safari
- Responsive layouts
- Session refresh
- Browser storage behavior
- Media loading
- Cookie authentication
- Socket reconnects
- Redirects
- OAuth flow
- Account deletion

## 12.6 Mobile compatibility

Test on real Android and iOS devices where available.

Verify:

- Login and session restoration
- Notifications
- Camera and photo permissions
- Media uploads
- Deep links
- Keyboard behavior
- App background/resume
- Network loss and recovery
- Socket.IO reconnection
- Logout and account switching

Do not claim a native build has been tested unless it actually ran.

## 12.7 Store readiness

Review current official Apple App Store and Google Play requirements before submission.

Prepare:

- Accurate privacy disclosures
- Correct age suitability
- Functional account deletion
- User reporting
- User blocking
- Moderation operations
- Permission descriptions
- Store screenshots
- App metadata
- Test credentials where required
- Support contact
- Privacy policy URL

Do not claim store approval before review.

---

# 13. PHASE 10 — ADVANCED FEATURES AFTER MVP STABILITY

Priority: P2/P3.

Implement these after all critical safety requirements and core workflows are functional.

## 13.1 Voice messaging

Implement actual:

- Audio recording
- Recording preview
- Upload
- Playback
- Duration display
- Permissions
- Failed-upload recovery
- Media access authorization
- Reporting and retention controls

Use platform-compatible libraries for the installed Expo version.

## 13.2 Audio and video calling

The current project contains visual calling screens but no complete working call system.

For real calling, implement:

- WebRTC media streams
- Authenticated signaling
- Offer/answer negotiation
- ICE candidates
- STUN/TURN configuration
- Incoming call requests
- Accept/reject
- Call timeout
- Microphone mute
- Camera enable/disable
- Speaker controls where supported
- Call termination
- Connection failure handling
- Blocking enforcement
- Call permissions and privacy safeguards

Validate compatibility with Expo development builds, web, and native platforms.

Do not pretend that Expo Go supports functionality requiring unsupported native modules.

If provider infrastructure or platform builds are unavailable, leave calls disabled and document the verified blocker rather than showing fake functional buttons.

## 13.3 Profile/photo verification

Implement a clear verification process.

Possible approaches include:

- User-submitted selfie
- Liveness checks through an appropriate provider
- Photo/profile comparison by an authorized verification service
- Human review where needed

Do not retain biometric data unnecessarily.

Implement clear consent, retention, and appeal policies.

Never label a member identity-verified unless a genuine verification process succeeded.

## 13.4 Premium subscriptions

Design optional premium functionality only after free dating workflows are complete.

Possible features:

- Additional discovery preferences
- More likes
- Profile boosts
- Premium discovery tools

Ensure blocking, reporting, account deletion, privacy, and basic safety features remain available to all users.

Implement verified server-side subscription entitlements.

Use appropriate platform billing systems and receipt/transaction validation.

Never use client-only premium entitlement checks.

Do not process real payments without approved product decisions and valid provider configuration.

---

# 14. DATABASE IMPLEMENTATION RULES

Use the existing PostgreSQL architecture.

Do not replace the current application schema.

Inspect:

```text
backend/db_init.sql
backend/migrations/
backend/db.js
```

The current repository also includes an older Supabase-style schema file under:

```text
mobile/db/schema.sql
```

Do not mistakenly deploy that schema instead of the actual backend schema.

Identify the authoritative schema and document it.

Create additive migrations for new capabilities.

Suggested new tables:

```text
user_preferences
user_blocks
user_reports
moderation_cases
moderation_actions
notification_events
device_tokens
privacy_consents
account_deletion_requests
admin_roles
audit_events
media_assets
```

Do not create duplicate tables when an existing model can be extended safely.

Add appropriate:

- Primary keys
- Foreign keys
- Unique constraints
- Indexes
- Timestamps
- Check constraints
- Ownership relationships
- Deletion and retention behavior

Review existing records and referential integrity before migrating.

Provide a safe rollback or recovery strategy for each migration.

---

# 15. API DESIGN REQUIREMENTS

Reuse existing endpoints wherever possible.

Introduce new endpoints only where necessary.

Possible additions:

```text
GET    /api/preferences
PUT    /api/preferences

GET    /api/safety/blocks
POST   /api/safety/blocks
DELETE /api/safety/blocks/:userId

POST   /api/safety/reports
GET    /api/safety/reports/me

DELETE /api/matches/:id

GET    /api/notifications
PATCH  /api/notifications/:id/read
PUT    /api/notification-preferences

POST   /api/devices
DELETE /api/devices/:id

PATCH  /api/profiles/me
POST   /api/profiles/me/pause

GET    /api/account/export
DELETE /api/account

GET    /api/admin/reports
GET    /api/admin/reports/:id
POST   /api/admin/reports/:id/actions
```

These are proposed API contracts, not necessarily existing routes.

Check repository conventions and authentication mechanisms before choosing final paths.

For every endpoint:

- Validate inputs.
- Authenticate when required.
- Authorize the requested operation.
- Enforce age, block, moderation, and privacy rules.
- Return consistent error responses.
- Avoid leaking private data.
- Apply appropriate rate limits.
- Add automated tests.
- Document request/response shapes.

---

# 16. TESTING REQUIREMENTS

A feature is not complete without appropriate verification.

## Unit tests

Cover:

- Age calculation
- Profile validation
- Preference filtering
- Compatibility scoring
- Block logic
- Notification preferences
- Authorization helpers

## Integration tests

Cover:

- Registration
- Email verification
- Onboarding completion
- Profile discovery
- Matching
- Message persistence
- Blocking
- Reporting
- Unmatching
- Account deletion
- Notification events

## Security tests

Verify:

1. An underage user cannot access dating features.
2. Incomplete accounts cannot bypass onboarding.
3. User C cannot access the private chat between Users A and B.
4. Blocking prevents new messages and access to restricted media.
5. Blocking is enforced even after socket reconnection.
6. Suspended users cannot continue activity using existing tokens.
7. Non-admin users cannot access admin APIs.
8. Private locations never appear in public API payloads.
9. Invalid media files are rejected.
10. OAuth redirect manipulation is rejected.
11. Deleted accounts cannot restore active sessions.
12. Concurrent swipes do not generate duplicate matches.
13. Notification retries do not create inconsistent duplicate records.

## Cross-platform E2E tests

Test the complete workflow:

```text
Register
   ↓
Verify email
   ↓
Complete onboarding
   ↓
Configure preferences
   ↓
Discover another user
   ↓
Like profile
   ↓
Mutual match
   ↓
Open conversation
   ↓
Send message
   ↓
Receive notification
   ↓
Unmatch / Block / Report
   ↓
Manage privacy
   ↓
Delete account
```

Perform this using separate test accounts.

Validate across web and supported native environments.

Do not rely only on mocked frontend tests.

## Final quality commands

Run the supported commands:

```bash
cd backend
npm test
npm run test:integration
```

Run integration suites only against an explicitly isolated test database.

Then, from the project root:

```bash
cd mobile
npx tsc --noEmit
npm run lint
```

Also run appropriate build, E2E, security, and smoke tests when the required environment is available.

Report exact passing and failing results.

---

# 17. IMPLEMENTATION WORKFLOW

Work in the following order.

### Step 1 — Inspect

Read relevant source files and understand existing behavior.

### Step 2 — Plan

Write a task checklist with impacted files, data migrations, security considerations, and acceptance tests.

### Step 3 — Implement

Make actual source-code changes.

Do not stop after writing pseudocode or recommendations.

### Step 4 — Integrate

Connect frontend components to real backend APIs and persistent data.

### Step 5 — Test

Run relevant unit, integration, and available platform tests.

### Step 6 — Fix

Address regressions and errors introduced by the change.

### Step 7 — Document

Update architecture, environment, deployment, and feature documentation.

### Step 8 — Continue

Proceed to the next phase without discarding the working changes.

Maintain a durable implementation tracker so work can resume correctly across coding sessions.

If an external credential, paid service, platform account, or production authorization is missing, complete the safe local implementation and document the exact remaining integration requirement.

Never replace unavailable infrastructure with fake functionality presented as production-ready.

---

# 18. REQUIRED DOCUMENTATION OUTPUT

Maintain:

```text
docs/
  implementation/
    BASELINE_AUDIT.md
    IMPLEMENTATION_TRACKER.md
    ARCHITECTURE.md
    API_REFERENCE.md
    DATABASE_MIGRATIONS.md
    SECURITY_CHECKLIST.md
    TEST_REPORT.md
    DEPLOYMENT_GUIDE.md
    RELEASE_CHECKLIST.md
    KNOWN_LIMITATIONS.md
```

Update the existing README and deployment documentation when behavior changes.

Do not add redundant documentation that contradicts the application.

For each implementation phase, report:

1. Features completed.
2. Files modified.
3. Database migrations added.
4. API endpoints implemented.
5. Frontend screens updated.
6. Tests run and their exact results.
7. Security concerns addressed.
8. Remaining blockers.
9. Next implementation phase.

Use statuses:

```text
COMPLETE
PARTIALLY COMPLETE
BLOCKED
NOT STARTED
```

Do not mark partially working functionality as complete.

---

# 19. FINAL DEFINITION OF DONE

The application is ready for a public dating MVP only when:

- Registration works securely.
- Adult-only eligibility is enforced.
- Members provide authentic profile information.
- Verified status is truthful.
- Profile discovery respects preferences.
- Precise location privacy is protected.
- Swiping creates valid mutual matches.
- Matching and unmatching work correctly.
- Real-time chat works reliably.
- Blocking prevents unwanted contact.
- Reporting and moderation are functional.
- Mobile push notifications work in supported environments.
- Media access is authorized.
- Account deletion works.
- Privacy settings work.
- Admin access is restricted and audited.
- Backend APIs are protected.
- Relevant automated tests pass.
- Web and native user journeys have been tested.
- Production monitoring and backups are configured and verified.
- Deployment documentation reflects the actual system.
- App-store and legal requirements have been reviewed before public launch.

Do not describe the product as production-ready until these conditions are actually satisfied.

Advanced calls and subscriptions are separate release features and must not delay critical safety fixes.

---

# 20. START IMPLEMENTATION NOW

Begin by examining the actual repository.

1. Read `AGENTS.md` and the existing project documentation.
2. Inspect backend, frontend, database, tests, and deployment configuration.
3. Establish the current test baseline.
4. Create the implementation tracker.
5. Identify the smallest safe changes required for Phase 1.
6. Implement Phase 1, including code, database changes, UI integration, and automated tests.
7. Continue through the remaining phases in priority order.

Use the repository itself as the source of truth.

Avoid unnecessary refactoring.

Protect existing functionality.

Do not invent test results or claim that unavailable external integrations have been validated.

**Your objective is not to create another demo. Your objective is to turn the existing Dateza codebase into a secure, maintainable, fully integrated, cross-platform dating product.**
