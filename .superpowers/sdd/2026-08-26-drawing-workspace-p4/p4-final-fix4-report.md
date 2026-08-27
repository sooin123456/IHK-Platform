# Drawing Workspace P4 final fix 4 report

Date: 2026-08-27
Rereviewed source: `c7cdef1`
Product fix: `1751c3411880f2f51abba8c6bcd45ac66e1c5200`

## Implemented result

- `createDrawingAwarenessPublication` is now the single local Awareness
  publication authority. It owns candidate state and the frame-bounded
  publisher, and exposes only `connect`, `update`, `clear`, `disconnect`, and
  read-only local-state access to the workspace.
- Every update and connection synchronously reads the current canonical
  selection and dependency-aware visible entity set. Hidden hosted openings
  are removed from both selection and soft locks before initial connection,
  reconnection, reauthorization, cursor/lease updates, or a passive selection
  effect can publish them.
- Pruning is persisted in the coordinator's local state. Restoring a host wall
  therefore does not resurrect a prior opening selection or soft lock.
- The workspace no longer contains `awarenessPublisherRef`,
  `awarenessLocalRef`, or a direct adapter `setLocalState` call. The only
  adapter publication call is inside the canonical coordinator.
- Remote peer state remains independent. Host visibility filters its mounted
  presentation but never clears or rewrites the peer's stored lock state.
- No dependency, state manager, CRDT protocol, migration, database, public API,
  controller ledger, or P5 product file changed.

## TDD evidence

- The deterministic coordinator test failed first because the new authority
  did not exist. It now covers stale multi-selection and locks at initial
  connect, reconnect after a host-hide render but before passive publication,
  reauthorization through the same update boundary, an unrelated visible
  selection/lock, remote-state independence, and no restoration resurrection.
- The static contract failed first on the two legacy refs and direct publisher
  calls. It now requires zero workspace adapter writes/legacy authorities and
  exactly one `adapter.setLocalState` call inside the coordinator.
- The mounted test failed first because it had no lock-bearing outgoing state.
  It now observes the real local adapter payload with a selected hosted opening
  and soft lock, hides the host without another pointer event, observes both
  arrays become empty, preserves an unrelated remote lock, and confirms local
  state remains empty after restoration.
- Focused Node verification passed **78/78**; the focused mounted Chromium race
  passed **1/1**.

## Fresh verification

- Full Drawing Workspace suite: **646 passed, 0 failed, 1 skipped**. The sole
  skip is the explicit unconfigured disposable real-PostgreSQL fixture.
- Application and collaboration typechecks: exit `0`.
- Application and collaboration production builds: exit `0`, with only the
  established bundle-size, React Router future, and unsigned-theme-cookie
  warnings.
- Canonical local Chromium functional/IndexedDB gate: **10/10 passed**.
- Exact source-bound local release at `1751c34`: **`P4 LOCAL PASS`**. It also
  passed collaboration **33/33**, IFC/PDF/quantity/approval/Revit regressions
  **100/100**, production-build performance execution **1/1**, and license
  closure **7/7**.
- Application audit retains three moderate transitive `ajv` findings with no
  available fix and no high-severity finding; collaboration audit reports zero
  vulnerabilities. `git diff --check` passed.
- One non-gate exploratory Playwright command intentionally collected the
  repository's unrelated credentialed suites and failed during discovery on
  absent credentials. The release-owned explicit P4 functional/IndexedDB file
  list subsequently passed both standalone and within the exact release.

## Honest status separation

- **P4 LOCAL IMPLEMENTATION: PASS.** All local Awareness publication paths now
  share one synchronous dependency-aware authority.
- **REAL POSTGRESQL: UNEXECUTED.** No disposable PostgreSQL authority is
  configured; PGlite evidence is not relabelled as real PostgreSQL.
- **PRODUCTION: UNEXECUTED.** Hosted provider convergence, production RLS and
  freeze/source checks, provider p95, cleanup, deployment, and rollback are not
  claimed.
- **PERFORMANCE TARGET: NOT MET.** Refreshed commit-bound local evidence records
  first usable at `5849.099999964237 ms` versus the `2500 ms` target. Warm
  local p95 is zoom `0.20000004768371582 ms`, pan
  `0.30000001192092896 ms`, and selection `85.80000001192093 ms`. P7 60 fps
  and production-provider p95 remain `UNEXECUTED`.

The branch and worktree remain available for the parent integration workflow.
