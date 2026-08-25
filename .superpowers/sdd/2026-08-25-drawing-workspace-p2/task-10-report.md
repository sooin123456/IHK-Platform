# Task 10 — Deterministic drawing export report

## Outcome

Implemented one canonical export traversal and browser-native SVG, PNG, and PDF encoders for the Drawing Workspace. The workspace now exposes an accessible native-download dialog to editors and viewers without a route action, RPC, source-row update, or Storage mutation. SVG and PNG export the active canvas; PDF exports every paper canvas in canonical page/canvas order, while a model canvas is included only through the explicit current-model selection.

Commit subject: `feat: export drawing workspace documents`

## TDD evidence

The work followed RED/GREEN in small contracts:

- License RED: the exact `pdf-lib` dependency, lock metadata, and notice row were absent. GREEN after the mandated exact install and notice update.
- Traversal RED: the export module did not exist. GREEN covered canvas isolation, visible layer/order, locked-visible inclusion, hidden-layer exclusion, canonical object/block ordering, live style resolution, and resolved block primitives.
- SVG RED: the named encoder and deterministic XML contract were absent. GREEN covered stable bytes, attribute order, canvas millimeter bounds/viewBox, XML escaping, and multiline layout. The final multiline RED observed a raw newline where canonical `<tspan>` positions were required; the minimal encoder change made the focused test GREEN.
- PNG RED: the named encoder was absent. GREEN covered deterministic 1x/2x/4x dimensions, white background contract, matching PDF.js source evidence/bounds, missing/mismatched/tainted/background-encoding failures, and PNG encoding failure. A deliberate fill mutation made the real-browser pixel assertion fail (expected red, observed white); restoring canonical style rendering returned it to GREEN.
- PDF RED: the named encoder was absent. GREEN parses actual bytes with `pdf-lib` and verifies page count/order, exact `72 / 25.4` dimensions, embedded rendered images, metadata, default paper-only behavior, and explicit model selection.
- UI RED: the actual workspace SSR shell had no export trigger. GREEN verifies the native dialog appears for both editor and viewer capability and that no export form intent/server mutation is present.
- Source invariance GREEN: the PDF test snapshots and compares the canonical PDF background metadata and source bytes before and after export. Export does not write the source row or Storage.

## Implementation files

- `platform/app/lukas/lib/drawing-export.ts`: canonical traversal plus SVG/PNG/PDF encoders and explicit export errors.
- `platform/app/lukas/components/drawing-export-dialog.tsx`: accessible format/scale/model-selection UI, PDF.js background rendering, status/errors, and native downloads.
- `platform/app/lukas/components/drawing-workspace.tsx`: dialog integration at the real workspace toolbar.
- `platform/tests/drawing-workspace-export.test.mjs`: traversal, byte, dimensions, pixels, failures, PDF parsing, metadata, ordering, model isolation, and source-invariance tests.
- `platform/tests/drawing-workspace-license.test.mjs`: exact dependency/license closure.
- `platform/tests/drawing-workspace-shell.test.mjs`: editor/viewer dialog and no-server-intent contract.
- `platform/package.json`, `platform/package-lock.json`, and `platform/THIRD_PARTY_NOTICES.md`: exact dependency and notice.

## Dependency and license review

Installed exactly with:

```text
npm install --save-exact pdf-lib@1.17.1
```

`pdf-lib` 1.17.1 is MIT licensed, used unmodified from npm, with official repository `https://github.com/Hopding/pdf-lib`. Its locked transitive packages are permissive and the focused test rejects GPL, MPL, or source-available licenses. No other export dependency, renderer, state library, or copied implementation was added. Export uses native Canvas/XML, existing geometry/layout/style/block resolvers, and never Konva JSON.

## Verification

Final commands from `platform/`:

```text
node --test tests/drawing-workspace-export.test.mjs tests/drawing-workspace-license.test.mjs tests/drawing-workspace-shell.test.mjs
# 21 tests, 21 pass, 0 fail

npm run test:drawing-workspace
# 397 tests, 397 pass, 0 fail

npm run typecheck
# pass

npm run build
# pass: client 2,582 modules; SSR 139 modules
```

The production build confirms the dynamic `pdf-lib`/PDF.js paths do not break SSR. Existing non-blocking output remains: large-chunk guidance, React Router future-flag warnings, a pre-existing mixed static/dynamic IFC import warning, and the unsigned theme-cookie warning.

The preview route was also exercised against the local dev server with preview Supabase environment values. Playwright opened `/workspace-preview/drawing-workspace`, opened the export dialog, selected SVG, downloaded `A-101 도면 작업실.svg`, and observed the accessible success status with no page errors. The first server start without those environment values failed closed on the expected missing Supabase configuration; rerunning with the preview values passed.

