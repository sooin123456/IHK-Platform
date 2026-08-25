# 1HK Drawing Workspace P3 Collaboration Design

Date: 2026-08-26

Status: approved program direction refined for implementation. The user has explicitly approved the full P0–P7 program, selected subagent-driven execution, and asked not to pause for further approvals.

## 1. Outcome

P3 turns the P2 structured editor into a real multi-user draft workspace. Two editors can open the same draft, see one another, see world-coordinate cursors and canonical selections, create and move different objects concurrently, work offline, and merge on reconnect. Reviewer and Viewer clients can join and observe but cannot mutate. A review request freezes the current revision and preserves one canonical Postgres snapshot and SHA-256 as approval evidence.

P3 also brings the existing issue/comment/review activity into the workspace, adds mentions, advisory soft locks, role-aware sharing, change history, and an operation-based restore flow. It completes the original first vertical release gate that requires two-browser cursor and object synchronization.

## 2. Binding boundaries

- PDF and IFC source bytes remain immutable. P3 never writes to source storage objects.
- Postgres materialized drawing rows, append-only operations, snapshots, approvals, issues, comments, events, and notifications remain the business/audit authority.
- Yjs is the mergeable state of a draft collaboration room. It is not approval, quantity, price, or payment evidence.
- The existing pure command/reducer contracts remain the only way UI tools construct drawing mutations.
- The existing IndexedDB operation outbox and `lukas_drawing_apply_operation` RPC remain the durable audit/materialization path. Yjs does not replace them.
- A local command is validated/reduced without publication, queued durably in the existing IndexedDB outbox, and only then appended to Yjs and exposed to the provider. Boot reconciliation repairs every crash boundary between outbox, local Yjs, remote Yjs, and an RPC result. A rejected Postgres operation is marked conflicted by a server-owned reconciliation transaction and removed from the derived projection; it is never silently presented as approved state.
- Review cannot start while the requesting browser or server room has pending/conflicted operations. The collaboration service freezes the room, validates its immutable operation ledger, and returns its state vector and operation IDs/statuses. The locked database transaction requires every accepted room operation to exist exactly in Postgres and then derives the only canonical snapshot JSON/SHA itself. Offline edits arriving after freeze are retained locally as recovery evidence and are not inserted into the frozen revision.
- Supabase Postgres Changes only invalidates server-loaded business state. It never declares a local mutation successful.
- Hocuspocus Awareness carries high-frequency cursor and selection state. Supabase Presence is not used for cursor traffic.
- Hocuspocus is a separate long-lived Node.js 22 OCI service, never a Vercel function.
- No external React state manager is added. `DrawingDocumentStore` remains the sole `useSyncExternalStore` projection consumed by React.

## 3. Technology and open-source policy

Exact direct pins:

| Package | Version | License | Use |
|---|---:|---|---|
| `yjs` | `13.6.32` | MIT | CRDT document and updates |
| `y-indexeddb` | `9.0.12` | MIT | offline Yjs update persistence |
| `@hocuspocus/provider` | `4.6.0` | MIT | browser WebSocket provider and Awareness |
| `@hocuspocus/server` | `4.6.0` | MIT | collaboration WebSocket service |
| `y-protocols` | `1.0.7` | MIT | Awareness protocol types/helpers |
| `jose` | `6.2.10` | MIT | Supabase asymmetric JWT verification |

`lib0` and `ws` are not direct dependencies unless application code imports them. Package lockfiles and `THIRD_PARTY_NOTICES.md` record the exact dependency closure. No Penpot, Excalidraw, Figma, or Rayon source is copied.

Hocuspocus v4 uses web-standard `Headers` in authentication hooks and requires Node.js 22. The server uses `onAuthenticate`, `onTokenSync`, `beforeHandleMessage`, `beforeHandleAwareness`, `onLoadDocument`, and debounced `onStoreDocument`. Server shutdown awaits `destroy()` so pending stores flush.

## 4. Collaboration document

Room name is canonical and non-ambiguous:

`drawing:<project UUID>:<revision UUID>`

The Y.Doc contains these top-level shared types:

- `serverMeta: Y.Map`: server-owned `schemaVersion`, `projectId`, `revisionId`, `baseSnapshotSha256`, `baseOperationSequence`, and freeze state/request ID.
- `operationOrder: Y.Array<string>`: immutable operation IDs in deterministic Yjs order.
- `operations: Y.Map<operationId,envelope>`: immutable validated command envelopes. An editor may add one new envelope for their own verified actor ID; no client may rewrite/delete an existing envelope or order entry.
- `operationStatus: Y.Map`: server-owned operation ID to `pending | acked | conflicted | rejected` plus authoritative Postgres sequence/result versions.

