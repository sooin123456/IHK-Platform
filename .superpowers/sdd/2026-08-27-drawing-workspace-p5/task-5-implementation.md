# P5 Task 5 implementation report

Date: 2026-08-27

Base: `c97c194`

Commit subject: `feat: review drawing PDF and IFC revisions`

## Outcome

Implemented revision review inside the existing Drawing workspace and collaboration room without a new dependency, store, schema, migration, CRDT collection, or public API.

The active PDF page can show only the exact immutable `supersedes` predecessor for the current file and same page number. The workspace provides current, overlay, and previous modes, opacity, explicit marker calculation, visible `브라우저 미리보기` labeling, missing/no-edge states, and rotation/aspect refusal. No sheet or page is guessed. PDF.js documents, render tasks, canvases, timers, and diff work are aborted and cleaned on mode/page/source changes and unmount.

Task 1's rotated PDF transform drives object-to-PDF regions. PDF and IFC evidence uses the existing Task 2 mounted `put_source`/`delete_source` commands and existing role/revision/freeze permissions. Valid source operations were added only to the existing Awareness advisory-target extractor; no Awareness payload changed.

The collaboration room focuses one explicit revision candidate, clears stale pending evidence, requires a fresh user-selected PDF region or explicit IFC evidence selection, and submits one `relink_anchor` form to the Task 3 atomic RPC. It never performs separate deactivate/add mutations or copies predecessor PDF coordinates. Success, rollback, old inactive/new active status, and `replaces_anchor_id` lineage are visible.

Viewer remains read-only. Signed URLs, pixels, markers, mode/opacity, and candidate focus stay transient and never enter operations, snapshots, IndexedDB/Yjs state, or Awareness. Source response bytes remain unchanged and SHA-256 evidence is asserted.

## TDD record

1. Exact-predecessor server tests failed on a null predecessor. The loader now accepts only one exact current-file edge, verifies project/kind/immutability and both file SHA values, and returns no predecessor when no edge exists.
2. Mounted overlay tests failed until the previous active page, compare controls, Task 1 transform/diff integration, and non-listening markers were mounted.
3. Cancellation RED held the predecessor response pending and switched to current. Cleanup now leaves no previous canvas, loading state, marker, document, render task, timer, or raster residue.
4. Mounted PDF link RED raised `Drawing recorded operation payload is invalid.` A focused test proved valid `put_source`/`delete_source` actions were missing from Awareness target extraction. The narrow object/source target mapping fixed the mounted command path.
5. Relink parser tests reject extra pixels, mismatched file identity, copied/invalid coordinates, and missing fields. The service test proves exactly one atomic RPC with exact old/new/current IDs, anchor, and note.
6. The production collaboration E2E now counts one relink POST, queries old inactive/new active replacement lineage, and re-downloads both immutable PDFs to compare SHA-256 with fixture evidence.

## Boundaries

- Server query: exact `current_file_id` plus `relation_kind = supersedes`; no filename, label, dimension, upload-neighbor, or page guessing.
- More than one edge or any ID/SHA/kind/project mismatch fails closed. A missing prior page says another page will not be chosen automatically.
- Both pages use exact PDF.js rotated viewports. Task 1 refuses marker calculation for rotation mismatch or aspect mismatch over 1%, while manual overlay remains available.
- Diff is explicit and bounded to a maximum 1024-pixel edge. Marker layer and shapes are `listening={false}` and visibly labeled `브라우저 미리보기`.
- PDF linking uses the selected object's canonical bounds plus Task 1 transform. IFC linking requires explicit user-originated selection and exact file ID/SHA/GlobalId/camera.
- Candidate focus clears prior evidence. IFC programmatic focus is review only; the user still explicitly chooses evidence. PDF coordinates are never copied.
- Confirmation sends one previous ID, fresh new UUID, current file ID, fresh anchor, and required note to the one Task 3 RPC.

## Mounted browser evidence

```sh
E2E_BASE_URL=http://127.0.0.1:4115 \
  npx playwright test e2e/drawing-workspace-p5.spec.ts \
  --project=chromium --workers=1
```

Result: exit 0, 7/7 passed in 16.9 seconds after the Vite optimizer was warm. One cold run caused the pre-existing exact-one-IFC-fetch assertion to observe optimizer reload requests; its immediate warm isolated rerun passed 1/1 before the full 7/7 rerun.

Task 5 coverage proves exact lazy predecessor loading, all modes/opacity, transient markers, Viewer denial, cancellation/cleanup, mounted PDF link/unlink, and unchanged response-buffer hashes. Existing Task 4 lifecycle, source-swap, narrow-tab, independent URL-state, and GlobalId tests also remain green.

Screenshot: `.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-5-pdf-overlay.png` shows mounted overlay mode with one visible `브라우저 미리보기` marker. This is loopback preview evidence, not hosted evidence.

## Verification

Focused Task 5/adjacent suite:

```sh
node --test tests/drawing-revision.test.mjs \
  tests/drawing-awareness.test.mjs \
  tests/drawing-workspace-p5-server.test.mjs \
  tests/local-drawing-workspace-preview.test.mjs \
  tests/drawing-pdf-revision-diff.test.mjs \
  tests/drawing-pdf-transform.test.mjs \
  tests/drawing-source-commands.test.mjs \
  tests/drawing-source-links.test.mjs
```

Result: 68/68 passed.

PDF suite: `node --test tests/pdf-*.test.mjs tests/drawing-pdf-*.test.mjs` — 17/17 passed.

Serial Drawing suite:

```sh
node --test --test-concurrency=1 \
  tests/drawing-workspace-*.test.mjs \
  tests/drawing-fixture-cleanup.test.mjs
```

Result: 676 passed, 0 failed, 1 existing real-PostgreSQL case skipped. This includes P5 PGlite atomic relink/lineage/rollback and source-byte authority contracts.

Other gates:

- `npm run test:ifc`: passed; 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, 14,694 triangles.
- `npm run typecheck`: passed.
- `npm run typecheck:collaboration`: passed.
- `npm run build`: passed with existing large-chunk, React Router future-flag, theme-cookie, and IFC static/dynamic import warnings.
- Prettier applied to Task 5 TS/TSX/MJS files; `git diff --check` passed.
- `npx playwright test e2e/drawing-collaboration.spec.ts --list --project=chromium`: five production tests compiled and listed.

## Preserved worktree state

These pre-existing P4 dirty artifacts were not reset, deleted, formatted, or included in the Task 5 commit:

- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/progress.md`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-desktop.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-authored.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-restored.png`

## Residual gates

- Production collaboration one-POST/lineage/Storage-SHA E2E is implemented and compiles, but is **UNEXECUTED** here because disposable Supabase service-role credentials are not configured.
- Firefox and WebKit are **UNEXECUTED** because their Playwright binaries are not installed. Chromium is the executed browser authority.
- Hosted signed-URL expiry/CORS, real multi-user collaboration, real PostgreSQL, and release/performance evidence remain Task 6 gates.
- Full geometry diff, IFC dual-model diff, automatic sheet matching, OCR/CAD/DWG, persistent markers, and source rewriting remain out of scope.
