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
