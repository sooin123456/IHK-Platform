# Collaboration provenance — follow-up contract findings

This is read-only design preparation for the next persistence unit, not a completed reconnect correction. It supplements the earlier [bootstrap preparation](2026-09-06-native-dwg-resave-protocol/collaboration-bootstrap-contract.md). The active R2/R4/R5 goal is unchanged.

## Newly traced paths

Browser load applies stored bytes or a new bootstrap and then reconciles freeze metadata before Hocuspocus installs normal persistence listeners. Independent server/service loads can therefore author protected identities absent from durable storage. The browser path is not the only first loader: detached freeze/authority loading and detached outcome receipt loading each have missing-row bootstrap branches in `platform/collaboration/src/server.ts`.

Repeated equal-scalar freeze assignments are an independently fixable subset. The [freeze identity unit](../specs/2026-09-06-collaboration-freeze-identity.md) removes redundant assignments but leaves real transition durability and absent-row persistence explicitly open. Ordinary accepted-outcome reconciliation during interrupted draft freeze already awaits `completeFreeze`; release recovery already stages a candidate, awaits `syncReleasedState`, then applies it. Preserve those ordering guarantees.

## Canonical initialization decisions to carry forward

The trusted private initializer must insert only an absent state or return the existing exact row. Never merge independently bootstrapped roots, overwrite an existing row, or reinterpret ordinary generation/SHA CAS semantics. All first-loader entry points must discard their candidate and adopt only the returned winner before authoring later metadata/status changes.

The absent row is serialized by locking the exact revision row, as existing store/freeze functions do. A candidate's pre-fetched canonical snapshot SHA and operation sequence must be verified under this lock; reject/retry stale candidates. Existing-row return remains byte-identical with no generation/timestamp bump. User authorization and realtime entitlement apply before any disclosure; service entry remains restricted to the private collaboration role. Browser updates must never reach this API.

An authorized first Viewer must be able to establish server-generated provenance without gaining edit capability. For an absent approved/read-only revision with no lease, an `active/null` server projection preserves today's reader behavior: the latest `private.lukas_drawing_collaboration_read_freeze` defaults to active in this exact case, and the connection remains read-only. It is not an approval mutation or a fabricated frozen manifest. Ordinary stores remain draft-only. Service bootstrap's existing absent-row draft requirement remains a separate contract.

The current source of truth for `read_freeze` is `platform/supabase/migrations/20260905131704_drawing_released_freeze_recovery.sql`, not the earlier lease migration. Any lease row, including an expired row awaiting recovery, projects `freezing`; released state preserves the request after lease deletion. An absent state therefore does not universally mean an active room.

## Lease ordering — do not introduce a first-freeze dead end

`applyFreezeRequest` awaits `freezeCoordinator.prepare()` before detached service loading. Preparation calls `acquireFreezeLease` without Yjs bytes; the SQL explicitly supports a lease-only phase. Calling ordinary `assert_store_unleased` from a new initializer would reject this same owner's first freeze.

A narrowly trusted insert-only canonical origin while a lease exists is defensible: it updates no existing snapshot, steals no lease, and does not grant client writes. Leave owner columns to the existing owner-qualified `acquireFreezeLease` call that supplies canonical bytes before `beginFreeze`. Every participating loader must use the returned canonical winner. This permission is not permission to expose a locally projected transient fence or bypass any existing store/freeze guard.

## Required admission counterexample

1. Owner prepares a lease with no state.
2. Browser initializer inserts durable Yjs origin A.
3. Browser load reconciles A and creates local fence identities B.
4. Browser receives A+B.
5. Owner loads A and persists its own freeze identities C.
6. Browser reconnects with B, which the protected-state guard correctly rejects because B was never canonical.

Current `beforeSync` closure is insufficient to prevent step 4: it bypasses message type 0 and returns early for read-only clients. Idempotent writes only stop repeating B within one document, not independent B/C creation. Owner-qualified first insertion would not solve this counterexample either.

The next unit must expose only durable protected identities during initial admission. If load reconciliation would create a transient preparation/lease fence, defer admission, discard that projection, and retry against the settled canonical snapshot. Keep write blocking during the entire interval; do not suppress the protected-map error or admit independently authored metadata. Existing live-room transient projections also require a separately verified durability/authority strategy, not a claim that first-load insertion fixes every reconnect.

## Verification requirements

- Actual concurrent first loaders elect exactly one byte-identical origin (including service/browser races).
- First Viewer and approved-reader opening preserve access without permitting client mutation.
- Stale canonical hash/sequence candidates cannot seed a new room.
- Prepared-lease first freeze can obtain its canonical origin; foreign and expired lease cases neither admit ephemeral identities nor loosen write gates.
- Never-dirtied room unload/restart accepts the client's retained canonical origin; forged protected updates still fail.
- Full authenticated R2 verification still requires actual logout/restoration, independent expected offline geometry on both clients before/after reconnect/reload, and phase-aware error assertions.

No SQL, services, data, or dependencies were changed for these findings. Independent read-only audit corroborated the call ordering and the admission counterexample; runtime proof remains part of implementation acceptance.
