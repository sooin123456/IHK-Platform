# Task 10 report — IndexedDB outbox, autosave, conflict state, and reload recovery

## Outcome

- Added a native IndexedDB outbox using database `1hk-drawing-workspace`, object store `operations`, primary key `clientOperationId`, and the required compound revision/created-at and status indexes.
- Persisted only the canonical validated `DrawingOperationInput`; local command history metadata, signed URLs, and authentication material are not stored.
- Added durable enqueue-before-send, per-revision ordering, exact acknowledgement deletion, idempotent acknowledgement, conflict/rejection isolation, a concurrent-flush mutex, and bounded 1/2/4/8/15-second retry scheduling.
- Added atomic base-version reload recovery. A stale operation or an already blocked revision remains in the outbox and is shown as a conflict instead of being discarded or partially replayed.
- Wired the workspace command, undo, and redo paths to autosave. Editing remains disabled until IndexedDB recovery completes, and Viewer/Reviewer capabilities cannot enter the persistence path.
- Replaced the placeholder local-change label with exactly `저장됨`, `저장 중`, `오프라인 저장`, or `충돌 검토 필요`; IndexedDB failure also renders a separate visible `로컬 저장 실패` alert.
- Extended the existing action success response with the server-parsed `clientOperationId` while preserving the existing RPC result, so outbox deletion depends on an exact server acknowledgement.

## Strict TDD evidence

1. Initial outbox RED:

   `cd platform && node --test tests/drawing-workspace-outbox.test.mjs`

   Failed with `ERR_MODULE_NOT_FOUND` for `drawing-outbox.client.ts`.

2. Core outbox GREEN:

   `cd platform && node --test tests/drawing-workspace-outbox.test.mjs`

   Passed 7/7 initial tests, then 8/8 after adding the transport boundary.

3. Exact server acknowledgement RED/GREEN:

   `cd platform && node --test --test-name-pattern='apply action echoes' tests/drawing-workspace-server.test.mjs`

   RED showed the missing `clientOperationId`; GREEN passed 1/1 after the server echoed the already parsed operation ID.

4. Workspace wiring RED/GREEN:

   `cd platform && node --test --test-name-pattern='durable outbox recovery' tests/drawing-workspace-route.test.mjs`

   RED showed the missing outbox wiring; GREEN passed 1/1 after autosave, recovery, status, and readiness gating were connected.

5. Boundary regressions found during self-review:

   - Nested renderer-shaped operation data was accepted by the prior shallow schema. The focused RED failed with `Missing expected rejection`; after shared nested schema validation it passed 1/1.
   - Multi-object reload recovery partially changed the first object before a later item conflicted. The RED observed `Partially changed`; after per-operation candidate-state commit it passed.
   - Pending `add_layer` recovery falsely conflicted because its creation version is represented in `baseVersions`. The RED observed a missing recovered layer; the special creation-version check then passed.
   - A revision with a retained conflict could replay later independent pending work. The RED failed during entry parsing; entry-aware blocked-revision recovery then passed.

6. Focused integration GREEN:

   `cd platform && node --test tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-commands.test.mjs && npm run typecheck`

   Passed 98/98 tests and TypeScript checking.

7. Full verification GREEN:

   - `cd platform && node --test tests/*.test.mjs` — passed 279/279.
   - `cd platform && npm run typecheck` — passed.
   - `cd platform && npm run build` — passed client and SSR production builds.
   - `cd platform && git diff --check` — passed.

   The build retained only the known chunk-size, React Router future-flag, and unsigned theme-cookie warnings recorded at baseline.

## Changed files

- `platform/app/lukas/lib/drawing-outbox.client.ts`
- `platform/app/lukas/components/drawing-workspace.client.tsx`
- `platform/app/lukas/lib/drawing-workspace.types.ts`
- `platform/app/lukas/lib/drawing-workspace.server.ts`
- `platform/tests/drawing-workspace-outbox.test.mjs`
- `platform/tests/drawing-workspace-route.test.mjs`
- `platform/tests/drawing-workspace-server.test.mjs`

## Deliberate limits

- No Dexie, Zustand, Yjs, y-indexeddb, collaboration server, or other dependency was added. P3 can replace the persistence/collaboration adapter while retaining the canonical operation contract.
- Unit tests exercise the real outbox against a small in-memory persistence adapter and the real transport/recovery logic. The native browser IndexedDB implementation is typechecked and production-built; browser-level IndexedDB/reload coverage remains part of the Task 12 E2E gate.
- Recovery intentionally does not rebuild actor-scoped undo/redo history because canonical durable operations do not contain local actor/history metadata. It restores the visible document state without inventing authority or history fields.

