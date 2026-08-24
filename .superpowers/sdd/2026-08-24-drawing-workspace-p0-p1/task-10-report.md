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
