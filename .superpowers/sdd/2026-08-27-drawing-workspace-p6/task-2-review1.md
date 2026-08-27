# P6 Task 2 independent review 1

Range reviewed: `b6b4363..56e4f24` (`56e4f24`) in detached worktree `/tmp/goagent-p6-task2-review-56e4f24`.

Verdict: **BLOCKED** — not READY.

## Findings

### Critical

1. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:246-255` — `lukas_drawing_put_boq_link` locks and authorizes the caller-selected `p_boq_version_id`, but when `p_id` already exists it never requires `v_result` to belong to that same version/source/line/project before the stale-version branch and unconditional `UPDATE ... WHERE id=p_id`. A maker of any draft B can pass a known link ID from another maker's A (including A in `in_review` or `approved`), use B's valid source/line to satisfy the earlier ancestry checks, provide A's current `base_version`, and overwrite A's factor. The factor-total query is calculated for B while the UPDATE changes A. This is a cross-maker mutation and defeats immutable approved/reviewed child evidence. Reject an existing ID unless every persisted ancestry field matches the requested values, and lock/revalidate the persisted link's own BOQ version/status/maker (ideally predicate the update on those values and its OCC version).

2. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:412-433` — replacing `lukas_qto_decide_boq` with `SECURITY DEFINER` bypasses the existing BOQ approval/version RLS policies, but adds no authenticated non-anonymous session, project membership, or reviewer-role check. The retained approval trigger verifies only `in_review` plus “not the maker”; it does not verify membership. Thus any other authenticated (including an anonymous Auth session, which also has the `authenticated` database role) caller that knows a version UUID can insert an approval/decision and transition that BOQ. Keep this path invoker-authorized or explicitly check `private.lukas_qto_verified_session()` and `private.lukas_qto_project_role(v.project_id) in ('owner','staff','reviewer')` before inserting; preserve the independent-reviewer predicate.

3. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:145-167, 295-317, 412-420` — the frozen `input_state_sha256` does not cover the authority it is supposed to freeze. It includes BOQ-line fields, Drawing-link IDs/factors, and component IDs/coefficient only; it omits Drawing quantity-link evidence/value/unit/snapshot/fingerprint, every legacy mapping/exclusion, price book/resource/effective evidence, and other calculation inputs. A permitted draft edit to an omitted legacy mapping or price resource between input retrieval and finalize therefore leaves the SHA unchanged and lets the stale TypeScript result/manifest be frozen and later approved. The public input RPC also cannot supply the required complete authoritative input. Canonicalize and digest every line, legacy/Drawing source, mapping, resource/component, and price-book field used by the 1.1 engine, then exercise the edit-vs-finalize and approval races on real PostgreSQL.

### Important

4. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:169-224` — the private quantity boundary accepts the caller's `raw_quantity` and fingerprint. It only checks fingerprint syntax, not a fingerprint recomputed from the exact canonical snapshot object, and it neither requires `v_snapshot.schema_version = 2` nor searches `canonical_json->'objects'` for exactly the claimed active object/geometry/version/lineage. It consequently does not repeat P4 measurement and exact unit conversion either. This fails the required DB-side defense against stale/wrong snapshot objects and a compromised trusted caller. Re-load and validate the schema-v2 snapshot object, recompute canonical fingerprint and P4 measure/conversion, and compare all derived values before the insert/replay decision.

5. `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql:321-371` — material handoff verifies structural resource/plan compatibility but never derives `derivedDesignQuantity` from the approved BOQ final quantity and component coefficient, nor verifies each plan's `design_quantity` equals the exact grouped link sum. It also accepts any same-project file with the supplied SHA as the “manifest” rather than binding it to the approved BOQ manifest, and both `ON CONFLICT ... DO NOTHING` paths silently accept mismatched retries. The private boundary can therefore persist an arbitrary design quantity or return success for a divergent replay. Recompute/compare the quantities and grouped plan totals, verify the file is the re-downloaded approved manifest associated with this result/manifest hash, and compare all persisted values on conflicts before returning an idempotent result.

6. `platform/tests/drawing-workspace-p6-database-contract.test.mjs:1-89` and `platform/tests/drawing-workspace-p6-postgres-concurrency.test.mjs:1-12` — Step 9 is not implemented. The former only regex-matches migration text; it never applies a schema or tests fresh/upgrade preservation, RLS, grants, anonymous Auth, direct DML, foreign ancestry, triggers, retry/OCC, locks, or query plans. The claimed real-PostgreSQL test only asserts that an environment variable exists and performs no database work. This allowed all defects above to pass. Add executable PGlite fresh/seeded-upgrade tests plus an actual real-PostgreSQL suite for the stated adversarial and concurrency matrix.

## Scope/compliance notes

- The range changes exactly the migration and the three Task 2 test/fixture files. No `platform/database.types.ts`, P4 evidence, or `.superpowers/audits/` file is in the range. With no project authority and no `SUPABASE_PROJECT_REF`, leaving generated database types unchanged is correct.
- The migration declares exactly the three companion public tables and the six fixed planned P6 functions; it does not add a Realtime publication. The surface test confirms those strings only.
- Ponytail review: Lean already. Ship.

## Commands and evidence

- `node --test tests/drawing-workspace-p6-database-contract.test.mjs` — PASS (3 static-text tests only).
- `P6_REAL_POSTGRES_REQUIRED=1 node --test tests/drawing-workspace-p6-postgres-concurrency.test.mjs` — exits 1 with `P6 real PostgreSQL gate is UNEXECUTED` because `P6_REAL_POSTGRES_DATABASE_URL` is absent. This is honest non-pass behavior, but it proves no concurrency/RLS behavior.
- `git diff --check b6b4363 56e4f24` — PASS.
- A local PGlite execution could not be run: the checked-out worktree has no `node_modules` and `@electric-sql/pglite` is unavailable. No local Postgres client/server or database authority variables are available.

## Residual UNEXECUTED gates

1. Real PostgreSQL fresh migration, seeded P0-P5 upgrade preservation, RLS/grant/SECURITY DEFINER audit, and concurrent lock/OCC proof.
2. Hosted Supabase migration/advisors and type generation (`SUPABASE_PROJECT_REF` absent).
3. Full PGlite fresh/upgrade adversarial suite (not implemented and PGlite unavailable in this worktree).
4. Required production/deployed two-user, cross-organization, Storage/CORS, deterministic export, performance, and backup/restore gates.
