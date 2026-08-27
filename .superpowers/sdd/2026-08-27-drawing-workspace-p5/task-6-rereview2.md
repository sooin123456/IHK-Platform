# P5 Task 6 fix2 independent rereview

Range reviewed: `9506c58..c66a0f7` (`4deb7ef`, `c66a0f7`)

Review environment: fresh clean detached worktree at `c66a0f7`. The shared P4/audit dirt and generated artifacts were not used. Product code and shared release evidence were not edited by this review.

## Verdict

**READY — Critical 0 / Important 0 / Minor 0**

All two Important and three Minor findings from `task-6-rereview1.md` are closed by bounded code and reproducible tests. The exact local P5 manifest reaches `P5 LOCAL PASS`. The hosted test is now capable of exercising the declared atomic anchor and two-browser/provider source boundaries, but the real hosted run remains honestly nonzero **UNEXECUTED** because production authorities are absent. The recorded 13,709.3 ms baseline remains **NOT MET** against 2,500 ms.

## Prior finding disposition

### Important 1 — actual issue-anchor atomic relink: closed

`platform/e2e/drawing-workspace-p5-production.spec.ts:96-180` now uses `lukas_drawing_relink_issue_anchor` itself rather than calling a drawing-object source replacement a relink.

The hosted workflow:

- inserts one active predecessor PDF anchor on the predecessor file;
- calls the RPC with a non-edge current file and verifies an error plus the exact unchanged one-row anchor set;
- calls the same valid payload as Viewer and verifies denial;
- calls the exact registered predecessor → revised-PDF edge as Editor;
- verifies the exact returned `previousAnchorId/newAnchorId` pair;
- verifies the predecessor remains present/inactive and the successor is active with `replaces_anchor_id` equal to the predecessor.

The existing database runtime suite additionally covers stale/inactive predecessors, audit note retention, duplicate/direct replacement defenses, and transactional rollback. The production contract now asserts the actual RPC and lineage fields instead of broad `put_source/delete_source` strings.

### Important 2 — authenticated mounted two-browser/provider source projection: closed

`platform/e2e/drawing-workspace-p5-production.spec.ts:182-330` opens independent authenticated Editor and Viewer browser contexts on the canonical `/projects/:projectId/drawings/:fileId/workspace?document=...` route. Both wait for the mounted collaboration status `connected`, select the same persisted drawing object through the canvas, and use the real inspector surface.

The Editor clicks the canonical `PDF 영역 원본 근거 연결`, `원본 근거 해제`, and replacement-link buttons. The Viewer inspector observes link → no-link → replacement-link states through its mounted workspace. The spec also checks Viewer UI absence and direct RPC denial, the deleted source at version 2 and replacement at version 1, non-member non-enumeration, signed current/predecessor PDF and IFC responses, 2D/3D/split modes, source file-row/blob invariance, both browser-context closes, and fixture cleanup.

This is not PostgREST polling presented as provider evidence: PostgREST is used only for authoritative row/version assertions after the mounted UI/provider observations. The test compiles and lists as one serial hosted test. Execution remains **UNEXECUTED** without real credentials, as required by the plan.

### Minor 1 — scoped read-only navigation during durable-storage failure: closed

The whole-canvas `pointer-events-none` class is removed. `outboxReady` still participates in `baseCanEdit`, `applyCommand`, undo/redo, checkpoint restore, review preparation, and source-mutation eligibility, so no mutating command can escape before durable local initialization.

The production-build mounted retry test reproduced permanent local initialization failure and verified:

- the surface stays pointer-interactive;
- mutating line tools are absent;
- wheel input changes the viewport zoom;
- retry clears the storage error, creates exactly one local resource, and restores editing controls;
- provider failure remains degraded until the online retry connects.

The transient-state unit test also proves a read-only Viewer retains the non-mutating pan tool without acquiring an edit layer. Selection uses no editable snapshots when `canEdit` is false, so object dragging cannot emit a command.

