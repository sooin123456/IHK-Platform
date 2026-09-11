# Collaboration bootstrap persistence contract

## Decision

A **narrow atomic database operation is needed**. The existing load/store RPCs contain most of the required validation and locking primitives, but none provides the required contract to every simultaneous first loader: “insert this trusted bootstrap candidate only if no row exists, otherwise return the already-canonical first-writer `yjs_state` unchanged.”

Do not weaken `validateDrawingClientUpdate`, merge independently bootstrapped protected structures, or redesign the collaboration channel. The fix boundary is one bootstrap-only persistence RPC plus the `onLoadDocument` missing-row branch.

## Existing persistence contracts

### Application-authorized load/store

`DrawingStoredState` already models the full canonical result needed by a loader: bytes, generation, SHA-256, and base operation sequence (`platform/collaboration/src/storage.ts:13-20`). `load` returns that object, while the database `store` interface returns only generation and SHA (`storage.ts:41-56`).

The PostgreSQL adapter behaves as follows:

- `load(scope)` calls `private.lukas_drawing_collaboration_load_state(user, project, revision)` and maps the full row, including `yjs_state` (`storage.ts:297-317`).
- `store(value)` calls the generation-fenced user RPC but discards its returned `yjs_state`, retaining only generation and SHA (`storage.ts:318-337`).
- Both run under `set local role lukas_drawing_collaboration` in a transaction (`storage.ts:261-275`).

The current user load RPC calls `lukas_drawing_collaboration_authorize` before returning a row (`platform/supabase/migrations/20260825193714_drawing_workspace_p3_collaboration_state_fence.sql:12-28`). The current user store implementation:

- requires an authorized capability with `can_write = true` and a draft revision (lines 60-82);
- accepts `base_operation_sequence >= 0`, bounds bytes/schema, and rejects a sequence beyond the canonical operation maximum (66-88);
- locks the state row when it exists, implements generation/SHA compare-and-swap, inserts generation 1 for expected `(0, null)`, and returns the full load row (90-136).

The preload fence wrapping that store locks the revision row before entering the unfenced implementation and checks the freeze lease (`platform/supabase/migrations/20260826073708_drawing_workspace_p3_preload_store_fence.sql:45-72`). That revision lock is already the correct serialization key when the state row does not exist.

### Service load/store

`loadService` maps the full state row (`platform/collaboration/src/storage.ts:338-358`), while `storeService` again discards the returned bytes (`359-378`). The service store has the same expected-generation/SHA protocol and inserts generation 1 when absent (`platform/supabase/migrations/20260901112430_m1_collaboration_service_store_state.sql:1-76`). Its outer wrappers lock the revision, enforce the freeze-lease fence (`20260826073708_drawing_workspace_p3_preload_store_fence.sql:94-121`), and enforce the realtime-collaboration entitlement (`20260828073233_drawing_workspace_organization_administration.sql:871-893`). Service functions are executable only by the nologin collaboration role, not public/anon/authenticated/service_role (`organization_administration.sql:1150-1161, 1235-1240`).

The service store deliberately has no end-user capability parameter. The user load/bootstrap path does: `private.lukas_drawing_collaboration_bootstrap(user, project, revision)` calls the same authorization function and returns the caller's capability/read-write projection (`20260825234510_drawing_collaboration_history_lineage.sql:146-180`). This distinction matters for a first Viewer load: a Viewer is allowed to read/bootstrap a room in memory but cannot call the ordinary user store because `can_write` is false.

### Process-level storage wrapper

`createDrawingCollaborationStorage` remembers CAS tokens per `(user or service, project, revision)` (`platform/collaboration/src/storage.ts:105-148`). On P3S03 it loads the winning row, merges the current and proposed Yjs updates, rewrites `baseOperationSequence`, validates, and retries once (`storage.ts:150-214`). That behavior is correct for ordinary concurrent append persistence, but it is specifically wrong for bootstrap provenance: two logically identical bootstraps with different server client IDs must not be merged into the canonical protected roots.

## Why the existing store RPC cannot be used as the bootstrap contract

The SQL store RPC can insert an absent row and, on a successful call, its SQL return type includes canonical bytes. It does **not** atomically return the first writer's bytes to a losing simultaneous initializer:

