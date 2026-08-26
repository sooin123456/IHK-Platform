# P3 Task 6 report — collaborative command integration

## Outcome

- Replaced the workspace's direct command/save path with one lifecycle keyed by
  `(userId, projectId, revisionId)`: side-effect-free command preparation,
  durable existing outbox enqueue, local Yjs append, then provider flush.
- Restores revision-scoped `y-indexeddb` before connecting Hocuspocus and repairs
  outbox-only, Yjs-only, accepted-but-unacked, and RPC-committed-unshared
  operations by immutable client operation ID without duplicate publication.
- Uses the Task 3 transactional collaboration bootstrap as the authoritative
  graph/checkpoint/capability/outcome boundary. Same-revision bootstrap refreshes
  the adapter's authoritative base without replacing pending local contributions;
  a user/project/revision identity change disposes the full lifecycle.
- Keeps `DrawingDocumentStore` as the only React projection. Remote Yjs updates
  project through the adapter and never enter the local outbox or actor undo
  ownership.
- Added a browser-only Supabase session token resolver and Hocuspocus provider
  boundary. It serializes neither tokens nor internal/service secrets, refreshes
  the provider token on reconnect/visibility, and exposes connected, connecting,
  or degraded state while offline edits remain durable.
- Capability/revision downgrade immediately freezes the adapter, clears
  selection/tool state, and denies further persistence while retaining the
  provider for read-only observation. Local storage failure also freezes
  mutation until explicit recovery.
- The React server now sends HMAC-authenticated, idempotent accepted/rejected/
  conflicted receipts after the authoritative RPC. A lost accepted receipt
  returns retryable 503 so the same durable operation ID is replayed safely.
- Preview injects null local persistence and an inert connected provider; browser
  coverage proves it makes no fake Supabase or collaboration WebSocket request.
- Fixed the shared Yjs adapter's `add_layer` creation-version check, discovered
  by hydrated browser testing, so a durable new layer projects instead of being
  quarantined as a provisional conflict.

## Review fixes

- Recorded undo/redo operations are reduced to the exact collaboration envelope
  before outbox/Yjs publication. The adapter keeps the local actor's history
  relationship while replaying the shared business operation, and the redundant
  second `DrawingDocumentStore.replace` path was removed.
- A schema-valid operation that became durable before a same-object remote edit
  is always appended. Projection classifies the losing pending operation as a
  provisional conflict; reload repair terminates with both immutable IDs and the
  remote winner instead of repeatedly failing initialization.
- Bootstrap `revisionStatus`, `capability`, and `canWrite` now override a stale
  independently loaded workspace row for adapter freeze, pointer safety, and all
  local mutation gates.
- Viewer/commenter/reviewer clients stay connected read-only. Provider disconnect
  is visibly degraded, automatic reconnect returns to connected, and remote
  projection continues after authorization downgrade.
- Each local initialization attempt owns and deterministically disposes its
  document, persistence, and adapter. Retry is single-flight, clears the failed
  persistence authority on success, and provider construction failure degrades
  collaboration without misclassifying local durability or disabling editing.
- Undo/redo lineage is now part of the same immutable operation envelope and
  durable outbox entry (`historyAction` plus `originalOperationId`). The private
  adapter-memory history map was removed; ordered replay reconstructs actor
  stacks after IndexedDB reload and same-user cross-tab delivery.
- Preview readiness no longer uses an animation-frame shortcut. Its injected
  Realtime adapter exposes a one-shot ready promise and subscribed state that
  advance only from the actual `subscribe` boundary.
- History lineage is now an authoritative database/service contract, not only a
  client envelope. A forward migration stores the paired nullable
  `history_action`/`original_operation_id`, constrains the original to the same
  revision, compares lineage during RPC idempotency, and returns it from lookup
  and bootstrap contracts.
- Service ingress and full-room validation rebuild a deterministic per-actor
  history stack. Missing, foreign-actor, non-head, repeated, and wrong-direction
  undo/redo contributions are rejected before persistence; valid actor history
  survives polling, receipt loss, process restart, and remote interleaving.
- Test readiness has no timer shortcut. The shell now waits for independently
  observable persistence sync and provider subscription/failure signals, while
  explicit Vite dependency prebundling makes an empty-cache server deterministic.
- A second CLI-generated forward migration closes both database compatibility
  bypasses. Legacy six-argument public/private apply functions are now thin
  null-lineage wrappers over the authoritative eight-argument function, and a
  composite `(revision_id, original_operation_id, actor_id)` foreign key binds
  direct history writes to an original operation owned by the same actor.

## TDD evidence

### RED

- Initial collaboration integration suite failed because
  `drawing-collaboration-client.ts` did not exist.
- Bootstrap integration failed because the transactional bootstrap loader was
  not exported from the workspace server boundary.
- Signed accepted receipt coverage failed because the collaboration service
  rejected `acked` and did not recognize an authoritative sequence.
- Command-order failure injection proved a durable outbox enqueue error must stop
  before both Yjs append and provider publication.
- Hydrated Chromium initially lost a newly created layer. The added adapter
  regression failed with the layer absent and its operation provisionally
  conflicted; creation-version semantics fixed it.
- The accepted-RPC/lost-receipt regression initially returned 400 instead of the
  required retryable 503; receipt transport exceptions now preserve retry.
- Review RED: edit → remote → undo failed with `Drawing collaboration operations
  have exact fields.` before reaching Yjs; the exact-envelope/history regression
  now completes undo, a second remote projection, and redo with one store
  publication per Yjs transaction.
