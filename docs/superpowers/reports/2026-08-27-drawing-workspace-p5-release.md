# Drawing Workspace P5 release evidence — 2026-08-27

Task 6 source commits are `46b52d0` and follow-up `d4d51ef`.

## IMPLEMENTED

- Canonical PDF+IFC entry without feature-specific flags or user-facing raw JSON.
- Distinct deterministic current/prior PDFs, visible diff marker, real selectable IFC,
  2D/3D/split, bidirectional focus, exact-one fetch and cleanup.
- Authorized recovered outbox flush through resource routes which re-export the existing
  actions; no second controller, state manager, or dependency.
- PDF.js, Three.js and web-ifc licenses closed in third-party notices.

## LOCAL PASS

- Focused Node/license 25/25; P3/P4 offline/collaboration/source 97/97.
- Typecheck/build PASS; production-build Chromium Task 6 3/3 PASS.
- Current PDF 62,602 bytes/SHA `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`.
- Prior PDF 63,118 bytes/SHA `ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc`.
- IFC 413,681 bytes/SHA `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d`;
  120 elements, 115 rendered elements, 14,694 triangles.
- All three before/after hashes matched; IFC fetch 1; unmounted IFC canvas 0.
- Pre-existing dirty P4 files were restored to starting bytes and excluded with audits.

## LOCAL NOT MET

- Exact composed P0–P4 local release is **NOT MET**: whole Node suite reported
  980 pass, 1 fail, 1 skip because the existing PDF diff worker mutation was not
  observed under full parallel load. The same test passed three standalone runs.

## LOCAL ENV / PRODUCTION UNEXECUTED

- Disposable real PostgreSQL/linked Supabase authorities remain unavailable.
- Production command exited nonzero before Playwright because real app, Supabase,
  provider, database and run authorities were absent. Storage CORS, signed URLs,
  hosted role denial, two-user provider, atomic relink, cleanup and rollback are
  **UNEXECUTED**.

## MEASURED

- Commit-bound record: `.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-6-release-evidence.json`.
- Chromium 151, 1440×900, 10,000 objects, 2,000 links, one IFC, one compare page.
- First usable 10,775.4 ms vs 2,500 ms: **NOT MET**. P7 60 fps: **UNEXECUTED**.

P5 implementation and focused evidence are reviewable; local release PASS,
production PASS, the 2.5-second target and P7 60 fps are not claimed.
