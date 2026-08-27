# Drawing Workspace P5 PDF/IFC integration implementation plan

Spec: `docs/superpowers/specs/2026-08-27-drawing-workspace-p5-design.md`

## Task 1 — Strict source links, PDF/world transforms, and diff kernel

**Files:** modify `drawing-workspace.types.ts` and `drawing-structure.ts`; add `drawing-source-links.ts`, `drawing-pdf-transform.ts`, `drawing-pdf-revision-diff.ts`, and focused tests.

- [ ] Write RED exact-union tests for PDF/IFC links, hash/GlobalId/camera/region/version keys and source-map final-graph validation.
- [ ] Write RED transform tests for contain-fit letterboxing, rotations 0/90/180/270, forward/inverse precision, clipping, and empty rejection.
- [ ] Write RED diff tests for identical pages, threshold tiles, merging/capping, aspect/rotation refusal, stable output, and AbortController cancellation.
- [ ] Write RED focus tests for user/programmatic loop prevention, GlobalId preference, same-SHA ExpressId scope, unique/ambiguous/no-match, and load generations.
- [ ] Implement the smallest dependency-free contracts and keep signed URLs, renderer IDs, pixels, and markers outside canonical state.
- [ ] Run focused plus P0–P4 structure/geometry/typecheck regressions and commit.

Commit: `feat: define drawing PDF and IFC evidence contracts`

## Task 2 — Operation-backed source commands and offline/history integration

**Files:** modify structure/commands/store/collaboration protocol/Yjs/outbox/history/checkpoint modules and focused tests.

- [ ] Add RED command/inverse/final-graph tests for link, unlink, object delete, restore order, duplicate, and clipboard exclusion.
- [ ] Extend only `mutate_structure` with `put_source/delete_source`; retain P3 schema/database v1.
- [ ] Project sources through store, Yjs/outbox replay, retry/conflict, undo/redo/revert, snapshots, checkpoints, templates, and approved-child drafts.
- [ ] Add real IndexedDB crash/reopen tests and no-source-copy clipboard/browser assertions.
- [ ] Run full Drawing collaboration regressions and commit.

Commit: `feat: link drawing objects to source evidence`

## Task 3 — Supabase source authority and atomic anchor relink

**Files:** one new CLI migration, strict server loaders/revision service/database types, shared TS/SQL fixtures, PGlite/real-PG/source-contract tests.

- [ ] RED fresh-install/P0–P4-upgrade tests for versioned soft-deleted sources, partial uniqueness, payload/file/SHA/final-graph validation, OCC/idempotency, and exact result versions.
- [ ] RED RLS/grant/freeze/direct-DML tests for roles, project boundaries, mutable/wrong-kind/wrong-SHA sources, and approved/review-requested revisions.
- [ ] RED snapshot/checkpoint/template/approved-child/freeze source-lineage tests.
- [ ] RED atomic relink tests for exact revision edge, stale/inactive predecessor, wrong kind, direct replacement denial, old/new audit preservation, and rollback.
- [ ] Generate one forward migration and extend strict authorized loaders without public source mutation APIs.
- [ ] Run PGlite, real PostgreSQL when available, full DB/server/typecheck regressions, and commit; absence is `UNEXECUTED`.

Commit: `feat: persist drawing evidence links and relinks`

## Task 4 — Controlled IFC viewer and 2D/3D/split workspace

**Files:** modify workspace route/view/shell, IFC property/model viewer, source panel, preview, and browser tests.

- [ ] RED route/source-bundle tests for `view`, selected IFC, foreign/mutable/wrong-SHA files, catalog URL exclusion, and signed-source minimization.
- [ ] RED controlled focus tests for request IDs/origins, link index ambiguity, no feedback loop, and IFC load/SHA generation.
- [ ] Compose accessible `2D | 3D | 분할`, chooser, desktop panes/narrow tabs, drawing↔IFC focus/link controls, and remote drawing-selection highlights.
- [ ] Lazy-load once across mode toggles; abort/dispose on source swap/unmount; handle WebGL loss/retry and hidden-frame suppression.
- [ ] Run mounted Chromium lifecycle/two-browser tests, IFC smoke, typecheck/build, and commit.

Commit: `feat: integrate IFC focus into drawing workspace`

## Task 5 — PDF revision overlay and relink review UI

**Files:** add revision overlay/source panel; modify PDF renderer/canvas/issue panel/revision service/workspace; add component/E2E tests.

- [ ] RED active-page predecessor overlay tests for exact edge/page, opacity/modes, missing page, cancellation/cleanup, and no automatic sheet guessing.
- [ ] Render transient non-listening markers from the Task 1 diff kernel and label them `브라우저 미리보기`.
- [ ] Add object PDF-region/IFC link/unlink inspector flows through mounted commands and permissions.
- [ ] Replace separate anchor add/deactivate UI with explicit candidate focus/confirm and the atomic relink RPC; never copy PDF coordinates automatically.
- [ ] Verify old inactive/new active lineage, Viewer read-only behavior, source bytes, accessibility, and commit.

Commit: `feat: review drawing PDF and IFC revisions`

## Task 6 — P5 vertical workflow, lifecycle, and release evidence

**Files:** preview/E2E/release scripts/config/contracts/status docs/notices/evidence.

- [ ] Add real PDF+IFC fixtures and a mounted vertical covering modes, single IFC fetch, bidirectional link/focus, second browser, offline link/unlink/undo/reload/ack, PDF overlay/marker, atomic relink, Viewer denial, and resource cleanup.
- [ ] Hash PDF/IFC file rows and bytes before/after every mutation workflow.
- [ ] Add a 10k objects/2k links/one IFC/one active compare-page baseline without claiming 60 fps.
- [ ] Run all P0–P4 Drawing, IFC, PDF, quantity, approval, export, Revit, collaboration, license, audit, typecheck, and build gates.
- [ ] Add hermetic fail-closed production authority/CORS/signed-URL/two-user/provider gates; missing authority is nonzero `UNEXECUTED`.
- [ ] Record generated commit-bound local metrics and honest `NOT MET/UNEXECUTED` statuses, then commit.

Commit: `test: verify drawing workspace P5 integration`
