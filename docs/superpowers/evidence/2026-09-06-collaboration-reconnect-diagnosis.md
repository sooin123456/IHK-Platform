# Collaboration diagnosis: M1 authenticated runtime attempt 3

## Scope and verdict

This diagnosis used only the retained public runtime report/log plus current collaboration, client, test-helper, and SQL source. It did not rerun M1, start services, connect to the database, or modify application/test code.

| Signal | Classification | Confidence |
| --- | --- | --- |
| Nine `Clients cannot rewrite protected collaboration state.` closures (six in scenario 23) | **Real collaboration protocol defect / false-positive guard activation on an honest reconnect path.** The guard itself is a valid security boundary, but current bootstrap, unload, and whole-document client persistence make a previously server-authored update look client-authored after the server document is rebuilt. The green suite does not establish harmlessness. | High for the mechanism; exact actor/update bytes for each retained closure are absent from the log. |
| Scenario-23 `P3A01` from `beforeHandleAwareness` | **Strong source-level explanation: expected live-authorization denial during the scenario's explicit Viewer membership-removal window.** The existence and ordering of that revocation are confirmed; exact actor correlation is not fully proven because the retained server log has no user id. It is not approval-state fallout or generic runner cleanup. | High for the causal source sequence; actor attribution is not log-correlated. |
| Editor React Router `.data` `net::ERR_ABORTED` | **Most likely a superseded loader revalidation/navigation, not evidence of an HTTP/server failure, but still unclassified in the retained evidence.** Scenario 23 omits the editor `requestFailures` assertion, so the pass does not prove this cancellation was intended. | Medium/low for the exact trigger. |

## Exact scenario-23 trace

Scenario 23 starts at `e2e/drawing-workspace-m1-estimator.spec.ts:9261`. Its editor context clones four examples in a fixed order (`measured-plan`, `office-layout`, `remodel-phases`, `finishes-takeoff`) at lines 9280-9285. For every clone it enters the new workspace and then explicitly reloads it at lines 9349-9480, including `page.reload()` at line 9459. It later opens the measured-plan workspace in a Viewer context (9496-9502), navigates the editor back to it (9512-9515), reloads the editor after the live symbol arrives (9723), submits review and approval (9790-9860), and reloads the editor again after approval (9892).

The retained log starts scenario 23 at line 5847. Its six protected-state closures are, in order:

1. revision `7957f335-980d-4ff3-88fe-957e14f6e8f6` (5850);
2. revision `53e9b4e3-d0e0-4823-a7ff-a87a50de8ad4` (5861);
3. revision `b9b1cdbd-b89a-491f-a039-131fa7f654a4` (5869);
4. revision `c3c0f87b-4036-498b-a593-9b4957b703be` (5881);
5. the first revision again (5891);
6. the first revision again (5901).

That shape matches the test's four newly created rooms followed by repeated measured-plan navigation/reload. The log does not contain a user id, sync message type, state-vector hash, or protected-key diff, so the exact actor for the last two updates cannot be proven from the retained bytes. There is no deliberate WebSocket protected-state forgery in this scenario: the Viewer write counterexamples are HTTP/form/API denials, while the normal browser provider is the source of the logged `beforeSync` messages.

After the approval/export flow, scenario 23 calls `proveNativeDrawingDwgExport(...)` at lines 10100-10112. That helper creates a Viewer page for the same measured-plan room (`e2e/utils/drawing-native-dwg-export-evidence.ts:311-317`), explicitly removes `fixture.viewer` from the project (349-362), checks that the revoked Viewer cannot download (363-366), closes the still-connected Viewer page **before** restoring membership (367-379), and only then restores the Viewer role. Thus the runtime report's statement that scenario 23 contains no role revocation is incorrect.

The page close is expected to emit Awareness teardown/removal. The client lifecycle explicitly clears Awareness before destroying the provider (`app/lukas/components/drawing-workspace.tsx:3647-3658`; `app/lukas/lib/drawing-awareness.ts:150-168, 241-247`). The server reauthorizes before processing every Awareness message, including an empty removal (`collaboration/src/server.ts:827-851`). The log identifies `beforeHandleAwareness` and the same measured-plan room at lines 5908-5910. This source sequence strongly explains the error as the removed Viewer's teardown hitting the intended live-revocation fence. The retained log does not include the authenticated user id, however, so it cannot independently prove that the failing socket belonged to `fixture.viewer`; that linkage should remain an evidence-backed source attribution rather than an actor-correlated log fact.

The SQL proves approval cannot produce this `P3A01`. `private.lukas_drawing_collaboration_authorize_pre_entitlement` raises `P3A01` only when the revision/project row is absent/mismatched or the user's project capability is null (`supabase/migrations/20260825192113_drawing_workspace_p3_collaboration_state.sql:67-80`). Revision status only controls the returned `can_write` boolean (81-82). The entitlement wrapper would instead raise `P7A07`; the retained stack explicitly reaches the pre-entitlement function (`m1-authenticated-runtime-attempt-3.log:5925-5931`). Given the confirmed remove-close-restore sequence, the removed Viewer's null-capability branch is the strong source-level explanation, but the log alone does not identify that actor.

