# P5 Task 5 fix round 3 implementation

Date: 2026-08-27

Base: `98e031b fix: reset drawing PDF diff sessions`

## Outcome

- A PDF predecessor capability is now accepted only from the response that follows the currently pending exact compare request.
- The client records the submitted revision edge, current and predecessor file IDs and SHA-256 values, active page, and the fetcher's pre-request response identity. Retained data from an earlier successful request cannot remount a discarded predecessor while fresh revalidation is pending.
- Current-only mode and current/source changes clear both the transient capability and the pending request binding. No signed URL, request binding, diff pixels, or markers are persisted.
- Fix2 behavior remains intact: returning to overlay may perform one fresh capability POST and one predecessor GET, but performs no diff reads and restores no markers until another explicit calculation.

## TDD evidence

- RED: the second compare response was held at the network boundary for 250 ms. During that hold, predecessor GET count changed from one to two, and both requests were recorded with `capabilityReleased: false`.
- GREEN: while the second response is held, predecessor GET count stays one and the pending-capability status remains visible. Releasing the response causes exactly one GET using the new `?capability=fresh` signed URL, recorded only after release.
- The same mounted regression verifies zero additional `getImageData` calls and zero markers after re-entry. The second explicit `변경 표시 계산` alone adds two image reads and restores a non-listening marker.
- Root cause: `useFetcher.data` retains its previous successful response across submissions. Mode alone was therefore insufficient to establish which request produced the accepted capability.

## Verification

- Targeted delayed-response mounted regression: **1 passed, 0 failed**.
- Focused P5, database/PGlite, Awareness, PDF, source command/link, and preview suite, serial: **219 passed, 0 failed**. The shared tree includes follow-on Task 6 preview tests; no Task 6 file was changed by this fix.
- PDF suite: **17 passed, 0 failed**.
- Relevant serial Drawing suite: **686 passed, 0 failed, 1 existing real-PostgreSQL-dependent skip/UNEXECUTED** (687 total, including preserved shared Task 6 tests).
- Mounted Chromium P5 suite, warm: **8 passed, 0 failed**. The isolated warm IFC lifecycle test also passed **1/1**.
- Cold Chromium note: all four PDF tests passed; Vite dependency re-optimization after the preserved Task 6 package changes caused the known development-only IFC three-fetch observation. The isolated warm IFC and complete warm suite passed unchanged.
- IFC geometry smoke: **PASS** — 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, 14,694 triangles.
- Application typecheck: **PASS**. Collaboration typecheck: **PASS**.
- Production build: **PASS**, with only the existing large-chunk, mixed IFC import, React Router future-flag, unsigned-theme-cookie, and localStorage warnings.
- Production collaboration spec compiled/listed **5 tests**.
- Prettier and `git diff --check`: **PASS**.

Production collaboration execution remains **UNEXECUTED** because all required Supabase, hosted application, collaboration service, and deterministic-run credentials are absent. Real PostgreSQL execution remains **UNEXECUTED** because `DATABASE_URL` and `P3_E2E_DATABASE_ADMIN_URL` are absent. No database or schema change was made in this round.

## Scope and artifacts

- Changed only the PDF compare capability request binding, its deterministic mounted regression, and this report.
- No dependency, lockfile, migration, schema, generated database type, store, CRDT/Awareness shape, signed URL persistence, source bytes, or public API changed.
- The browser-generated Task 5 screenshot was restored byte-for-byte from the base commit.
- All pre-existing P4/audit artifacts and concurrent Task 6 preview/release files remain untouched and excluded from this fix.
