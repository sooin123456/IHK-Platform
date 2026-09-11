# Task 1 report — DONE

Task: atomic SQL canonical collaboration initialization in `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`.

## Changes

- Filled the existing, initially empty CLI-generated migration `platform/supabase/migrations/20260906070918_drawing_collaboration_canonical_initialization.sql` with the three exact private SETOF interfaces in the binding spec.
- Added `proveCanonicalCollaborationInitialization` and one invocation immediately after fixture seeding in `platform/tests/drawing-workspace-m1-real-database.test.mjs`. The delta against the exact pre-task snapshot is 267 inserted lines in two hunks; all preceding dirty edits are preserved.
- Added this report, `run-task-1-postgres.mjs`, and generated execution/PostgreSQL logs under this plan's SDD directory only.

## Contract self-review

The core locks the exact revision/project, reports P3A01 when unavailable, returns existing complete state before validating a candidate or enforcing draft-only service insertion, validates candidate bounds with P3S01, hashes current schema-2 canonical JSONB text with pgcrypto, rejects sequence/SHA/schema mismatches with P3S04, and inserts generation 1/schema 1/active state with null freeze metadata. It never updates existing state or touches freeze leases. Both wrappers return the complete table row; user initialization uses the existing private verified-user authorization without a can_write or auth.uid gate, and service initialization uses the existing realtime entitlement check with readonly disabled.

All functions are SECURITY DEFINER with empty search_path and qualified referenced objects. PUBLIC, anon, authenticated, service_role, and collaboration role privileges are explicitly revoked first. Only the two wrappers then grant EXECUTE to lukas_drawing_collaboration. Core remains inaccessible to all application roles. No table or public API is added.

Database assertions cover no-end-user-JWT Viewer first initialization, initial hash/size/generation/base sequence and null metadata, ordinary Viewer write refusal, all role EXECUTE privileges and direct call denial, unauthorized/null user and cross-project/missing revision refusal, null/empty/oversize bytes, null/negative sequence, null/uppercase/short/invalid SHA, stale SHA/sequence, independent worker backends blocked at a deterministic revision-lock barrier, exact complete-row winner equality, invalid losing-candidate no-op, approved absent service refusal, approved Viewer initialization, existing approved/frozen no-op including timestamps, and pre-acquired freeze lease preservation with ordinary service write still refused.

Opaque two-byte candidates are explicitly SQL-boundary fixtures, not claims of valid Yjs documents. Server semantic validation and adapter/admission behavior belong to Task 2. Frozen-state setup is explicitly a SQL-only fixture; approved revisions use the real request/review/approval APIs.

## TDD and actual execution

Commands below ran from the named worktree. No dependencies, app build, staging, commit, deploy, remote data writes, or other plans' private SDD access occurred.

1. RED, migration still 0 bytes:

   `node .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-1-postgres.mjs red > .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/task-1-red.log 2>&1`

   Exit 1; 1 test failed, 0 passed, 0 skipped. Exact expected failure: SQLSTATE 42883, `function private.lukas_drawing_collaboration_initialize_state(uuid, uuid, uuid, bytea, bigint, text) does not exist`. Log: `task-1-red.log`; database log: `task-1-red-postgres.log`. Owned cluster `/tmp/canonical-pg-SqdCd5`, stopped in finally.

2. First implementation run:

   `node .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-1-postgres.mjs green > .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/task-1-green.log 2>&1`

   New canonical proof completed, but a later existing scaffoldStarter assertion hit PostgreSQL 23514 for a Korean property name. The initdb log proved `--no-locale` chose SQL_ASCII; corrected only the owned runner to add `--encoding=UTF8`. Logs: `task-1-green.log`, `task-1-green-postgres.log`. Owned cluster `/tmp/canonical-pg-neVUxD`, stopped in finally.

3. GREEN, full existing M1 actual-PostgreSQL fixture with all migrations:

   `node .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-1-postgres.mjs green-utf8 > .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/task-1-green-utf8.log 2>&1`

   Exit 0; 1 test passed, 0 failed, 0 skipped, 3475.005208 ms total. Logs: `task-1-green-utf8.log`, `task-1-green-utf8-postgres.log`.

   Runner uses installed PostgreSQL 17.11 tools at `/opt/homebrew/bin`, an owned mkdtemp cluster, an OS-assigned loopback port, UTF-8, and logical WAL. It precreates the collaboration NOLOGIN/NOINHERIT role and grants it to postgres WITH INHERIT FALSE, SET TRUE. The fixture verifies that membership before role setup, creates/drops its own separate database, applies all migrations, and uses independent workers. Actual test subprocess:

   `NODE_OPTIONS=--no-experimental-webstorage M1_REAL_POSTGRES_REQUIRED=1 M1_REAL_POSTGRES_DATABASE_URL=postgresql://postgres@127.0.0.1:<owned-port>/postgres node --test tests/drawing-workspace-m1-real-database.test.mjs`

   Existing long-identifier PostgreSQL NOTICE output is retained in logs. No initializer errors remain. The optional Docker/native DWG import pipeline was not enabled; this task does not claim that separate gate.

4. Final checks:

   `git diff --check -- platform/tests/drawing-workspace-m1-real-database.test.mjs platform/supabase/migrations/20260906070918_drawing_collaboration_canonical_initialization.sql` — no whitespace errors.

   `node --check platform/tests/drawing-workspace-m1-real-database.test.mjs` and `node --check .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-1-postgres.mjs` — clean.

   `/opt/homebrew/bin/pg_ctl -D /tmp/canonical-pg-g127yj status` — `pg_ctl: no server running`. All three owned clusters were stopped; retained cluster directories and copied logs provide local evidence. No other cluster was stopped.

## Skills and concerns

Read and used test-driven-development (including writing-good-tests), verification-before-completion, Supabase, and systematic-debugging. The Supabase changelog and official functions documentation were checked; the binding spec's private verified-user boundary controls over generic auth.uid guidance. No remote advisors or migration writes were performed. No unresolved implementation concern. Controller review remains to be performed. Commits: none.