## Root cause of the protected-state closures

The false-positive path is a composition of four individually visible behaviors:

1. **The browser persists and synchronizes the entire Y.Doc, including server-owned roots.** `openDrawingYjsPersistence` binds `IndexeddbPersistence` directly to the whole document (`app/lukas/lib/drawing-yjs-persistence.client.ts:41-69`) and flushes its full state (93-100). The provider then uses that same document (`app/lukas/lib/drawing-collaboration-client.ts:256-307`). The shared roots include `serverMeta` and `operationStatus` (196-224).
2. **A first load can bootstrap server-owned structures without scheduling persistence.** The app initializes an empty collaboration room in `onLoadDocument` (`collaboration/src/server.ts:1038-1057`); `initializeDrawingCollaborationDocument` writes `serverMeta` and statuses with the server origin (`server.ts:256-325`). Hocuspocus 4.6.0 installs its document `onUpdate`/store listener only *after* `onLoadDocument` returns (`node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js:1446-1490`). Therefore those bootstrap writes do not call `storeDocumentHooks`.
3. **`unloadImmediately: false` does not keep an idle, never-dirtied room resident.** The application sets it false (`collaboration/src/server.ts:973-980`), but Hocuspocus unloads immediately on the last connection when no store debounce is pending (`hocuspocus-server.esm.js:1375-1387`). A pending store eventually unloads too (1535-1553), and unload destroys/removes the Y.Doc (1571-1595). A newly bootstrapped room with no later accepted document write can therefore disappear without its original CRDT identities being stored.
4. **The next bootstrap has the same logical values but new Yjs identities, and the guard rejects any protected-map event before comparing semantics.** `validateDrawingClientUpdate` clones the current server document, observes `serverMeta` and `operationStatus`, applies the client update, and throws immediately if either observer fires (`collaboration/src/server.ts:333-388`). A reconnecting browser legitimately has the prior server bootstrap in IndexedDB. Its state-vector diff against the newly bootstrapped Y.Doc contains the old server-authored structs. Merging them fires the protected observers even when the JSON values are identical.

A permitted in-memory Yjs diagnostic reproduced the decisive property without files, services, or a database: create one document with logical `serverMeta.freezeState = active` and `operationStatus.op-1 = applied`, encode it as the browser's persisted state, independently create a second document with the same values, compute the prior document's update against the second document's state vector, and apply it. The 76-byte replay fired one `serverMeta` event and one `operationStatus` event while both resulting JSON values remained identical. That is precisely the condition rejected at `server.ts:381-382`.

Exact command already run from `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform`:

```sh
node -e 'const Y=require("yjs"); const seed=d=>{d.getMap("serverMeta").set("freezeState","active"); d.getMap("operationStatus").set("op-1","applied")}; const prior=new Y.Doc(); seed(prior); const persisted=Y.encodeStateAsUpdate(prior); const server=new Y.Doc(); seed(server); let meta=0,status=0; server.getMap("serverMeta").observe(()=>meta++); server.getMap("operationStatus").observe(()=>status++); const replay=Y.encodeStateAsUpdate(prior,Y.encodeStateVector(server)); Y.applyUpdate(server,replay); console.log(JSON.stringify({priorClientId:prior.clientID,rebuiltClientId:server.clientID,replayBytes:replay.byteLength,metaEvents:meta,statusEvents:status,logicalMeta:server.getMap("serverMeta").toJSON(),logicalStatus:server.getMap("operationStatus").toJSON()})); prior.destroy(); server.destroy();'
```

Exact observed output:

```text
{"priorClientId":1268127458,"rebuiltClientId":1152467073,"replayBytes":76,"metaEvents":1,"statusEvents":1,"logicalMeta":{"freezeState":"active"},"logicalStatus":{"op-1":"applied"}}
(node:7073) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
```

This mechanism also explains why the same guard appears three times earlier in the suite (runtime log 5798-5828): it is tied to fresh room bootstrap/reopen behavior, not to native DWG authorization or approval specifically.

### Why 23 passing scenarios do not make this harmless

- Scenario 23 asserts the Viewer's collaboration status once before review/approval (9780-9786), but does not assert the editor's provider remains connected after each clone/reload or after approval.
- Connection creation failures are caught and reduced to a `degraded` UI phase (`app/lukas/components/drawing-workspace.tsx:3380-3439`), while much of the scenario's durable work is performed through HTTP and direct database assertions. The scenario can therefore finish after a socket was rejected.
- The final assertions check the editor's page, console, and HTTP response errors, but omit its `requestFailures`; only Viewer/Reviewer/Approver request failures are asserted (`e2e/drawing-workspace-m1-estimator.spec.ts:10113-10125`).
- No assertion consumes server-side protected-state rejection counts or correlates a close to its actor/message. A green browser result cannot distinguish a correctly denied forged update from an honest client being disconnected and later recovering.

