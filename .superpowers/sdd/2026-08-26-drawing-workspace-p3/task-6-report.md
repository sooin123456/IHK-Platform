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
- Capability/revision downgrade immediately freezes the adapter, disposes the
  provider, clears selection/tool state, and denies further persistence. Local
  storage failure also freezes mutation until explicit recovery.
- The React server now sends HMAC-authenticated, idempotent accepted/rejected/
  conflicted receipts after the authoritative RPC. A lost accepted receipt
  returns retryable 503 so the same durable operation ID is replayed safely.
- Preview injects null local persistence and an inert connected provider; browser
  coverage proves it makes no fake Supabase or collaboration WebSocket request.
- Fixed the shared Yjs adapter's `add_layer` creation-version check, discovered
  by hydrated browser testing, so a durable new layer projects instead of being
  quarantined as a provisional conflict.

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

### GREEN

- Focused collaboration/outbox/Yjs/service command: 115 passed, 0 failed.
- Full `node --test --test-reporter=tap tests/drawing-*.test.mjs`: 547 passed,
  0 failed, 1 existing explicitly skipped gate (548 total).
- Fresh-server hydrated Chromium workspace shell: 6 passed, 0 failed. This
  includes same-revision local edit preservation, user-key reset, downgrade to
  viewer, visible collaboration status, and zero preview Supabase/collaboration
  requests.
- Real Chromium `y-indexeddb` recovery: 3 passed, 0 failed, including 100 offline
  operations, frozen recovery, and two-browser-realm same-ID deduplication.
- `npm run typecheck`: passed.
- `npm run build`: passed. Vite reported only its existing large-chunk and future
  React Router warnings.
- `git diff --check`: passed.
- Browser source scan found no service-role key, internal collaboration secret,
  or privileged Supabase credential in the new client boundary.

## Files

- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/lib/drawing-collaboration-client.ts`
- `platform/app/lukas/lib/drawing-workspace.server.ts`
- `platform/app/lukas/lib/drawing-yjs-draft.ts`
- `platform/app/lukas/screens/drawing-workspace.tsx`
- `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- `platform/collaboration/src/server.ts`
- `platform/e2e/drawing-workspace-shell.spec.ts`
- `platform/tests/drawing-collaboration-service.test.mjs`
- `platform/tests/drawing-workspace-collaboration.test.mjs`
- `platform/tests/drawing-workspace-route.test.mjs`
- `platform/tests/drawing-yjs-draft.test.mjs`

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
