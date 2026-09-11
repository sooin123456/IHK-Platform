# Canonical Collaboration Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one canonical first Yjs state and admit browsers only with durable server identities.

**Architecture:** Add insert-only private SQL initialization under the revision lock. Reuse current storage, bootstrap, validation and freeze coordination through one canonical loader; no client protocol weakening.

**Tech Stack:** PostgreSQL, postgres.js, TypeScript, Yjs, Hocuspocus, Node test.

**Spec:** `docs/superpowers/specs/2026-09-06-collaboration-canonical-initialization.md`

## Global Constraints

- No new dependencies, remote writes, deploys, commits, staging, or rebuilding the live preview.
- Preserve dirty-worktree changes; review against exact pre-task snapshots rather than HEAD.
- Initializers return one winner's full bytes, never merge losing candidates.
- Authorized Viewer initialization is trusted serialization; ordinary Viewer writes remain denied.
- Only collaboration role can execute private initialization wrappers; no application role can execute core.
- Original sources, approved revisions, freeze leases and protected-state guards remain unchanged.

### Task 1: Atomic SQL initialization with real PostgreSQL proof

**Files:** Modify the empty CLI migration named in the spec and `platform/tests/drawing-workspace-m1-real-database.test.mjs`. An owned local-cluster runner may live in this plan's SDD workspace; no additional production harness.

**Interfaces:** Produce the three exact SQL functions and error codes from the spec. Task 2 consumes full state rows through the collaboration role. The canonical snapshot helper and authorize/entitlement functions already exist in migrations.

- [ ] Add `proveCanonicalCollaborationInitialization` to the existing real-DB fixture and invoke it after seeded fixture/document setup. Exercise independent worker connections using a deterministic revision-lock barrier, not timing sleeps:
  ```js
  assert.notEqual(backendA, backendB);
  assert.deepEqual(winner.yjs_state, loser.yjs_state);
  assert.equal(winner.generation, 1);
  assert.equal(loser.sha256, winner.sha256);
  assert.equal(loser.persisted_at.getTime(), winner.persisted_at.getTime());
  ```
  Add assertions for stale SHA/sequence rejection, malformed bounds, unauthorized and role-execute denial, Viewer first load, approved-reader absent-state initialization, absent approved service refusal, existing approved/frozen no-op return, and pre-acquired lease unchanged. Use valid candidate encodings where server integration matters; SQL-only opaque bytes are acceptable for SQL boundary tests and must be identified as such.
- [ ] Run actual isolated PostgreSQL with the empty migration, expect missing initializer failure. Reuse local initdb/pg_ctl, an exact mkdtemp directory and loopback port; precreate collaboration role and grant postgres WITH INHERIT FALSE, SET TRUE required by M1 fixture. Capture RED output.
- [ ] Implement the spec's core lock/check/insert/return order and narrow wrappers. SQL skeleton:
  ```sql
  perform 1 from public.lukas_drawing_revisions
    where id=p_revision_id and project_id=p_project_id for update;
  return query select * from private.lukas_drawing_collaboration_states
    where revision_id=p_revision_id;
  ```
  Existing row returns before candidate validation; absent insert alone checks snapshot. Reuse existing migration conventions and codes exactly.
- [ ] Run the M1 real-DB test with required=1 and the owned cluster URL; assert all migrations, role checks, concurrent proof and existing fixture assertions pass. Stop only the owned cluster and preserve logs. Self-review, report precise commands/results and files; no commit.

### Task 2: Canonical storage and durable first admission

**Files:** Modify `platform/collaboration/src/storage.ts`, `platform/collaboration/src/server.ts`, and existing focused `platform/tests/drawing-collaboration-service.test.mjs`, `platform/tests/drawing-review-freeze.test.mjs`, `platform/tests/drawing-native-collaboration.test.mjs` where absent-state fixtures require the new interface. Add `platform/tests/drawing-collaboration-initialization.test.mjs` for focused end-to-end initialization cases if keeping them separate is clearer.

**Interfaces:** Consume Task 1 SQL functions; expose the exact `DrawingInitializeInput`, database and storage methods from the spec. All browser/service/receipt paths use a shared canonical loader. Missing initializer support must explicitly fail on absent state, not silently fall back to nondurable bootstrap.

- [ ] Add RED tests proving initialization waits for durable state and discards the losing Yjs origin:
  ```js
  assert.deepEqual(Y.encodeStateAsUpdate(loaded), Y.encodeStateAsUpdate(winner));
  assert.equal(initialPayload.share.size, 0); // while initialization awaits or transient fence is rejected
  assert.doesNotThrow(() => validateHonestReplay(cachedWinner, reloadedWinner));
  ```
  Use actual existing validator signatures when wiring the assertion. Cover bounded P3S04 retry, non-transient propagation, token seeding, all three loaders, approved Viewer, active metadata correction persistence and transient lease refusal. Update older fake storage only when the test actually starts from absent state.
