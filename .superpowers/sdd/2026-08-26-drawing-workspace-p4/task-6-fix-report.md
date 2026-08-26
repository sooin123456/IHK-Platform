# P4 Task 6 review-fix report

Base: `0c62ff150812081c1b71edf6584b465a6924a362`

Reviewed implementation: `2d76b44`, corrected by the fix2 evidence report.

## Review finding closure

### C1 — changed checkpoint restore

`drawingCommandTargetIds` now sends `restore_checkpoint.actions` through the
existing structural target resolver. The RED test reproduced the prior
`Drawing recorded operation payload is invalid.` failure; GREEN asserts an
affected peer soft lock is returned. The fix2 mounted browser vertical changes
the graph and restores through the UI, comparing semantic objects, geometry,
opening host IDs, all three schedules, and SVG bytes with the captured baseline
(versions are intentionally monotonic and excluded from semantic content
equality). Peer-lock mutation rejection is exercised separately in that same
workflow.

### C2 — hosted export order

The canonical render adapter performs a stable, same-layer dependency pass:
an opening waits for its host wall, while existing layer and unrelated item
order remains unchanged. Tests cover inverse and representative random UUID
pairs. Real Chromium renders an inverse-ID void opening and samples its white
cut in direct PNG, rasterized SVG, and rendered PDF output.

### I1 — real offline/outbox/reconnect

The browser is genuinely isolated with Playwright network offline state and
asserts `navigator.onLine === false`. One hundred grid operations use the
production collaboration command bridge, real IndexedDB `DrawingOutbox`, and
real Yjs IndexedDB persistence. Outbox, Yjs operation order, pending order, and
materialized object order are exact before and after closing/reopening every
store. Reconnect performs 100 real local action POSTs, verifies the echoed ID
inside each React Router wire response, lets `sendDrawingOperation` validate
each decoded acknowledgement, and empties the outbox. No local test writes the
server-owned Yjs status map. Without a configured authority/provider projection,
the 100 operations truthfully remain pending; provider-authoritative convergence
is **UNEXECUTED**.

### I2 — integrated P4 vertical and durable sources

One local Chromium test now executes every requested transition: six semantic
authoring tools, inspector edit, wall move/opening follow, opening move,
invalid shrink rejection, undo/redo, peer lock conflict, provider retry and
reconnect, viewer-direct rejection, locked-layer rejection, real review
freeze/failure release, changed restore equality, PDF download/parse/render,
and source PDF/IFC SHA equality around the workflow. The durable permissive
source fixture is:

`.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf`

### I3 — live/export parity

Semantic renderer constants and pure label/centroid geometry live in
`drawing-geometry.ts` and are consumed by both the live Canvas and export
paths. This removes the copied centroid implementation and makes wall caps,
opening strokes/cuts, default space/area fills, grid dashes/bubble strokes, and
label placement identical by construction. A focused parity test locks those
values.

### Minor — connected preview and evidence wording

The preview now contains a second wall sharing the first wall's endpoint. UI
and reports continue to label semantic Schedule/evidence as preview-derived;
no confirmed server evidence is claimed.

## Boundaries

- No new dependency or lockfile change.
- No semantic CRDT, migration, state manager, operation kind, or widened RPC.
- Source PDF and IFC bytes are read/rendered only; their SHA-256 values are
  identical before and after the integrated workflow.
- Production PostgreSQL, deployed collaboration, deployment, and latency are
  **PRODUCTION UNEXECUTED**.

See `task-6-fix-evidence.txt` for commands and immutable hashes.
