# P4 Task 7 implementation report

Base: `ea7885c257f3b5cbae314d25ae31d86c553d6a51`

## Implemented result

- Added fail-fast, separately labelled local and production release commands.
  The production command validates every hosted application, Supabase,
  collaboration, database, and run-identity authority before Playwright starts
  and exits nonzero as `UNEXECUTED` when they are absent.
- Added a deterministic exact 10,000-object fixture: 2,000 walls, 2,000 hosted
  openings, and 1,500 each spaces, areas, grids, and arcs. Invalid fixture size,
  duplicate identity, broken host linkage, and wrong selection targets fail the
  release contract.
- Split Chromium evidence at its real boundaries: source-module-dependent P4
  and IndexedDB functional regressions run against Vite; the decision benchmark
  runs against the built application on a dedicated non-reused loopback port.
- Added the hosted P4 semantic production gate after the existing exact P3
  provider gates. With real authorities it checks semantic persistence,
  server-derived measurement and schedules, organization/RLS denial, draft-only
  editor mutation, review freeze/approved immutability, and source re-read.
- Kept semantic export, measurement, schedules, IFC/PDF/quantity/approval/Revit,
  source SHA-256, collaboration service, builds, licenses, audits, and diff
  checks in the executable local release path.
- Added only release fixtures, runners, tests, and status/runbook evidence. No
  dependency, lockfile, migration, RPC, product feature, or hosted state changed.

## TDD evidence

- Initial release contract: 6 discovered, 1 passed and 5 failed because the P4
  fixture, runner, scripts, and evidence were absent.
- Initial browser contract failed `expected 10000, received 8` before the exact
  fixture was connected to the preview.
- Port ownership, server `PORT` propagation, and inert loopback root-loader
  variables each had a focused red contract before the production-build harness
  was changed.
- The combined production-serve attempt exposed that existing functional specs
  intentionally import Vite source modules. The package/runner contract was
  changed red-first to require separate functional and production-performance
  commands.
- The production benchmark then exposed transient detached layout during the
  10,000-object navigation. The test now waits for a positive box across two
  animation frames before declaring the surface usable.

## Executed local evidence

- `npm run release:drawing-workspace-p4:local`: **LOCAL PASS**.
- Whole Node suite: 844 discovered; 843 passed, 0 failed, 1 explicit disposable
  PostgreSQL `UNEXECUTED` skip.
- Drawing suite: 608 discovered; 607 passed, 0 failed, the same 1 explicit
  `UNEXECUTED` skip. Collaboration service: 33/33. Explicit
  IFC/PDF/quantity/approval/Revit regressions: 98/98. License closure: 7/7.
- Chromium functional/IndexedDB: 9/9. Production-build benchmark: 1/1.
- Both typechecks and builds passed. Application high-severity audit exited 0
  with three known moderate `ajv` findings and no available fix; collaboration
  audit reported 0 vulnerabilities. Diff check passed.
- PDF: 62,602 bytes, SHA-256
  `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`.
  IFC: 222 bytes, SHA-256
  `30c157d118a3be377cd592d520e163ff9249781fb002c4c81be64240672c8b93`.

## Status and disposition

- **MEASURED:** production-build Chromium 151.0.7922.34, Apple M3 Max, 14
  logical CPUs, 36 GiB, 1440×900. First usable was 5,434.0 ms, so the product
  target `<= 2.5 s` is **NOT MET**. Warm p95 was zoom 0.2 ms, pan 0.3 ms, and
  selection 72.7 ms from 30/31/30 samples. This is not a P7 60 fps claim.
- **LOCAL ENV UNEXECUTED:** disposable PostgreSQL, linked Supabase, deployment,
  and rollback authorities are unavailable.
- **PRODUCTION UNEXECUTED:** real hosted provider convergence and p95 `<= 500
ms`, real provider/offline recovery, hosted org/RLS/freeze/approval/source,
  cleanup, deploy, and rollback were not executed and are not counted as pass.

Requested commit message: `test: verify drawing workspace P4 semantics`.
