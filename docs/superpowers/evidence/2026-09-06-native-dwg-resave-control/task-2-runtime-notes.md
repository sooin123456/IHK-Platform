# Task2 local runtime and reuse notes

The binding requirements are task-2-brief.md and the design it references. These notes are execution context, not alternate interfaces.

- Authoritative root: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; work from its platform directory. HEAD remains9f5f56d93db325ff935772252f9d4fb64d69f98c and index is unchanged. Do not use ambient GoAgent root as source.
- Exact pre-task wrapper copy: `/tmp/1hk-resave-control-m6Q9WS/drawing-workspace-m1-real-database.test.mjs`. Other Task2 files are new. Logs belong in that temporary directory with task2 names. No private artifact access.
- Existing installed runtime can run Node tests/direct no-emit tsc in authoritative source. Always use `NODE_OPTIONS=--no-experimental-webstorage`. Do not build or install here; preview4173/PID80284 uses existing build assets.
- Owned disposable PostgreSQL URL: `postgresql://postgres:resave-local-only@127.0.0.1:32779/postgres?sslmode=disable`. Container6a694ad8dceadb81344c551be3788a72735ce68d1097e9994dc08c74d6280076, name1hk-resave-control-pg-20260906-m6q9ws, tmpfs data, cached Supabase PostgreSQL17.6. This is not a user DB; no other endpoint is authorized.
- Prerequisites were provisioned only in this container: collaboration nologin/noinherit role plus SET TRUE/INHERIT FALSE membership for fixture postgres, and SET on parameter session_replication_role for rolled-back corrupt-evidence probes. Do not broaden production privileges or weaken expected denials.
- Existing copied-runtime baseline passed1/1 real PostgreSQL wrapper with multiple connections after narrow environment configuration. Raw configured log `/tmp/1hk-resave-control-m6Q9WS/database-baseline-configured.log`; original prerequisite failure preserved at database-baseline.log. Pre-existing PostgreSQL identifier-truncation NOTICE messages are in the logs.

## Focused extension points

- Existing wrapper calls proveNativeDwgCanonicalImportAuthority near2812. Capture its returned `{projectId,scope,jobId,plan}` and pass to the new fixture. Its project is already registered for retention cleanup.
- Canonical-import fixture returns near982; approved original source no-op exists. Use its trusted template clone flow near688–745, then existing apply_operation before review/approval for a genuinely changed LINE. Never invent approved canonical snapshots or compiled edit requests.
- Original approved-source fixture deliberately proves selectedEdits.request is null and the public RPC shape is only `{approved,analysis}`; keep that contract.
- Reuse role+JWT transactions, project/job lock barriers, owner-only rolled-back evidence corruption from existing import/canonical fixtures. Use actual independent worker connections; pg_blocking_pids barriers, not sleep races.
- Current import SQL uses project→job locks and strict role+JWT guards. Do not inherit draft-only/editor-only/requester-only policy accidentally; the resave spec explicitly differs.
- Reuse existing private actor resolver and its verified import-job source, not a second source-authority implementation. Existing generic retention-delete helper accepts the new table relation OID and checks trigger depth, owner, purge project and deleted project.
- No published/completed result in this task; no artifact/UI/CLI changes.

## CLI

Supabase CLI2.114.0 installed. Help for migration new, db query and db advisors was inspected by controller. Generate the migration with CLI only after actual RED, and report its real path. All DB calls must explicitly use the owned loopback URL, never linked/project-ref/default remote state.

`supabase db advisors --db-url URL --type all --level info --fail-on none --output-format json` is supported. Arrange this while the wrapper's isolated migrated database exists, or coordinate a disposable retained copy with controller. Do not report advisors run against the empty postgres maintenance database as application verification. Replaying the whole migration chain in a new wrapper-owned DB proves clean replay; if testing same migration re-execution separately, label that distinct from chain replay.
