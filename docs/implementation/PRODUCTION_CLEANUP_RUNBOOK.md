# Production data cleanup — runbook (PREPARED ONLY, NOT EXECUTED)

**Status:** written during Phase 0 (updated in Phase 1 for the archived migrations) under owner decision Q7 ("prepare a runbook only"). **Nothing in this document has been run.** No production, staging or hosted database was contacted while preparing it; the row lists below come from the source code, not from live data. **The owner executes this, deliberately, after reviewing it.**

**Purpose:** remove fictional/seeded accounts and the shared demo login from a hosted Dateza environment so real members never see fake people, and so the application can be deployed safely with the new migration guard.

**Why it may be needed.** `VALIDATION_REPORT.md` (2026-11-20) records that 34 profiles — including seeded and showcase rows — were copied from a local database into the production Neon database, and `render.yaml` enables `DEMO_LOGIN_ENABLED`. Those fake profiles have `is_demo = false`, so real members can see them in discovery. Whether they are still there is **unknown**.

**Hard rules for whoever runs this**
- Take the recovery point first. Do not continue without one.
- Do it on a **copy** (a Neon branch or restored backup) first, then repeat on the live database.
- Read-only queries first; the delete runs inside a transaction you can roll back; verify the counts before `COMMIT`.
- Never `TRUNCATE`, never `DELETE` without a `WHERE` that names ids, never run a statement you have not read.
- Do not paste connection strings into chat, tickets or this file.

---

## 0. Before you start

- [ ] Owner has read this and agrees to the scope.
- [ ] A quiet time is chosen (the delete is quick, but verify under low traffic).
- [ ] A recovery point exists and its identifier is written here: `__________` (Neon branch name or point-in-time timestamp, taken immediately before step 3).
- [ ] You have a way to connect that shows the host you are on (`SELECT current_database(), inet_server_addr();`) so you know it is the copy or the live database as intended.

## 1. Inventory (read-only)

```sql
-- 1a. Everything that looks like a fixture. Review every row by eye.
SELECT id, email, name, is_demo, created_at
FROM profiles
WHERE id LIKE 'seed-%' OR id LIKE 'demo-%'
   OR email LIKE '%@dateza.local' OR email LIKE '%@example.com'
ORDER BY id;

-- 1b. Anything that is NOT a fixture must not appear above. Confirm real accounts use the usr_ prefix:
SELECT count(*) AS real_looking_accounts FROM profiles WHERE id LIKE 'usr_%';
SELECT id, email FROM profiles
WHERE (id LIKE 'seed-%' OR id LIKE 'demo-%') AND email NOT LIKE '%@dateza.local' AND email NOT LIKE '%@example.com';
-- ^ any row here deserves a second look before continuing
```

Expected fixture ids from the code (any subset may exist):

| Group | Ids |
|---|---|
| Mock accounts removed from the UI (migrations 004/005) | `seed-liana`, `seed-elena`, `seed-aria`, `seed-chloe`, `seed-sophia`, `seed-marcus`, `seed-dev`, `seed-nina`, `seed-james` |
| Older mock accounts | `seed-isabelle`, `seed-liam`, `seed-zoe` |
| Showcase fixtures (16) | `seed-showcase-<key>` — keys listed in `backend/data/showcase-profiles.json` |
| Live demo accounts | `demo-alex`, `demo-elena` (created by `backend/demo.js`; only needed if the demo is kept) |

## 2. Impact check (read-only)

Replace the list with the ids you decided to remove (`$ids` below).

```sql
-- Rows that would disappear with the accounts (foreign keys cascade):
SELECT 'swipes by fixtures'  AS what, count(*) FROM swipes  WHERE swiper_id = ANY($ids)
UNION ALL SELECT 'swipes ON fixtures (made by anyone)', count(*) FROM swipes WHERE swipee_id = ANY($ids)
UNION ALL SELECT 'swipes ON fixtures made by REAL members', count(*) FROM swipes WHERE swipee_id = ANY($ids) AND swiper_id LIKE 'usr_%'
UNION ALL SELECT 'matches with fixtures', count(*) FROM matches WHERE user_a = ANY($ids) OR user_b = ANY($ids)
UNION ALL SELECT 'matches between a fixture and a REAL member', count(*) FROM matches
          WHERE (user_a = ANY($ids) AND user_b LIKE 'usr_%') OR (user_b = ANY($ids) AND user_a LIKE 'usr_%')
UNION ALL SELECT 'messages in those matches', count(*) FROM messages
          WHERE match_id IN (SELECT id FROM matches WHERE user_a = ANY($ids) OR user_b = ANY($ids))
UNION ALL SELECT 'images owned by fixtures (become orphans)', count(*) FROM images WHERE owner_id = ANY($ids);
```

**Stop and ask for advice** if "matches between a fixture and a REAL member" or "messages in those matches" is not zero: that is real members' conversation data. The fix then is a decision about those people, not a delete.

Swipes by real members on fixtures are expected and are not personal content; they disappear with the fixtures.

## 3. Delete (transaction, verify, then commit)

```sql
\set ON_ERROR_STOP on
BEGIN;

DELETE FROM profiles
WHERE id = ANY (ARRAY[ /* the exact ids you reviewed in step 1 */ ]::text[])
RETURNING id, email;
-- Compare the returned rows with your reviewed list. The count must match exactly.

-- If anything is surprising:  ROLLBACK;
-- If it is exactly what you reviewed:  COMMIT;
```

Do **not** use `is_demo = true` as the selector, and do not "hide" fixtures by setting `is_demo = true`: `backend/demo.js` deletes every `is_demo` profile that is not one of the two demo personas the next time the demo login is used.

## 4. Migrations 004 and 005 (no action needed any more)

Since Phase 1 (Task 0) the two destructive cleanups are **archived outside `backend/migrations/`** (`backend/ops/local-dev-cleanup/`, content unchanged) and the migration runner never reads that folder, so a hosted deploy can no longer try to run them and **nothing has to be recorded in `schema_migrations`**. If your hosted database happens to contain rows for them from an earlier run, they are harmless (the runner knows the two names are retired).

Optional, read-only: see whether they were ever applied there — `SELECT name, applied_at FROM schema_migrations WHERE name IN ('004_remove_requested_mock_profiles.sql','005_remove_additional_mock_profiles.sql');`

## 5. Turn the shared demo login off

- In the Render dashboard (or `render.yaml` — Phase 1 task P1-00b) set `DEMO_LOGIN_ENABLED` to `false` / remove it. Redeploy by your normal process.
- If a demo is wanted later it must be a **separate service with its own database**, never the production one.

## 6. Verify (read-only)

```sql
SELECT count(*) FROM profiles WHERE id LIKE 'seed-%' OR id LIKE 'demo-%' OR email LIKE '%@dateza.local';  -- expect 0 (or only the demo accounts you decided to keep)
SELECT count(*) FROM profiles WHERE id LIKE 'usr_%';  -- must equal the count from step 1b
SELECT name FROM schema_migrations ORDER BY name;
```

Then in the app (as a real member): discovery contains no fictional people, and `POST /api/auth/demo` answers that the demo is disabled (`GET /api/auth/demo/status` reports `enabled: false`).

## 7. Rollback

Restore from the recovery point recorded in step 0 (Neon branch/point-in-time restore). If only the bookkeeping rows in step 4 were wrong, delete those two rows from `schema_migrations`.

## 8. What this runbook deliberately does not do

It does not rotate credentials, change billing or hosting configuration, delete real members' data, or touch images beyond reporting orphans (orphan cleanup belongs to Phase 7).
