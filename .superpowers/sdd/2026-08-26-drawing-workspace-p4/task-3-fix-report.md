# P4 Task 3 official-finding fix report

Base implementation: `3a4f23492eb4ca05daa328924d3b3ab4665e14c7`

## Summary

- Added the CLI-generated forward migration `20260826132102_drawing_workspace_p4_semantic_object_contract_fixes.sql`. The committed `20260826123529` P4 migration and all older migrations remain unchanged.
- Reconstructed every mixed semantic `put_object` base and now require the top-level `base_versions` ledger to equal those action bases plus the established reference-operation bases before mutation. Exact retries of existing operations still delegate to the established idempotency authority.
- Made the P4 host UUID parser match the existing SQL version/variant UUID domain, without widening the global UUID contract.
- Made space number/finish strings use the same 255 UTF-16-unit definition in TypeScript and PostgreSQL. Both authorities preserve precomposed/decomposed strings and allowed controls, while rejecting NUL and unpaired surrogates at or before PostgreSQL JSON materialization.
- Added a persisted-row UTF-16 check so a direct authorized RPC cannot store geometry that the strict loader rejects.
- Preserved private function boundaries, authenticated/service operation execution, RLS/table grants, approved-review freeze behavior, source-file bytes, and existing operation/history semantics. No public table/RPC, dependency, UI, state manager, or CRDT collection was added.

## RED evidence

- The shared mutation corpus initially reproduced the UUID mismatch: the TypeScript geometry parser accepted the nil host UUID while SQL rejected it.
- The shared SQL/TypeScript Unicode probes initially disagreed at supplementary-character length boundaries.
- A mixed wall/opening mutation with a missing changed-object entry in `base_versions` initially committed instead of returning `P1C01`.
- The populated upgrade test initially stopped at P3 and failed on the absent P4 `host_object_id` column before either P4 forward migration was applied.

## GREEN evidence

- Shared fixtures now cover v1/v8 valid UUIDs; nil, version-zero, and invalid-variant UUIDs; BMP and non-BMP 255/256 UTF-16 boundaries; paired and lone surrogates; NUL and allowed control characters; and precomposed/decomposed Unicode without normalization.
- Missing, mismatched, extra, and jointly false mixed bases return `P1C01` on the first call and exact retry, with byte-equivalent object rows and no operation-ledger row.
- The valid mixed operation retains exact idempotent retry, undo, redo, hosted-reference, and result-version behavior.
- The disposable PGlite upgrade fixture populates draft, review-requested, approved, snapshot-v2, approval, source-file, primitive object, operation, and template-clone rows at final P3. After both P4 migrations it proves byte-equivalent documents, revisions, pages, canvases, layers, primitive objects, operations, snapshots, approvals, clone ledger, and source-file row before accepting wall/opening and Unicode-boundary space writes.
- The server loader accepts the same shared SQL-valid Unicode boundary row through its strict production parser.

## Verification

- Focused P4 database/runtime/server gate: 13/13 passed, 0 failed.
- Required Task 3 DB/server gate: 193/193 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 559 discovered; 558 passed, 0 failed, 1 explicitly `UNEXECUTED` disposable-PostgreSQL concurrency fixture.
- `npm run typecheck`: passed (`react-router typegen && tsc`, exit 0).
- `git diff --check`: passed.
- Real PostgreSQL: `UNEXECUTED`. `P3_POSTGRES_CONCURRENCY_DATABASE_URL`, actor/project fixture values, `psql`, PostgreSQL server binaries, `pg_tmp`, Docker, and Podman are unavailable; no real-PostgreSQL pass is claimed.

## Scope

- No edit to a committed migration.
- No public measurement or semantic persistence endpoint.
- No source-file mutation.
- No UI, dependency, state-manager, or collaboration-model expansion.
