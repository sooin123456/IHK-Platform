# Drawing Workspace P3 Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-safe realtime invalidation, Yjs/y-indexeddb/Hocuspocus collaborative drafts, Awareness cursors/selections/soft locks, workspace comments/history, review freeze, and the two-browser P3 vertical release gate without weakening Postgres audit or source-file immutability.

**Architecture:** `DrawingDocumentStore` remains the only React-facing projection. A Yjs command ledger merges immutable existing Drawing operations, y-indexeddb preserves them offline, Hocuspocus authenticates and persists the room, and the existing outbox/RPC materializes every local operation in Postgres. Supabase Realtime only invalidates business state. Review freezes and validates the room against the canonical Postgres snapshot before status transition.

**Tech Stack:** React 19, React Router 7.18.2, TypeScript 5.9.3, Supabase Postgres/Auth/RLS/Realtime, Konva/react-konva, Yjs 13.6.32, y-indexeddb 9.0.12, Hocuspocus 4.6.0, y-protocols 1.0.7, jose 6.2.10, Node.js 22 OCI, Zod 3.24.2, Node test runner, PGlite 0.5.3, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-26-drawing-workspace-p3-design.md`

## Global Constraints

- Source PDF/IFC bytes are immutable and SHA-256 must be equal before and after all P3 workflows.
- Postgres rows, append-only operations, canonical snapshot JSON/SHA, approvals, issues, events, and notifications remain business/audit authority.
- Yjs contains server-owned draft metadata/status plus client-append-only immutable operation envelopes; never approval, quantity, rate, price, payment, or source bytes. Clients cannot author status/meta, rewrite/delete operations, or claim another actor ID.
- Supabase Postgres Changes only triggers authoritative revalidation and never acknowledges a mutation.
- Hocuspocus Awareness carries cursor/selection/page/soft-lock state; Supabase Presence is not used for pointer traffic.
- Exact direct dependency pins are `yjs@13.6.32`, `y-indexeddb@9.0.12`, `@hocuspocus/provider@4.6.0`, `@hocuspocus/server@4.6.0`, `y-protocols@1.0.7`, and `jose@6.2.10`; all are MIT.
- Hocuspocus runs as a separate Node.js 22 OCI service and not in a Vercel function.
- JWT authorization requires a non-empty Supabase asymmetric `RS256`/`ES256` JWKS, exact issuer/audience, server-verified UUID subject, `is_anonymous !== true`, allowed Origin, canonical room name, and database membership/revision revalidation. Never trust `user_metadata`, client capability, or Awareness identity.
- The collaboration service uses a dedicated least-privilege Postgres login, not a browser key or Supabase service-role key. No password is committed.
- No external React state manager, Redis, multi-replica service, CRDT compactor, or copied third-party editor source is added in P3.
- Every product edit follows RED → GREEN → focused regression → fresh task review. Production credentials/deployment absence is recorded as `UNEXECUTED`, never skipped green.

---

### Task 1: P3-A workspace Realtime invalidation and connection status

**Files:**
- Create: `platform/app/lukas/lib/drawing-workspace-realtime.ts`
- Create: `platform/app/lukas/components/drawing-workspace-realtime.client.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- Test: `platform/tests/drawing-workspace-realtime.test.mjs`
- Test: `platform/e2e/drawing-workspace-shell.spec.ts`

**Interfaces:**
- Consumes: `drawingRealtimeState`, React Router `useRevalidator`, `projectId`, `revisionId`, `currentUserId`.
- Produces: `useDrawingWorkspaceRealtime({ projectId, revisionId, userId, enabled, onInvalidate }): DrawingWorkspaceRealtimeView`; `DrawingWorkspaceRealtimeView = { phase: "connecting" | "connected" | "disconnected"; message: string; lastInvalidationAt: number | null }`.

- [ ] **Step 1: Write failing contracts**

Require project/revision-scoped subscriptions for revisions, object-issue links, issues, comments, events, approvals, and visible membership changes; 250 ms coalescing; one revalidation after disconnected→connected; visibility-return revalidation; cleanup; and no mutation-success callback.

