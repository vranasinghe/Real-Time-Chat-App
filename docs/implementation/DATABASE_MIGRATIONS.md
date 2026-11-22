# Dateza — Database schema and migrations

Verified against the repository on 2026-11-22 (after Phase 1). Only facts checked in code or by a test run are stated.

## 1. What is authoritative

| Source | Role |
|---|---|
| `backend/db_init.sql` | Base schema. Idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). **Runs on every backend start.** |
| `backend/migrations/NNN_name.sql` | Ordered, one-time changes, applied by `backend/db.js` after `db_init.sql`, each in its own transaction, recorded in `schema_migrations(name, applied_at)`. |
| `backend/ops/local-dev-cleanup/` | **Retired** destructive data cleanups (old migrations 004 and 005). Never read by the runner. See §3. |
| `docs/archive/legacy-supabase-schema.sql` | **Legacy, not used, do not deploy** (old Supabase schema). |

Startup order (`db.initDb()`): `db_init.sql` → `runMigrations()` → (only on a local, non-production database) development seeding and fixture marking. A failure retries 4 times, then the process exits.

`db_init.sql` contains one `DELETE FROM matches` (a one-time merge of duplicate match rows for the same pair, after re-pointing their messages). It pre-dates the migration system, is idempotent and only acts when duplicates exist; it is not covered by the guard because it does not go through the runner. Reviewed and left as is.

## 2. Tables

`profiles`, `swipes`, `matches`, `messages`, `match_reads`, `images`, `auth_codes`, `ephemeral_media`, `stories`, `schema_migrations` (existing) and, from Phase 1: `user_preferences`, `privacy_consents`, `oauth_transactions`, `oauth_exchange_codes`. New `profiles` columns: `status`, `suspended_until`, `status_changed_at`, `profile_completed_at`, `onboarding_step`, `onboarding_done`, `relationship_intention`.

DATE columns (`birthdate`) are returned by the driver as `YYYY-MM-DD` strings (`pg` type parser, `db.js`) instead of a `Date` at local midnight, which could shift the calendar day.

## 3. Migration files

| File | Kind | State |
|---|---|---|
| `001_indexes_and_constraints.sql` | additive | committed |
| `002_account_security.sql` | additive | committed |
| `003_ephemeral_media.sql` | additive (+ one back-fill `UPDATE`) | committed |
| `004_…`, `005_…` | **retired** (destructive data cleanups) | **archived, see 3.1** |
| `006_account_state.sql` | additive | committed locally in `378eac8` (not pushed) — applied and tested on throwaway local databases only; never applied to a hosted database |
| `007_consents_oauth.sql` | additive (new tables) | committed locally in `378eac8` — same |

Numbers are reserved by the roadmap in `IMPLEMENTATION_PLAN.md` §6 (**008 match lifecycle** and **009 safety** are next, then 010 profile/preferences, 011 notifications/jobs, 012 deletion/export/support, 013 media assets). Retired numbers (4, 5) and every used number are never reused: `dbSafety.orderMigrationFiles()` rejects a duplicate or a retired number, and `dbSafety.test.js` checks the directory is gap-free apart from the retired numbers.

### 3.1 Migrations 004 and 005: archived, local-only

Owner decision (2026-11-22): keep these cleanups **local-only** and clean hosted data only through the reviewed runbook (`PRODUCTION_CLEANUP_RUNBOOK.md`).

- **What they do:** each is one `DELETE FROM profiles WHERE id IN (…)` over nine fixed `seed-*` mock ids (`seed-liana`, `-elena`, `-aria`, `-chloe`, `-sophia`, `-marcus`, `-dev`, `-nina`, `-james`), cascading to those accounts' swipes (including swipes real members made on them), matches, messages, `match_reads`, `auth_codes`, media, stories; `images.owner_id` becomes `NULL`.
- **Where they are now:** `backend/ops/local-dev-cleanup/` (moved, **content unchanged**: SHA-1 `d9cfeedb…` and `7593eb2a…`, identical before and after the move). The runner reads only `backend/migrations/`, so **nothing here can run automatically**.
- **Can they be archived without breaking history, order or checksums?** Yes, verified from the code: the runner records only the file **name** in `schema_migrations`; there is **no checksum**, so moving a file cannot invalidate anything. A database that already recorded 004/005 keeps those rows; the runner now knows the two names are retired and does not log them as "missing on disk" (`RETIRED_MIGRATION_NAMES`). A database that never applied them simply never will. Order is unaffected: 006 follows 003 and the retired numbers stay reserved.
- **Applied state could not be established for any hosted database** (none was contacted, by rule). Locally: the throwaway test database recorded them once (when they were still migrations); the owner's developer database is hosted (`backend/.env` host classified, value not read) and its `schema_migrations` was not read. Whether the hosted database applied 004/005 is therefore **unknown**; it does not matter for correctness now (the files are retired either way), and the runbook's read-only queries answer it.
- **They were not edited and not executed against any hosted database.** The only place they ran was the throwaway local test database, before the move.
- **Future hosted deployments cannot execute them or any destructive SQL by accident:** (1) the files are no longer in `migrations/`; (2) the guard (§4) refuses destructive migrations on any non-local or production database unless reviewed and explicitly allowed; (3) `dbSafety.test.js` fails if a destructive file ever appears in `migrations/` without a deliberate change to the test.
- **For a local development database that still contains the nine mock accounts** (optional): run the files by hand against the LOCAL database only (`backend/ops/local-dev-cleanup/README.md`).

