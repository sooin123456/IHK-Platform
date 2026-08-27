# Drawing Workspace P5 — PDF/IFC integration design

Status: approved program slice; implementation pending

## Outcome

P5 connects the P0–P4 vector workspace to immutable PDF and IFC evidence without adding another renderer, state store, collaboration protocol, or source registry.

The complete local P5 experience is:

1. switch the workspace between `2D`, `3D`, and `split` through shareable URL state;
2. link a drawing object to a normalized PDF region or IFC GlobalId through the existing operation/Yjs/outbox path;
3. select a linked drawing object and focus the IFC element, or pick an IFC element and select the unique linked drawing object without feedback loops;
4. compare the current PDF page with its immediate immutable predecessor and calculate transient browser-only change markers;
5. review and atomically relink issue anchors to the current revision while preserving replacement lineage;
6. prove the PDF/IFC file ID, SHA-256, byte size, and downloaded bytes remain unchanged.

No new runtime dependency is added. PDF.js, Konva, Three.js, `web-ifc`, the existing file-revision graph, `lukas_drawing_object_sources`, P3 collaboration, and P4 review/export contracts are reused.

## Scope boundaries

Included:

- one editable 2D vector canvas and at most one selected IFC model;
- one current and one immediate-previous active PDF page for comparison;
- explicit GlobalId links and normalized PDF-region links;
- on-demand, cancellable, transient PDF diff markers;
- exact operation-backed link/unlink, undo/redo, offline recovery, history, checkpoint, template, approved-child, and review-freeze behavior;
- atomic issue-anchor relinking with old/new audit lineage;
- desktop split view and narrow-screen accessible tabs.

Deferred:

- full IFC geometry/model diff, clashes, federation, section boxes, or IFC-to-2D projection;
- automatic PDF sheet matching, OCR, vector recognition, CAD/DWG, or AI interpretation;
- persisted diff markers or their use as quantity, approval, or monetary evidence;
- cross-file GlobalId guessing without a confirmed identity link;
- organization libraries and performance/productization work owned by P7.

## Canonical source links

`DrawingStructureState` adds `sources: Record<string, DrawingObjectSource>`.

`DrawingObjectSource` is an exact-key union:

- PDF: `id`, `objectId`, `revisionId`, `sourceFileId`, lowercase `sourceSha256`, `sourceKind:"pdf_region"`, page number, normalized top-left `x/y/width/height`, and `version`.
- IFC: the shared fields plus `sourceKind:"ifc_element"`, exact 22-character `ifcGlobalId`, optional same-file `elementId`, optional canonical camera, and `version`.

Rules:

- every source belongs to an active object in the same drawing revision;
- source file/project/kind/SHA must match an immutable file row;
- PDF regions are clipped to `[0,1]`, non-empty, and use the rotated PDF.js viewport convention;
- GlobalId is revision-followable evidence; ExpressId is only a same-SHA convenience;
- at most one active `(object, source file, source kind)` link exists;
- signed URLs, viewport pixels, renderer IDs, and diff markers are never persisted, snapshotted, or published through Awareness;
- clipboard and same-document duplicate start unlinked unless the user explicitly creates a new link.

The existing `mutate_structure` action union adds `put_source` and `delete_source`. No new operation discriminator, Yjs collection, IndexedDB database, or schema version is introduced. Object deletion records source deletions before the object; undo restores the object before its sources.

## Source commands and permissions

Pure commands:

- `linkDrawingIfcSourceCommand`
- `linkDrawingPdfRegionSourceCommand`
- `unlinkDrawingObjectSourceCommand`

Each command emits an existing compound `mutate_structure` operation with exact base versions and inverse payloads. Admin/Editor may mutate links only on draft, unfrozen revisions. Viewer, Commenter, Reviewer, and Approver may focus evidence but cannot link or unlink.

## Workspace source bundle and URL state

The route provides a verified `DrawingWorkspaceSourceBundle` containing:

- immutable primary descriptor;
- selected PDF and IFC descriptors;
- immediate previous PDF plus an exact revision edge;
- project file catalog metadata without signed URLs.

Descriptors contain file ID, kind, filename, byte size, SHA-256, and an ephemeral signed URL only for sources actually loaded. The route accepts only `view=2d|3d|split` and optional canonical `ifc=<uuid>`. Invalid, foreign, mutable, wrong-kind, or SHA-mismatched selections fail with `400/404`; they are never silently substituted.

`2D` is always the vector workspace. `3D` is the selected IFC. `split` shows both. Without an IFC selection, 3D/split is disabled with a project-file chooser. Switching modes keeps one parsed IFC mounted but hidden; changing IFC disposes and aborts the previous model before loading the next.

## PDF/world transform

One pure `DrawingPdfPageTransform` owns page number, rotation, rotated PDF.js viewport dimensions, and the exact contain-fit world bounds.

It provides:

- normalized PDF point → world point;
- world bounds → clipped normalized PDF region or null;
- normalized PDF region → world bounds.