- [ ] **Step 2: Verify RED**

Run: `cd platform && node --test tests/drawing-workspace-realtime.test.mjs`

- [ ] **Step 3: Implement the pure invalidation scheduler and browser hook**

Lazy-load the existing Supabase browser client, use the same connection-state semantics as Drawing Room, apply exact Postgres filters where supported, and fail closed when environment values are absent.

- [ ] **Step 4: Integrate one top-bar connection indicator**

Do not replace the document store. Revalidated same-revision props may refresh issues/capability, but mutation success still comes only from the existing action/outbox response. Preview mode uses an injected inert connected adapter so it never contacts a fake Supabase endpoint.

- [ ] **Step 5: Verify and commit**

Run: `cd platform && node --test tests/drawing-workspace-realtime.test.mjs && npm run typecheck && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-anon-key VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-anon-key npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --workers=1`

Commit: `feat: add workspace realtime invalidation`

### Task 2: P3 collaboration protocol and exact OSS dependency closure

**Files:**
- Create: `platform/app/lukas/lib/drawing-collaboration-protocol.ts`
- Modify: `platform/package.json`
- Modify: `platform/package-lock.json`
- Modify: `platform/THIRD_PARTY_NOTICES.md`
- Modify: `platform/tests/drawing-workspace-license.test.mjs`
- Test: `platform/tests/drawing-collaboration-protocol.test.mjs`

**Interfaces:**
- Consumes: existing strict drawing operation/action schemas and `DrawingWorkspaceCapability`.
- Produces: `drawingRoomName`, `parseDrawingRoomName`, server-owned `DrawingCollaborationMetaSchema`/`DrawingCollaborationStatusSchema`, client-append-only `DrawingCollaborationOperationSchema`, `DrawingAwarenessStateSchema`, size/collection limits, distinguished server-origin constant, and a schema-version constant equal to `1`.

- [ ] **Step 1: Add RED protocol and license tests**

Cover canonical UUID room parsing, exact operation fields, unknown-field rejection, limits, prohibited business fields, awareness bounds, client-versus-server ownership, immutable operation IDs/order, and exact MIT pins/notices/lock closure.

- [ ] **Step 2: Verify RED**

Run: `cd platform && node --test tests/drawing-collaboration-protocol.test.mjs tests/drawing-workspace-license.test.mjs`

- [ ] **Step 3: Install exact client pins and exact server/JWT pins**

Use `npm install --save-exact`; do not add `lib0`, `ws`, Redis, or a state manager directly.

- [ ] **Step 4: Implement the protocol schemas and notices**

Reuse operation schemas rather than duplicating their permissible action shapes. Record upstream, exact version, license, purpose, and unchanged-package status.

- [ ] **Step 5: Verify and commit**

Run: `cd platform && node --test tests/drawing-collaboration-protocol.test.mjs tests/drawing-workspace-license.test.mjs && npm run typecheck && npm audit --omit=dev`

Commit: `feat: define drawing collaboration protocol`

### Task 3: Private collaboration state, least-privilege authorization, and publication migration

**Files:**
- Create via CLI: `platform/supabase/migrations/<generated>_drawing_workspace_p3_collaboration_state.sql`
- Modify: `platform/tests/drawing-workspace-database-runtime.test.mjs`
- Test: `platform/tests/drawing-workspace-p3-database-contract.test.mjs`
- Modify: `platform/DEPLOYMENT.md`

**Interfaces:**
- Consumes: `private.lukas_drawing_workspace_capability`, revision/project graph, operation sequence, current application publication.
- Produces: `private.lukas_drawing_collaboration_states`; dedicated `lukas_drawing_collaboration` NOLOGIN role; `private.lukas_drawing_collaboration_authorize(user,project,revision)`; `load_state`; `store_state`; `private.lukas_drawing_collaboration_lookup_operations(revision_id, client_operation_ids uuid[])` returning exact accepted comparison fields only and executable only by the collaboration role; public authenticated `public.lukas_drawing_collaboration_bootstrap(revision)`; private service-only `private.lukas_drawing_collaboration_bootstrap(verified_user_id, project_id, revision_id)` that reuses authorization and is executable only by the collaboration role. Both bootstraps return canonical P2 JSON, exact operation sequence, schema version, SHA, revision status, capability, and recent outcomes from one database snapshot. The task also produces publication membership for required public invalidation tables. Review-freeze functions are intentionally deferred to Task 9’s forward migration.

