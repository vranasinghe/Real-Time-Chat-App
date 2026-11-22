# Retired migrations 004 and 005 — local development cleanup only

These two SQL files used to live in `backend/migrations/`. They are **data cleanups that delete rows**
(`DELETE FROM profiles WHERE id IN (…)` over nine fixed `seed-*` mock accounts, cascading to those
accounts' swipes, matches and messages). A migration folder is applied automatically at every backend
start, so they were moved here on 2026-11-22 (Phase 1, Task 0), following the product-owner decision to
keep them local-only and to clean hosted data only through the reviewed runbook.

- **Content is unchanged** (the files were moved, not edited; SHA-1 of `004…` is `d9cfeedb…`, of `005…` is `7593eb2a…`).
- **The migration runner never reads this folder.** Nothing here runs automatically anywhere.
- **Their numbers (004, 005) are retired and must never be reused** (`backend/dbSafety.js`, `RETIRED_MIGRATIONS`).
  A database that already recorded them in `schema_migrations` keeps those rows; the runner knows the names are retired and does not warn about them.
- **Hosted databases:** do not run these files. Follow `docs/implementation/PRODUCTION_CLEANUP_RUNBOOK.md`
  (read-only inventory, impact check, a recovery point, a transaction you verify before `COMMIT`).
- **Local development database that still has the nine mock accounts** (optional): review the files, then run
  them by hand against the LOCAL database only, for example
  `psql "postgresql://postgres@127.0.0.1:5432/<your local db>" -f 004_remove_requested_mock_profiles.sql`.
  Fresh local databases never contain those accounts (the development seeder no longer creates them).