- [ ] Implement facade/adapter initialization without ordinary CAS merge. Both user and service loads adopt the returned bytes only after existing persisted-state/scope validation.
- [ ] Refactor server loading narrowly. Canonical load algorithm:
  ```ts
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await load();
    if (existing) return validatedFreshDocument(existing);
    const candidate = await trustedBootstrapDocument();
    try { return validatedFreshDocument(await initialize(candidate)); }
    catch (error) { if (error.code !== 'P3S04' || attempt === 2) throw error; }
    finally { candidate.destroy(); }
  }
  ```
  Implement helpers in current server.ts with actual types; no standalone framework. For browser admission reconcile detached doc, persist an active server-only correction with existing guarded service store when needed, reload durable bytes and compare normalized encodings. Retry concurrent movement up to three times, otherwise explicit retryable reconciliation error; apply to empty payload only after equality. Reuse detached service loading in receipt path and destroy detached documents in finally.
- [ ] Add an actual WebSocket untouched-room persistence/reload/honest-cached-replay case using production Hocuspocus and trusted storage implementation. Preserve forged protected-state rejection and Viewer denial; failures leave no unpersisted initial document visible. Include database-backed integration where existing real-DB fixture can provide it without broad harness changes.
- [ ] Run focused RED/GREEN, all collaboration unit/service/freeze/ledger/history/reconciliation regressions, and `npx tsc -p collaboration/tsconfig.json --noEmit` with `NODE_OPTIONS=--no-experimental-webstorage`. Confirm live preview still serves unchanged build. Self-review and report; no commit.

### Task 3: Actual PostgreSQL and WebSocket canonical restart proof

**Files:** Create `platform/tests/fixtures/drawing-collaboration-canonical-initialization.mjs`; modify the existing `platform/tests/drawing-workspace-m1-real-database.test.mjs` only to import and invoke the proof after canonical SQL proof, passing `owner`, `targetUrl`, `ids`, and `createDocument`. Preserve Task 1 changes using its accepted file as Task 3 baseline.

**Interfaces:** Export `proveCanonicalCollaborationSocketInitialization({ owner, targetUrl, ids, createDocument })`. Consume production `createPostgresDrawingCollaborationDatabase(targetUrl)`, `createDrawingCollaborationStorage({database, validateState:validatePersistedDrawingState})`, and `createDrawingCollaborationServer`. Use real database.authorize; only the JWT verifier is an explicit local fixture mapping two fixed opaque test tokens to the seeded editor/viewer IDs. This gate proves actual SQL+server+socket behavior, not real Supabase Auth or browser IndexedDB.

- [ ] Write a proof that creates a fresh empty document through the existing authenticated creation RPC, starts the actual server on port 0, and connects an empty Viewer Y.Doc through HocuspocusProvider with the allowed Origin. On first sync, query the private collaboration row through the owned test admin and assert:
  ```js
  assert.equal(Number(row.store_generation), 1);
  assert.equal(row.yjs_sha256, createHash('sha256').update(row.yjs_state).digest('hex'));
  assert.deepEqual(Y.encodeStateAsUpdate(viewerDoc), normalize(row.yjs_state));
  assert.equal(viewerDoc.getArray('operationOrder').length, 0);
  ```
  Normalize by applying bytes to a temporary Y.Doc and encoding, destroying it in finally. Empty collections may need the existing ensure-by-get accessors; no protected data mutation.
- [ ] Stop the first provider/runtime, retain cached winner bytes, create fresh production database/storage/server instances, and connect an Editor doc restored from exactly those cached bytes. Verify sync succeeds, operation history remains empty, canonical bytes and generation/hash remain unchanged before any editor operation. Assert actual database authorization denies Viewer ordinary edits and the production protected-state validator rejects a forged metadata update cloned from the winner. Use the validator's real scope/actor/context parameters from source. Ensure ordinary stores were not required for first initialization.
- [ ] Capture a meaningful RED by running the integration proof against exact pre-Task-2 server/storage in an owned copy or by an explicit in-memory adapter boundary fault that removes initialization support without altering source. Prefer the former only if it avoids duplicate dependencies; never temporarily overwrite current production files. Then run GREEN against accepted Task 2. This Task 3 test also serves integration verification; do not claim separate feature code was TDD-built here.
- [ ] Invoke the existing owned UTF-8 local PostgreSQL runner, which applies all migrations and requires the M1 test. Use bounded event-based sync timeouts, no readiness sleep loops. Cleanup provider documents, runtime SQL connections and owned server in finally, including failure paths. No remote data or live preview build.
- [ ] Report precise RED/GREEN commands and results, actual first-state hash/generation and reload equality proof, deliberate JWT fixture limitation, file delta and cleanup. No commits.

## Integration acceptance

Controller reviews each exact dirty delta, resolves findings, and requests final integration review. Publish evidence and update the continuation map with accepted scope and remaining R2/R4/R5 requirements. Do not mark the whole active goal complete from these tests.