1. Two server instances load the same absent state. Hocuspocus coalesces simultaneous loads only inside one process (`node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js:1428-1440`), so cross-instance first loads remain possible.
2. Each creates semantically identical Yjs state with different CRDT identities and calls store with expected `(generation 0, SHA null)`.
3. The preload wrapper's revision lock serializes the calls. The first inserts generation 1.
4. The second sees an existing row with a different SHA and raises P3S03 at the CAS check (`20260901112430_m1_collaboration_service_store_state.sql:36-52`, equivalently the user store at `20260825193714...sql:90-112`).
5. Calling through `storeWith` then merges the winner and loser identities (`storage.ts:196-212`), defeating the provenance fix. Calling the raw database store and then issuing a separate load would avoid that merge, but it is a two-operation recovery convention, not an atomic insert-or-return contract; the TypeScript store result currently omits the bytes, and the user variant also excludes read-only members.

Changing normal CAS semantics so `(0, null)` silently returns an existing row would overload the ordinary store operation and could hide a stale-writer bug. The bootstrap behavior should therefore be a separate RPC/method with no update path.

## Smallest required atomic operation

A private function such as:

```sql
private.lukas_drawing_collaboration_initialize_state(
  p_user_id uuid,
  p_project_id uuid,
  p_revision_id uuid,
  p_schema_version smallint,
  p_yjs_state bytea,
  p_base_operation_sequence bigint
) returns table(
  revision_id uuid,
  project_id uuid,
  schema_version smallint,
  yjs_state bytea,
  yjs_sha256 text,
  base_operation_sequence bigint,
  store_generation bigint,
  byte_size integer,
  persisted_at timestamptz
)
```

should have this single-purpose transaction contract:

1. Call `private.lukas_drawing_collaboration_authorize(user, project, revision)` so target existence, realtime entitlement, and current project capability are enforced. The operation persists bytes generated and validated by the trusted collaboration service; it should require a non-null authorized capability, not `can_write`, otherwise a legitimate first Viewer load retains the current bug.
2. Lock the exact `(revision_id, project_id)` revision row `FOR UPDATE`. This is the serialization point even while the state row is absent, matching the existing preload-store fence.
3. Select the state row. If it exists, return it byte-for-byte without comparing the candidate, changing generation, updating `persisted_at`, checking `can_write`, or merging anything. This is both the simultaneous-loser and existing-room behavior.
4. Only when no state row exists, apply the **explicitly selected read-only/revision-status policy described below** and the applicable freeze-lease fence. Do not assume the ordinary store's draft-only edit rule is automatically correct for trusted canonical initialization. Validate schema 1, byte length/SHA, `base_operation_sequence >= 0`, and the existing upper bound against canonical operation sequence.
5. Insert the supplied bytes as generation 1, then return that exact row. A zero-operation room must persist successfully with `base_operation_sequence = 0`; both the table (`20260825192113_drawing_workspace_p3_collaboration_state.sql:11-27`) and current stores already permit zero.
6. Keep the function in `private`, SECURITY DEFINER with empty `search_path`, revoke default/public execution, and grant only to `lukas_drawing_collaboration`, matching the current service boundary. No browser-provided update may reach this operation.

An `inserted boolean` result is optional for observability; correctness requires the full canonical state row on both branches.

### Unresolved design edge: absent state on an approved/read-only revision

The next implementation unit must make this a product/security decision before fixing the RPC contract. A blanket draft-only rejection is **not** already authorized by current browser-load behavior:

- Browser `onLoadDocument` uses the user-scoped bootstrap when state is absent (`platform/collaboration/src/server.ts:1038-1057`). The current user bootstrap calls `lukas_drawing_collaboration_authorize`, returns `revisionStatus` and `canWrite`, but does not require `revisionStatus = draft` (`platform/supabase/migrations/20260825234510_drawing_collaboration_history_lineage.sql:146-180`). An authorized Viewer can therefore currently obtain an in-memory canonical projection for a read-only revision.
- `initializeDrawingCollaborationDocument` initially writes `freezeState = active` regardless of the bootstrap's passthrough `revisionStatus` (`platform/collaboration/src/server.ts:256-325`). `onLoadDocument` then calls `reconcileLoadedDocument` before admission (1038-1060).
- Freeze reconciliation reads persisted freeze/revision status and explicitly handles committed `review_requested`, `reviewed`, and `approved` revisions. A persisted frozen state is projected back into `serverMeta.freezeState = frozen` and its request id (`platform/collaboration/src/freeze.ts:683-718, 831-857`); active/released/freezing states have separate reconciliation branches (753-870).
- The service bootstrap is draft-only (`20260825234510_drawing_collaboration_history_lineage.sql:185-195`), as are ordinary stores, but that service/edit constraint is not the same contract as the existing user-authorized browser load.

