# P4 Task 4 review-fix report

Reviewed implementation: `884e82aaa7373d8dca11c9a7edce1ebc0b7085f6`

## Corrections

- I1: the pure tool controller now revalidates the current layer by identity and full editability on every context sync. A same-ID lock, hide, source conversion, capability loss, or pointer event cancels the session and releases capture without emitting a command.
- I2: wall/grid endpoints snap first and then reconcile to an exact 45-degree ray, including object-versus-grid snap competition.
- I3: rendering and hit testing reuse the canonical exact-microdegree arc sampler. The duplicate raw-degree sampler was removed; huge, negative, and full-turn cases share one result.
- I4: selection keeps bounds as the broad phase and applies geometry-specific narrow-phase tests for wall/grid/arc segments, resolved opening cut/door/window markers, and polygon interior/boundaries. Empty overlap regions fall through to the underlying eligible object.
- I5: a drag preview builds one transient host map and renders visible dependent openings against it without adding opening mutations. Wall-only, wall-plus-opening, hidden dependent, cancellation, commit, and host-visibility cancellation are covered.
- I6: architectural menu Escape and item activation restore focus to the `건축 객체` trigger at desktop and tablet sizes.
- M1: invalid space/area completion retains the current point session and exposes an accessible Korean validation alert until the boundary is corrected or cancelled.
- M2: semantic render caching is a `WeakMap` keyed by object identity, stores only openings/arcs, and invalidates an opening when its host identity changes.

No dependency, CRDT schema, renderer package, or parallel UI/state path was added. Semantic objects remain outside block definitions.

## RED evidence

- Initial focused Node run: 26 discovered; 18 passed and 8 failed on same-ID layer revalidation, snap/constraint ordering, canonical arc sampling, narrow-phase fallthrough, dependent opening previews, invalid polygon retention, and bounded cache behavior.
- Initial focused Chromium run failed because architectural menu item activation/Escape left focus outside the trigger.
- Opening-marker audit RED: the focused geometry suite was 15/16 because the rendered door leaf was outside the old opening narrow phase and bounds.

## GREEN and verification evidence

- Focused P4 geometry/tools: 26/26 passed, 0 failed.
- Relevant commands, Awareness, block, and route tests: 110/110 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 572 discovered; 571 passed, 0 failed, 1 explicitly skipped disposable-PostgreSQL concurrency fixture.
- Fresh `npm run typecheck`: exit 0.
- Fresh `npm run build`: exit 0. Existing Vite chunk-size, mixed dynamic/static import, React Router future-flag, and local cookie warnings remain warnings only.
- Full real Chromium shell: 11/11 passed with one worker, including desktop/tablet architectural authoring, invalid polygon feedback, trigger focus restoration, and overflow checks. A preceding run was 10/11 on an unrelated review-freeze toast timing assertion; its isolated rerun and the subsequent complete rerun both passed.
- Fresh `git diff --check`: exit 0.

## Browser artifact

- Screenshot: `/Users/h/Documents/GoAgent/.worktrees/drawing-workspace-p0-p1/.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-4-fix-chromium.png`
- Screenshot SHA-256: `3bf8c403d7450345d6bb476958bbc15d03e5f777b4df72214880b6e166cb05ca`
- Chromium DOM evidence at 1440×900: all six menu items visible, focus on `벽 도구`, document horizontal overflow `0`.

## Commit

- Subject: `fix: close P4 architectural authoring review findings`
- Identity: the commit containing this report; exact SHA is reported in the task handoff because a commit cannot embed its own content hash.

## Residuals

- The disposable-PostgreSQL concurrency fixture remains explicitly unexecuted because that external fixture is not configured; no PostgreSQL concurrency pass is claimed.
- Server-derived V1 evidence and semantic schedule/export work remain assigned to later P4 tasks, unchanged by this review fix.
