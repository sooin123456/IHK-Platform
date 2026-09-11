# Task 3 — DONE

Implemented the bounded actual PostgreSQL + Hocuspocus WebSocket restart gate. There were no production-code changes and no contract problem. The permanent test delta is exactly the new fixture `platform/tests/fixtures/drawing-collaboration-canonical-initialization.mjs` plus one import and one invocation in `platform/tests/drawing-workspace-m1-real-database.test.mjs` immediately after the accepted canonical SQL proof.

## Proof coverage

- Creates a new empty drawing through the existing authenticated creation RPC, then starts production PostgreSQL adapter, storage facade, and server on port 0.
- Connects an empty Viewer Y.Doc through a real `HocuspocusProvider` with the allowed Origin. Before disconnect, the owned test admin reads the private collaboration row and asserts generation 1, SHA over exact stored bytes, Viewer/row normalized Yjs equality, and zero operations.
- Database `authorize` returns Viewer/`canWrite=false`. A validator-accepted `add_layer` update is then sent through the actual ordinary storage/PostgreSQL path and is rejected with SQLSTATE `P3A02`; the canonical row remains byte-for-byte unchanged.
- Stops provider and first runtime/database; applies exactly the cached winner bytes to a fresh Editor Y.Doc; creates fresh production database/storage/server instances; reconnects and proves sync succeeds with zero operations and unchanged raw bytes, generation, SHA, byte size, and base sequence before any Editor edit.
- Clones the winner, forges protected `baseSnapshotSha256`, and proves the production client-update validator rejects it with the real Editor scope/actor/context. The database row remains unchanged.
- Provider, Y.Doc, server, adapter SQL pool, document fixture, isolated database, and owned cluster cleanup all execute through `finally` paths.

The fixed JWT seam deliberately maps only `task-3-fixed-editor-token` and `task-3-fixed-viewer-token` to the already seeded actor IDs. This proves real database authorization after identity mapping; it does **not** claim Supabase Auth/JWKS/JWT cryptographic verification or browser IndexedDB.

## TDD evidence

All commands ran from `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`. The runner creates a disposable UTF-8 PostgreSQL 17 cluster on an OS-assigned loopback port, applies all migrations through the existing M1 fixture, and stops only its owned cluster in `finally`.

1. RED against the exact pre-Task-2 server/storage in `task-3-red-owned`:

   `node .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-3-postgres.mjs red > .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/task-3-red.log 2>&1`

   Exit 1; 0 passed, 1 failed, 0 skipped. Expected assertion: `untouched Viewer sync must durably initialize canonical collaboration state`; actual row was `undefined` after sync. Baseline hashes were server `b1c8908502c1461be782fd4f4d883afa5e1dbe0843ccab5cf710d5caaf0e34fe` and storage `d5c37967a28eb668f7e421a378d474b9186f7f1913320bc39ca7a967c4e52d32`. This identifies missing durable first state, not a harness/module failure. Log: `task-3-red.log`; PostgreSQL log: `task-3-red-postgres.log`.

2. Final GREEN against the accepted actual tree after strengthening the Viewer attempt to a valid changed operation:

   `node .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-3-postgres.mjs green > .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/task-3-green.log 2>&1`

   Exit 0; full M1 fixture 1/1 passed, 0 failed, 0 skipped, 3357.626417 ms. Final event:

   `{"generation":1,"sha256":"4f4b054e356d4fe5453c13b92dd4d5bd2145c54903f7b770d806c1a420597bdd","byteSize":366,"baseOperationSequence":0,"operationCount":0,"reloadExact":true,"viewerOrdinaryStoreDenied":true,"protectedMetadataRejected":true}`

   The SHA varies across independently created Yjs documents because the trusted candidate has a new client identity; the value above is the exact final GREEN state and was recomputed from its stored bytes. Earlier successful pre-strengthening GREEN is preserved as `task-3-green-before-viewer-operation.log`, not used as final acceptance.

## Local Supabase security advisors

The owned-copy fixture invoked, before isolated database cleanup:

`supabase db advisors --db-url postgresql://postgres@127.0.0.1:<owned-port>/m1_<owned>?sslmode=disable --type security --level warn --fail-on none`

Final output was `{"results":[],"message":"db advisors"}`; the enclosing M1 run passed 1/1 and its owned cluster stopped. Therefore there are no advisor warnings to classify as existing or introduced, and specifically no warning for the three new private initializer functions. Existing PostgreSQL `42622` long-identifier NOTICE output is migration/runtime noise already present in Task 1 logs, not an advisor finding and not caused by the initializer functions.

