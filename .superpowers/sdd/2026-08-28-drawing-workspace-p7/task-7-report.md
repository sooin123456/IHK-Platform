# P7 Task 7 — release and completion audit

## Outcome

Task 7 implementation and local audit are complete, but the P0–P7 program is **not release-complete**. The final fail-closed requirement ledger records **35 PASS / 1 NOT_MET / 11 UNEXECUTED**, overall `NOT_MET`, with 12 unresolved production inputs/gates when the cold miss is counted with external authorities.

Implementation commits:

- `6e06b2f` — fail-closed P7 release authority, current desktop/tablet and actual-identity production Playwright contracts.
- `dab2049` — first source-bound performance refresh after Task 7 authority.
- `2d5c5c2` — complete production evidence composition and provider telemetry boundary.
- `cb1b567` — final source-bound performance and managed-restore evidence binding before the full matrix.
- `8155fa3` — repository-relative receipt authority and source-commit binding that survives evidence-only commits.

## Added release authority

- One exact local gate manifest runs the full Drawing Workspace suite, focused PGlite, required real-PG mode, desktop/tablet Chromium, collaboration protocol/service/Yjs, PDF/IFC, BOQ/material, source-bound 10k performance, retention/restore, organization/admin, license, both typechecks/builds and diff check.
- The runner does not fail fast, so a missing real PostgreSQL authority cannot hide later local regressions.
- One 47-requirement evidence schema distinguishes `PASS`, `NOT_MET`, and `UNEXECUTED`, binds the current commit/source tree, and hashes child receipts. A standalone JSON file does not provide execution authority.
- Production authority rejects local/fixture/example identities and requires three exact existing auth UUID/email pairs. The mounted Playwright flow opens all three identities, authors an offline operation, reconnects with zero loss, comments, revises, requests review, independently approves, denies mutation of the approved revision, exports audited bytes, and compares every project PDF/IFC Storage byte before/after.
- Provider telemetry must be returned from a hosted authenticated endpoint with provider request identity, body SHA, exact deployment/commit/region, cold startup and collaboration p95, CPU and RSS. No self-attested runtime metric is accepted.
- Managed restore continues to require provider-issued backup identity, a distinct isolated project and byte/domain comparison.

## Fresh local evidence

```text
npm run release:drawing-workspace-p7:local
overall NOT_MET
requirements: PASS 35 / NOT_MET 1 / UNEXECUTED 11
exit nonzero
```

Key child results:

- Complete Drawing Workspace Node suite: **831 total / 825 pass / 0 fail / 6 authority skips**.
- Focused PGlite matrix: **173 total / 170 pass / 0 fail / 3 real-PG skips**.
- Required real PostgreSQL mode: **20 pass / 2 expected failures** because both real database URL authorities are absent; recorded as `UNEXECUTED`, not a regression failure.
- Desktop/tablet production-build Chromium: **3/3 pass**, with 1280x720, 768x1024 and 1024x768 screenshots.
- Collaboration service/protocol/Yjs: PASS.
- PDF/IFC lifecycle and source contracts: PASS.
- BOQ/material/golden bytes: **90/90 pass**.
- Retention/restore route contracts: **15/15 pass**.
- Organization/library/admin route contracts: **14/14 pass**.
- License and notice closure: **7/7 pass**; current lock adds no new dependency and no Rayon asset/copy exists.
- Application typecheck/build and collaboration typecheck/build: PASS.
- `git diff --check`: PASS for implementation-owned changes.

## Current performance truth

The final full runner refreshed Task 4 against source commit `8155fa3db98d1fd1ef3a02ed11a4088fdfbfd087`:

- exact 10k browser gates: 3/3 PASS;
- warm reopen first usable: **2290.4ms MET**;
- cold/cache-miss first usable: **2713.4ms NOT MET**;
- warm interaction p95: zoom **0.2ms**, pan **0.3ms**, selection **9.0ms**, all MET;
- hosted production runtime: **UNEXECUTED**.

Warm reopen is not relabeled as cold startup. Overall release therefore remains nonzero even if every local functional gate passes.

## Current visual evidence

- `task-7-desktop-1280x720.png`: current PDF/IFC split, canvas-first center and recoverable docks.
- `task-7-tablet-portrait-768x1024.png`: persistent canvas and one mutually exclusive tool surface.
- `task-7-tablet-landscape-1024x768.png`: persistent canvas, visible IFC split and focus-restoring drawer interaction.

All three gates assert no document-level overflow, one mounted workspace canvas, current copy without the stale P4 badge, >=44px tablet targets, and focus return to the canvas.

## Exact non-PASS requirements

`NOT_MET`:

- `performance.cold_startup` — 2713.4ms exceeds 2500ms.

`UNEXECUTED`:

- production PDF/IFC SHA before/after;
- production offline zero loss;
- real PostgreSQL RLS and approved-revision immutability;
- hosted collaboration;
- hosted provider runtime telemetry;
- managed backup restore and RPO/RTO;
- three real production users;
- mounted production route/actions;
- production export audit.

The managed restore runner was refreshed with source commit `8155fa3` and exited 2 on the first missing input, `P7_RESTORE_MANAGEMENT_ACCESS_TOKEN`; the full required input list is recorded in `docs/P0_P7_IMPLEMENTATION_MATRIX.md`.

## Release ruling

The locally actionable Task 7 audit boundary is implemented and locally verified. The Drawing Workspace program must remain active and must not be marked complete until the cold/cache-miss threshold is met and every production authority above produces a current receipt.
