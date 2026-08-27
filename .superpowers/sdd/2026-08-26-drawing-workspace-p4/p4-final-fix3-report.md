# Drawing Workspace P4 final residual fix report

Date: 2026-08-27
Rereviewed source: `82127c6`
Product fix: `fc3c4f597a888d9074177085b6f939829ee9f662`

## Implemented result

- `deriveDrawingTransientState` now consumes the existing
  `drawingVisibleCanvasObjects` authority. Object selection therefore requires
  both the existing editable/selectable own-layer rule and membership in the
  dependency-aware visible set. A hosted opening is removed when its host wall
  layer is hidden even when the opening's own layer remains visible.
- Existing semantics remain intentional: a visible host wall being locked does
  not make an opening visually hidden; block-instance semantic inspection rules
  are unchanged; unresolved hosts remain available to strict graph validation.
- The workspace derives one canonical selection key from
  `transient.selectedIds`, prunes stale raw React selection after a visibility
  transition, and keys local Awareness publication to that derived selection.
  Restoration therefore cannot resurrect the pruned opening automatically.
- Every local publisher update that does not explicitly clear or replace
  selection—including cursor and soft-lock updates—merges the current canonical
  derived selection rather than the prior `awarenessLocalRef` selection.
- The local preview observes the exact payload delivered to its real Awareness
  adapter's `setLocalState`; the mounted test does not infer local publication
  from the already-filtered remote overlay.
- No dependency, state manager, CRDT protocol, migration, public API, controller
  ledger, screenshot, or P5 file changed in the product commit.

## TDD evidence

- The parent-state test failed first with the hosted opening retained alongside
  an unrelated visible rectangle. After the shared-helper change, the opening
  is removed, the unrelated multi-selection member remains, and a visible but
  locked host continues to preserve opening visibility.
- The mounted test failed first because no outgoing local Awareness payload
  exposed the selected opening at the real adapter seam. After the fix it:
  restores the host, selects the opening, observes its ID in outgoing local
  Awareness, hides the host without another pointer event, and observes both
  parent selection and outgoing Awareness become empty.
- Restoring the host leaves local selection and local Awareness empty while the
  independent remote overlay returns. This proves local selection is not
  resurrected and remote peer state was neither cleared nor rewritten.
- Focused parent/adapter/Awareness tests: **43/43 passed**. The focused mounted
  Chromium regression: **1/1 passed** before the full gate.

## Fresh verification

- Full Drawing Workspace suite: **645 passed, 0 failed, 1 skipped**. The sole
  skip is the explicit unconfigured disposable real-PostgreSQL fixture.
- Application and collaboration typechecks: exit `0`.
- Application and collaboration production builds: exit `0`, with only the
  established bundle-size, React Router future, and unsigned-theme-cookie
  warnings.
- Full Chromium functional/IndexedDB: **10/10 passed**, including the outgoing
  local Awareness transition and all existing offline recovery tests.
- Exact source-bound local release at `fc3c4f5`: **`P4 LOCAL PASS`**. Within it,
  collaboration passed **33/33**, IFC/PDF/quantity/approval/Revit regressions
  passed **100/100**, performance execution passed **1/1**, and license closure
  passed **7/7**.
- Application audit retains three moderate transitive `ajv` findings with no
  available fix and no high-severity finding; collaboration audit reports zero
  findings. `git diff --check` passed.

## Honest status separation

- **P4 LOCAL IMPLEMENTATION: PASS.** The final residual selection/local
  Awareness visibility authority is closed by the shared derivation, direct
  outgoing-payload observation, and exact local release.
- **REAL POSTGRESQL: UNEXECUTED.** No disposable PostgreSQL authority is
  configured; PGlite coverage is not relabelled as real PostgreSQL.
- **PRODUCTION: UNEXECUTED.** Hosted provider convergence, production RLS and
  freeze/source checks, provider p95, cleanup, deployment, and rollback are not
  claimed.
- **PERFORMANCE TARGET: NOT MET.** Refreshed local evidence records first usable
  at `5918.199999988079 ms` versus the `2500 ms` target. Warm local p95 is zoom
  `0.20000004768371582 ms`, pan `0.19999998807907104 ms`, and selection `79 ms`.
  P7 60 fps and production-provider p95 remain `UNEXECUTED`.

The branch and worktree remain available for the parent integration workflow.