### Minor 2 — owned IFC disposal observer: closed

The production-global `drawing:ifc-viewer-lifecycle` event and `window.dispatchEvent` are removed. The model viewer now accepts an owned `onDispose` callback; the property browser forwards it through a ref, so callback identity changes do not enter the `[byteSize, sourceKey]` load lifecycle or trigger source/model reloads.

Only the explicit local P5 preview/evidence harness supplies the callback. Ordinary production workspace instances pass no observer. The production-build baseline observes exactly one IFC fetch, 115 geometry-bearing elements, focus on element 2863, one owned disposal, one context-loss request, and zero IFC canvases after unmount.

### Minor 3 — bounded once-only PDF cleanup: closed

`scheduleDrawingPdfOwnedCleanup` races the next animation frame with a one-second timer. The first callback atomically marks completion, cancels both scheduled handles, and runs cleanup once. Current and predecessor effects still clear their exact owned canvas identity before scheduling page cleanup, document destruction, and canvas zeroing.

The scheduler test executes timeout → frame for one generation and frame → timeout for another, verifies exactly one cleanup per generation and both sibling cancellations, and verifies the old cleanup does not zero the new canvas. Browser scheduling is asynchronous, so the scheduler's handle assignment precedes either callback. Hidden tabs therefore have a bounded release path without reintroducing the old visible-frame `drawImage` race.

## Independent verification

- Focused document-store/PDF cleanup/P5 release suites: **38/38 pass**.
- Production-build collaboration-initialization retry Chromium scenario: **1/1 pass**.
- Application typecheck and production build: **pass**.
- Exact `npm run release:drawing-workspace-p5:local`: **PASS**, final `P5 LOCAL PASS`.
  - whole Node suite: 989 total, 988 pass, 1 intentional skip;
  - Drawing Workspace Node suite: 693 total, 692 pass, 1 intentional skip;
  - collaboration service: 33/33 pass;
  - IFC geometry smoke: 413,681 bytes, 120 elements, 115 geometry-bearing elements, 119 placements, 14,694 triangles;
  - IFC/PDF/quantity/approval/Revit regression set: 100/100 pass;
  - application/collaboration typechecks and builds: pass;
  - P4 mounted/real IndexedDB: 13/13 pass;
  - P4 production-build performance: 1/1 pass;
  - P5 dev import-generation lifecycle: 1/1 pass;
  - P5 production-build vertical/lifecycle: 12/12 pass;
  - license closure: 7/7 pass;
  - application audit: three known moderate transitive `ajv` findings, no high/critical; collaboration audit: zero.
- Hosted P5 production spec compile/list: **1 test listed**.
- `npm run release:drawing-workspace-p5:production`: exit **1**, **UNEXECUTED**, for missing real application, Supabase, collaboration/provider, secret, admin-DB, and run authorities.
- `git diff --check 9506c58..c66a0f7`: pass.
- No dependency, lockfile, migration, operation discriminator, CRDT schema, IndexedDB schema, or state-manager change exists in the range.

## Evidence and honest residuals

The committed evidence is bound to product/test source commit `4deb7ef8fad6f6ca83c64dac3ffd9f385b10b8c0`. The committed first-usable result is **13,709.3 ms — NOT MET**; this independent exact-manifest rerun measured approximately **13,697.8 ms — NOT MET**. P7 60 fps remains **UNEXECUTED**.

The observed immutable fixture oracles remain:

- current PDF: 62,602 bytes, SHA-256 `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`;
- predecessor PDF: 63,118 bytes, SHA-256 `ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc`;
- IFC: 413,681 bytes, SHA-256 `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d`.

Hosted PostgreSQL/RLS execution, production Storage CORS, production signed URLs, and production two-user/provider execution remain **UNEXECUTED** until real authorities are supplied. They are not represented as local passes and do not invalidate readiness of the fail-closed release gate.
