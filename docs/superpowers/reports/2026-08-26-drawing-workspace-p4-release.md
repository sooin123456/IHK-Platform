# Drawing Workspace P4 release evidence — 2026-08-27

This record separates implementation, locally executed evidence, unavailable
local authorities, production evidence, and measurements. It does not deploy,
migrate a hosted database, create production users, or infer a hosted result.
Task 7 started from source commit `ea7885c257f3b5cbae314d25ae31d86c553d6a51`.

## IMPLEMENTED

- `npm run release:drawing-workspace-p4:local` runs the whole Node and Drawing
  suites, collaboration service, dev-served Chromium P4/IndexedDB regressions,
  a separate production-build Chromium performance gate, pinned IFC smoke,
  explicit IFC/PDF/quantity/approval/Revit regressions, both typechecks/builds,
  license closure, both high-severity audits, and diff check.
- `npm run release:drawing-workspace-p4:production` reuses the exact P3 hosted
  provider fixture and adds a P4 semantic graph/measurement/schedule/RLS/freeze/
  source gate. Its credential guard exits nonzero with `UNEXECUTED` before
  Playwright when any real authority is absent.
- The loopback-only benchmark builds exactly 10,000 mixed semantic objects:
  2,000 walls, 2,000 hosted openings, and 1,500 each spaces, areas, grids, and
  arcs. IDs, host references, object mix, viewport, and selection targets are
  deterministic.

## LOCAL PASS

- Release contract: 8 executable tests, including fixture mutation boundaries,
  fail-fast runner behavior, credential-free production guard, and durable
  source bytes.
- Production-build Chromium benchmark: 1 scenario with 10,000 mixed semantic
  objects; 30 warm zoom, at least 30 warm pan, and 30 warm selection samples.
- Durable source evidence remained exact:
  - PDF: 62,602 bytes, SHA-256
    `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`.
  - IFC: 222 bytes, SHA-256
    `30c157d118a3be377cd592d520e163ff9249781fb002c4c81be64240672c8b93`.
- The complete local gate results are recorded in the Task 7 evidence ledger;
  no environment-only or production authority is counted as LOCAL PASS.

## LOCAL ENV UNEXECUTED

- The disposable real-PostgreSQL concurrency fixture is not configured. Its
  explicit `UNEXECUTED` result is not a pass or an unlabelled skip.
- No linked Supabase project, Docker runtime, deployment host, registry, or
  operator rollback orchestrator is configured. Hosted migration diff/advisors,
  OCI image checks, deploy/promotion, and rollback rehearsal are unexecuted.

## PRODUCTION UNEXECUTED

- All app/Supabase/collaboration/database/run-identity authorities were absent.
  The production command exited nonzero before Playwright; no hosted state was
  read or changed.
- Hosted owner/editor/reviewer/viewer/nonmember organization/RLS results,
  provider-authoritative semantic convergence, exact offline provider recovery,
  freeze/approved immutability, PDF/IFC source hashes, cleanup, deployment, and
  rollback rehearsal are `UNEXECUTED`.
- Production three-context provider p95 target `<= 500 ms`: **UNEXECUTED**; no
  value is recorded. Provider-authoritative convergence: **UNEXECUTED**.
- P4 production or operational PASS is not claimed.

## MEASURED

- Authority: local production application build served to Chromium 151.0.7922.34.
- Hardware: Apple M3 Max, 14 logical CPUs, 36 GiB memory; viewport 1440×900.
- Composition: 10,000 mixed semantic objects (2,000 wall, 2,000 opening, 1,500
  space, 1,500 area, 1,500 grid, 1,500 arc).
- First usable after warm application assets and cold 10,000-object document:
  5,434.0 ms. Product target first usable `<= 2.5 s`: **NOT MET**.
- Warm samples: zoom 30, pan 31, selection 30. p95: zoom 0.2 ms, pan 0.3 ms,
  selection 72.7 ms. These event-to-animation-frame samples are a baseline, not
  a P7 60 fps claim.
- Production provider p95, cold provider reflection, deployed offline loss, and
  field-user measurements: `UNEXECUTED`; no values recorded.

Disposition: P4's local semantic release contracts can be reviewed separately
from the unmet 2.5-second product target and all hosted/field gates. P7 owns the
broader 10,000-object 60 fps optimization; Task 7 does not hide or relabel the
measured shortfall.