An operation envelope contains the existing canonical operation ID, actor ID, type, base versions, forward actions, inverse actions, creation time, and schema version. It does not contain auth capability, approval, quantity, rate, price, or source bytes.

The Postgres comparison subset is exact and explicit: revision ID, `client_operation_id`, actor ID, type, base versions, forward actions, inverse actions, authoritative sequence, and result versions. Client creation time and collaboration schema version are validated protocol metadata; they are not compared to the server-generated Postgres `created_at`.

The server applies each candidate client update to a clone before accepting it. It rejects any client change to `serverMeta` or `operationStatus`, removal/rewrite of an existing operation/order entry, duplicate ID, envelope/order mismatch, actor ID different from the verified JWT subject, or invalid/oversized envelope. Authoritative status/meta changes use a distinguished server-only origin and direct connection.

The React projection is derived from one transactionally bootstrapped canonical base snapshot plus Yjs operations whose authoritative Postgres sequence is greater than `baseOperationSequence`, or whose status is still pending. Every envelope and resulting graph is validated with the existing drawing schemas. A stale same-object pending operation that cannot replay is a provisional per-operation conflict; it does not quarantine the entire room. Authoritative Postgres sequence/status selects the winner, skips the rejected loser, and recomputes deterministically. Structurally invalid documents still fail closed and are quarantined; no partial invalid projection is published.

This command-log design is intentionally smaller than mirroring every drawing entity into nested Y.Maps. It preserves the tested reducer, actor-scoped undo semantics, operation audit contract, and Postgres materialization. Soft locks and OCC handle same-object contention; different-object concurrent commands merge deterministically.

Compaction is not added in P3. A periodic base-snapshot compactor is a P7 measured optimization after room-size evidence exists.

## 5. Client flow

### Boot

1. Call one transactional bootstrap RPC that returns the authoritative P2 graph, revision status/capability, exact maximum operation sequence from the same database snapshot, snapshot schema version, and canonical JSON SHA-256.
2. Create the scoped Y.Doc and `DrawingDraftAdapter` for the revision.
3. Load y-indexeddb updates and reconcile locally-authored envelopes bidirectionally with the IndexedDB outbox and authoritative Postgres operation results before enabling network propagation.
4. Connect Hocuspocus with the current Supabase access-token resolver only after local durability reconciliation.
5. Merge the server room, let the service reconcile server-owned operation statuses against Postgres rows and signed internal application-server rejection receipts, then publish one `DrawingDocumentState` through `documentStore.replace`.
6. If IDB or remote state is invalid, keep the authoritative loader state visible, quarantine the invalid update, and show recovery status.

### Local command

1. Existing tool creates a pure `DrawingCommand`.
2. Adapter validates capability, draft state, active layer, and soft-lock advisory state.
3. The adapter validates/reduces the candidate without publishing it.
4. The operation is durably enqueued in the existing IndexedDB outbox.
5. One Yjs transaction appends the immutable envelope/order entry and publishes the derived projection/provider update.
6. The existing RPC records/materializes the operation. Accepted operations are recoverable from the append-only Postgres row. After every accepted or explicitly rejected RPC result, the React application server also sends an authenticated idempotent outcome receipt to Hocuspocus; only the collaboration service writes `operationStatus`. If that receipt is lost, an accepted row is found by service polling and a rejected outbox operation retries the same RPC until the application server can redeliver the same rejection receipt. Conflict/rejection skips the loser and recomputes the projection.

### Remote command

The Yjs update triggers one validated projection. It does not enqueue the remote actor’s operation in the local outbox and does not enter the local actor’s undo stack. Undo emits a new inverse command only for the current actor and never deletes another actor’s command.

### Reconnect

y-indexeddb restores local operations before the network provider syncs. The adapter reconciles four cases before connecting: outbox-only commands are appended locally; local-Yjs-only commands owned by this actor recreate a pending outbox row; Postgres-committed commands missing an ack receive authoritative status; and RPC-committed-but-unshared commands are shared with their original ID. It then merges the server state and resumes delivery with the same client operation IDs. The gate is 100 commands during five minutes offline with zero lost acknowledged or pending command IDs.

## 6. Presence, cursors, selection, and locks

Awareness state is ephemeral and schema-limited:

```ts
type DrawingAwarenessState = {
  user: { id: string; displayName: string; color: string };
  pageId: string | null;
  canvasId: string | null;
  cursorWorld: { x: number; y: number } | null;
  selectedIds: string[];
  activeTool: string | null;
  softLocks: Array<{ entityId: string; leaseId: string; expiresAt: number }>;
};
```

The server overwrites `user` from verified auth context and drops unknown/oversized fields. Cursor coordinates are world coordinates and render only on the matching canvas. Cursor sends are animation-frame throttled; unchanged coordinates are not resent.

