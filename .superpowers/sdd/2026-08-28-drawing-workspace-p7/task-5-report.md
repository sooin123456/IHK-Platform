# P7 Task 5 — Retention, archive, backup and restore authority

## Status

- Initial implementation commit: `74b5dceffa8f93ceaf8c58fbe0f04f3d2b2c64a0`.
- Provider/checkout/purge hardening commit: `bf76204c16fb35fef56b5464378462f5716a069b`.
- Review hardening and export-audit implementation: `43464cf9507e51459834066a72b11695884a7ddf`.
- Latest source/build-bound performance refresh: `289a4b9` (capture is bound to `43464cf`).
- Local DB, server, route, restore-runner, typecheck, build, and complete Drawing Workspace regressions: **PASS**.
- Real PostgreSQL catalog/RLS counterexamples: **UNEXECUTED** (`P7_REAL_POSTGRES_DATABASE_URL` unavailable).
- Managed Supabase backup -> isolated restore: **UNEXECUTED** (Management API, backup, restored-project, hosted DB, and Storage authorities unavailable).
- No provider identity, RPO, RTO, row digest, or storage digest was fabricated. The missing-authority runner exited `2` and wrote `task-5-restore-evidence.json` with null RPO/RTO.

## Delivered vertical slice

- One forward migration, `20260828052729_drawing_workspace_retention_restore.sql`.
- Project lifecycle columns with a trigger-guarded archive/delete-request boundary; interactive project DELETE grant and policy are removed.
- Append-only organization retention policy versions, lifecycle/legal-hold/purge events, restore-run records, and exact export events. Stable request identities are transaction-locked, idempotent for the same payload, and reject mismatched reuse; restore rehearsal identity permits a new attempt against the same backup/target.
- Organization owner/admin/staff RPC authority rechecks; route actions bind the route organization and accept only exact stable fields. Organization managers list every organization project through a bounded authority RPC even without project membership, while active holds come from an unpaginated database boundary rather than the 100-event activity feed.
- Service-role-only trusted purge. Retention expiry, active legal holds, approvals, approved BOQs, quantity/BOQ/material lineage, published/imported library provenance, and material transactions are checked before deletion. Immutable files enter a two-phase `STORAGE_REQUIRED` flow: an append-only path/SHA/size manifest is retained, Storage deletion is performed externally, and finalization rechecks the manifest, holds, dependencies, and `storage.objects` absence before project metadata is deleted. Any approved or linked evidence remains `HELD`.
- Drawing PDF/PNG/SVG, approved and legacy BOQ CSV/XLSX/manifest, and material CSV downloads cross one server audit boundary that hashes the exact response bytes before release. Revit retains its existing server-side release-SHA audit. Audit failure fails the download.
- Organization administration screen for policy versions, archive/delete requests, complete active legal holds, lifecycle audit, and provider-verified restore history. Archived projects leave the active workspace list.
- Managed restore runner that binds the checked-out Git commit and an idempotent request UUID, requires a provider-issued completed physical backup and distinct provider project ID/ref, compares the physical PostgreSQL system identifier, the complete current `lukas_qto_*`/`lukas_drawing_*` public-table inventory, schema/catalog (columns, constraints, relation/RLS flags, ACLs, functions, policies, triggers, indexes, types, views, sequences, and extensions), immutable Storage bytes and recorded SHA/size, accepted Yjs state, approvals, and BOQ/material lineage, and records provider-derived RPO/live-measured RTO through a service-only append boundary. Missing Storage is `NOT MET`; unavailable Storage authority is `UNEXECUTED`.
- Deployment runbook for real PostgreSQL proof, isolated Supabase restore, Storage restoration, authority variables, purge scheduling, exit codes, and teardown.

The implementation adds no dependency, state manager, queue, provider abstraction, or duplicate drawing/business schema. Approved and immutable evidence is conservatively retained instead of inventing a destructive cascade that would violate existing immutable-child guards.

## Strict TDD evidence

### RED

