# Drawing Workspace P5 release evidence — 2026-08-27

Task 6 final source commit is `4deb7ef`; release evidence is `c66a0f7`, and the
independent READY review is `2352365`.

## IMPLEMENTED

- Canonical PDF+IFC entry without feature-specific flags or user-facing raw JSON.
- Distinct deterministic current/prior PDFs, visible diff marker, real selectable IFC,
  2D/3D/split, bidirectional focus, exact-one fetch and cleanup.
- Authorized recovered outbox flush through resource routes which re-export the existing
  actions; no second controller, state manager, or dependency.
- PDF.js, Three.js and web-ifc licenses closed in third-party notices.

## LOCAL PASS / INDEPENDENT READY

- Exact `npm run release:drawing-workspace-p5:local`: `P5 LOCAL PASS`.
- Whole Node suite 988 pass / 1 intentional skip; Drawing Workspace 692 pass /
  1 intentional skip; collaboration service 33/33.
- P4 mounted/real IndexedDB 13/13; P5 development lifecycle 1/1; P5
  production-build vertical/lifecycle 12/12.
- IFC/PDF/quantity/approval/Revit regressions 100/100; application and
  collaboration typechecks/builds PASS; license closure 7/7.
- Current PDF 62,602 bytes/SHA `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`.
- Prior PDF 63,118 bytes/SHA `ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc`.
- IFC 413,681 bytes/SHA `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d`;
  120 elements, 115 rendered elements, 14,694 triangles.
- Browser-observed bytes and authoritative file-row metadata matched before and
  after the mutation workflow. IFC fetch 1; owned disposal 1; context-loss
  request 1; unmounted IFC canvas 0.
- The hosted specification can exercise the real issue-anchor relink RPC and two
  authenticated mounted Editor/Viewer provider clients when authorities exist.
- Pre-existing dirty P4 files were restored to starting bytes and excluded with audits.

## LOCAL ENV / PRODUCTION UNEXECUTED

- Disposable real PostgreSQL/linked Supabase authorities remain unavailable.
- Production command exited nonzero before Playwright because real app, Supabase,
  provider, database and run authorities were absent. Storage CORS, signed URLs,
  hosted role denial, two-user provider, atomic relink, cleanup and rollback are
  **UNEXECUTED**.

## MEASURED

- Commit-bound record: `.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-6-release-evidence.json`.
- Chromium 151, 1440×900, 10,000 objects, 2,000 links, one IFC, one compare page.
- First usable 13,709.3 ms vs 2,500 ms: **NOT MET**. P7 60 fps: **UNEXECUTED**.

P5 local implementation is independently **READY**. Production PASS, the
2.5-second target, and P7 60 fps are not claimed.