A soft lock is an advisory Awareness lease, not authorization. It is acquired at drag/inspector edit start, renewed while active, and expires within 10 seconds without renewal. Another user’s unexpired lock disables the relevant affordance and explains who is editing. RLS/RPC/Hocuspocus write checks remain authoritative.

The top bar shows connection phase and current participants. Canvas overlays show remote cursor labels and selection outlines. Capability/revision downgrade clears local Awareness, cancels active pointer capture through the existing authorization key, changes the provider to read-only, and keeps unsent local evidence recoverable.

## 7. Authentication and service storage

The browser provider supplies the current Supabase user access token. Deployment preflight first requires a non-empty asymmetric JWKS and accepted `RS256` or `ES256` signing key; a legacy HS256-only project is not deployable until its signing-key migration is complete. The collaboration server verifies tokens using `jose` and `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, with exact issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`, valid UUID `sub`, authenticated role, `is_anonymous !== true`, expiration, allowed origin, and canonical room name. It never trusts `user_metadata`, loader-provided capability, Awareness identity, or an unverified decoded JWT.

After JWT verification the service calls a narrowly granted database authorization function. That function rechecks that revision/project IDs match and reuses `private.lukas_drawing_workspace_capability` semantics: admin/editor may write only to a draft; reviewer/commenter/viewer are read-only; non-members cannot connect. Active connections are reauthorized on token sync, before every update/Awareness message, and on a bounded 30-second server timer so passive revoked users are closed without relying on their own RLS-filtered delete event.

The service uses a dedicated Postgres login role limited to collaboration authorization, service-only transactional bootstrap, bounded accepted-operation lookup, and `private.lukas_drawing_collaboration_states` load/store/freeze functions. It does not receive the Supabase service-role key. Password creation/rotation is an operator secret step, not committed migration text.

`private.lukas_drawing_collaboration_states` stores revision/project IDs, schema version, complete Yjs update bytes, SHA-256 of those exact bytes, base operation sequence, byte size, persisted time, and explicit `active | freezing | frozen | released` freeze state/request ID. On freeze the service also persists the exact accepted-operation manifest SHA-256/count/base sequence. The Yjs-byte and manifest digests are storage/freeze integrity evidence and are never compared to `lukas_drawing_snapshots.sha256`. The table is not exposed through the Data API or Realtime publication. Size, schema version, revision ownership, monotonic sequence, state transitions, and digest format are checked in SQL. Approved/review-requested rooms cannot be overwritten.

When no persisted room exists, `onLoadDocument` calls the private service-only transactional bootstrap `(verified_user_id, project_id, revision_id)`. It reuses collaboration authorization, returns the same canonical graph/sequence/SHA/outcomes as the authenticated browser bootstrap, and is executable only by the dedicated collaboration role. The service then initializes `serverMeta` with the distinguished server-only origin before any client update is accepted. A collaboration-service reconciliation worker calls a dedicated-role-only lookup `(revision_id, client_operation_ids[])` that returns exact accepted Postgres operation comparison fields and omits missing IDs, which therefore remain pending. Explicit rejection/conflict receipts arrive only through a constant-time authenticated internal endpoint called by the React server; browser clients cannot write status.

## 8. Supabase Realtime invalidation

The workspace subscribes to project/revision-scoped changes for revisions, object-issue links, issues, comments, issue events, and approvals. Membership changes trigger refresh where RLS permits visibility; every reconnect and document visibility return performs one authoritative revalidation. Events are debounced and only call React Router revalidation.

Revision/capability changes are applied before other UI state. Same-revision loader refresh reconciles only when the authoritative operation checkpoint advances. A new revision ID disposes the old provider/IDB scope and creates a new room.

The migration never modifies objects in the locked `realtime` schema. It only updates the `supabase_realtime` publication for public application tables when absent.

## 9. Issues, mentions, sharing, history, and restore

- The workspace adds `댓글·이슈` and `변경 이력` panels without replacing the existing drawing room.
- Object comments reuse existing object-issue links. Generic canvas-region comments add one immutable revision/project/canvas-bound world-region anchor with finite millimeter `x`/`y` (negative values allowed) and finite positive millimeter `width`/`height`, composite foreign keys, and the existing issue/comment/event/notification flow. Normalized 0–1 coordinates remain exclusive to existing PDF source anchors; IFC source anchors remain unchanged.
- Mentions are explicit selected project members stored in a new normalized mention table linked to a comment. `@` display text alone never grants access or creates a notification. Insert validates same-project membership and creates append-only notification/event evidence.
- Role sharing reuses project membership roles and existing admin authority. It does not create a second drawing ACL table.
- History is paginated from append-only drawing operations and issue/review events.
- Single-operation revert emits that operation’s validated inverse against current base versions and may be refused when later dependencies make it invalid. Restore-to-checkpoint computes a validated current→target graph delta with current base versions and records one append-only restore compound operation. An approved checkpoint is restored only by an idempotent RPC that clones its immutable snapshot into a new child draft revision with fresh entity IDs and preserved lineage; approved rows are never edited.