- Review RED: a deferred durable enqueue followed by a same-object remote edit
  threw `Drawing operation does not reproduce its canonical command`; reload
  repair repeated the failure. Both live and repaired cases now retain the local
  ID as provisional conflict evidence and publish the remote winner.
- Review RED: stale workspace `draft` plus transactional
  `review_requested/canWrite=false` still exposed layer editing, viewer downgrade
  lost the connected read-only state, provider disconnect mapped to connecting,
  and retry leaked/retained failed local authority. Node and hydrated Chromium
  regressions cover each corrected boundary.
- Review RED: cloning edit → remote actor edit → undo into a fresh adapter lost
  the redo stack because lineage existed only in adapter memory. The reload and
  same-actor cross-tab regression now redoes successfully, excludes the remote
  operation from the local actor's command, and remains idempotent on repeated
  updates.
- Review RED: the animation-frame preview barrier could report ready without a
  Realtime subscription and still timed out cold. Readiness is now emitted by
  the injected adapter's real subscription boundary.
- Re-review RED: service ingress accepted missing, foreign, repeated, and
  wrong-direction history lineage because only clients reconstructed the stack.
  End-to-end service tests now exercise those mutations plus remote-actor
  interleaving and valid undo/redo.
- Re-review RED: the operation ledger and RPC discarded history lineage, so the
  same durable ID could be retried with a different lineage and a detached
  service could not authorize redo after restart. PGlite runtime tests now prove
  exact retry, mismatched-lineage rejection, lookup/bootstrap preservation, and
  restart reconstruction.
- Re-review 3 RED: retrying an eight-argument history operation through the
  legacy six-argument overload returned the stored result without comparing
  lineage, and a service-role insert could reference another actor's original.
  The new wrapper and composite-FK regressions failed for those exact reasons
  before the forward migration was implemented.

### GREEN

- Focused service, source-contract, and database runtime: 138 passed, 0 failed.
  This includes legacy 8→6 rejection, 6→8 null equivalence, non-history retry,
  cross-actor service-role insert/update rejection, and a populated migration
  upgrade that preserves valid same-actor lineage byte-for-byte.
- Full `node --test --test-reporter=tap tests/drawing-*.test.mjs`: 566 passed,
  0 failed, 1 existing explicitly skipped gate (567 total).
- Fresh-server hydrated Chromium workspace shell: 8 passed, 0 failed. This
  includes same-revision local edit preservation, user-key reset, downgrade to
  viewer with a retained provider, transactional stale-row freeze, deterministic
  resource retry, visible collaboration status, and zero preview
  Supabase/collaboration requests. The formerly flaky readiness case passed
  repeated warm runs and a final empty-Vite-cache fresh-server run.
- Real Chromium `y-indexeddb` recovery: 3 passed, 0 failed, including 100 offline
  operations, frozen recovery, and two-browser-realm same-ID deduplication.
- `npm run typecheck`: passed.
- `npm run typecheck:collaboration`: passed.
- `npm run build`: passed. Vite reported only its existing large-chunk and future
  React Router warnings.
- `git diff --check`: passed.
- Browser source scan found no service-role key, internal collaboration secret,
  or privileged Supabase credential in the new client boundary.

## Files

- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/lib/drawing-collaboration-client.ts`
- `platform/app/lukas/lib/drawing-collaboration-protocol.ts`
- `platform/app/lukas/lib/drawing-workspace.server.ts`
- `platform/app/lukas/lib/drawing-workspace.types.ts`
- `platform/app/lukas/lib/drawing-yjs-draft.ts`
- `platform/app/lukas/screens/drawing-workspace.tsx`
- `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- `platform/collaboration/src/server.ts`
- `platform/collaboration/src/storage.ts`
- `platform/e2e/drawing-workspace-shell.spec.ts`
- `platform/supabase/migrations/20260825234510_drawing_collaboration_history_lineage.sql`
- `platform/supabase/migrations/20260826002019_drawing_collaboration_history_authority.sql`
- `platform/tests/drawing-collaboration-service.test.mjs`
- `platform/tests/drawing-collaboration-protocol.test.mjs`
- `platform/tests/drawing-workspace-collaboration.test.mjs`
- `platform/tests/drawing-workspace-database-runtime.test.mjs`
- `platform/tests/drawing-workspace-p3-database-contract.test.mjs`
- `platform/tests/drawing-workspace-route.test.mjs`
- `platform/tests/drawing-workspace-server.test.mjs`
- `platform/tests/drawing-yjs-draft.test.mjs`
- `platform/vite.config.ts`

## Unexecuted deployment gates

- No production/disposable Supabase deployment, dedicated collaboration database
  login, production JWT issuer, Hocuspocus deployment, or external TLS endpoint
  was available. Deployed RLS/RPC, token rotation, signed receipt delivery, and
  real multi-browser networking are therefore `UNEXECUTED`.
- Collaboration latency p95, disconnect/reconnect soak, and 10,000-object frame
  targets were not measured by this integration task.
- No production migration, secret, database, or external service was modified.

## Commit

- `feat: integrate collaborative drawing commands`
- Review hardening follow-up: `fix: harden collaborative drawing integration`
- Re-review follow-up: `fix: persist collaborative drawing history`
- Authoritative lineage follow-up: `fix: enforce authoritative collaboration history`
- Database authority follow-up: `fix: close collaboration history database bypasses`