## Editor `.data` abort

The retained report records one editor `GET ...workspaces/<measured-document>.data net::ERR_ABORTED`, with no editor page/console/HTTP-response error and empty evidence arrays for the other contexts. The evidence collector records only method, URL, and Playwright error text (`e2e/drawing-workspace-m1-estimator.spec.ts:64-99`), so it retained no timestamp, resource type, navigation flag, frame URL, redirect chain, or test phase.

The strongest source-level hypothesis is a route revalidation superseded by one of the explicit editor reloads, especially the reload immediately after approval at line 9892: drawing realtime invalidations call React Router `revalidate()` (`app/lukas/lib/drawing-workspace-realtime.ts:188-215`), and the test does not wait for Router idle before reloading. Scenario 23 also invokes explicit revalidation after native-symbol import (`drawing-workspace.tsx:5551-5565`). Elsewhere this same suite explicitly permits at most one exact `.data ... net::ERR_ABORTED` as a Router data cancellation (`drawing-workspace-m1-estimator.spec.ts:3133-3145`), so the failure class can be benign. The retained record is insufficient to tie this instance to a specific reload, however, and scenario 23 accidentally omits the editor request-failure assertion. It should not be globally allowlisted based on the green result alone.

## Smallest next instrumentation and regression step

1. Add a focused collaboration regression that reproduces the bootstrap boundary without a live service: initialize room A, give its encoded state to a client document, discard room A without storing it, initialize logically identical room B, generate the client's state-vector diff against room B, and pass it through `validateDrawingClientUpdate`. The current test should demonstrate the false-positive throw. The corrected protocol must accept that exact honest replay while still rejecting a client update that changes `freezeState`, `freezeRequestId`, or an `operationStatus` value. Do **not** simply suppress the guard when JSON is equal: hidden competing Yjs structs can later become visible after deletes/merges.
2. Add test-only structured diagnostics around `beforeSync` rejection: room, authenticated user id/capability, sync type, payload length, socket id, hashes of current state vector and incoming update, which protected roots observed events, and semantic before/after hashes. Do not log tokens or raw document content. In scenario 23, phase-tag clone/reload boundaries and assert zero protected-state rejections for ordinary reconnects.
3. Make the expected P3A01 explicit in `proveNativeDrawingDwgExport`: phase-tag `[viewer-member-removed, viewer-member-restored]`, capture the collaboration close/hook diagnostic, and assert exactly one unavailable authorization for `fixture.viewer` in the measured room during that window. This converts legitimate security enforcement from noisy error output into a checked counterexample.
4. Extend browser request-failure evidence with monotonic time, current test phase, `resourceType()`, `isNavigationRequest()`, frame URL, and redirect ancestry. Around each explicit `page.reload()`, record a narrow cancellation window and assert either zero failures or exactly the known `.data` navigation cancellation inside that window. Also add the missing editor `requestFailures` assertion. This will separate an expected superseded loader from a spontaneous transport failure before any allowlist is added.

The durable protocol fix should preserve the CRDT provenance of server bootstrap state (for example, persist bootstrap state before admitting/synchronizing the first client) or stop putting server-owned roots in a whole-document client persistence/sync channel. The regression above should be written before selecting between those designs.

## Controller addendum — actual production initializer and guard

The controller subsequently ran a stronger, read-only in-memory diagnostic against the actual `initializeDrawingCollaborationDocument` and `validateDrawingClientUpdate` exports from `platform/collaboration/src/server.ts`, using the installed Yjs implementation. It did not start a service, contact a database/storage endpoint, or change production/test files.

Exact command from the authoritative checkout:

```sh
NODE_OPTIONS=--no-experimental-webstorage node .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/diagnose-bootstrap-replay.mjs
```

The script used valid literal project/revision/user UUIDs and a bootstrap callback returning a fixed 64-character SHA and `operationSequence: 0`. It initialized the first server Y.Doc with client ID `1001`, encoded that state into an honest client, then independently initialized a second server Y.Doc with client ID `2002`. It asserted identical logical `serverMeta` values and passed the honest client's state-vector diff to the production guard. That call threw the exact protected-state error. Two controls restored the original encoded server state: the honest diff was then accepted, while a client changing `freezeState` to `released` was still rejected. All documents were destroyed in `finally`.

Exact observed output (exit 0):

```json
{
  "productionInitializerAndGuard": true,
  "logicalBootstrapEqual": true,
  "honestReplayBytes": 363,
  "honestReplayRejected": true,
  "durableIdentityRestoreAccepted": true,
  "forgedProtectedUpdateRejected": true,
  "scope": "in-memory reproduction, not attribution of every prior runtime closure"
}
```

This closes the gap between the earlier pure-Yjs mechanism and the current application guard. It does **not** establish a concurrency-safe persistence fix, authenticated browser acceptance, or actor-level attribution of all historical closures. Bootstrap provenance persistence and its multi-load/multi-process races remain implementation and regression work; security enforcement must remain intact.
