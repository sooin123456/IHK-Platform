# Task4 brief — product wiring and executable imported-DWG worker

Read this first. Implement only after controller dispatch following Task3 review. Do not read the whole plan/history. Binding design: docs/superpowers/specs/2026-09-06-native-dwg-resave-publication-design.md sections Authenticated HTTP/UI/worker and Verification. Read sibling task-4-preflight.md for exact existing symbols/tests and the actual Node startup RED; it is a compact source map, not extra feature scope.

## Worktree / constraints

- Exact existing-file baselines are already saved in sibling task-4-baselines.md and baseline/task-4-*. They cover all eight planned existing files, including the large workspace component, with independently verified hashes. Recheck those hashes before editing; if an intervening change exists, alert controller rather than overwrite it. New files use /dev/null review baseline.

- Root /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1, app platform. NODE_OPTIONS=--no-experimental-webstorage for Node tests. Existing linked branch codex/universal-workspace-m1, HEAD9f5f56d93db325ff935772252f9d4fb64d69f98c. No stage/commit/merge/push/deploy, new dependency/lockfile changes, paid/license services or remote/customer mutation.
- Preserve dirty changes, accepted source-free behavior and original/source/approved bytes. No private .superpowers/sdd scripts/artifacts, private binaries, original4173 runtime/rebuild or authoritative platform/build/.react-router writes.
- No subagents/reviewers; main reviews exact pre-task delta after your self-review/test report. Apply_patch only. Main synchronizes source to /Users/h/1hk-r2-restore-uvc74K/platform for full build/typecheck. Existing React/browser unit harnesses may create explicitly owned ephemeral loopback servers; clean only their owned resources.
- Skill workflow: TDD and Ponytail/minimal existing-code reuse; read React best-practices and applicable rule files; no new state library. Public exact baselines/brief/report replace private skill scripts, and standing no-commit authority supersedes skill commit prompts. Ask controller about bounded contract ambiguity, not the user for approval.

## Task 4: Product request/status/download and executable worker

**Files:**
- Create platform/app/lukas/lib/drawing-native-dwg-resave-resource.server.ts and drawing-native-dwg-resave-download.server.ts
- Create platform/app/lukas/screens/drawing-native-dwg-resave.ts and drawing-native-dwg-resave-download.ts
- Modify platform/app/routes.ts and platform/app/lukas/lib/drawing-workspace-paths.ts
- Create platform/app/lukas/components/drawing-native-dwg-resave-control.tsx
- Create platform/app/lukas/lib/drawing-native-dwg-resave-contract.ts; narrowly extract/re-export public DTO schemas from drawing-native-dwg-resave-jobs.server.ts and drawing-native-dwg-resave-artifacts.server.ts so UI/server share validation without client imports of server modules. Descriptor/claim/compiler/Node code stays server-only. Preserve all accepted schema behavior and existing server export names.
- Modify platform/app/lukas/components/drawing-export-dialog.tsx and drawing-workspace.tsx narrowly for conditional control/currentUserId.
- Create platform/native-dwg-worker/src/resave.ts
- Modify platform/package.json only to add start:native-dwg-resave-worker matching the existing direct-Node CLI pattern; no dependency/lockfile changes.
- Narrowly replace constructor parameter properties in NativeDrawingDwgResaveJobError and inherited NativeDrawingDwgJobError with explicit readonly fields/assignments, preserving constructors/messages/kinds. Files: drawing-native-dwg-resave-jobs.server.ts and drawing-native-dwg-jobs.server.ts. This is required for the actual Node26 strip-only entry, not a source-free behavior refactor.
- Create matching resource/download/control/entry tests under platform/tests, following existing source-free tests.

