# P6 Task 2 independent rereview 1

Reviewed commit: `6719efa13851a9ce02a95fb1af498c62ca3b39b6`

Review authority: clean detached worktree at `/tmp/goagent-p6-task2-rereview1.Q9nCLZ`; no implementation file was modified.

Verdict: **BLOCKED** — not READY.

Finding counts: **1 Critical, 3 Important, 1 Minor**.

## Findings

### Critical

1. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:794-838,1077-1099`, together with `platform/supabase/migrations/20260820025118_verified_boq_v1.sql:267-285` — the new finalize/decision protocol locks the BOQ version, but the inherited guard for legacy BOQ children neither locks that version nor protects the OLD identity on UPDATE. It chooses only `new.version_id/new.project_id` and performs a plain SELECT. This has two independently exploitable consequences:

   - An authenticated estimator can move an existing mapping, exclusion, component, line, or other guarded child out of an `approved`/1.1 frozen version into another draft version the actor owns; the trigger checks only that draft destination. I reproduced this against the executable actual Verified BOQ migrations: an approved 1.0 mapping was updated to the seeded draft version/line and committed while the source version remained `approved`.
   - A legacy child edit whose trigger observes `draft` can remain uncommitted while finalize hashes the old row and commits `in_review`; decision can then hash the still-invisible old row and commit `approved`, after which the edit commits. The stored input/result/manifest hashes then describe different child rows from the approved database state.

   This violates the explicit edit-after-lock and approved-child immutability contracts and can corrupt approved financial evidence. The forward migration must replace/harden `lukas_qto_guard_boq_draft_child()`: validate OLD as well as NEW identity, reject version/project relocation, and acquire the BOQ-version row lock before accepting every contributing child mutation. A real-PostgreSQL edit-versus-finalize/approve test must hold the edit transaction open across both boundaries.

### Important

1. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:859-874` and `platform/tests/fixtures/drawing-workspace-p6-database-fixtures.mjs:69-77,707-714` — material handoff incorrectly requires the approved manifest file SHA/path digest to equal `lukas_qto_boq_versions.manifest_sha256`. The latter is the frozen **calculation manifest** SHA; the approved bytes include the later approval envelope and have the distinct `handoff_sha256`, which Task 8 uses in `.../boq-manifests/{handoffSha256}.manifest.json`. A correct approved handoff is therefore rejected unless two different byte strings collide; storing the calculation manifest instead would omit the approval envelope and violate the evidence contract. The fixture masks this by using the same `p6Sha.manifest` for both concepts. Bind `p_manifest_file_sha256` and the storage suffix to the actual handoff file SHA, retain the separate calculation-manifest check through the approved BOQ authority, and test two deliberately distinct hashes.

2. `platform/tests/fixtures/drawing-workspace-p6-database-fixtures.mjs:80-93,206-209,428-485` — the fixture and therefore both executable suites do not run the relevant current P5 authority or exact current Drawing DDL. They create handwritten reduced tables, then extract only selected P4 functions plus actual Verified BOQ/material migrations. In particular, the production `lukas_drawing_object_sources_revision_guard` / `lukas_drawing_draft_child_guard` is absent; the database test at `platform/tests/drawing-workspace-p6-database-contract.test.mjs:568-580,650-674` consequently updates a source on an approved revision, an operation production DDL rejects. The populated preservation assertions are meaningful for the rows included, and the PGlite diagnostic correctly disclaims RLS/locking proof, but the fix report's “exact current P0/P4/P5 authority” claim is overstated. Apply the relevant historical migration chain or exact current constraints/triggers/RLS, and keep adversarial state changes possible under that authority.

3. `platform/tests/drawing-workspace-p6-postgres-concurrency.test.mjs:267-390,428-529` — the real-PostgreSQL body is safely isolated and fail-closed when required, but it still does not implement Task 2's required proof matrix. Its “submission race” at lines 340-349 is finalize-versus-finalize, not a legacy line/mapping/component edit held across finalize and approval, so it missed the Critical defect. The shared fixture seeds an other-project user/file but no other-project revision, object, snapshot, quantity, BOQ, line, component, resource, plan, or manifest positions; neither suite tests every cross-project FK position. Direct authenticated INSERT/UPDATE/DELETE and RPC allow/deny are also not covered across all three bridge tables, roles, and required Drawing/BOQ statuses. Add the missing production-DDL fresh/upgrade runs, full foreign-ID/direct-DML matrix, and independently connected transaction races with deterministic synchronization.

### Minor

1. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:113-116,161-167` — the quantity table has no index whose leading columns cover the snapshot composite FK `(drawing_revision_id,project_id,drawing_revision_version,drawing_snapshot_sha256)`. The drill-down index stops at project/revision/object, and the unique quantity identity substitutes object/kind/rule for the snapshot version/SHA. Parent snapshot UPDATE/DELETE enforcement can therefore inspect all quantity rows for a revision, contrary to spec section 4.1 and the Supabase Postgres FK-index guidance. Add the exact snapshot-FK index and assert its catalog shape/plan.

## Prior finding disposition and semantic audit

- Prior Critical known-ID cross-maker/status mutation: **resolved**. Existing BOQ-link IDs are loaded first, their persisted version is locked, and exact project/version/source/line/maker/status/OCC identity is checked before mutation.
- Prior Critical unauthorized decision: **resolved**. The definer function now requires non-null `auth.uid()`, a verified nonanonymous session, independent reviewer identity, and `owner|staff|reviewer` project authority; 1.0 transition behavior remains additive.
- Prior Critical incomplete 1.1 digest: **content coverage resolved, transaction safety not resolved**. The digest now includes engine/policy/scale, line/section fields, full Drawing source/link/anchor/issue evidence, legacy mappings/exclusions, components/resources, and price-book evidence. No unsafe `FOUND` dependency remains. The Critical legacy-child lock/identity defect still defeats the frozen digest.
- Prior Important quantity boundary: **resolved**. The SQL repeats schema-v2/status/decision/revision/snapshot checks, canonical object identity/fingerprint, P4 kind/unit/value, exact integer-sqrt and micromillimetre half-away rounding, fixed PI, polygon final-perimeter behavior, and opening-host identity/bounds. Focused SQL golden tests passed.
- Prior Important material boundary: **mostly resolved, but not closed**. Strict parsing, approved/superseded result/decision authority, resource/component/line/plan ancestry, plan/link replay, grouped totals, and immutability are present. The calculation-manifest versus approved-handoff SHA conflation remains Important finding 1.
- Prior Important executable tests: **materially improved, but not closed**. PGlite executes SQL and meaningful populated preservation; the real-PG harness uses random exact database/role names, independent connections/JWT roles, bounded cleanup, migration application, and an honest required gate. Important findings 2-3 describe the remaining fidelity and matrix gaps.
- Grants/RLS/search paths/helper execution: no additional finding. PUBLIC/anon/private helper execution is explicitly revoked, authenticated gets SELECT plus the fixed public RPCs, security-definer paths use empty search paths, restrictive verified-session SELECT policies exist, and immutable triggers cover quantity/material rows.
- Surface/global constraints: exactly three P6 companion tables and the six planned mutation/read boundaries are added. No Realtime publication, backfill, fourth table, extra RPC, result JSON column, dependency, or lockfile change was found.
- Ponytail review: no over-engineering finding. The deterministic SQL helpers are substantial but directly implement required P4 and authority behavior; no separate engine/table/API should be added to address the findings.

## Verification evidence

- Focused combined run (P6 PGlite, real-PG configuration/body, P5 DB, Task 1, P4 measurements): **32 tests; 30 pass, 0 fail, 2 skip**. Both skips are the absent real-PostgreSQL authority.
- `node --test tests/drawing-workspace-p6-database-contract.test.mjs`: **9/9 pass**.
- `node --test tests/drawing-workspace-p5-database-contract.test.mjs`: **4/4 pass**.
- `node --test tests/drawing-quantity-lineage.test.mjs`: **8/8 pass**.
- `npm run typecheck`: PASS.
- Prettier check of all three P6 test/fixture files: PASS.
- `git diff --check 6719efa^ 6719efa` and current `git diff --check`: PASS.
- Required no-URL gate, `P6_REAL_POSTGRES_REQUIRED=1 node --test tests/drawing-workspace-p6-postgres-concurrency.test.mjs`: expected nonzero; **0 pass, 1 fail, 1 skip**, exact message `P6 real PostgreSQL gate is UNEXECUTED`.
- Focused relocation probe using the executable actual Verified BOQ migrations: PASS as a defect reproduction; the approved mapping committed with the draft destination version/line while its source BOQ remained approved.

Only the authorized shared `platform/node_modules` symlink was used to execute these commands; no package install or lock artifact was created.

## External authorities still UNEXECUTED

1. Real PostgreSQL execution of fresh/upgrade RLS, trigger scheduling, concurrent OCC/submission/edit races, and EXPLAIN behavior: `P6_REAL_POSTGRES_DATABASE_URL` is absent. The absence itself is not a code finding; Important finding 3 is the statically verified missing coverage in the suite body.
2. Hosted Supabase migration/advisors and real-schema type generation: project authority and `SUPABASE_PROJECT_REF` are absent. `platform/database.types.ts` was correctly left unchanged.
3. Production/deployed two-user, cross-organization, private Storage/CORS, backup/restore, and release-performance authorities remain later P6 release gates and were not represented as local PASS evidence.