The transform uses the rotated PDF.js viewport and never infers aspect ratio from paper millimetres. The legacy PDF issue viewer and Drawing Workspace reuse these primitives.

## Controlled IFC focus

The property/model viewer becomes controlled through request IDs and origin-tagged callbacks.

- Drawing → IFC: a single drawing selection resolves the active source for the selected IFC file, sends a fresh focus request, resolves GlobalId, highlights, and optionally restores camera.
- IFC → Drawing: a user pick queries a memoized `(fileId, GlobalId) -> objectIds` index. A unique object is selected/navigated; multiple objects show a chooser; none enables `선택 도면 객체에 연결` only when exactly one editable drawing object is selected.
- Programmatic focus never feeds back into drawing selection.
- ExpressId maps rebuild on every IFC file/SHA load. Awareness continues to publish drawing object IDs only; peers resolve local IFC highlights from the link index.

## PDF revision overlay

Comparison uses only the immediate immutable `supersedes` edge. The previous PDF is lazy-opened when comparison is enabled and follows the current page number.

Controls: `current | overlay | previous`, opacity slider, and `변경 표시 계산`.

The dependency-free diff helper:

- renders equal origin-clean canvases with longest edge <=1024 px;
- rejects automatic markers for rotation mismatch or >1% aspect mismatch while retaining manual overlay;
- compares premultiplied RGBA by a fixed threshold in 32-pixel tiles;
- merges adjacent changed tiles, discards tiny regions, caps output at 256 normalized rectangles;
- is AbortController/generation cancellable;
- labels markers `브라우저 미리보기` and never persists or treats them as evidence.

## Atomic anchor relinking

`lukas_drawing_issue_anchors` adds nullable `replaces_anchor_id` with a same-issue/project self-FK and unique non-null index.

One `lukas_drawing_relink_issue_anchor` RPC authenticates the contributor, locks the issue/old anchor, requires an exact same-kind immutable revision edge, validates the new payload, inserts the new active anchor, deactivates the old anchor with a required note, and returns both IDs in one transaction. Direct replacement inserts are denied. IFC candidates may pre-focus by GlobalId but still require confirmation; PDF coordinates are never copied automatically.

## Database authority

One CLI-generated forward migration:

- versions and soft-deletes object-source rows while preserving history;
- replaces all-row uniqueness with active partial uniqueness;
- extends the latest private operation validator/executor for `put_source/delete_source` with exact OCC and idempotent retry;
- includes active sources in snapshot/checkpoint/template/approved-child/freeze restore paths;
- revokes direct authenticated source mutations and keeps member SELECT/service access under RLS;
- adds guarded anchor replacement lineage and the exact-signature relink RPC with empty search path and no PUBLIC execute;
- denies wrong role/project/file/kind/SHA, mutable source, non-draft/frozen/approved state, and direct DML;
- never mutates file rows, storage objects, or revision edges.

## Lifecycle and performance

- IFC code lazy-loads on first 3D/split entry. One model remains mounted across mode toggles. Source swap/unmount aborts fetch, closes model/API, disposes Three geometries/materials/controls/render lists/renderer, disconnects listeners/observers, removes canvas, and releases WebGL context.
- Hidden 2D mode renders no IFC frames. `webglcontextlost` exposes a retry path.
- PDF current/previous tasks abort and clean up on page/file/revision/generation changes.
- diff retains only two active pages, is opt-in, and never runs during drag/pan/zoom.
- desktop split panes stay >=320 CSS px; smaller widths use tabs.
- source indexes are memoized by source-map identity and IFC file/SHA.

## Open-source boundary

PDF.js is Apache-2.0 and Three.js is MIT. Existing `web-ifc` is MPL-2.0, not permissive. P5 keeps it unmodified and isolated behind the npm/runtime boundary, records it in third-party notices, and does not copy its source. A strictly permissive replacement is a separate evaluated migration, not incidental P5 scope.

## Local completion gates

- strict transform, diff, source-link, focus-loop, command/inverse/clipboard tests;
- forward install and P0–P4 upgrade database tests, source OCC/RLS/freeze/snapshot/anchor relink authority, and byte/hash invariance;
- mounted browser 2D/3D/split lifecycle with no second IFC fetch across toggles;
- bidirectional GlobalId link/focus across two browsers and offline reload;
- PDF predecessor overlay, opacity, calculated marker, cancellation, and source SHA invariance;
- atomic anchor relink preserving inactive predecessor and active replacement;
- Viewer focus/compare but no mutation controls;
- source swap/unmount resource cleanup;
- all P0–P4 Drawing, IFC, PDF, quantity, approval, export, Revit, collaboration, and release regressions.

Hosted Storage CORS, real signed URLs, real two-user WebSocket reflection/p95, hosted RLS, GPU lifecycle, and production byte evidence remain `PRODUCTION UNEXECUTED` until run with the required authorities.