The first advisor diagnostic is preserved as `task-3-advisor-tls-failure.log`: CLI defaulted to TLS against the plain owned server (`LegacyDbConnectError`), corrected only in the owned copy with `sslmode=disable`. The next diagnostic, `task-3-advisor-owned-missing-docs.log`, shows advisors already returned empty results but a later unrelated fixture lacked the owned-copy `docs` symlink. After adding that unchanged symlink, final `task-3-advisor.log` passed completely. No remote project, credentials, or managed advisor was used.

## Final delta and cleanup

- Accepted Task-1 M1 baseline hash: `8e37790d48aee460bc6f2127d26fef06c3cd61333ef28a652f4a569e61827eda`.
- Current M1 test hash: `626145b3fd80dcd9ed5e74469398a8e0c883384287abb9a4d25ceec8edc15379`; diff from that baseline is exactly four added lines: one import and three-line call.
- Initial reviewed fixture hash before fix1 (not yet approved): `d9d2a7e23d89c58262c927c145387f08d643ad425e2ae09a4c6272338379d9fe`.
- `node --check` for both permanent test files and `git diff --check` passed.
- All RED/GREEN/advisor PostgreSQL logs are preserved. Explicit `pg_ctl status` checks for all six Task 3 cluster directories returned `no server running`; each runner also dropped its isolated M1 database and stopped its cluster.
- No dependencies, production files, preview build, staging, commit, deploy, remote tool/data, or live preview process were touched. Commits: none.

## Fix1 — failed authentication provider cleanup

The independent review found that `connect()` rejected `onAuthenticationFailed` without destroying its function-local provider, so callers could not stop the managed WebSocket connection-check interval. Upstream inspection confirmed `HocuspocusProvider.destroy()` clears provider timers and delegates to `HocuspocusProviderWebsocket.destroy()`, which clears `connectionChecker` and sets `shouldConnect=false`.

The fixture now routes both unsuccessful settlements—authentication failure and bounded timeout—through one idempotent `fail()` path that destroys the local provider before rejection. A real invalid-token WebSocket handshake uses a narrow tracking subclass and asserts, before caller fallback cleanup, that destruction occurred exactly once and the managed socket has `shouldConnect=false`. The fallback destroy runs only after the assertions and exists to keep an intentionally failing RED bounded.

Fix1 RED, with the negative proof added but the exact pre-fix `connect()` from `baseline-task3-fix1` retained:

`node .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-1-postgres.mjs task-3-fix1-red > .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/task-3-fix1-red.log 2>&1`

Exit 1; 0 passed, 1 failed, 0 skipped. Actual destroy count `0`, expected `1`, at `failed authentication must destroy its unreturned provider`. The real server logged the expected invalid fixture token. The fallback cleanup then bounded the leaked pre-fix provider, and owned cluster `/tmp/canonical-pg-jXIv0R` stopped. Stable logs: `task-3-fix1-red.log` and `task-3-fix1-red-postgres.log`.

Fix1 GREEN against the current Task-2-fixed server/storage and all migrations:

`node .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/run-task-1-postgres.mjs task-3-fix1-green > .superpowers/sdd/2026-09-06-collaboration-canonical-initialization/task-3-fix1-green.log 2>&1`

Exit 0; full M1 fixture 1/1 passed, 0 failed, 0 skipped, 3533.674583 ms. The negative handshake proved destroy count 1 and `shouldConnect=false`; the canonical proof also remained green with generation 1, 366 bytes, zero operations, exact reload, Viewer ordinary-store denial, and protected-metadata rejection. This independent run's state SHA was `c0c100899c9c3885453780fa50b2b4befb8c38e9598c2fcb05d38c368788c500`. Owned cluster `/tmp/canonical-pg-NBFBnx` stopped. Stable logs: `task-3-fix1-green.log` and `task-3-fix1-green-postgres.log`.

Fix1 exact baseline/current fixture hashes are `d9d2a7e23d89c58262c927c145387f08d643ad425e2ae09a4c6272338379d9fe` / `15915bedb4d009fad529465dc13bef16dfefa3b6a35388f59e7fe3bd020084f2`. The M1 hook remains byte-identical at `626145b3fd80dcd9ed5e74469398a8e0c883384287abb9a4d25ceec8edc15379`; no production file was edited by Task 3 fix1. Advisors were not rerun because SQL is unchanged and the prior local result remains `results: []`. Commits: none.