- [ ] **Step 1: Create the migration using the installed CLI**

Run `cd platform && npx supabase migration new drawing_workspace_p3_collaboration_state`; use the emitted filename. Discover CLI flags with `npx supabase migration --help` if needed.

- [ ] **Step 2: Write RED PGlite and source contracts**

Test private/Data-API isolation; exact role grants; admin/editor draft write; reviewer/viewer read-only; non-member denial; project/revision mismatch; size/schema/Yjs-byte-digest/sequence checks; monotonic store; review/approved overwrite denial; public/anon/authenticated/service-role direct denial; authenticated and dedicated-role service bootstrap JSON/sequence/SHA consistency under a concurrent write; service bootstrap actor/revision authorization; lookup input bounds/project ownership/exact accepted fields/missing-ID omission; denial of both private functions to every role except the dedicated collaboration role; and idempotent publication additions without touching `realtime` schema.

- [ ] **Step 3: Verify RED**

Run: `cd platform && node --test tests/drawing-workspace-p3-database-contract.test.mjs --test-name-pattern='P3'`

- [ ] **Step 4: Implement one additive migration**

Use fixed `search_path`, explicit `REVOKE ... FROM PUBLIC, anon, authenticated, service_role` for private service functions/tables, exact grants only to the dedicated role, composite FKs, bounded `bytea`, SHA-256 of exact Yjs bytes, and no committed login password. The authenticated bootstrap wrapper performs its own membership check and returns one transactionally consistent immutable payload. Existing public Drawing mutation/review RPC signatures stay unchanged.

- [ ] **Step 5: Verify migration runtime and history**

Run focused PGlite fresh-install and upgrade tests, then `cd platform && node --test tests/drawing-workspace-database-runtime.test.mjs tests/drawing-workspace-p3-database-contract.test.mjs && npm run typecheck`.

- [ ] **Step 6: Commit**

Commit: `feat: persist private drawing collaboration state`

### Task 4: Hocuspocus Node 22 collaboration service

**Files:**
- Create: `platform/collaboration/src/config.ts`
- Create: `platform/collaboration/src/auth.ts`
- Create: `platform/collaboration/src/storage.ts`
- Create: `platform/collaboration/src/server.ts`
- Create: `platform/collaboration/tsconfig.json`
- Create: `platform/collaboration/Dockerfile`
- Create: `platform/collaboration/.dockerignore`
- Modify: `platform/package.json`
- Test: `platform/tests/drawing-collaboration-service.test.mjs`

**Interfaces:**
- Consumes: Task 2 protocol, Task 3 dedicated DB functions, Supabase JWKS, `COLLABORATION_DATABASE_URL`, allowed origins.
- Produces: `createDrawingCollaborationServer(deps)`; `verifyDrawingAccessToken`; `authorizeDrawingRoom`; server-owned empty-room initialization; pending-operation Postgres reconciliation; constant-time authenticated idempotent internal outcome-receipt endpoint; Hocuspocus auth/token-sync/update/awareness/load/store hooks; `GET /healthz`; graceful shutdown; OCI image.

- [ ] **Step 1: Write RED service tests with injected verifier/storage/clock**

Cover missing/malformed/expired/anonymous/wrong issuer/wrong audience tokens, empty/HS256-only JWKS refusal, RS256/ES256 success, invalid room/origin, non-member, read-only roles, draft editor, server-owned empty-room metadata initialization, token-sync and passive 30-second membership downgrade, oversized/update-rewrite/actor forgery, awareness identity overwrite, accepted-row polling, signed rejection receipt, lost-receipt idempotent retry, load/store retry, health, and one-time graceful flush.

