# P4 Task 6 semantic inspector draft fix report

Base: `0c62ff150812081c1b71edf6584b465a6924a362`

Prior reviewed fix: `cb75670`

## Production fix

The semantic inspector no longer keys either the component or its form by
object version. A queued local projection can therefore advance the selected
object version without remounting the form or discarding browser input and its
dirty-field set.

The inspector records the canonical value and object version when each field
first becomes dirty. Every later projection of the same object is classified
at field level:

- queued local movement is preserved because wall start/end change while the
  dirty thickness and height baselines do not;
- an authoritative change to an unrelated field preserves the dirty input,
  and submitting merges the dirty field over the latest object without
  replacing the authoritative field;
- an authoritative change to a dirty field keeps the user's visible draft but
  blocks submission with an alert, so it cannot silently overwrite the newer
  value;
- selecting another object resets the form to that object's canonical values;
- deleting the selected object unmounts and clears its draft;
- the explicit native cancel button resets the form to the latest canonical
  values and clears the conflict.

The existing queued update rebase remains the command authority after a valid
submit. No queue, outbox, Yjs, operation, RPC, or collaboration protocol shape
changed.

## Mounted rapid workflow

The mounted regression now sends 27 Shift-arrow commands and immediately,
without waiting for those projections, fills wall thickness `220` and height
`3200`, submits the native semantic form, focuses the canvas, and sends native
Undo then Redo.

It requires an exact **30-operation** delta before continuing: 27 moves, one
inspector update, one undo, and one redo. It also verifies exact wall
coordinates, thickness, height, unchanged stored hosted-opening geometry, no
collaboration rejection notice, and exact objects/operation/undo/redo order
after real Yjs/IndexedDB flush and reload.

This adversarial workflow passed **10/10** repeated Chromium runs.

## Field conflict and lifecycle proof

Pure classification tests cover local movement, unrelated authoritative
changes, same-field conflicts, selection changes, and deletion.

Two mounted tests use development-loopback-only controls to apply an
authoritative projection through the mounted draft adapter:

- a remote wall-name change preserves a dirty thickness input; submit applies
  thickness while retaining the remote name;
- a remote thickness change leaves the dirty value visible, raises the
  conflict alert, and appends no inspector operation; cancel loads the remote
  thickness, selection away/back clears a later draft, and deleting a dirty
  selected arc removes its inspector.

These two mounted cases passed **10/10** across five repetitions each.

## TDD and mutation evidence

Before the fix, the no-wait mounted test failed with **29/30** operations and
unchanged thickness/height. The three draft-classification tests also failed
because no field-level projection classifier existed.

After the fix, temporarily restoring the old parent
`key={id + ":" + version}` behavior made the mounted workflow fail again with
**29/30** operations. Restoring the ID-stable inspector returned the workflow
to green. The mutation was not retained.

## Verification

- Focused semantic table/inspector tests: **15 passed, 0 failed**.
- Focused no-wait mounted workflow repetition: **10 passed, 0 failed**.
- Mounted field conflict/lifecycle repetition: **10 passed, 0 failed**.
- Combined P4 and real IndexedDB Chromium: **9 passed, 0 failed**.
- Full `npm run test:drawing-workspace`: **600 discovered; 599 passed, 0
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
- Authoritative projection controls exist only in the existing
  development-loopback `verticalTest` harness and operate the mounted draft
  adapter; they are not production provider evidence.
- Provider-authoritative convergence, production PostgreSQL concurrency,
  hosted collaboration, deployment, and latency remain **PRODUCTION
  UNEXECUTED**.
