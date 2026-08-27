# P5 Task 4 Fix Round 1 Implementation

Date: 2026-08-27

Base: `af5bfc9a17570f0b8b6327ef4c6b1088c5b120e8`

Review source: `task-4-review.md` (`0 Critical / 3 Important / 0 Minor`)

## Result

All three Important findings were reproduced with failing tests and fixed without adding dependencies, stores, schemas, migrations, or new UI scope.

1. IFC-to-drawing reverse lookup now indexes and matches the exact `(sourceFileId, sourceSha256, ifcGlobalId)` tuple. A stale or foreign SHA cannot produce a unique or ambiguous match, and the already-linked guard uses the same exact identity. The existing viewer focus order remains element focus first, canonical camera restore second.
2. A documentless workspace no longer bypasses source validation. The project-scoped immutable source query, UUID/kind/SHA/metadata validation, explicit IFC selection validation, and URL-free catalog construction run before the documentless return. This path signs no source, including when an IFC is explicitly selected.
3. Narrow split tabs wrap on both `ArrowLeft` and `ArrowRight`; `Home` and `End` retain deterministic endpoints. Selection, focus, `aria-selected`, `tabIndex`, `aria-controls`, and the controlled tabpanel stay synchronized.

## TDD Evidence

RED:

- Reverse lookup returned `ambiguous` when the second link had the same file and GlobalId but a different SHA.
- A valid documentless explicit IFC was absent from the returned catalog, while invalid selections bypassed validation.
- Mounted source inspection found no selected SHA in the reverse lookup or already-linked guard.
- Mounted Chromium narrow split test kept `2D 도면` selected after `ArrowLeft` at the first tab instead of wrapping to `IFC 3D`.

GREEN:

- Targeted fix tests: `18/18` passed.
- Focused Task 4/route/preview set: `45/45` passed.
- Mounted narrow Chromium reproduction: `1/1` passed.
- Clean mounted Task 4 Chromium lifecycle suite: `4/4` passed in `9.7s`.

## Verification Gates

- Serial Drawing suite: `675` total, `674` passed, `1` existing PostgreSQL-dependent skip, `0` failed (`26.1s`).
- IFC geometry smoke: `120` elements, `115` geometric elements, `119` placements, `14,694` triangles.
- Application typecheck: passed.
- Collaboration typecheck: passed.
- Production build: passed. Existing Vite large-chunk and mixed static/dynamic IFC import warnings remain unchanged.
- Prettier: changed files formatted; final check passed.
- `git diff --check`: passed.
- React review: the TSX change is limited to exact identity arguments/guards and the existing controlled two-tab handler; no added effects, state, or client fetches.
- Independent fix review: `0 Critical / 0 Important / 0 Minor`; all three official findings closed with camera ordering and exact-fetch behavior preserved.

## Request Trace Environment Note

The browser lifecycle test still requires the IFC request count to equal exactly one across `2D -> 3D -> 2D -> split` and WebGL retry. It does not filter, deduplicate, or tolerate extra requests. A cold Vite dependency-optimizer full-page reload invalidates a development-only trace; prewarm the stable dev server and rerun the exact assertion (or verify the production build). Any duplicate request in a stable or production-like run remains a test failure. The recorded clean run observed exactly one initial IFC fetch.

## Artifacts and Residual Gates

- No new screenshot was necessary because the visible layout did not change; the mounted accessibility test verifies focus, ARIA selection, and the visible IFC tabpanel.
- No database migration, CRDT/Awareness schema change, new dependency, source copy, geometry diff, PDF overlay, or relink UI was introduced.
- Real authenticated RLS/storage signing and production browser traces remain deployment-environment gates; local mocks validate fail-closed behavior and zero documentless signing.
- The four pre-existing P4 dirty progress/PNG artifacts were preserved and excluded from this fix.
