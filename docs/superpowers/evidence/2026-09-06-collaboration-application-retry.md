# Collaboration application admission recovery — verified bounded unit

The Universal Workspace goal remains active. This unit connects the already-accepted canonical initialization server behavior to the existing application connection wrapper. It does not complete R2, R4, or R5.

## Implemented

- `connected` now means an authenticated initial Yjs sync, not merely an open WebSocket. The returned connection phase reflects its current state.
- Only the explicit authentication refusal `drawing-reconciling` schedules automatic admission recovery. Reauthentication **and** `startSync()` reuse the same provider and caller-owned Y.Doc. Delays grow from 1 to 2, 4, 8, then at most 10 seconds; long leases do not exhaust a finite recovery window.
- Other authentication failures and known authorization/review CLOSE reasons stop automatic retry, including the existing visibility/online token-refresh callback. The status gives rights/login/drawing-state guidance.
- Ordinary transport disconnection remains recoverable by Hocuspocus. Document-only CLOSE also invalidates the connected badge; unknown close reasons degrade the connection without pretending to be a permission decision.
- Duplicate refresh calls share the pending handshake. Disposal cancels scheduled recovery, suppresses late phase callbacks, and leaves the caller-owned document intact. No IndexedDB/outbox clearing, new dependency, server guard change, or database migration.
- Presence has accessible, distinct retry/denied guidance. “Local work retained” is not a claim that every operation is already committed by the server.

## Verification

All commands ran in `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform` with `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Result |
| --- | --- |
| Seven actual-provider/socket tests against the exact pre-task client source | 0 passed, 7 failed for the targeted missing behavior |
| Focused provider/socket + rendered presence | 8/8 passed |
| Collaboration/service/protocol/freeze/native/client/policy/initialization regression | 166/166 passed, no skipped/cancelled tests |
| Existing legacy collaboration suite through installed Vite SSR alias | 17/17 passed |
| Application `npx tsc --noEmit` | exit 0 |
| Collaboration `npx tsc -p collaboration/tsconfig.json --noEmit` | exit 0 |

The **183 distinct final tests** include the focused eight; do not add them a second time. The new production-server integration holds an actual preparation lease in the storage seam, observes no premature connected phase or admitted room, releases the lease, and proves automatic recovery with the identical durable winner, exactly one initialization, and zero ordinary stores. Storage is an in-memory controlled seam in this integration; real PostgreSQL, Auth/JWKS, IndexedDB and the complete browser story were **not rerun in this unit**.

Raw logs and the exact before-copy delta are in [the artifact directory](2026-09-06-collaboration-application-retry/). The final regression has three expected negative-fixture `onLoadDocument` diagnostics: two nondurable-admission refusals and one absent-initializer refusal. No blanket log allowlist was added. A first SSR-test run raced Vite dependency scanning during teardown; the SSR-only fixture now disables client dependency discovery, and the fresh final run no longer has that diagnostic.

The initial CLOSE handler incorrectly treated any still-open socket as permission denial. The real transport-drop regression caught that error. Installed Hocuspocus forwards the close callback before its internal socket-status update and also delivers document-only CLOSE frames with code 1000. The final handler uses explicit authorization code/reason checks instead; ordinary network reconnect passes. The initial test using `server.closeConnections()` was corrected because that method sends a logical document CLOSE rather than dropping the socket.

## Independent review and preservation

`admission_client_trace` inspected callers and lifecycle ownership read-only. `admission_retry_review` reviewed exact before-copy deltas and installed provider/server lifecycle code, not the huge pre-existing HEAD diff. Final review found no remaining Critical/Important issue in this bounded unit, conditional on the fresh focused/full checks above, which passed. Optional coverage remains for the literal 10-second cap and delay reset after a later recovery; the real socket tests exercise the first two retry intervals.

HEAD remains `9f5f56d93db325ff935772252f9d4fb64d69f98c`; index SHA-256 remains `ab8778babeb2aa04f070a609cbd1240760b3158cb5aa1e6ced3da34bb9a9f84c`. Prior canonical production files are unchanged; its initialization test only gains the automatic application-recovery case. No staging, commit, merge, push, deployment, paid resource or remote customer mutation. Live preview port 4173/PID 80284 remains the existing build and returned HTTP 200; it has **not** been rebuilt to show this code.

## Next required work

1. Scope displayed connection status to the workspace lifecycle: on a same-component actor/project/revision change, the existing React phase can still show the prior connection while the next local draft/checkpoint initializes. `drawing-workspace.tsx` effect at approximately line 3040 does not reset it; the current preview lifecycle fixture immediately reports success and cannot expose that gap. Add a deferred replacement-connection browser assertion rather than a source-text assertion.
2. Preserve local work through live-room freeze transitions and legacy divergent cache recovery; finish actual logout/full geometry+binding restore and independently calculated two-client offline geometry checks. This unit verifies pending Y.Doc updates over real sockets, not the entire offline persistence story.
3. Implement the existing prepared R4 immutable native-resave jobs, cancellation, artifact publication/download and actual authenticated import/edit/approve/resave handoff. Complete R5 exact-approved-revision package and independent CAD/content-rights qualification. Keep those unimplemented/externally unqualified parts explicit.

For the complete remaining scope, use the [continuation map](2026-09-06-universal-workspace-continuation-map.md). Do not reimplement this accepted client-retry unit or clear user drafts to make later tests pass.