### 3.2 Migration 006 — account state, onboarding progress, discovery age range (additive)

Adds to `profiles`: `status` (`active | suspended | banned | pending_deletion | deleted`, default `active`, CHECK), `suspended_until`, `status_changed_at`, `profile_completed_at`, `onboarding_step`, `onboarding_done TEXT[] DEFAULT '{}'`, `relationship_intention` (CHECK in `long_term, short_term, friendship, figuring_out`), a **`NOT VALID`** static birthdate range CHECK (1900-01-01 up to 2100-01-01: applies to new/updated rows only, no existing row is rejected or rewritten), indexes on `status` and on completed profiles; creates `user_preferences (user_id PK → profiles ON DELETE CASCADE, min_age, max_age, CHECK 18–99 and min ≤ max)` — the interim home of the discovery age range; migration 010 extends it.
**Existing members are preserved:** every row becomes `status = 'active'`, `profile_completed_at = NULL`, `onboarding_done = '{}'`. They keep signing in and keep all matches, messages, swipes, stories and media; they confirm the setup steps once (see `API_REFERENCE.md`). No value is changed or deleted, and nothing is invented.

### 3.3 Migration 007 — consents and OAuth (additive, new tables)

`privacy_consents (user, kind terms|privacy, version, accepted_at, UNIQUE(user, kind, version))`; `oauth_transactions` (hash of the one-time `state`, app PKCE challenge, validated redirect, own PKCE verifier for Google, expiry, consumed flag); `oauth_exchange_codes` (hash of the one-time code, member, platform, challenge, 60-second expiry, consumed flag). Neither OAuth table holds a session token. Expired rows are purged opportunistically.

### 3.4 Tested on

`backend/test/integration.test.js` applies every migration to an isolated local PostgreSQL (throwaway cluster), checks each is recorded once and in order, that a failing file rolls back and is not recorded, that destructive files are refused on non-local/production targets, and uses scratch databases for those cases. Phase 1 tests also create members shaped like **pre-Phase-1 accounts** (invented values, no verification, existing match and messages) and prove nothing is lost.
Not done: applying 006/007 to a copy of the real production data (no access); a lock-time review on a large table (the new columns use constant defaults).

## 4. Safeguards (`backend/dbSafety.js`, `backend/db.js`)

1. **Destructive-migration guard.** All pending files are classified before any is applied (`DELETE FROM`, `TRUNCATE`, `DROP …`, `ALTER TABLE … DROP / ALTER COLUMN … TYPE / RENAME`; comments ignored). A destructive file runs automatically only on a **local** database outside production; elsewhere it needs `-- destructive-approved: by=<name> on=<date>` **and** `ALLOW_DESTRUCTIVE_MIGRATIONS=true`; otherwise the runner refuses before applying anything.
2. **Seeding guard.** Mock and showcase profiles are seeded only into a local, non-production database (`canSeedDevData`); `ALLOW_REMOTE_DEV_SEED=true` overrides outside production only. Seeded fixture rows are marked verified/completed so the eligibility rules still show them on a local database.
3. **Name and number validation**; duplicates and retired numbers abort the run.
4. **Failure atomicity**: a failing file rolls back and is not recorded; later files are not attempted.
5. **Drift warning** for names recorded in the database but missing on disk, except the retired names.

## 5. Rules for every new migration

1. Next free number from the roadmap; lowercase snake_case; never edit an applied file.
2. Additive first (nullable columns, `IF NOT EXISTS`, `NOT VALID` constraints validated later); back-fills are separate, resumable steps.
3. No `DROP`/`TRUNCATE`/`DELETE` unless unavoidable; then the guard applies and the file needs review and the approval marker.
4. Test on an empty database **and** on a database holding the previous schema plus realistic rows, locally (`npm run test:integration:local` in `backend/`).
5. Add a recovery note here.
6. Watch lock impact on large tables.

## 6. Recovery strategy

| Situation | Action |
|---|---|
| A migration failed mid-run | Nothing to do: rolled back and not recorded. Fix the file (it was never applied) and restart. |
| An additive migration needs reverting | Prefer a new forward migration; the 006/007 objects are unused by older code, so leaving them is safe. Dropping a column/table is destructive and needs a backup and the approval marker. |
| Rows were deleted by a data cleanup | Restore from the provider's point-in-time recovery or a branch taken **before** the cleanup (the runbook requires it). `schema_migrations` cannot be rewound by SQL alone. |
| A member was wrongly suspended/banned | `accountStatus.setAccountStatus(io, id, "active")` (or an equivalent `UPDATE profiles SET status = 'active'`); the member signs in again (old tokens stay revoked). |
| Need to mark a manually executed cleanup | The retired files are not in `migrations/` any more, so nothing needs marking. (An old `schema_migrations` row for them, if present, is harmless.) |

Backups, restore drills and Neon recovery windows are **not** established yet (Phase 9, tracker P9-05).
