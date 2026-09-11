# DXF server-plan attestation design

Updated: 2026-09-05 (Asia/Seoul)

## Problem

The authenticated Drawing Workspace action reads an immutable DXF object from
Storage, checks its SHA-256, parses it on the server, and returns deterministic
operations. The browser then writes those operations through the ordinary
outbox. The database validates the operation graph and DXF source metadata, but
it cannot distinguish the returned server plan from an editor-modified copy.
An editor can therefore change geometry while retaining a valid DXF source ID,
entity key, and source SHA. That makes the displayed source lineage false.

## Product invariant

A newly persisted `dxf_entity` source and every staging/finalization operation
in its import group must be PostgreSQL-canonical-value equivalent, at the
database RPC boundary, to a plan prepared from the immutable source bytes by the
authenticated application server. Direct authenticated RPC access must not
bypass this rule.

Existing committed operations keep exact idempotent retry and history support.
Undo and redo remain derived from the already committed original operation.

## Selected design

Keep the current server parser, deterministic plan, browser projection,
IndexedDB/Yjs draft, outbox, and generic operation route. Add one narrow trust
bridge:

1. After the server has downloaded and re-hashed the immutable DXF and built the
   canonical plan, the action calls a service-role-only RPC.
2. The RPC verifies the actor still has Drawing Workspace Editor/Admin authority,
   the draft revision belongs to the project, the immutable DXF file and SHA are
   exact, and the operation array is one complete ordered `dxf_import` group.
3. It stores one private row per operation. The row binds actor, project,
   revision, canvas, source file/SHA, deterministic plan ID/index/count, client
   operation ID, and a domain/version-separated PostgreSQL-canonical SHA-256 of
   every value visible to the operation RPC (`actor`, project/revision,
   `clientOperationId`, `operationType`, `baseVersions`, `forward`, `inverse`,
   and history identities). The digest helper is shared with the existing
   operation write lease so both boundaries hash the same values.
4. `BEFORE INSERT` and `BEFORE UPDATE` guards on
   `lukas_drawing_operations` close both persistence shapes. The insert guard
   recognizes every new original `mutate_structure` DXF import operation, locks
   the matching private row, recomputes the same digest, and rejects a missing,
   changed, cross-actor, cross-revision, or already-consumed attestation with
   `P1C01`. It also catches the legacy ungrouped `object_source_create` compound
   so stripping `historyGroup` cannot bypass authority. The update guard blocks
   the reference-aware wrapper from adding a novel version-1 `dxf_entity` source
   after its source-free core operation was inserted. Existing-source tombstone
   restores, checkpoint restoration, and trusted template cloning remain valid.
5. The trigger marks the attestation consumed in the same transaction. Any later
   failure rolls both the drawing mutations and consumption back.

The operation-table guards are the final authority rather than a wrapper around
the current PL/pgSQL apply function. This covers direct inserts and the current
reference-aware insert-then-rewrite path, and avoids cached-function/OID bypass
after a function rename.

## Idempotency and concurrency

- Plan and operation IDs are already deterministic for the exact revision,
  canvas, source file/SHA, and selected unit.
- Re-preparing the same exact plan for the same actor is idempotent. A changed
  digest under the same identity fails closed.
- The attestation issuer recognizes an exact already-committed prefix and records
  it as consumed, allowing a pre-release partial import to be prepared again and
  resumed.
- Before accepting that prefix, the issuer queries every existing original
  operation carrying the same history-group ID. Any extra, changed, or
  out-of-plan member fails closed; legacy rows are never generically backfilled.
- Exact operation retries do not insert another row; the existing operation
  idempotency branch returns the stored receipt before the trigger is reached.
- Concurrent first inserts serialize on the attestation row. Only one consumes
  it; the existing write lease and subsequent exact retry resolve the winner.
- Original plan attestations do not expire. The source is immutable and stale
  base versions are already rejected, while non-expiring proof preserves offline
  recovery. Rows cascade with revision/project retention.

## Authority and exposure

- The ledger lives in `private`; all table and helper access is revoked from
  `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- Only the public attestation RPC is exposed, with `EXECUTE` granted solely to
  `service_role` and revoked from browser roles.
- The application imports the existing admin client dynamically inside the
  server action after parsing succeeds. No service credential or attestation row
  is returned to the browser.
- The normal authenticated operation RPC remains browser-callable, but cannot
  create a new DXF import without a matching server-issued proof.

## Compatible rollout

The trust boundary is released in three ordered steps so neither the current web
artifact nor the new artifact encounters a missing requirement:

1. An additive foundation migration creates the private ledger, canonical digest
   helper, and service-role-only issuer RPC, without enforcing consumption.
2. The attesting web artifact is deployed and canaried against that additive
   schema. It issues proofs before returning a non-empty plan; the browser payload
   and outbox remain unchanged.
3. A separate enforcement migration installs the final insert/update guards and
   consumer.
   Direct authenticated un-attested imports are then rejected, and the full
   positive/negative canary is repeated.

After enforcement, a rollback to a pre-attestation web artifact would prevent
new DXF imports. The release evidence therefore records both the Vercel rollback
artifact and the reviewed forward migration/runbook that disables only the new
guard if application rollback is required. Already-open, never-attested legacy
plans must be re-prepared from the immutable source; this discards no committed
authored geometry or source bytes.

## Failure behavior

- Parser, source, plan, or service attestation failure returns no plan to the
  browser.
- A missing or mismatched proof rejects with the existing bounded operation
  conflict class and inserts no object, source, operation, or consumption mark.
- If the service authority is unavailable, preparation is retryable; the browser
  does not enqueue an unproven plan.
- No source bytes are modified or deleted by this change.

## Alternatives rejected

- **Client signature only:** the database would still lack an authoritative
  verification key/ledger and direct RPC callers could bypass client checks.
- **Commit the whole import in the prepare action:** this would bypass the
  existing durable local/outbox/Yjs ordering and require a new collaboration and
  recovery path.
- **Reparse DXF in PostgreSQL:** it duplicates the pinned parser in an unsuitable
  runtime and increases the security surface.
- **New state library or collaboration service:** neither is needed; the defect is
  one trust-boundary assertion.

## Acceptance evidence

- A legitimate prepared plan fails before attestation and succeeds after the
  service-only attestation.
- Changing only one LINE coordinate after attestation yields `P1C01` and zero
  rows for that phase.
- Browser roles cannot call the attestation RPC or read/write the private ledger.
- Actor/project/revision/source/SHA, plan ordering, duplicates, incomplete groups,
  and changed same-ID retries fail closed.
- Exact partial-prefix preparation, exact retry, undo, and redo remain supported.
- Server tests prove only the immutable-byte-derived `plan.operations` value is
  sent to the privileged RPC before the plan is returned.
- The disposable Supabase/browser gate still passes the real login -> verified
  DXF upload -> import -> reload/relogin -> collaboration -> approval lineage.
