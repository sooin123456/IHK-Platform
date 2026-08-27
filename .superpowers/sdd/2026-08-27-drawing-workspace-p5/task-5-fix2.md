# P5 Task 5 fix round 2 implementation

Date: 2026-08-27

Base: `d6bb084 fix: enforce drawing revision review lineage`

## Outcome

- Entering current-only PDF mode now ends the active diff session as well as discarding the predecessor capability and renderer resources.
- Returning to overlay may request and fetch one fresh ephemeral predecessor capability because the prior capability was intentionally discarded. It does not reuse the earlier calculation generation, rasterize either page, or restore transient markers.
- A new explicit `변경 표시 계산` action is required after re-entry. That action performs exactly two image reads and restores only transient, non-listening `브라우저 미리보기` markers.
- Opacity changes and overlay/previous display-mode changes remain render-style-only. Current/source change and unmount cancellation behavior is unchanged.

## TDD evidence

- RED: after one explicit calculation, `현재 도면 -> 겹쳐 보기` changed `getImageData` calls from 3 to 5 and automatically restored a marker. Capability POST and predecessor GET counts each changed from one to two because current-only mode intentionally disposes the predecessor resource.
- GREEN: the same round trip keeps image reads at 3 and markers at zero while the fresh capability POST/GET counts reach two. A second explicit calculation alone advances image reads from 3 to 5 and restores a non-listening marker.
- Root cause: current-only mode cleared the predecessor capability and canvas but retained a positive `pdfDiffGeneration`; the newly mounted predecessor canvas consumed that stale generation.
- Minimal fix: current-only mode resets `pdfDiffGeneration` to zero and clears the compare result to idle. No renderer abstraction, persistence field, public API, dependency, or database change was added.

## Verification

- Targeted mounted regression: **1 passed, 0 failed**.
- Focused P5, database, Awareness, PDF, source command/link, and preview suite, serial: **217 passed, 0 failed**.
- PDF suite: **17 passed, 0 failed**.
- Relevant serial Drawing suite: **681 passed, 0 failed, 1 existing real-PostgreSQL-dependent skip/UNEXECUTED** (682 total).
- Mounted Chromium P5 suite, warm: **8 passed, 0 failed**, including the real no-interception PDF resource case.
- Cold Chromium note: the four PDF tests passed; the existing Vite optimizer reload caused the IFC exact-fetch assertion to observe three requests. The immediate isolated warm IFC test passed **1/1**, and the complete unchanged warm suite passed **8/8**.
- IFC geometry smoke: **PASS** — 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, 14,694 triangles.
- Application typecheck: **PASS**. Collaboration typecheck: **PASS**.
- Production build: **PASS**, with only the existing large-chunk, mixed IFC import, React Router future-flag, unsigned-theme-cookie, and localStorage warnings.
- Production collaboration spec compiled/listed **5 tests**.
- Prettier and `git diff --check`: **PASS**.

Production collaboration execution remains **UNEXECUTED** because Supabase, hosted application, collaboration service, and deterministic-run credentials are absent. Real PostgreSQL execution remains **UNEXECUTED** because `DATABASE_URL` and `P3_E2E_DATABASE_ADMIN_URL` are absent. No database or schema changes were made in this round.

## Scope and artifacts

- Changed only the PDF compare session transition, its mounted Chromium regression, and this report.
- No dependency, lockfile, migration, schema, generated database type, store, CRDT/Awareness shape, signed URL persistence, PDF marker/pixel persistence, source bytes, or public API changed.
- The browser-generated Task 5 screenshot was restored byte-for-byte from the base commit.
- The four pre-existing P4 artifacts and `.superpowers/audits/` remain untouched and excluded from this fix.
