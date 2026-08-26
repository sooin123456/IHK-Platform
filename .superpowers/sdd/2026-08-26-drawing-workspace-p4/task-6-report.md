# P4 Task 6 implementation report

Base: `0c62ff150812081c1b71edf6584b465a6924a362`

This report supersedes the evidence claims in commit `2d76b44`. The official
review found that its checkpoint test restored an unchanged graph, its offline
test did not disable Chromium networking or use `DrawingOutbox`, and its review
freeze used a monkey-patched form. Those are not retained as proof.

## Implemented result

- PNG, PDF, and SVG export fail before artifact construction when any semantic
  host reference is unresolved. Equal-layer rendering now preserves authored
  ordering while scheduling each host wall before its hosted openings.
- Live Canvas and export share semantic fills, opening/wall/grid metrics,
  polygon centroid calculation, and label layout constants. SVG/Canvas export
  now matches the live square wall cap and grid bubble stroke.
- The local preview contains eight P4 objects: two connected walls, hosted door
  and window, space, area, grid, and arc. Its Schedule values remain explicitly
  browser-derived preview values; no confirmed server evidence is claimed.
- Checkpoint restore commands resolve their structural object targets through
  the existing soft-lock resolver. A changed graph can restore without a peer
  lock and is blocked when an affected object has an active peer lock.
- No dependency, lockfile, migration, operation discriminator, semantic CRDT,
  state manager, RPC, or persisted schedule was added.

## Executed local evidence

- The integrated Chromium P4 test authors all six semantic types through the
  production tool controller; applies a real semantic inspector edit; moves a
  wall and hosted opening; checks opening follow, invalid shrink rejection, and
  undo/redo; exercises a peer restore conflict and collaboration retry; rejects
  viewer-direct and locked-layer mutation; observes a real pending review
  freeze and its server failure release; restores a changed graph and compares
  exact semantic objects/geometry, host references, all three schedules, and
  SVG output.
- The same test downloads the P4 PDF, parses its metadata/pages with `pdf-lib`,
  renders page 1 through the shared PDF.js renderer, and requires non-white
  pixels. It also opens the durable source PDF through that renderer.
- Chromium was placed in real network-offline mode (`navigator.onLine ===
  false`). One hundred operations went through the production collaboration
  command bridge into the real IndexedDB `DrawingOutbox` and Yjs persistence.
  After both stores were closed/reopened, exact ordered operation IDs, pending
  IDs, outbox IDs, and object IDs matched. Reconnect posted 100 operations to
  the real local preview action, verified every echoed ID, removed every
  outbox entry, applied authoritative Yjs acknowledgements, and converged with
  no pending ID or object loss.
- Inverse and representative random UUID host/opening pairs assert host-first
  SVG order. Real Chromium samples the opening cut after SVG, PNG, and PDF
  rendering, so ordering is checked visually rather than by traversal alone.

## Verification summary

- Focused review suites: 41 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 595 discovered; 594 passed, 0 failed,
  1 explicitly skipped disposable-PostgreSQL concurrency fixture.
- Combined P4/IndexedDB Chromium: 6 passed, 0 failed.
- `npm run typecheck`, `npm run typecheck:collaboration`, `npm run build`, and
  `npm run build:collaboration`: exit 0 with established warnings only.
- `git diff --check`: exit 0.

Exact commands, hashes, and durable paths are recorded in
`task-6-fix-evidence.txt`; detailed review-fix mapping is in
`task-6-fix-report.md`.

Production PostgreSQL concurrency, hosted collaboration, deployment, and
production latency remain **PRODUCTION UNEXECUTED**.