## Representative artifacts and inspection

Artifacts are intentionally generated and ignored under:

```text
.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.svg
.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing@2x.png
.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf
```

Inspection results:

- SVG rendered successfully and its drawing/text bounds aligned after the canonical text-baseline correction.
- PNG has a real PNG signature and is `2378 × 1682`, 8-bit RGBA, non-interlaced. Browser pixel inspection confirmed the white/PDF.js background and resolved vector colors.
- Poppler `pdfinfo` identifies a PDF 1.7 document with three pages, expected title/subject/creator/producer/dates, and A0 first-page dimensions `3370.39 × 2383.94 pt`.
- Poppler `pdftoppm` rendered all pages. Pages 1 and 3 show the expected representative geometry cleanly. Page 2 is intentionally blank because that canonically ordered paper canvas contains no visible objects; its presence verifies one-page-per-visible-paper-canvas behavior. The explicitly selected model page also rendered cleanly during inspection.

`platform/tmp` was removed before commit; only the required ignored SDD artifacts remain.

## Concerns

- PNG/PDF background export deliberately requires callable browser Canvas and PDF.js rendering paths; missing, mismatched, tainted, or undecodable source pixels fail explicitly rather than silently changing the export.
- The blank middle representative PDF page is expected fixture content, not an export omission.

## Fix round — seven Important review findings

All findings in `task-10-review.md` were addressed in one focused follow-up.

- **I1 authoritative order:** RED showed tied layers grouped by layer ID and reverse-local-ID block primitives reordered. GREEN reuses `drawingCanvasRenderAdapter()` and `blockRenderModelBounds()` from the authoritative renderer, sorts render items globally by `(layer.sortOrder, item.id)`, and preserves `model.primitives` definition-array order. Unit IDs and overlapping browser pixels protect both mutations.
- **I2 text/XML:** RED showed SVG without clipping, Canvas `fillText(maxWidth)` compression, and accepted `U+0001`. GREEN uses one fixed no-wrap layout for SVG `<clipPath>` and Canvas `rect()/clip()` with uncompressed `fillText`, including multiline text and dimension labels. XML 1.0-invalid C0 controls are rejected without stripping semantic text. DOMParser and real SVG/PNG raster evidence verify clipping and both line bands.
- **I3 calibration:** RED rendered a stale cross-page calibration as numeric. GREEN uses `canvas.pageId` as calibration identity and never geometry evidence as the selected calibration ID. Calibrated, missing, stale, and transformed block dimensions are covered in SVG/Canvas calls; the browser PNG and rendered PDF require calibrated dimension ink.
- **I4 background choice:** RED proved canonical metadata forced a background even when exclusion was requested. GREEN adds explicit `includeBackground`, preserving white plus vectors on exclusion and exact source-file/SHA/page evidence on inclusion. The hydrated dialog exposes an accessible checkbox, disables and describes it when unavailable, and real browser pixels distinguish yellow included background from white excluded background while retaining vectors.
- **I5 deadline/cancel:** RED deadline, cancellation, PNG encoding, PDF background, and stalled image-read tests all failed. GREEN owns one 30-second timer and `AbortController` per ref-gated export, propagates the signal through PDF.js load/render and PNG/PDF work, races non-cancellable array-buffer/embed/save promises, cancels on Close/unmount, avoids post-unmount state, and settles timers/disposers once. Native download revokes its Blob URL exactly once even when click throws. Hydrated Playwright verifies the background UI, double-click gate, cancel/close, and clean reopen.
- **I6 license closure:** The guard now resolves the package-lock closure rooted at exact `pdf-lib@1.17.1`: `pdf-lib`, both `@pdf-lib` packages, all three nested `pako` entries, and nested `tslib`. Every closure license must be one of the observed permissive expressions; runtime and dev direct dependency keys must equal explicit approved baselines. Mutation runs rejected an injected direct export framework and an `UNKNOWN` nested license, after which exact package/lock bytes were restored.
- **I7 executable evidence:** The unrelated local byte invariant was removed. The real browser gate serves actual fixture PDF bytes, renders them through PDF.js, freezes and compares file/SHA/storage evidence, hashes bytes before/after, and asserts every observed server request is GET. It parses/renders SVG, renders include/exclude PNG, and parses/renders the exported two-page PDF with distinct page dimensions, ordered page-specific pixels, block/tied-layer pixels, multiline clip bounds, and dimension ink. Its validation boundary explicitly rejects blank vectors, swapped pages, duplicate pages, and blank pages.