**Interfaces:**
- Routes /projects/:projectId/workspaces/:workspaceId/native-dwg-resave and /projects/:projectId/workspaces/:workspaceId/native-dwg-resave/:jobId/download/:kind. Path helpers drawingNativeDwgResavePath(projectId,documentId) and drawingNativeDwgResaveDownloadPath(projectId,documentId,jobId,kind), matching existing route-helper naming.
- GET existing four revision query fields+optional jobId returns {job,receipt}; null idle, receipt only completed. POST strict request/cancel intent from spec with trusted server image.
- Browser-safe contract exports NATIVE_DWG_RESAVE_ARTIFACT_LIMITS, NativeDrawingDwgResaveScopeSchema, NativeDrawingDwgResaveArtifactKindSchema, NativeDrawingDwgResaveArtifactMetadataSchema, NativeDrawingDwgResaveArtifactMetadataArraySchema, NativeDrawingDwgResaveReceiptSchema, NativeDrawingDwgResaveAcceptanceSchema and NativeDrawingDwgResaveStatusSchema. Move accepted Zod shapes/refinements verbatim; server-local aliases preserve old consumers. Frontend {job,receipt} parsing also enforces null receipt unless completed, exact scope/job identity and trusted fixed qualification fields.
- NativeDrawingDwgResaveControl receives exact scope, currentUserId, open and readiness; actor partitions local IDs, never grants authority.
- Export nativeDrawingDwgResaveRouteRequest(args) and nativeDrawingDwgResaveDownloadRouteRequest(args) for route delegates. Resource test boundary is handleNativeDrawingDwgResaveResource({request,projectId,workspaceId,client,headers,loadServiceClient,imageId}); download boundary is handleNativeDrawingDwgResaveDownload({client,headers,jobId,kind,loadServiceClient,projectId,request,scope,workspaceId},runtime?:{downloadMilliseconds?:number}). Existing source-free files are drawing-native-dwg-export.server.ts and drawing-native-dwg-download.server.ts.
- parseNativeDrawingDwgResaveWorkerConfig(env) validates exact spec config; runNativeDrawingDwgResaveWorkerOnce(config,dependencies) claims and invokes Task3; CLI uses existing import RPC/source and Task1 Storage.
- Worker config returns {supabaseUrl,serviceRoleKey,resaverImageId,dockerPath,dockerHost,leaseSeconds,pollMilliseconds}. Worker-once dependencies are {serviceClient,downloadSource,storage,resave?,signal?}, using Task3 existing types; returns {outcome:"idle"} or Task3 outcome. Already-aborted before claim is idle; claim uses the existing5s helper and parseNativeDrawingDwgResaveClaim, never an invented claim adapter. A claim received during shutdown still enters Task3 with the aborted signal for fenced settlement. Unconfirmed/malformed claim returns control_uncertain without fabricated fail/ack. CLI logs only the outcome string, never receipt/claim. An abortable poll wait follows every worker turn, including immediate refusal, to prevent tight retry loops.

- [ ] Write RED resource/download tests: same-origin JSON≤4096; strict route/scope/body; unavailable missing trusted image; no client image/actor/path; null latest and completed receipt only. Download test revokes between read and second descriptor and expects no attachment. Exact example:

```js
const response = await handleNativeDrawingDwgResaveDownload({request, ...dependencies});
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), artifact.sha256);
```

  Use bounded actual loopback stalled/abort-ignoring body tests, secure no-referrer/nosniff headers and generic errors.
- [ ] Implement route adapters and actual bounded authenticated descriptor→Storage/hash→fresh descriptor equality. No raw authority/locator leakage. Keep source-free download contract intact.
- [ ] Extract accepted public schemas only when adding the UI consumer; keep client imports free of .server and Node modules. Run existing artifact/jobs/adapter contract tests to prove behavior unchanged, then use these exact schemas for client JSON parsing.
- [ ] Write and run failing component tests for single conditional imported/source-free control, real-backend/checkpoint/outbox readiness, click request, same requestID retry, status/own-cancel, completion-only four downloads, relogin latest, actor/scope/open generation including A→B→A. No request merely on open. Implement minimal existing-form/style UI with experimental warning and namespaced actor+scope storage. Existing source-free tests remain gates.
- [ ] Entry tests validate config and production dependency wiring, sanitized logs, shutdown cleanup. Implement CLI using immutable cached resaver image config, fixed 900s lease default/180–900 and 1000ms poll default/100–60000. Do not start production worker or deploy.
- Actual entry subprocess tests must run node --experimental-strip-types native-dwg-worker/src/resave.ts, not only Vite SSR. Controller preflight reproduced ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at resave jobs constructor; Node26.5 also rejects the removed --experimental-transform-types option. Convert only the two identified error constructors to erasable syntax and preserve source-free error behavior with covering tests; do not add a transpiler dependency or suppress startup failure.
- [ ] Run focused route/component/entry/source-free tests; owned-copy build/typecheck; React best-practice review after TSX edits. Record exact tests and limitations; review delta, no commit.


## Authoritative earlier APIs

Tasks1–3 are accepted. Task3 publisher final SHA2560983a6c68fe1f9f8d3f9f4ddea376f81a7f323cff7fc745aafaa708c0c4612e3; worker helper filecdcbc6eb52332e12f754e5212921bd212bf1828d4cc90f5fc6f7c4496cde606b. The final shutdown success-path handoff fix has clean scoped review and65tests/full build. Do not alter the publisher/native worker in Task4. Prior deferred pending-poll/readback/first-refusal test-coverage Minor is tracked in progress.md for final unit review; it does not expand your product wiring task.

Read actual signatures before wiring:

- requestNativeDrawingDwgResave(userClient,serviceClient,rawRequest,rawImageId,signal?): rawRequest is six-field scope+requestId (REMOVE HTTP intent); it performs real verified-actor/source/compiler/admission checks. NativeDrawingDwgResaveJobError is generic bounded-kind only.
- getNativeDrawingDwgResaveStatus(client,rawScope,rawJobId,signal?), getLatestNativeDrawingDwgResaveStatus(userClient,rawScope,signal?), cancelNativeDrawingDwgResave(client,rawScope,rawJobId,signal?). Status is NOT acceptance:true or source-free status/receipt shape.
- getNativeDrawingDwgResaveReceipt(userClient,rawScope,jobId,signal?) and getNativeDrawingDwgResaveDownloadDescriptor(userClient,rawScope,jobId,kind,signal?) are in artifact-jobs.server; descriptors remain private. Existing source-free scope/status helper is exported in drawing-native-dwg-export.server.ts; private JSON reader is not exported. Reuse only actual existing APIs.
- Core builder/stage/receipt schemas currently in resave-artifacts.server; Task4 relocates only public schemas to browser-safe contract and preserves existing exports/refinements. Server-only descriptor/claim/compiler/frame code stays server-only. No second handwritten client status/receipt validator.
- Task3 runNativeDrawingDwgResaveToStorage/options plus exported callNativeDrawingDwgResaveAttemptRpc (five-second deadline) control helper compose the CLI. No claim helper exists; call lukas_drawing_claim_native_dwg_resave with p_resaver_image_id and p_lease_seconds through that helper, validate exact returned claim against config image, then invoke Task3.
- createNativeDrawingDwgImportRpcFetch and createNativeDrawingDwgImportSourceTransport in native-dwg-worker/src/import-supabase.ts, plus createNativeDwgResaveStorageTransport in src/supabase.ts, are the actual existing transport building blocks. Do not instantiate the import conversion worker just to download source.

## Product integration details

- New resource handlers use drawingContext and mergeResponseHeaders following existing screens. Load admin client only on authenticated admission POST or authenticated download after descriptor validation; GET status and cancellation must not need admin credentials/image configuration merely to read/cancel an existing job. Missing or malformed pinned image disables NEW admission with a bounded unavailable response, not a conversion claim.
- Browser request intent JSON exactly {intent:"request",...scope,requestId}; cancel {intent:"cancel",...scope,jobId}. No actor, resaver image, locator, edit text or attestation from browser. Same-origin POST, strict streaming4096byte/fatal-UTF8 JSON, strict normalized route/scope/query IDs. No arbitrary echoed errors. Use no-store/nosniff, preserve auth headers.
- GET {job,receipt}: null/null if idle, noncompleted/null otherwise, completed only with validated exact receipt. Download endpoint checks exact managed descriptor, bounded returned bytes/hash, then fresh descriptor equality before attachment. Must actually return by bounded deadline even if an injected GET/body/cancel ignores abort; do not wait forever in finally on such cleanup. Copy chunks before later awaits so returned bytes are the verified bytes. No abandonment of POST is involved in this GET path.
- Pass currentUserId through the existing lazy dialog callsite. Legacy/preview consumers may supply undefined/null; no valid actor means no new imported admission control. Actor partitions local IDs only. Old source-free control and direct DXF-rejection regression remain unchanged. Add actual dialog conditional coverage plus explicit actor callsite coverage, since existing tests alone miss that chain.
- Imported UI only: versioned localStorage namespace native-dwg-resave + normalized actor + exact six-field scope, storing request identity only, with storage read/write exceptions handled. Recover actual latest status on remount/relogin; do not automatically POST merely on opening. Request ID survives uncertain retry and local React transitions. Closing, actor change or scope change fences stale responses; A→B→A needs a fresh generation, not only equality of scope strings.
- Own cancel is offered only when local actor/scope request identity matches latest requestId and status is cancellable; don't infer ownership of another collaborator's latest job. New request identity only after explicit user action on terminal failed/cancelled; no auto-admission based on a lost reply. Four links only after complete strict receipt. Render experimental/unqualified warning; no independent CAD/operational qualification claim.
- New CLI uses process signals to abort execution but awaits Task3 cleanup. Log only fixed event names and outcome string, never the completed receipt/claim/config/error stack. Idle before an already-aborted claim is safe; after a claim was obtained during shutdown, pass it to Task3 for fenced cleanup. Every turn gets the bounded abortable poll wait; no immediate-error busy loop. Actual child-process idle claim/SIGTERM test is required.

## Verification and report

Use independent expected response/identity/sequence assertions and real React events/actual loopback subprocess where listed; label precise transport doubles. RED must fail on a required absent behavior before production code changes. Use existing protocol/compiler/core fixtures, not a second fake approved document shortcut. Keep original source-free and Task1–3 contracts as regressions after public schema extraction/error syntax updates. If a callsite has to be modified beyond listed files, capture exact baseline first and message controller with a concrete reason.

Write full report to docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/task-4-report.md with changed-file hashes, RED/GREEN commands and outputs, self-review findings, React checklist results and unverified actual Auth/Storage/native/browser boundaries. Main separately reviews this exact delta and performs owned-copy build. Return only short DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED status, no commits, one-line tests, concerns and report path. Task5 owns actual full-stack native/Storage acceptance and deployment guidance; do not start it or deploy.
