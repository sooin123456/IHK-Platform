# P7 Task 7 — release and completion audit

## Outcome

Task 7 implementation and local audit are complete, but the P0–P7 program is **not release-complete**. The final fail-closed requirement ledger records **35 PASS / 1 NOT_MET / 12 UNEXECUTED**, overall `NOT_MET`, with 13 unresolved gates when the cold miss is counted with external authorities.

Final hardening commits:

- `c63ec79` — reviewer/approver separation, production-flow authority, immutable receipt boundary, license closure and desktop/tablet evidence hardening.
- `efdc719` — first post-hardening source-bound performance refresh.
- `88dbc7b` — final source change, scoping diff authority to implementation source so user-owned audit output cannot create a false failure.
- `bcce6ef` — final Task 4 performance evidence bound to source commit `88dbc7b`.

## Added release authority

- One exact local gate manifest runs the full Drawing Workspace suite, focused PGlite, required real-PG mode, desktop/tablet Chromium, collaboration protocol/service/Yjs, PDF/IFC, BOQ/material, source-bound 10k performance, retention/restore, organization/admin, license, both typechecks/builds and diff check.
- The runner does not fail fast, so a missing real PostgreSQL authority cannot hide later local regressions.
- One 48-requirement evidence schema distinguishes `PASS`, `NOT_MET`, and `UNEXECUTED`, invokes current child semantic validators, binds the current source tree and hashes child receipts. A coordinated rewrite of mutable JSON/logs cannot provide completion authority; final PASS additionally requires an immutable or externally signed completion receipt.
- Production authority rejects local/fixture/example identities and requires three exact existing auth UUID/email pairs with author, reviewer and approver authority. The mounted Playwright flow uses UI actions for revise/review/final approval, proves the exact offline `clientOperationId` is persisted once, verifies the actual browser WSS URL, denies mutation of the approved revision, verifies the exact export request/audit event, and compares every project PDF/IFC Storage byte before/after.
- Reviewer and Approver are distinct project roles. A reviewer can record `reviewed`; only an independent approver can record final `approved`, and role crossover/maker-checker violations are denied at the database and action boundaries.
- Hosted runtime telemetry cannot PASS from an arbitrary application HTTPS response. It requires a trusted provider-domain, nonce-bound, signed or immutable provider receipt for deployment/commit/region, cold startup, collaboration p95, CPU and RSS.
- Managed restore continues to require provider-issued backup identity, a distinct isolated project and byte/domain comparison.

## Fresh local evidence

```text
npm run release:drawing-workspace-p7:local
overall NOT_MET
requirements: PASS 35 / NOT_MET 1 / UNEXECUTED 12
exit nonzero
```

Key child results:

- Complete Drawing Workspace Node suite: **841 total / 835 pass / 0 fail / 6 authority skips**.
- Focused PGlite matrix: **173 total / 170 pass / 0 fail / 3 real-PG skips**.
- Required real PostgreSQL mode: **20 pass / 2 expected failures** because both real database URL authorities are absent; recorded as `UNEXECUTED`, not a regression failure.
- Desktop/tablet production-build Chromium: **3/3 pass**, with 1280x720, 768x1024 and 1024x768 screenshots.
- Collaboration service/protocol/Yjs: PASS.
- PDF/IFC lifecycle and source contracts: PASS.
- BOQ/material/golden bytes: **90/90 pass**.
- Retention/restore route contracts: **15/15 pass**.
- Organization/library/admin route contracts: **14/14 pass**.
- License and notice closure: **9/9 pass**; the actual 14-root/33-transitive drawing dependency closure and notices are permissive, and no Rayon asset/copy exists.
- Application typecheck/build and collaboration typecheck/build: PASS.
- `git diff --check`: PASS for implementation-owned changes.

## Current performance truth

The final full runner refreshed Task 4 against source commit `88dbc7b03d0c11ec70e3a20543b67916abf1f47e`:

- exact 10k browser gates: 3/3 PASS;
- warm reopen first usable: **2284.6ms MET**;
- cold/cache-miss first usable: **2843.8ms NOT MET**;
- warm interaction p95: zoom **0.2ms**, pan **0.3ms**, selection **8.3ms**, all MET;
- hosted production runtime: **UNEXECUTED**.

Warm reopen is not relabeled as cold startup. Overall release therefore remains nonzero even if every local functional gate passes.

## Current visual evidence

- `task-7-desktop-1280x720.png`: current PDF/IFC split, canvas-first center and recoverable docks.
- `task-7-tablet-portrait-768x1024.png`: persistent canvas and one mutually exclusive tool surface.
- `task-7-tablet-landscape-1024x768.png`: persistent canvas, visible IFC split and focus-restoring drawer interaction.

All three gates assert no document-level overflow, one mounted workspace canvas, current copy without the stale P4 badge, scroll-reachable toolbars, safe-area behavior, >=44px tablet targets, and focus return to the canvas. Every screenshot is SHA-256/dimension bound to the current source tree and client/server build.

## Exact non-PASS requirements

`NOT_MET`:

- `performance.cold_startup` — 2843.8ms exceeds 2500ms.

`UNEXECUTED`:

- production PDF/IFC SHA before/after;
- production offline zero loss;
- real PostgreSQL RLS, approved-revision immutability, and reviewer/approver separation;
- hosted collaboration;
- hosted provider runtime telemetry;
- managed backup restore and RPO/RTO;
- three real production users;
- mounted production route/actions;
- production export audit.

The managed restore runner exited 2 on the first missing input, `P7_RESTORE_MANAGEMENT_ACCESS_TOKEN`; its receipt remains explicitly `UNEXECUTED` with no fabricated source/provider identity. The full required input list is recorded in `docs/P0_P7_IMPLEMENTATION_MATRIX.md`.

## Release ruling

The locally actionable Task 7 audit boundary is implemented and locally verified. The Drawing Workspace program must remain active and must not be marked complete until the cold/cache-miss threshold is met and every production authority above produces a current receipt.
