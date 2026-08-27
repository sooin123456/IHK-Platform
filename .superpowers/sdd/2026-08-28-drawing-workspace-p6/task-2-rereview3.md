# P6 Task 2 independent rereview 3

Reviewed commit: `91cca7da58813bc931e1beba1da431cadada1993`

Previous review: `2cbef9a7b972a162d4140de68a539ba52f911a29`

Review scope: the Task 2 real-PostgreSQL verifier change in `platform/tests/drawing-workspace-p6-postgres-concurrency.test.mjs`, with regression confirmation of the P6 migration, shared authority fixture, PGlite contract, P5 database contract, P6 Task 1, P4 measurements/schedules, and Verified BOQ 1.0. Concurrent Drawing-shell/IFC work and user-owned P4/audit files were excluded and not modified or staged.

Verdict: **READY**.

Finding counts: **0 Critical, 0 Important, 0 Minor**.

## Previous Important disposition

The rereview-2 Important is **resolved**.

- The real-PostgreSQL verifier now creates two independently named databases. The fresh path applies the current P0-P5 authority fixture without rows, applies the P6 migration, and resolves all three bridge relations plus the public BOQ-link RPC from the fresh catalog. The populated-upgrade path separately seeds P0-P5, snapshots its legacy Drawing/BOQ/file/material/transaction/project authority, applies P6, and proves that snapshot and the Verified BOQ 1.0 result remain unchanged.
- The verifier executes, rather than merely declares, every named foreign identity position. Service/authenticated transactions with isolated PostgreSQL connections and JWT claims probe foreign revision, object, snapshot, quantity link, BOQ line, BOQ version, manifest file, rate component, material resource, and material plan identities. The probes are partitioned across quantity, BOQ-link, and material-handoff RPCs, and their union is the declared ten-position matrix.
- Drawing authority is exercised through real service-role RPC calls for `draft`, `review_requested`, `approved`, and `superseded`, including approved, rejected, and missing decision authority. The representative matrix isolates invalid status from invalid decision and proves both approved and superseded valid cases; redundant invalid-status plus invalid-decision Cartesian combinations would not add a distinct branch to the guarded predicate.
- BOQ authority is exercised through actual authenticated maker/reviewer and owner connections across draft, rejected-to-draft, `in_review`, `approved`, and `superseded`. Rejection and independent approval use the production decision RPC, while each state also runs direct-DML and public RPC mutation assertions. The visited-state set is compared with the complete declared BOQ matrix.
- The no-database static matrix assertion is only a fail-fast coverage inventory. It does not substitute for the gated test body: all authority probes live inside the database-backed test and use role-isolated transactions with `request.jwt.claim.sub`, `request.jwt.claims`, and `SET LOCAL ROLE`.

## Previous fix regression disposition

- Legacy BOQ child edit serialization remains intact. The real-PostgreSQL body still holds a rate-component edit open, observes both finalize and decision backends waiting on a lock through `pg_stat_activity`, releases the edit, and requires stale finalize/decision failures. The PGlite contract also continues to cover frozen-child relocation and the full draft/rejection/review/approval/supersession guard lifecycle.
- Calculation-manifest and approved-handoff SHA values remain distinct. `p6Sha.manifest` freezes BOQ calculation authority; `p6Sha.handoff` identifies the immutable same-project manifest file. Passing the calculation SHA as the handoff file SHA still fails, while exact handoff replay succeeds.
- The authority fixture still applies the current P4 revision/draft-child guards and P5 source constraints, mutation guard, revision/domain triggers, grants, and RLS from their historical migrations. The populated upgrade snapshot remains byte-for-byte unchanged.
- The snapshot and object composite-FK leading indexes remain present. PGlite catalog assertions and the gated real-PostgreSQL catalog/`EXPLAIN` assertions still verify their exact columns and use.

## Fresh verification evidence

- `node --test --test-reporter=spec tests/drawing-workspace-p6-database-contract.test.mjs`: **13 passed, 0 failed, 0 skipped**.
- P5 DB plus P6 Task 1/P4/Verified BOQ focused run (`drawing-workspace-p5-database-contract`, `drawing-quantity-lineage`, `drawing-workspace-measurements`, `drawing-workspace-semantic-schedules`, `verified-boq`): **53 passed, 0 failed, 0 skipped**.
- Ordinary no-URL real-PostgreSQL gate: **1 passed, 0 failed, 2 skipped**. The database-backed authority test is explicitly `P6 real PostgreSQL gate is UNEXECUTED`; the one pass is the static inventory assertion, not database proof.
- Required no-URL gate, with `P6_REAL_POSTGRES_REQUIRED=1`: expected nonzero; **1 passed, 1 failed, 1 skipped**, exact message `P6 real PostgreSQL gate is UNEXECUTED`.
- `npm run typecheck`: PASS.
- Prettier check for the fixture and both P6 database test files: PASS. The repository has no Prettier SQL parser, so the SQL migration was verified through executable PGlite application and `git diff --check`, not misreported as Prettier-checked.
- Target Task 2 diff and current worktree `git diff --check`: PASS.

## External authorities still UNEXECUTED

1. The database-backed real-PostgreSQL suite was not executed because neither `P6_REAL_POSTGRES_DATABASE_URL` nor a local PostgreSQL server/client is available. Its fail-closed required gate behaves correctly. The runner body is complete for the reviewed finding, so this external absence is not a code finding and is not local real-PostgreSQL PASS evidence.
2. Hosted Supabase migration/advisors and real-schema type generation remain UNEXECUTED because hosted project authority is absent. `platform/database.types.ts` was not changed.
3. Production/deployed two-user, cross-organization, Storage/CORS, backup/restore, and performance gates remain later release authorities and were not treated as Task 2 local proof.

Ponytail review: no additional abstraction or dependency is justified. The explicit matrix is long because it is the executable authority proof; consolidating it behind a generic permission DSL would make this security boundary harder to audit.