## Fix round 1 — scoped durability and reload lifecycle

### Findings addressed

- Bound every outbox instance to the authenticated local owner and current revision. Shared-browser entries belonging to another user or revision remain quarantined and are never sent through the current route.
- Added adapter-assigned monotonic `enqueueSequence` persistence. Flush order no longer depends on timestamps or UUIDs, and an active flush drains newly enqueued work before completing.
- Added a same-realm owner/revision coordinator so remounts and React StrictMode instances cannot double-send. `dispose()` cancels retry timers and prevents cleaned-up instances from initiating later sends. Cross-tab duplicates still rely on the existing authoritative idempotency contract, as ruled.
- Changed reload recovery to attempt an online idempotent resend first. Offline recovery overlays only exact-base work; stale or possibly already committed work remains pending and is reported as ambiguous rather than falsely conflicted.
- Classified `kind: "rpc"` action failures as retryable transport failures while keeping conflicts and other 4xx validation/permission failures terminal.
- Changed the primary storage-failure label to `저장 중`, retained the explicit alert, and added a visible `다시 시도` action backed by the unchanged durable enqueue path.
- Reused one fail-closed capability helper in command, undo, redo, and persistence paths. The server action and database remain authoritative.
- Upgraded the native IndexedDB schema to version 2 with an `enqueue_sequence` index and an atomic readwrite enqueue transaction. No state, IndexedDB, or collaboration dependency was added.

### Strict TDD evidence

1. Reviewer regression RED:

   `cd platform && node --test --import tsx --test-name-pattern='scope|sequence|active flush|same-realm|dispose|storage failure|transient RPC' tests/drawing-workspace-outbox.test.mjs`

   Failed 8/8 for the intended missing behaviors: foreign revision acceptance, owner leakage, UUID ordering, incomplete active drain, duplicate same-realm send, missing disposal, false `오프라인 저장`, and terminal treatment of transient RPC failures.

2. Reload/capability RED:

   `cd platform && node --test --import tsx tests/drawing-workspace-outbox.test.mjs`

   Failed at module loading because `restoreDrawingWorkspaceState` and `canPersistDrawingMutation` did not exist. The new tests cover response-lost/server-committed online reload, offline ambiguous retention, and fail-closed local capability.

3. Focused GREEN:

   `cd platform && node --test --import tsx tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs`

   Passed 111/111 after updating the workspace lifecycle seam and the route integration assertion.

4. Final gates:

   - `cd platform && node --test --import tsx tests/*.test.mjs` — passed 289/289.
   - `cd platform && npm run typecheck` — passed.
   - `cd platform && npm run build` — passed client and SSR production builds.
   - `cd platform && git diff --check` — passed.

   Build output retained only the baseline large-chunk, React Router future-flag, and unsigned theme-cookie warnings.

### Fix-round changed files

- `platform/app/lukas/lib/drawing-outbox.client.ts`
- `platform/app/lukas/components/drawing-workspace.client.tsx`
- `platform/tests/drawing-workspace-outbox.test.mjs`
- `platform/tests/drawing-workspace-route.test.mjs`
- `.superpowers/sdd/2026-08-24-drawing-workspace-p0-p1/task-10-report.md`

## Fix round 2 — volatile zero-loss window and upgrade takeover

### Findings addressed

- Replaced the single failed-command reference with a minimal ordered volatile persistence queue. Capture is synchronous, durable enqueue attempts are serialized, rapid commands cannot complete out of order, and the full remaining queue retries in causal order.
- A durable storage failure immediately makes the persistence capability fail closed. Command, undo, redo, canvas, layer, and inspector mutation paths remain disabled until every volatile operation is durable. The existing non-saved label and alert now retry the complete queue.
- Added native `beforeunload` protection plus React Router navigation blocking whenever volatile work exists.
- Online uncertain-ack recovery now snapshots the pre-send queue, identifies exact acknowledged removals, deterministically replays those operations over the captured loader snapshot, and only then overlays remaining pending work. Realized versions therefore remain current for the next command.
- A replacement same-realm instance now takes over whether an inherited active flush fulfills or rejects; a disposed predecessor cannot strand its pending operation or suppress the replacement retry schedule.
- IndexedDB open now rejects visibly on `onblocked`, closes every successful connection on `onversionchange`, closes late-success connections after a blocked rejection, and keeps the existing object store during v1→v2 index installation.

### Strict TDD evidence

