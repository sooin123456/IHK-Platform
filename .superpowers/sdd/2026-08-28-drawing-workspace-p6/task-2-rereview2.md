# P6 Task 2 independent rereview 2

Reviewed commit: `b91e0e151d24ac6cc8ff87593f44fe8299704dc5`

Review scope: Fix 4 changes in the P6 forward migration, PGlite database contract, real-PostgreSQL concurrency body, and shared authority fixture. No implementation or concurrent Drawing-shell file was modified.

Verdict: **BLOCKED** — not READY.

Finding counts: **0 Critical, 1 Important, 0 Minor**.

## Finding

### Important

1. `platform/tests/drawing-workspace-p6-postgres-concurrency.test.mjs:267-287,308-350,522-535` — the real-PostgreSQL body now has the missing deterministic legacy-child-edit barrier and a broad direct-DML/RLS matrix, but it still does not execute the full real-PostgreSQL authority matrix required by spec section 13.1 and the Fix 4 assignment. It creates one isolated database, seeds populated P0-P5 authority, and applies P6 once; there is no separate fresh-schema application. Its cross-project probes cover one internally consistent other-project quantity request, a foreign BOQ line, a foreign BOQ version, and a foreign manifest file, but not the individual foreign object, snapshot, quantity-link, component, resource, and plan positions. It also leaves Drawing `draft|review_requested|superseded` with rejected/missing decisions and BOQ rejection/supersession to PGlite rather than proving them on real PostgreSQL. The PGlite suite covers these cases usefully, but it explicitly cannot prove real RLS, trigger scheduling, or locks. Add isolated real-PostgreSQL fresh and populated-upgrade applications and exercise every named cross-project and lifecycle position there. The absence of a local PostgreSQL URL is separately UNEXECUTED; this finding concerns the statically incomplete test body, not that external absence.

## Previous finding disposition

- Previous **C1 legacy BOQ child identity/serialization**: **resolved**. `public.lukas_qto_guard_boq_draft_child()` rejects UPDATE relocation, derives ownership from NEW only for INSERT and OLD for UPDATE/DELETE, locks the exact BOQ version `FOR UPDATE`, then checks draft status and maker. Catalog coverage confirms all seven inherited child triggers still resolve the replaced function. The real-PostgreSQL body holds a rate-component edit open, observes both finalize and decision backends waiting on locks through `pg_stat_activity`, releases the edit, and requires stale finalize/decision failures.
- Previous **I1 calculation-manifest/handoff SHA conflation**: **resolved**. `p6Sha.manifest` and `p6Sha.handoff` are deliberately distinct. Material authority requires frozen non-null BOQ hashes plus an independently bound same-project immutable `kind='other'` file whose exact handoff SHA matches its canonical storage suffix; it no longer compares that file SHA to `v.manifest_sha256`. Passing the calculation-manifest SHA as the file SHA fails, while the distinct handoff SHA succeeds and is persisted on the material plan.
- Previous **I2 reduced fixture / production-impossible Drawing mutation**: **resolved for the relevant P6 authority**. The fixture extracts and executes the current P4 revision/draft-child guards and triggers and the current P5 camera validator, exact source constraints, source mutation guard, source revision/domain triggers, grants, and RLS from their historical migrations. The old approved-source mutation is now asserted to fail with `Approved drawing revision is immutable`; status-corruption probes explicitly disable the production revision trigger and are labelled table-owner damage probes rather than normal production mutations.
- Previous **I3 real-PostgreSQL proof matrix**: **partially resolved, still Important**. Deterministic edit-versus-finalize/decision locking, role-isolated direct INSERT/UPDATE/DELETE denial for all three bridge tables, retries, RLS visibility, immutable owner/service paths, and index plans were added. The fresh-schema, complete cross-project-position, and complete lifecycle-status real-PostgreSQL paths described above remain absent.
- Previous **M1 snapshot composite FK leading index**: **resolved**. Exact leading indexes now cover `(drawing_revision_id,project_id,drawing_revision_version,drawing_snapshot_sha256)` and `(drawing_object_id,drawing_revision_id,project_id)`; both PGlite catalog assertions and the real-PostgreSQL catalog/EXPLAIN body name and verify them.

## Verification evidence

- `node --test --test-reporter=spec tests/drawing-workspace-p6-database-contract.test.mjs`: **13 passed, 0 failed, 0 skipped**.
- P5 DB plus Task 1/P4 focused run (`drawing-workspace-p5-database-contract`, `drawing-quantity-lineage`, `drawing-workspace-measurements`, `drawing-workspace-semantic-schedules`, `verified-boq`): **53 passed, 0 failed, 0 skipped**.
- Ordinary no-URL real-PostgreSQL gate: **0 failed, 2 skipped**, with the authority test marked `P6 real PostgreSQL gate is UNEXECUTED`.
- Required no-URL gate, `P6_REAL_POSTGRES_REQUIRED=1 node --test --test-reporter=spec tests/drawing-workspace-p6-postgres-concurrency.test.mjs`: expected nonzero; **0 passed, 1 failed, 1 skipped**, exact message `P6 real PostgreSQL gate is UNEXECUTED`.
- `npm run typecheck`: PASS.
- Prettier check for the fixture and both P6 database test files: PASS.
- Fix 4 four-file `git diff --check` and current worktree `git diff --check`: PASS.

## External authorities still UNEXECUTED

1. The real-PostgreSQL suite itself was not executed because `P6_REAL_POSTGRES_DATABASE_URL` is absent. The fail-closed required gate behaves correctly. This external absence does not add a finding beyond the incomplete suite-body finding above.
2. Hosted Supabase migration/advisors and generated real-schema types remain UNEXECUTED because hosted project authority is absent. `platform/database.types.ts` was not changed.
3. Production/deployed two-user, cross-organization, Storage/CORS, backup/restore, and performance gates remain later release authorities and were not treated as local PASS evidence.

Ponytail review: no deletion recommendation in this Fix 4 scope. The added fixture and adversarial checks are large because they directly encode the required authority matrix; adding another abstraction or dependency would not close the remaining real-PostgreSQL coverage gap.