- [ ] **Step 2: Verify RED**

Run: `cd platform && node --test tests/drawing-collaboration-service.test.mjs`

- [ ] **Step 3: Implement config/auth/storage in small modules**

Do not log tokens, database URLs, binary state, or source hashes. Cache JWKS only within Supabase rotation guidance and expose a rotation purge path. Recheck access on token sync, before update/Awareness messages, and every 30 seconds for passive connections.

- [ ] **Step 4: Implement server hooks**

Set connection read-only for reviewer/commenter/viewer. Before accepting a client document update, apply it to a clone and reject client-authored server meta/status, rewrite/removal of an existing envelope/order entry, duplicate IDs, envelope/order mismatch, or actor mismatch. Initialize an absent room from Task 3 bootstrap with the distinguished internal origin. Poll pending IDs for accepted Postgres rows and accept explicit rejection/conflict only from the React server’s internal signed receipt endpoint; browser providers cannot write status. Sanitize Awareness before broadcast, validate complete state before store, use debounced/max-debounced persistence, and await `destroy()` on SIGTERM/SIGINT.

- [ ] **Step 5: Build and inspect OCI image**

Use Node 22 slim, multi-stage TypeScript build, `npm ci --omit=dev`, non-root runtime, explicit healthcheck, one exposed port, no Vercel/runtime vendor SDK.

- [ ] **Step 6: Verify and commit**

Run service tests, `npm run typecheck`, collaboration build, Docker build if Docker is available, and a secret/static scan.

Commit: `feat: add drawing collaboration service`

### Task 5: Yjs draft adapter and y-indexeddb recovery

**Files:**
- Create: `platform/app/lukas/lib/drawing-yjs-draft.ts`
- Create: `platform/app/lukas/lib/drawing-yjs-persistence.client.ts`
- Test: `platform/tests/drawing-yjs-draft.test.mjs`
- Test: `platform/e2e/drawing-yjs-indexeddb.spec.ts`

**Interfaces:**
- Consumes: protocol schemas, P2 loader hydration, pure command reducer, Y.Doc, IndexeddbPersistence.
- Produces: `DrawingDraftAdapter` with `getSnapshot`, `subscribe`, `prepareLocal`, `appendDurableLocal`, `applyServerProjection`, `replaceAuthoritative`, `setAuthorization`, `setFrozen`, `whenLocalPersistenceSynced`, and `dispose`. It exposes no client method that authors ack/conflict/reject status.

- [ ] **Step 1: Write RED convergence/projection tests**

Cover base+operations projection, two docs applying concurrent different-object commands in opposite network order, same-object commands with opposite Yjs order and opposite authoritative RPC sequence, provisional loser conflict without room quarantine, actor undo isolation, no remote outbox echo, idempotent operation IDs, ack checkpoint boundary, conflict removal, malformed/oversized quarantine, single publish per transaction, and disposal.

- [ ] **Step 2: Write RED IndexedDB recovery tests**

Run in real Chromium IndexedDB through Playwright; do not add a fake IndexedDB dependency. Require revision-scoped names, local-before-network boot, 100 operations during five simulated offline minutes, zero ID loss, safe version-change close, and frozen-revision recovery preservation.

- [ ] **Step 3: Verify RED**

Run: `cd platform && node --test tests/drawing-yjs-draft.test.mjs && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-anon-key VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-anon-key npx playwright test e2e/drawing-yjs-indexeddb.spec.ts --project=chromium --workers=1`

- [ ] **Step 4: Implement the smallest adapter over the existing reducer**

Do not mirror entity collections into a second React store. Publish only validated full projections through the existing store boundary.

- [ ] **Step 5: Implement browser-only y-indexeddb lifecycle**

No SSR open. Destroy providers/listeners deterministically. Invalid local data retains the authoritative loader projection and emits recovery evidence.

- [ ] **Step 6: Verify and commit**

