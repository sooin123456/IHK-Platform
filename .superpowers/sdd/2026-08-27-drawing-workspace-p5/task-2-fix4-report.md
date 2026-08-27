# P5 Task 2 review-fix round 4 report

## Commit

- Prior Task 2 fix: `1f35ff83df500fe9763041870f1223c5e2c06ce6`
- Subject: `fix: bind drawing recovery to trusted scope`

The fix commit contains only the bounded Task 2 authority binding, migrated
recovery callers, focused/browser regressions, and this report. The pre-existing
P4 progress and screenshot changes remain unstaged and excluded.

## Important finding resolved

Compacted outbox redo proof is now bound to a mandatory
`DrawingRecoveryScope` containing the authenticated current owner and revision.
`createDrawingOutbox` derives that scope from the workspace bootstrap values it
already uses to isolate durable entries, and `restoreDrawingWorkspaceState`
always obtains the scope from that outbox. There is no optional recovery path
that can project work without trusted context.

The compacted add → undo → redo proof now requires all of the following:

- the pending durable entry owner equals the trusted current owner;
- the original add and acknowledged undo trusted actors equal that owner;
- the authoritative state, original, undo, and pending redo revisions equal the
  trusted current revision;
- the existing exact lineage, payload, inverse, base/result version, operation
  order, and global UUID-owner checks all pass.

Server snapshot history obtains actor authority only from trusted recorded
operations. Just-acknowledged history obtains actor authority only from the
durable outbox entry owner. Unknown `actorId`, `resultVersions`, or
`realizedVersions` fields supplied on a client operation are parsed away and
never become recovery authority.

The general recovery API requires the trusted scope at every production and
test caller. A missing scope or a scope whose revision does not match the loaded
authoritative state returns the untouched state and marks pending work
ambiguous. Pending entries whose owner or operation revision differs from the
scope are likewise ambiguous and block later causal work.

Direct history remains actor-scoped, and Yjs compacted replay continues to bind
the original, undo, and pending redo to one actor plus the collaboration room
revision. The outbox path now has the same authority semantics.

## TDD evidence

### RED

- An outbox scoped to actor B projected actor A's exact compacted redo over a
  tombstone-free authoritative snapshot.
- Recovery accepted actor-A history whose revisions had been changed away from
  the current loaded revision.

### GREEN

- Actor B's durable entry over actor A's trusted history remains absent and is
  reported ambiguous through `restoreDrawingWorkspaceState`.
- Cross-revision recorded history and a current authoritative state whose
  revision differs from the outbox scope remain absent and ambiguous through
  the restore path.
- Missing trusted context, a pending-operation revision mismatch, and spoofed
  client actor metadata remain absent and ambiguous through direct recovery.
- The exact actor-A/current-revision compacted chain still restores object v3 in
  live acknowledged-prefix and second-realm recovery.
- The real Chromium crash/reopen now verifies the persisted outbox entry owner
  and revision and successfully recovers v3 only with the reopened outbox's
  trusted scope.

## Final verification

- Focused source command/lifecycle, outbox/store, Yjs, and history suite:
  `111/111` passed.
- Full Drawing workspace suite: `652` discovered, `651` passed, `0` failed,
  `1` existing disposable-PostgreSQL fixture skipped.
- Application TypeScript check: passed.
- Collaboration TypeScript check: passed.
- Standalone PDF revision diff: `9/9` passed.
- IFC geometry smoke: passed — 413,681 bytes, 120 elements, 115 geometric
  elements, 119 placements, and 14,694 triangles.
- Real Chromium IndexedDB compacted-history/outbox crash-reopen: `1/1` passed
  against `http://127.0.0.1:4108`.
- `git diff --check`: passed.

## Scope controls

- No new operation discriminator or payload field.
- No new Yjs collection or collaboration schema version.
- No IndexedDB version change.
- No dependency or lockfile change.
- No database migration or generated database type change.
- No renderer or visible UI change.
