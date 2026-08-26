# P4 Task 6 command-order fix report

Base: `0c62ff150812081c1b71edf6584b465a6924a362`

Prior reviewed fix: `e32ca40`

## Production fix

Mounted drawing mutations now share one per-workspace promise queue. Each
queued mutation reads the collaboration adapter's latest applied projection
before it prepares or appends an operation. The queue does not disable the UI;
it preserves input order while the durable outbox write is in flight.

Versioned `update_objects` commands retain the user's intent when a later
mounted event was created from the same render:

- ordinary geometry translations replay their delta over the latest geometry;
- hosted-opening pointer moves replay their offset delta over the latest
  opening offset;
- inspector geometry fields merge over the latest locally applied geometry;
- every rebased update uses the latest object version.

Rebasing is limited to a locally ordered projection. If the target differs
from the queue's prior local projection, the original version guard remains in
force so a remote edit still follows the existing conflict path instead of
being overwritten. Non-update commands prepare against the adapter at their
actual queue position. Rejections are surfaced through the existing
collaboration edit notice; storage failures retain the existing fail-closed
state.

Undo and redo are also constructed inside the queue from the latest adapter
projection. This closes the analogous immediate Undo-then-Redo race without
changing pointer capture, actor history, collaboration lineage, or operation
types.

## Mounted deterministic proof

The new Chromium test uses the rendered local workspace and its production
callbacks. It performs 27 Shift-arrow inputs without waits between commands
(12 right, 7 down, 5 left, 3 up), then verifies all 27 operations and the exact
wall coordinates. It also verifies the hosted opening follows the wall while
its stored geometry stays unchanged, performs consecutive pointer drags on the
rendered opening cut, applies inspector thickness and height while retaining
the moved geometry, and sends immediate native Undo/Redo shortcuts.

The development-loopback-only mounted control then flushes the real Yjs
IndexedDB persistence handle. Reload recovery compares exact objects and exact
operation, undo, and redo ID order. The persistence flush now waits for the
IndexedDB transaction following `y-indexeddb` compaction, so its resolved
promise is a truthful durable boundary rather than only a scheduled write.

The focused burst passed **10/10** repeated Chromium runs. The full integrated
architectural vertical that previously reproduced the race twice in eight
runs passed **8/8** repeated runs.

## Mutation check

Temporarily restoring the old fire-and-forget
`bridge.applyCommand(command)` path made the focused mounted test fail
deterministically: the wall reached version **4** instead of expected version
**28**. Restoring the production queue returned the test to green. The
temporary mutation was not retained.

## Verification

- Focused P4 command tests: **12 passed, 0 failed**.
- Combined P4 and real IndexedDB Chromium: **7 passed, 0 failed**.
- Focused mounted burst repetition: **10 passed, 0 failed**.
- Integrated architectural vertical repetition: **8 passed, 0 failed**.
- Full `npm run test:drawing-workspace`: **597 discovered; 596 passed, 0
  failed, 1 skipped**. The skip remains explicitly `UNEXECUTED: disposable
  PostgreSQL concurrency fixture is not configured`.
- `npm run typecheck`, `npm run typecheck:collaboration`, `npm run build`, and
  `npm run build:collaboration`: exit 0; established build warnings only.
- `git diff --check`: exit 0.
- Durable source PDF SHA-256 remained
  `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`.
- Source IFC SHA-256 remained
  `30c157d118a3be377cd592d520e163ff9249781fb002c4c81be64240672c8b93`.

## Scope and boundaries

- No dependency, lockfile, migration, RPC, protocol, operation kind, semantic
  CRDT, or state manager was added.
- The local-draft flush button is available only through the existing
  development-loopback `verticalTest` preview harness and invokes the mounted
  workspace's real persistence handle.
- Provider-authoritative convergence, production PostgreSQL concurrency,
  hosted collaboration, deployment, and latency remain **PRODUCTION
  UNEXECUTED**.
