# P5 Task 2 review-fix round 3 report

## Commit

- Prior Task 2 fix: `9541b9523714c6f52148469a78663127d3938b67`
- Subject: `fix: recover compacted drawing object redo`

The fix commit contains only the Task 2 product, regression, Chromium, and
report files. The pre-existing P4 progress and screenshot modifications remain
unstaged and excluded.

## Residuals resolved

### Authenticated compacted-history redo

A pending structured `add_objects` redo may now cross a fresh authoritative
snapshot that omits its client tombstone only when the exact acknowledged
add-and-undo lineage proves the missing deletion version.

Outbox recovery checks the original add, latest acknowledged undo, pending redo,
canonical payload/inverse pairing, exact base progression `v1 -> tombstone v2 ->
restore v3`, persisted result/realized versions when the loader supplies them,
operation order, and absence of any active global UUID owner. Evidence comes
from the authoritative recorded-operation history or the just-acknowledged
durable prefix. Missing or mismatched lineage, changed payloads, and live UUID
claims remain ambiguous and are never projected.

Yjs recovery uses the existing schema-v1 operation ledger and status map. For a
compacted acknowledged prefix it replays the exact original add and undo into a
proof state, verifies both authoritative result-version receipts, and carries
only the authenticated operation/undo-stack metadata into the fresh snapshot
before replaying the pending redo. Invalid proof remains a provisional conflict;
it does not become quarantine and does not create an object.

The acknowledgement final-effect validator now recognizes the round-2 exact
history-delete inverse: object v1 deletion owns tombstone v2 and records object
v3 as its restore inverse.

### One canonical tombstone equality rule

The recursive exact structural comparator used by canonical structure
validation is now shared with command restoration and object-deletion conflict
detection. Object member order is irrelevant across JSON, Yjs, and browser
realms, while array order, field values, versions, collection type, missing
fields, and extra fields remain authoritative.

Both plain `add_objects` restore and reference-aware object restore use this
same rule. The raw `JSON.stringify` tombstone restore comparisons are gone.

## TDD evidence

### RED

- Reordered keys in an otherwise exact object tombstone passed conflict
  detection, then threw `DrawingCommandError: restore tombstone is stale`.
- An exact pending redo over a tombstone-free snapshot with acknowledged add and
  undo history was left ambiguous by the outbox.
- The same compacted prefix in the Yjs ledger left the pending redo provisional
  and the object absent.

### GREEN

- Reordered tombstone object keys restore object v3 and consume tombstone v2.
- Changed payload, tombstone version, collection type, or extra object fields
  return the deterministic object conflict.
- Live acknowledged-prefix recovery and a second recovery realm both restore
  only the exact v3 redo; missing lineage, changed payload, and an active UUID
  owner stay ambiguous.
- Yjs restores exact compacted history metadata and projects the v3 redo, while
  a wrong acknowledged result version remains provisional with no quarantine.
- A real Chromium navigation crash/reopen persists the add, acknowledged undo,
  and pending redo in IndexedDB, then projects v3 over a fresh tombstone-free
  authoritative snapshot in the second JavaScript realm.

## Final verification

- Focused source commands, outbox/store recovery, Yjs, and history suite:
  `104/104` passed.
- Full Drawing workspace suite (`npm run test:drawing-workspace`): `651`
  discovered, `650` passed, `0` failed, `1` existing disposable-PostgreSQL
  fixture skipped.
- Application TypeScript check: passed.
- Collaboration TypeScript check: passed.
- Standalone PDF revision diff: `9/9` passed. The broader all-`drawing-*` glob
  also exposed its existing concurrency-sensitive generation race when run in
  parallel; the scoped Drawing workspace suite and standalone diff are green.
- Real Chromium IndexedDB compacted-history crash/reopen: `1/1` passed against
  `http://127.0.0.1:4108`.
- `git diff --check`: passed.

## Scope controls

- No new operation discriminator or payload type.
- No new Yjs collection or collaboration schema version.
- No IndexedDB version change.
- No dependency or lockfile change.
- No database migration or generated database-type change.
- No renderer or visible UI change.