Run focused tests, drawing document/outbox/command regressions, and typecheck.

Commit: `feat: add offline collaborative drawing drafts`

### Task 6: Integrate collaborative drafts with workspace commands, outbox, and roles

**Files:**
- Create: `platform/app/lukas/components/drawing-collaboration.client.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/lib/drawing-document-store.ts`
- Modify: `platform/app/lukas/lib/drawing-outbox.ts`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- Test: `platform/tests/drawing-workspace-collaboration.test.mjs`
- Test: `platform/tests/drawing-workspace-outbox.test.mjs`

**Interfaces:**
- Consumes: Task 1 invalidation, Task 3 transactional bootstrap, Task 5 adapter, current access-token session, existing command/outbox/action contracts.
- Produces: one provider/adapter lifecycle scoped to `(userId, projectId, revisionId)`; collaborative `applyCommand`; ack/reject projection updates; immediate read-only downgrade; local preview injected in-memory provider.

- [ ] **Step 1: Write RED integration contracts**

Require validate-without-publish → durable outbox enqueue → local Yjs append → provider send order; crash after each boundary; outbox-only/Yjs-only/Postgres-committed-unacked/RPC-committed-unshared boot repair; React-server delivery of authenticated idempotent accepted/rejected outcome receipts after RPC responses; lost-receipt retry; remote projection without local outbox enqueue/undo ownership; server-owned status projection only; same revision transactional checkpoint refresh; changed revision disposal; token refresh; capability/status downgrade pointer cancellation; and no fake network in preview.

- [ ] **Step 2: Verify RED**

Run focused workspace collaboration/outbox tests.

- [ ] **Step 3: Add session-token loader/client boundary**

Expose only the authenticated access token resolver needed by the provider; never serialize service credentials. Load the document through the Task 3 transactional bootstrap rather than pairing concurrent table reads with an unrelated max sequence. Keep server action/RLS checks unchanged.

- [ ] **Step 4: Replace the current `applyCommand` seam with adapter-backed application**

Preserve pure commands, existing outbox/RPC, local actor undo/redo, save status, conflict UI, and authorization remount key.

- [ ] **Step 5: Reconcile revalidation and provider lifecycle**

Avoid rebuilding on loader object identity. Dispose on revision/user change. If collaboration env is unavailable, fail visibly and preserve offline local work rather than silently falling back to a second authority.

- [ ] **Step 6: Verify and commit**

Run focused tests, full Drawing Workspace suite, local hydrated Chromium, typecheck, and build.

Commit: `feat: integrate collaborative drawing commands`

### Task 7: Awareness participants, cursors, selections, and soft locks

**Files:**
- Create: `platform/app/lukas/lib/drawing-awareness.ts`
- Create: `platform/app/lukas/components/drawing-collaboration-overlay.client.tsx`
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/app/lukas/components/drawing-inspector.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Test: `platform/tests/drawing-awareness.test.mjs`
- Test: `platform/e2e/drawing-workspace-shell.spec.ts`

**Interfaces:**
- Consumes: provider Awareness, screen→world geometry, current page/canvas/selection/tool, verified remote identities.
- Produces: frame-throttled local awareness publisher; validated peer view; participant top bar; remote cursor/selection overlays; 10-second renewable soft-lock leases.

- [ ] **Step 1: Write RED pure Awareness/lease tests**

Cover world coordinates, one send/frame, unchanged suppression, canvas filtering, canonical-ID selection, unknown-field stripping, deterministic user color, spoofed user rejection, lease acquire/renew/release/expiry, and advisory-not-authoritative semantics.

- [ ] **Step 2: Write RED visible UI test**

Inject two preview peers and require participant labels, remote cursor label, selection outline, lock explanation, no horizontal overflow, and accessible connection/lock status.

- [ ] **Step 3: Verify RED**

Run pure test and focused Chromium.

- [ ] **Step 4: Implement publisher and overlay**

Use Konva/WebGL overlay for shapes and cursor geometry; use DOM labels for readable names/status. Do not rerender the whole document on every cursor move.