## 10. Review freeze

1. The requester must be admin/editor on a draft and have no local pending/conflicted operations.
2. The application server creates an idempotent `freeze_request_id` and asks the collaboration service to move the persisted room from `active` to `freezing` using a private authenticated service endpoint.
3. The service rejects new client updates, validates immutable/server-owned fields, waits for stores and authoritative status reconciliation, persists `frozen` plus the exact accepted-manifest digest/count/base sequence under its dedicated role, and returns schema version, state vector, base sequence, and exact operation envelopes/statuses. It does not claim the business snapshot digest.
4. A dedicated idempotent database RPC locks the revision and collaboration state, requires `state = frozen`, the same `freeze_request_id`, and the same persisted manifest digest/count/base sequence. It compares the exact Postgres subset of every accepted envelope, requires pending/conflicted entries to be absent, derives canonical JSON/SHA only from locked Postgres state, writes the snapshot, changes status to `review_requested`, and records the same freeze request. Direct RPC calls without a service-persisted matching freeze are denied.
5. If validation fails before DB commit, the service may move the matching request to `released`. If the response is lost, both sides reconcile by request ID and database revision status; a room is never released after the revision committed `review_requested` or `approved`.
6. Approval continues through the existing maker-checker decision RPC. Approved rooms remain read-only forever; further editing creates a new revision/room.

## 11. Failure behavior

- WebSocket unavailable: local Yjs + y-indexeddb + outbox continue; UI shows offline state.
- Postgres RPC unavailable: operation remains pending; review is disabled.
- Postgres OCC rejection: server reconciliation marks the Yjs operation conflicted, recomputes with the authoritative winner, and shows conflict recovery; a same-object loser is a provisional operation conflict rather than a corrupt-room failure.
- Invalid/oversized Yjs state: reject store/update, preserve last valid DB checkpoint, close offending connection, and surface a recoverable client error.
- Token expiry or membership downgrade: token sync, per-message checks, and 30-second passive reauthorization close or downgrade the connection; server action/RLS still rejects writes immediately.
- Collaboration service loss before the database commit produces no status transition. Loss or response failure after a committed transition is recovered by the shared freeze request ID and authoritative database revision status; it never releases the committed room.
- Source PDF/IFC bytes and stored SHA-256 are checked before/after P3 E2E.

## 12. Verification and release gates

Local automated evidence must include:

- PGlite migration, transactional bootstrap snapshot/sequence, least-privilege role, authorization, draft-only load/store/freeze, size/digest/sequence, and approved mutation denials.
- Pure Yjs adapter convergence, actor undo isolation, server-owned-field/actor/append-only adversarial denial, provisional same-object conflicts in opposite Yjs/RPC orders, crash-boundary reconciliation, invalid-state quarantine, ack/conflict recomputation, y-indexeddb boot/reconnect, and 100-operation offline recovery.
- Hocuspocus auth, non-empty asymmetric JWKS preflight, token/origin/room parsing, passive membership revocation, read-only roles, awareness sanitization, persistence, graceful shutdown, and health checks.
- Two real browser contexts showing participant presence, cursor, selection, concurrent different-object create/move, reconnect merge, soft lock, Viewer write denial, and mid-drag review freeze.
- DB Realtime invalidation for issue/comment/approval/revision state without using events as success acknowledgements.
- Object comment/mention notification, role sharing, paginated history, append-only restore.
- PDF/IFC source SHA invariance and P0–P2/quantity/approval/Revit regressions.
- Exact license pins/notices, Node 22 OCI build, typecheck, production build, and collaboration service tests.

Targets remain measured separately from catastrophic gates: collaboration reflection p95 <= 500 ms across three simultaneous authenticated browser contexts, cursor render at display cadence without more than one send/frame, 100 offline operations with zero loss, and no invalid write by Viewer/non-member/frozen revision. The latency record includes browser, hardware/CPU, memory, viewport, object mix, and cold/warm conditions.

Production completion requires an actual deployed collaboration service, applied additive migrations, two authenticated users, and recorded operational evidence. Missing credentials or deployment evidence is `UNEXECUTED`, never a green skip.

## 13. Deferred work

- Redis/multi-replica Hocuspocus is P7 and added only after measured single-instance saturation.
- Yjs command-log compaction is P7 after measured room-size need.
- Quantities, rates, prices, and material links remain Postgres-only P6 work.
- AI drawing recognition and automatic approval remain outside P3.
