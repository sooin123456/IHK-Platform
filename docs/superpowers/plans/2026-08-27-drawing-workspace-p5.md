# Drawing Workspace P5 PDF/IFC integration implementation plan

Spec: `docs/superpowers/specs/2026-08-27-drawing-workspace-p5-design.md`

## Task 1 — Strict source links, PDF/world transforms, and diff kernel

Modify the Drawing Workspace structure/types and add dependency-free source-link, PDF transform, PDF diff, and IFC focus contracts. Write RED fixtures for exact schemas, rotations/letterboxing/clipping, diff merge/cap/refusal/cancellation, and user/programmatic focus loops. Keep signed URLs and transient markers outside canonical state.

Commit: `feat: define drawing PDF and IFC evidence contracts`

## Task 2 — Operation-backed source commands and offline/history integration

Extend the existing `mutate_structure` action family with `put_source/delete_source`; implement exact link/unlink commands, object-delete ordering, inverses, undo/redo/revert, clipboard exclusion, Yjs/outbox replay, snapshots, and checkpoint/template/approved-child graph handling. No new operation discriminator, store, CRDT collection, or dependency.

Commit: `feat: link drawing objects to source evidence`

## Task 3 — Supabase source authority and atomic anchor relink

Add one CLI-generated forward migration for versioned active source rows, partial uniqueness, strict source payload/file/SHA validation, private operation execution, snapshot/freeze restore, exact RLS/grants, replacement anchor lineage, and atomic relink RPC. Extend strict authorized loaders and shared TS/SQL mutation corpora. Real PostgreSQL absence is `UNEXECUTED`.

Commit: `feat: persist drawing evidence links and relinks`

## Task 4 — Controlled IFC viewer and 2D/3D/split workspace

Add verified source bundles and URL parsing, controlled IFC focus requests/callbacks, GlobalId indexes, drawing↔IFC selection without loops, paired IFC chooser, lazy model mounting, accessible desktop split/narrow tabs, WebGL loss/retry, and complete source-swap disposal. Reuse the existing IFC renderer and property browser.

Commit: `feat: integrate IFC focus into drawing workspace`

## Task 5 — PDF revision overlay and relink review UI

Compose the immediate predecessor PDF overlay, opacity/mode controls, opt-in cancellable change markers, source panel, link/unlink affordances, and explicit IFC/PDF anchor relink confirmation. Mark browser diff as preview only and preserve old/new anchor audit lineage.

Commit: `feat: review drawing PDF and IFC revisions`

## Task 6 — P5 vertical workflow, lifecycle, and release evidence

Add populated preview fixtures and mounted Chromium flows for 2D/3D/split, bidirectional focus, second-browser reflection, offline link/unlink/undo/reload, PDF compare/marker, atomic relink, Viewer restrictions, cleanup, exact source bytes, and all P0–P4 regressions. Add hermetic local/production gates, third-party notices, performance baselines, and truthful `NOT MET/UNEXECUTED` states.

Commit: `test: verify drawing workspace P5 integration`