- [ ] **Step 5: Apply soft-lock UI gating**

Lock only the entity being dragged/edited. Existing capability/revision/layer checks remain final. Downgrade or unmount releases local Awareness and pointer capture.

- [ ] **Step 6: Verify and commit**

Run focused tests, drawing canvas/command regressions, typecheck, build, and capture a two-peer preview screenshot.

Commit: `feat: show live drawing collaborators`

### Task 8: Workspace comments, mentions, sharing, history, and restore

**Files:**
- Create via CLI: `platform/supabase/migrations/<generated>_drawing_workspace_p3_mentions_history.sql`
- Create: `platform/app/lukas/components/drawing-collaboration-panel.tsx`
- Create: `platform/app/lukas/components/drawing-history-panel.tsx`
- Create: `platform/app/lukas/lib/drawing-history.server.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/lib/drawing-collaboration.server.ts`
- Test: `platform/tests/drawing-workspace-p3-social.test.mjs`
- Modify: `platform/tests/drawing-workspace-database-runtime.test.mjs`

**Interfaces:**
- Consumes: existing issues/anchors/object links/comments/events/notifications, project membership roles, append-only operations, adapter command path.
- Produces: normalized comment mentions; immutable canvas world-region anchors; object/region comment UI; workspace link/reuse of the existing project-membership action/validation; keyset-paginated activity feed; single-operation revert; restore-to-checkpoint delta; idempotent approved-snapshot→child-draft clone.

- [ ] **Step 1: Create the migration with `supabase migration new` and write RED DB tests**

Require same-project selected-member mentions, unique `(comment,user)` rows, immutable mentions, notification/event fanout, RLS non-member denial, no parsing of arbitrary `@text` into authority, and revision/project/canvas-bound immutable world-region anchors with finite signed millimeter `x/y`, strictly positive finite millimeter `width/height`, and composite FKs.

- [ ] **Step 2: Write RED server/UI contracts**

Cover object and world-region targets using finite millimeter `x/y` (negative allowed) and positive `width/height`, explicit mention picker, commenter/editor role controls, reuse of the existing admin-only `/projects/:projectId/members` action/validation rather than a second mutation path, bounded keyset history, operation detail, single-operation revert dependency refusal, restore-to-checkpoint validated current→target compound delta with current base versions, tombstones/references/required properties, and idempotent approved-parent snapshot clone with fresh IDs/preserved lineage.

- [ ] **Step 3: Implement migration and server paths**

Reuse existing tables and membership authority plus the current add/upsert/remove member action. Add only the normalized mention relation, canvas-region anchor relation, and narrowly required secure functions/triggers including an idempotent approved-snapshot child-draft clone.

- [ ] **Step 4: Implement panels**

Add `댓글·이슈` and `변경 이력` tabs to the existing left panel. Revert and restore-to-checkpoint create normal append-only operations; approved restore navigates to the newly cloned draft and never direct-updates historical rows.

- [ ] **Step 5: Verify and commit**

Run PGlite, focused social/history tests, Drawing Workspace suite, typecheck, build, and local Chromium.

Commit: `feat: add drawing collaboration activity`

### Task 9: Atomic collaboration-room review freeze

**Files:**
- Create via CLI: `platform/supabase/migrations/<generated>_drawing_workspace_p3_review_freeze.sql`
- Modify: `platform/collaboration/src/server.ts`
- Create: `platform/collaboration/src/freeze.ts`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Test: `platform/tests/drawing-review-freeze.test.mjs`
- Modify: `platform/tests/drawing-workspace-database-runtime.test.mjs`

**Interfaces:**
- Consumes: validated Y.Doc, operation status ledger, existing canonical P2 snapshot function and review/decision RPC.
- Produces: authenticated internal freeze/reconcile endpoint; persisted idempotent `freeze_request_id`, `active | freezing | frozen | released` state, and frozen accepted-manifest digest/count/base sequence; `lukas_drawing_request_collaborative_review` database transaction; client review gating and frozen recovery. Task 3’s committed migration is never edited.