### Fix verification

```text
node --test tests/drawing-workspace-export.test.mjs tests/drawing-workspace-license.test.mjs tests/drawing-workspace-shell.test.mjs
# 33 tests, 33 pass, 0 fail (final focused behavior; included cold-cache browser render)

npm run test:drawing-workspace
# 409 tests, 409 pass, 0 fail

SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=preview \
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=preview \
npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --workers=1
# existing hydrated tab tests passed; the new export test was rerun focused after adding the established hydration retry and passed 1/1

npm run typecheck
# pass

npm run build
# pass: client 2,582 modules; SSR 139 modules

npx prettier --check <six affected code/test files>
# all matched; git diff --check clean
```

Representative SVG, 2x PNG, and three-page PDF artifacts were regenerated under the ignored Task 10 artifact directory without rerunning the PDF artifact marker. `file`, `pdfinfo`, and Poppler confirmed SVG, `2378 × 1682` RGBA PNG, PDF 1.7, three pages, A0 first page, and fixed metadata. Fresh Poppler rasters were visually inspected: pages 1 and 3 retain their distinct vector content, page 2 remains intentionally blank, clipped text/dimensions are visible, and no rendering defect or unintended source background appeared. Temporary render/cache/test output was removed.

## Fix round 2 — whole-lifecycle deadline and prompt gate release

The remaining I5 finding from `task-10-rereview1.md` is addressed without changing the export renderer, dependency graph, source-data boundary, or the I1-I4/I6/I7 fixes.

- **One bounded lifecycle:** `runDrawingExportLifecycle()` now owns the per-run controller, timer, active-operation gate, executor, native download, registered resources, cleanup, and terminal status. The abort race settles the caller even when an executor (including either dynamic import) or disposer ignores its signal.
- **Cleanup before download/success:** a successful executor result is not downloaded or announced until all currently registered disposers settle within the same deadline. Timeout/cancel starts cleanup exactly once, detaches any stalled cleanup with an observed rejection, releases the timer/ref gate, and publishes one explicit terminal error. A disposer registered by a late executor continuation is immediately attempted once and cannot update the completed run.
- **No late side effects:** the lifecycle checks both the signal and run-owned ref immediately before native download and again before success. Once timeout/cancel wins, late executor/download/disposer completion is observed but cannot publish status or start a native download. The existing native-download `try/finally` continues to create and revoke one Blob URL exactly once for a download that actually starts.
- **PDF.js resources:** `pdfBackground()` now checks cancellation after its dynamic import, after document opening, and after rendering. Its render-task cleanup, canvas release, and document destruction share one once-wrapped disposer, including error and late-cancellation paths.
- **Prompt reuse:** the active ref and timer are released before either terminal status is published, so the UI cannot look idle/successful while retaining the old gate. A second run receives a distinct controller/timer/resource registry and is admitted immediately after timeout or cancel.

### Fix round 2 TDD evidence

- RED: the shell suite was 8/10 because the production lifecycle helper did not exist. The two new tests separately stalled the real executor and a registered disposer.
- GREEN: the shell suite became 10/10 after the lifecycle helper was implemented and the dialog was routed through it.
- A tighter gate-order assertion then went RED because the first implementation published terminal status immediately before clearing `activeOperationRef`; moving idempotent release before terminal status returned the suite to GREEN.
- The timeout test fires the injected production 30-second timer, observes prompt timeout, no download, a cleared gate at status publication, successful admission of a second run, and no late success/download when the first executor finishes.
- The cancel test stalls a real registered disposer, observes prompt explicit cancellation, exactly one disposal attempt, no first download/success, a cleared gate, a successful second run, and no late update or unhandled rejection when detached cleanup rejects.

### Fix round 2 verification

```text
node --test tests/drawing-workspace-export.test.mjs tests/drawing-workspace-license.test.mjs tests/drawing-workspace-shell.test.mjs
# 35 tests, 35 pass, 0 fail

npm run test:drawing-workspace
# 411 tests, 411 pass, 0 fail

SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=preview \
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=preview \
npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --workers=1
# 3 tests, 3 pass, 0 fail, including the hydrated export dialog cancel/reopen gate

npm run typecheck
# pass

npm run build
# pass: client 2,582 modules; SSR 139 modules
```

The production build retained only the previously documented non-blocking chunk-size, React Router future-flag, mixed IFC import, and unsigned preview theme-cookie warnings. No dependency, lockfile, notice, migration, route action, RPC, Storage mutation, or source-record mutation changed in this round.