1. Outbox/controller RED:

   `cd platform && node --test --import tsx tests/drawing-workspace-outbox.test.mjs`

   Failed at module loading because the requested volatile queue seam did not exist. The new behavioral probes cover two rapid failed captures and ordered retry, fail-closed capability, disposed-A/rejected-flush B takeover, acknowledged snapshot replay with a version-correct next edit, v1 record preservation, version-change close, blocked rejection, and late-success close.

2. Client integration RED:

   `cd platform && node --test --import tsx --test-name-pattern='durable outbox recovery' tests/drawing-workspace-route.test.mjs`

   Failed because the workspace had no volatile queue, navigation blocker, or `beforeunload` integration.

3. Focused GREEN:

   `cd platform && node --test --import tsx tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs`

   Passed 117/117.

4. Final gates:

   - `cd platform && node --test --import tsx tests/*.test.mjs` — passed 294/294.
   - `cd platform && npm run typecheck` — passed after correcting the client-only type import found by the first full typecheck.
   - `cd platform && npm run build` — passed client and SSR production builds.
   - `cd platform && git diff --check` — passed.

   Build output retained only the baseline large-chunk, React Router future-flag, and unsigned theme-cookie warnings.

### Known limit

- The volatile queue prevents loss while the current browser page remains alive and warns before navigation. If IndexedDB is completely unavailable and the browser process, tab, device, or OS crashes before retry succeeds, volatile memory cannot survive that crash. Removing this limit requires a second durable browser/native storage channel; adding one is outside the approved native minimal P0/P1 scope.

## Fix round 3 — legacy attribution and deterministic acknowledgement recovery

### Findings addressed

- Treats real version-1 ownerless records as quarantined legacy work. They remain visible for the current revision but are never sent, deleted, or silently attributed during ordinary startup.
- Adds an explicit, confirmed recovery action for Editor/Admin capabilities. Claiming atomically assigns the authenticated local owner and new monotonic enqueue sequences; the UI explains that the current authenticated claimant becomes the recovery/audit owner. Viewer and Reviewer capabilities cannot claim.
- Reconstructs acknowledged chains one operation at a time. An operation already represented by the loader snapshot is skipped only when its realized version and relevant effect match; the next exact-base acknowledged operation is then replayed. True ambiguity restores durable conflicted evidence instead of returning stale UI after deleting the queue.
- Invalidates the cached IndexedDB handle on `versionchange`, allowing the same adapter to reopen cleanly on its next operation.
- Propagates an `AbortSignal` through the outbox transport. Disposing an obsolete instance aborts a hung fetch so a replacement same-realm instance can acquire the coordinator and drain the pending entry.
- Derives `저장 중` whenever the volatile queue is non-empty, including the interval before a hung durable enqueue has failed.

### Strict TDD evidence

1. Legacy/recovery RED:

   `cd platform && node --test --import tsx tests/drawing-workspace-outbox.test.mjs`

   Failed during module loading because `claimLegacyDrawingOperations` did not exist. The added behavioral tests use the actual v1 ownerless record shape and cover quarantine, capability/confirmation gates, current-owner attribution, monotonic sequencing, mixed acknowledged replay, ambiguity evidence retention, abort takeover, cached-handle reopen, transport cancellation, and the volatile save label.

2. Client integration RED:

   `cd platform && node --test --import tsx tests/drawing-workspace-route.test.mjs`

   Failed because the workspace lifecycle had no legacy-entry query, visible quarantine notice, confirmed claim action, or abort-aware transport wiring.

3. Focused GREEN:

   `cd platform && node --test --import tsx tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs`

   Passed 123/123.

4. Full gates:

   - `cd platform && node --test --import tsx tests/*.test.mjs` — passed 300/300.
   - `cd platform && npm run typecheck` — passed.
   - `cd platform && npm run build` — passed client and SSR production builds.
   - `git diff --check` — passed.

   Build output retained only the existing large-chunk, React Router future-flag, and unsigned theme-cookie warnings. Native IndexedDB lifecycle and v1 migration behavior are covered by the existing deterministic fake-IDB browser-contract seam; no IndexedDB, state, or collaboration dependency was added.

### Audit and recovery boundary

- Legacy attribution is local privacy/audit metadata and does not replace server authorization. Every claimed operation still passes through the canonical server action, authenticated capability checks, revision checks, version checks, and idempotency contract.
- Delete acknowledgement recognition is conservative: absence is accepted only for an acknowledged delete carrying the target's base-version contract. Any other mismatched acknowledged state is retained visibly as conflicted recovery evidence.