- [ ] **Step 1: Write RED freeze race tests**

Cover pending/conflicted local denial, server persists `freezing` before DB transition, update racing freeze rejection, exact persisted comparison subset (`client_operation_id`, revision, actor, type, base versions, forward, inverse, authoritative sequence/result versions), client creation-time/schema exclusion, frozen manifest digest/count/base-sequence binding, direct RPC without freeze denial, stale/mismatched request denial, successful DB-only canonical snapshot/SHA/status, validation failure release, service crash/restart at every boundary, DB commit with lost response, no release after committed review/approval, disconnected service no transition, later offline update recovery, reviewer read-only, and permanent approved freeze.

- [ ] **Step 2: Verify RED**

Run focused service/PGlite/server tests.

- [ ] **Step 3: Implement internal service authentication and freeze**

Use a separate random internal secret header only between React server and collaboration service, constant-time comparison, no browser exposure, bounded timeout, and idempotent freeze request ID. On restart reconcile persisted freeze state against database revision status before accepting connections.

- [ ] **Step 4: Implement the database checkpoint transaction**

Lock revision and collaboration state; require `frozen`, the same request ID, and persisted accepted-manifest digest/count/base sequence; verify the exact persisted subset of every accepted immutable envelope against Postgres and reject pending/conflicted entries; derive/write the one canonical P2 snapshot/SHA only inside Postgres; record the freeze request and transition to review requested. Preserve existing maker-checker approval; never compare the Yjs-byte digest to the business snapshot SHA.

- [ ] **Step 5: Integrate UI and recovery**

Disable review while local work is pending/conflicted. A successful freeze immediately remounts the canvas read-only. Rejected post-freeze offline work remains exportable/recoverable but cannot mutate the frozen revision.

- [ ] **Step 6: Verify and commit**

Run focused tests, approval/snapshot regressions, Drawing Workspace suite, service build, typecheck, and app build.

Commit: `feat: freeze collaborative drawing reviews`

### Task 10: Two-browser P3 E2E, offline, performance, security, and regression gates

**Files:**
- Create: `platform/e2e/drawing-workspace-p3.spec.ts`
- Modify: `platform/e2e/utils/drawing-collaboration-fixture.ts`
- Create: `platform/tests/drawing-workspace-p3-contract.test.mjs`
- Modify: `platform/package.json`
- Modify: `platform/playwright.config.ts`

**Interfaces:**
- Consumes: deployed/local Supabase, collaboration service, owner/editor/reviewer/viewer/non-member fixture, representative PDF and IFC.
- Produces: one fail-closed credentialed P3 command and executable evidence for the complete first vertical collaboration gate.

- [ ] **Step 1: Add a fail-closed credential guard**

Require real app URL, Supabase URL/publishable/service-role test key, collaboration WebSocket/internal URL, and collaboration database/admin setup. Missing or placeholder variables terminate as `UNEXECUTED`; do not use `test.skip`.

- [ ] **Step 2: Seed deterministic P3 users/document and capture source SHA**

Reuse the existing fixture and exact role mapping. Cleanup must aggregate failures and remove rooms/users/files/rows without masking the test verdict.

- [ ] **Step 3: Implement two-editor scenarios**

Assert three simultaneous authenticated participants, cursor world location, selection, simultaneous different-object create/move, same-object opposite-order authoritative winner/conflicted loser, soft lock on same object, three-context p95 reflection timing with documented browser/hardware/CPU/memory/viewport/object mix/cold-warm conditions, crash/reconnect repair boundaries, 100 offline operations with zero ID/object loss, and page/canvas filtering.

- [ ] **Step 4: Implement role/freeze/social scenarios**

Viewer/non-member WebSocket and DB writes fail; Reviewer sees read-only state; comments/mentions/share/history/restore work; review during editor drag cancels interaction; frozen/approved revisions reject updates; next revision is editable.

- [ ] **Step 5: Implement source and regression evidence**