The next-unit specification must select and test one of these bounded behaviors:

1. **Safe read-only canonical initialization:** allow a trusted collaboration service to persist the absent canonical state for any currently authorized reader only after bootstrap and freeze/status reconciliation. The atomic RPC must verify the current revision/freeze facts under its lock, and the returned bytes must encode the reconciled read-only/frozen projection. This remains server initialization, not permission for the Viewer or any client update to write.
2. **Deliberate bounded fallback:** if persisting an absent non-draft state is considered unsafe or impossible to validate, define an explicit product behavior for that anomaly (for example, a fail-closed/read-only degraded path). The fallback must not admit a normal whole-document provider to a repeatedly re-authored, unpersisted Y.Doc, or it will retain the provenance rejection. If the product deliberately chooses rejection, that loss of current read-only open behavior must be stated and covered by a regression; it cannot be inherited accidentally from the ordinary store guard.

Until that choice is made, the proposed initializer's existing-row behavior is settled (return canonical bytes unchanged), while its absent-row revision-status predicate remains intentionally unspecified.

## `onLoadDocument` integration constraint

Current `onLoadDocument` loads authorized persisted state or initializes the Hocuspocus payload document directly, then reconciles and validates it (`platform/collaboration/src/server.ts:1038-1060`). Hocuspocus installs its update/store listener only after `onLoadDocument` returns (`hocuspocus-server.esm.js:1446-1490`), which is why the direct bootstrap is not persisted by normal `onStoreDocument` handling.

The missing-row branch must not initialize the payload document and then apply a different first writer's returned bytes to it; Yjs would merge both CRDT identities. The minimal safe order is:

1. `storage.load(scope)` as today. If it returns a row, apply those bytes to the empty payload document exactly as today.
2. If absent, create a **detached temporary Y.Doc**.
3. Run the existing authoritative bootstrap, reconciliation, and `validateLedgerWithoutAppend` on that detached candidate.
4. Encode the candidate and call the new atomic initialize-or-return RPC.
5. Destroy the candidate, apply only the RPC's returned canonical `yjs_state` to the still-empty payload document, and validate it before returning from `onLoadDocument`.

The storage-layer method should return `DrawingStoredState` and seed its process-local CAS token(s) with the returned generation/SHA. At minimum it must seed the authenticated user's token because later client-origin `onStoreDocument` uses `payload.lastContext` (`platform/collaboration/src/server.ts:1099-1103`). Seeding the service token too avoids a predictable first P3S03/load/merge when the next change has server origin (`server.ts:1062-1097`). Ordinary `onStoreDocument` CAS behavior otherwise remains unchanged.

## Required edge behavior

| Case | Required result |
| --- | --- |
| Two cross-instance first loads | Revision lock elects one first writer; both receive exactly its bytes, SHA, generation 1, and base sequence. No merge. |
| Persisted sequence 0 | Insert generation 1 with `base_operation_sequence = 0`; return exact bytes. |
| Existing room reload | Return existing canonical bytes without a write or generation bump, including read-only/frozen revisions. The candidate is discarded. |
| First load by Viewer/Reviewer/Commenter | Authorized read capability may trigger trusted server initialization; absence of `can_write` must not permit client writes and must not block persistence of server-generated provenance. |
| Revoked/nonmember or disabled entitlement | Authorization fails with the existing unavailable/entitlement errors; no state row is returned or inserted. |
| Absent state on approved/read-only revision | **Unresolved next-unit specification edge.** Select and test either reconciled trusted read-only canonical initialization or an explicit bounded fallback; do not silently copy the ordinary draft-only store rule. |
| Absent state with a live freeze lease | Respect the freeze coordinator/lease contract; any initialization path must not materialize an unreconciled `active` state across an in-flight freeze. |
| Later ordinary stores | Continue using generation/SHA CAS and merge/retry for accepted collaboration evolution; the bootstrap-only RPC is never an update API. |

This report defines a preparation contract only. It does not claim the reproduced protected-state rejection is fixed.
