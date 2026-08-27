# P5 Task 6 fix round 2 report

Date: 2026-08-27

Reviewed base: `9506c5837f1941796e8254298ca9dfe2842da37f`

Product/test fix: `4deb7ef8fad6f6ca83c64dac3ffd9f385b10b8c0`

## Outcome

All five findings in `task-6-rereview1.md` have a bounded implementation and a regression test. The exact local P5 release completed with `P5 LOCAL PASS`. The credentialed hosted gate remains honestly **UNEXECUTED** because no real production authorities were supplied; the command exits nonzero rather than substituting local fixtures.

The latest production-build measurement is still **NOT MET**: first usable was `13,709.3 ms` against the `2,500 ms` target. No 60 fps result is inferred.

## Important 1 — actual issue-anchor atomic relink

The hosted P5 spec now calls `lukas_drawing_relink_issue_anchor`, not the object-source replacement operation. It creates an active predecessor PDF anchor, proves a non-edge relink rolls back without creating a successor, proves Viewer denial, then executes the exact PDF revision edge and verifies:

- predecessor remains present and becomes inactive;
- successor is active;
- successor `replaces_anchor_id` is exactly the predecessor ID;
- predecessor/current file IDs are the exact registered edge;
- the RPC returns the exact old/new IDs.

The release contract test first failed because these boundary strings and assertions were absent, then passed after the hosted workflow was added.

## Important 2 — two authenticated mounted provider clients

The hosted spec now opens independent authenticated Editor and Viewer browser contexts on the canonical `/workspace` route. Both wait for their mounted collaboration provider to report `connected`. The Editor selects the same mounted object and authors link, unlink, and replacement link through the workspace inspector. The Viewer observes each projected state change through its mounted workspace. The test also proves Viewer mutation/RPC denial, source version ordering, non-member invisibility, signed current/predecessor PDF and IFC responses, 2D/3D/split modes, byte/file-row invariance, context cleanup, and fixture cleanup.

The credentialed test compiles and lists as one serial production test. It was not executed against production credentials in this run.

## Minor 1 — scoped read-only navigation

The whole-canvas `pointer-events-none` gate was removed. Durable persistence readiness still gates mutation commands, undo/redo, checkpoints, and editing tool availability. Selection and pan remain valid read-only tools when the active edit layer is unavailable; an authority downgrade converts mutating tools to selection while preserving an already selected pan tool.

RED/GREEN evidence:

- mounted retry test initially observed the canvas pointer block;
- the production-build mounted retry now proves the surface remains interactive, wheel navigation changes viewport zoom while local persistence is failed, mutating line tools are absent, and edit controls recover after retry;
- the transient-store unit test proves a read-only Viewer retains pan without acquiring an edit layer.

## Minor 2 — owned IFC lifecycle evidence

The unconditional `window` custom event was deleted. `createIfcModelViewer` accepts an optional owned disposal callback, the IFC property browser forwards it without putting callback identity into the load lifecycle, and `DrawingWorkspace` accepts it only through its explicit preview/evidence harness. The baseline harness records disposal and context-loss-request counts in a labeled owned output; ordinary production workspace instances receive no observer.

The production-build baseline observes one fetch, 115 geometry-bearing elements, usable focus on element `2863`, one owned disposal, one context-loss request, and zero IFC canvases after unmount.

## Minor 3 — bounded PDF ownership cleanup

Both current and predecessor PDF effects still clear their exact owned canvas identity before resource destruction. Cleanup is now fenced by the first of the next animation frame or a one-second timeout. The once-only closure cancels its sibling schedule, so hidden tabs release page/document/canvas resources without waiting indefinitely for rendering to resume.

The focused test first failed because the scheduler did not exist. It now drives timeout then frame for one generation and frame then timeout for another, verifies each callback runs exactly once, and proves old-generation cleanup cannot zero the new generation's canvas.

## Verification

- Focused document-store/PDF cleanup/P5 contract tests: **38/38 pass**.
- Scoped mounted collaboration-retry Chromium test: **1/1 pass** in the production-build preview environment.
- Hosted P5 spec compile/list: **1 test listed**.
- Application typecheck: **pass**.
- `git diff --check 9506c58..4deb7ef`: **pass**.
- Dependency/lockfile diff: **none**.
- Exact `npm run release:drawing-workspace-p5:local`: **PASS**.
  - whole Node suite: 989 total, 988 pass, 1 intentional skip;
  - Drawing Workspace suite: 693 total, 692 pass, 1 intentional skip;
  - collaboration service: 33/33 pass;
  - IFC geometry smoke: 413,681 bytes, 120 elements, 115 geometry-bearing elements, 119 placements, 14,694 triangles;
  - IFC/PDF/quantity/approval/Revit regressions: 100/100 pass;
  - application/collaboration types and builds: pass;
  - P4 mounted/IndexedDB: 13/13 pass;
  - P4 production-build performance: 1/1 pass;
  - P5 dev generation lifecycle: 1/1 pass;
  - P5 production-build vertical/lifecycle: 12/12 pass;
  - application audit: three known moderate transitive `ajv` findings, no high/critical; collaboration audit: zero.
- Post-commit P5 production-build rerun: **12/12 pass** and regenerated evidence bound to `4deb7ef8fad6f6ca83c64dac3ffd9f385b10b8c0`.
- `npm run release:drawing-workspace-p5:production`: exit **1**, **UNEXECUTED**, naming every missing real application, Supabase, provider, CORS, admin database, secret, and run authority.

## Measured immutable fixtures

- current PDF: 62,602 bytes, SHA-256 `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`;
- predecessor PDF: 63,118 bytes, SHA-256 `ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc`;
- IFC: 413,681 bytes, SHA-256 `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d`.

The browser mutation workflow fetched and hashed all three before and after the operation sequence and matched authoritative file-row byte size/SHA metadata. The evidence run ID is `0faa2ebf-16dd-487c-b64e-0fd69b3f7f95`.

## Honest residuals

- First usable remains **13,709.3 ms — NOT MET**.
- P7 60 fps gate remains **UNEXECUTED**.
- Hosted PostgreSQL/RLS, production Storage CORS, production signed URLs, and production two-user/provider execution remain **UNEXECUTED** until real credentials and authorities are supplied.
- The application audit retains three known moderate transitive `ajv` advisories with no available upstream fix.

## Preservation

The four pre-existing dirty P4 files were restored byte-for-byte to the recorded starting snapshot (SHA-256 prefixes `192f4d`, `da1246`, `b23862`, `ce56d8`) and are excluded from both commits. `.superpowers/audits/` and Task 5 artifacts are also excluded. No dependency, lockfile, migration, CRDT schema, IndexedDB schema, operation discriminator, or state-manager change was made.