- Database contract: `0/4` — the required single migration and retention authorities did not exist.
- Admin boundary: `0/3` — server module and route did not exist; workspace did not filter archived projects.
- Managed restore boundary: `0/4` — restore runner did not exist.
- Immutable Storage integrity regression: `3/4` — equal digests could pass when both snapshots declared failed byte integrity.
- Existing approval/lineage inventory regression: `4/5` — the first inventory used nonexistent generic table names rather than the canonical BOQ/material tables.
- Review round: `7` expected failures covered organization-wide manager listing, old active holds, retry/concurrency identity, two-phase immutable Storage purge, full schema drift detection, real-role counterexamples, and exact export auditing.

### GREEN

```text
node --test tests/drawing-fixture-cleanup.test.mjs \
  tests/drawing-workspace-p7-export-audit.test.mjs \
  tests/drawing-workspace-p7-retention-database.test.mjs \
  tests/drawing-workspace-p7-retention-route.test.mjs \
  tests/drawing-workspace-p7-restore.test.mjs
tests 25; pass 24; fail 0; skipped 1 real PostgreSQL
```

PGlite executes archive/delete-request, append-only guards, cross-organization denial, legal hold/release retries, concurrent-safe request identities, protected-evidence retention, two-phase immutable Storage purge, complete active-hold listing, restore retry/new rehearsal, and exact export evidence. The optional real PostgreSQL gate additionally executes outsider session SELECT/RPC denial, owner direct DELETE denial, and service purge organization mismatch through role/JWT session context; it remains skipped locally and becomes a hard failure with `P7_REAL_POSTGRES_REQUIRED=1`.

## Restore authority evidence

```text
P7_RESTORE_COMMIT=43464cf9507e51459834066a72b11695884a7ddf \
  P7_RESTORE_REQUEST_ID=2d484f7a-ec51-4b41-9c08-0aca9e5c0aa0 \
  npm run release:drawing-workspace-p7:restore
UNEXECUTED: missing P7_RESTORE_MANAGEMENT_ACCESS_TOKEN
exit 2
```

The resulting evidence is commit-bound and reports provider/comparison `UNEXECUTED`, all six evidence domains outstanding, and null RPO/RTO. Production `PASS` requires a provider-issued completed physical backup identity, a distinct active isolated project identity, a matching physical PostgreSQL system identifier, hosted source/target database authority, source/target Storage byte authority, exact domain equality, and successful append-only recording.

## Performance evidence refreshed after Task 5

The Task 4 source-tree digest intentionally covers application, scripts, and tests, so the review hardening invalidated the previous capture. The old JSON was not manually rebound. The exact production-build Playwright runner rebuilt the application and executed all three browser gates against `43464cf` before evidence commit `289a4b9`:

- exact Playwright gates: `3/3 PASS`;
- warm reopen first usable: `2208.1 ms — MET` (`<= 2500 ms`);
- cold/cache-miss baseline: `2854.2 ms — NOT MET`;
- warm p95: zoom `0.2 ms`, pan `0.2 ms`, selection `8.6 ms` — all `MET` (`<= 16.7 ms`);
- hosted production: `UNEXECUTED`.

## Final verification

```text
npm run typecheck
PASS

npm run build
PASS (existing Vite chunk and React Router future warnings only)

node --test tests/drawing-workspace-p7-performance.test.mjs
tests 14; pass 14; fail 0

npm run test:drawing-workspace
tests 800; pass 795; fail 0; skipped 5
```

The complete regression includes the P6 exact golden measurement/hash oracle, P0–P7 migrations and invariants, PDF/IFC source authority, collaboration/Yjs, approvals, BOQ/material lineage, library authority, performance provenance, and Task 5 retention/restore contracts.

## Honest remaining gates

- Real PostgreSQL RLS/ACL/trigger and role/JWT counterexample execution needs a disposable hosted database or authorized operator connection with bounded `SET ROLE` authority.
- A managed Supabase backup must be restored into a distinct isolated project, and its private Storage objects restored, before schema/data/Storage/Yjs/approval/lineage equality and RPO/RTO can be recorded.
- Until both authorities exist, Task 5 production recovery readiness is **UNEXECUTED**, not `PASS`.