Re-download and hash PDF/IFC; exercise P0–P2 drawing/edit/export, quantity, approval, Revit download, and existing drawing-room routes with strict successful responses and meaningful content/artifact assertions.

- [ ] **Step 6: Add mutation-resistant local contracts and scripts**

Add `test:e2e:drawing-workspace-p3:production`; contract each scenario’s critical assertions and exact fixture composition without claiming execution.

- [ ] **Step 7: Verify local gates and commit**

Run focused contracts, all Drawing Workspace tests, whole Node suite, IFC smoke, typecheck, build, collaboration service tests/build, local credential-free Chromium shell, and the credentialed P3 spec only when real variables exist.

Commit: `test: verify drawing workspace P3 collaboration`

### Task 11: P3 deployment, operations, and honest release evidence

**Files:**
- Modify: `platform/DEPLOYMENT.md`
- Modify: `docs/P0_P5_IMPLEMENTATION_MATRIX.md`
- Modify: `docs/DRAWING_COLLABORATION_FIELD_CHECK.md`
- Modify: `docs/PROJECT_STATE.md`
- Create: `docs/superpowers/reports/2026-08-26-drawing-workspace-p3-release.md`

**Interfaces:**
- Consumes: Tasks 1–10 and their test/artifact reports.
- Produces: ordered migration/service/app deployment, rollback/recovery procedure, measured P3 evidence, and explicit external-gate status.

- [ ] **Step 1: Document exact deployment order**

Backup/schema snapshot → verify non-empty Supabase asymmetric RS256/ES256 JWKS and document signing-key rotation/cache procedure → provision dedicated collaboration login secret → apply additive migrations → generate DB types → build/push one-replica Node 22 image → health/auth/storage smoke → deploy app preview → two-user P3 smoke → promote. Include publication and private-role queries without exposing secrets. Legacy HS256-only projects remain `UNEXECUTED` until migrated.

- [ ] **Step 2: Document rollback/recovery**

Stop new room connections, flush Hocuspocus, keep additive DB state, roll app/service image back, keep Postgres operation/snapshot authority, and use forward-fix migrations. Restore backup only for an approved incident procedure.

- [ ] **Step 3: Run full local gate**

Run whole Node, Drawing Workspace, typecheck, build, IFC, service tests/build, Docker build where available, dependency/license scan, and local Chromium.

- [ ] **Step 4: Run production gate only with real credentials**

Record deployment/image/migration IDs, representative file hashes, browser/CPU/memory/viewport/object mix/cold-warm conditions, p95 latency, offline loss count, role denials, and rollback rehearsal. Otherwise record every item `UNEXECUTED`.

- [ ] **Step 5: Update status honestly and commit**

Do not mark P3 operationally complete until the deployed two-user field gate passes. Local implementation completion and production passage remain separate fields.

Commit: `docs: record drawing workspace P3 release evidence`

---

## Plan self-review

- Every P3 requirement in the spec maps to at least one task: Realtime (1/3), protocol/dependencies (2), private storage/auth (3), service (4), Yjs/offline (5/6), Awareness/locks (7), comments/mentions/share/history/restore (8), review freeze (9), E2E/security/performance/source regression (10), deployment evidence (11).
- P3-A and P3-B share one plan because Task 1 produces the invalidation layer consumed by Task 6; neither is independently the requested two-browser release outcome.
- The plan never edits an already-applied migration after its task is committed; later SQL changes use a new forward migration.
- The same operation envelope, server-owned status/meta rule, transactional bootstrap, room name, awareness type, role map, and DB-only business snapshot SHA flow are used consistently across tasks.
- No placeholder/TBD acceptance criterion remains. Timestamped migration paths are intentionally emitted by `supabase migration new` per current CLI rules.

## Completion gate

P3 local implementation is complete only after Tasks 1–11 have clean task reviews, one final broad review, a clean worktree, and all available local gates pass. P3 production is complete only after applied migrations, a running collaboration service, credentialed two-browser/role/source tests, measured performance, and field evidence pass. Until then the overall P0–P7 goal stays active.
