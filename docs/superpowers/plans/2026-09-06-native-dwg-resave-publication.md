# Imported DWG Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Publish an approved imported-DWG edit as four immutable, verified files and expose authenticated request, status, cancel and download in the existing DWG dialog.

**Architecture:** Extend the accepted imported-DWG job/attempt lifecycle, not the source-free exporter. Share its bounded Storage transport with two fixed profiles; use durable upload fencing, exact-attempt publication and fresh download authorization. Preserve the accepted native runner and original source bytes.

**Tech Stack:** Existing TypeScript, Node crypto/fetch, Zod, Supabase PostgreSQL/Auth/Storage, React, Node test/Vite, Playwright, Docker resaver. No dependency installation.

**Spec:** docs/superpowers/specs/2026-09-06-native-dwg-resave-publication-design.md

## Global Constraints

- Preserve existing dirty worktree changes; no stage, commit, merge, push or deployment.
- No new dependency, paid service, license contract or remote DB/Storage mutation.
- Original source bytes and approved revisions remain immutable.
- Source-free native export eligibility, artifact kinds, limits and RPC behavior remain unchanged.
- Native output remains experimental-unqualified; persistenceAuthority remains not-issued.
- Do not modify or restart live port4173 or overwrite authoritative platform/build assets; build and run acceptance in an owned copy.
- Use only owned disposable local fixtures and public synthetic DWG; no customer data or private .superpowers/sdd artifacts.

## Execution and file map

Root: /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1. All commands run in platform unless noted. Use NODE_OPTIONS=--no-experimental-webstorage. Exact pre-task copies, not dirty HEAD diffs, form review baselines. Public ledger/brief/report/review artifacts live at docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/. The user's standing instruction waives further approval prompts and commits; retain evidence rather than deleting it.

Task1 owns artifact identity and the two-profile Storage transport. Task2 owns database evidence and RPC adapters. Task3 owns publication sequencing. Task4 owns resource/UI/CLI wiring. Task5 owns actual full-stack acceptance. Implementers run sequentially; read-only preflight/review can run alongside controller work.

Type flow: existing jobs → artifact core → artifact RPC adapters → publisher/resource/download. Existing jobs MUST NOT import artifact core; this avoids a claim-parser cycle. Existing native worker → publisher, not vice versa. HTTP/UI never get service keys, raw source locators, lease tokens or attestation texts.

## Task 1: Verified artifacts and shared imported Storage transport

**Files:**
- Create platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
- Modify platform/native-dwg-worker/src/supabase.ts (existing private Storage primitives only; preserve its other adapters)
- Create platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs
- Create platform/tests/drawing-native-dwg-resave-artifacts.test.mjs
- Create platform/tests/drawing-native-dwg-resave-storage.test.mjs
- Read existing resave jobs, attestation, protocol, source fixture and source-free Storage tests.

**Interfaces:**
- Consumes parseNativeDrawingDwgResaveClaim(raw,imageId), buildNativeDrawingDwgResaveAttestation(scope,payload,imageId), decodeNativeDrawingDwgResaveOutput(bytes,expected); read exact existing signatures before calling.
- Produces NATIVE_DWG_RESAVE_ARTIFACT_LIMITS = {dwg:209715200,edit_request:2097152,authority:67108864,report:1048576}; DWG min6 and other artifacts min1, all safe integers.
- Produces strict NativeDrawingDwgResaveArtifactKindSchema, NativeDrawingDwgResaveReceiptSchema, NativeDrawingDwgResaveDescriptorSchema.
- buildNativeDrawingDwgResaveArtifacts(rawClaim,rawResult,imageId): Promise<{claim,bytesByKind:Record<Kind,Buffer>,metadata:Array<{kind,sha256,byteSize}>}>.
- nativeDrawingDwgResaveArtifactPath(scope,jobId,attemptNumber,metadata): string.
- validateNativeDrawingDwgResaveStagedArtifacts(raw,claim,metadata): parsed {jobId,attemptNumber,leaseToken,uploadState:"open"|"closed",artifacts:Array<{kind,sha256,byteSize,path}>}.
- validateNativeDrawingDwgResaveReceipt(raw,claim,metadata): parsed exact public receipt (spec schema, no token/path).
- createNativeDwgResaveStorageTransport(rawConfig,runtime?) uses {supabaseUrl,serviceRoleKey} and optional fetch/lowered artifactLimits; returns the same upload/read call shapes as createNativeDwgStorageTransport but new kinds. New NativeDwgConfirmedUploadError distinguishes definite no-write from existing NativeDwgUncertainUploadError.
- Fixture resaveArtifactFixture(buildAttestation) returns {claim,result,imageId,sourceBytes}; uses actual production attestation with finite literal native output, explicitly not actual native evidence.

- [x] Write failing behavior tests. Use Vite SSR as existing tests do, real production compiler, independently hashed finite bytes. Example:

```js
const f = await resaveArtifactFixture(buildAttestation);
const artifacts = await buildNativeDrawingDwgResaveArtifacts(f.claim, f.result, f.imageId);
assert.deepEqual(artifacts.metadata.map(x => x.kind), ["dwg", "edit_request", "authority", "report"]);
assert.equal(artifacts.bytesByKind.edit_request.toString("utf8"), f.claim.attestation.request.text);
assert.equal(artifacts.bytesByKind.authority.toString("utf8"), f.claim.attestation.authority.text);
assert.equal(artifacts.metadata[0].sha256, createHash("sha256").update(f.result.dwgBytes).digest("hex"));
```

  Also reject wrong pinned image, rebuilt-attestation mismatch, report object/bytes disagreement, no-op, output/source/request mismatch, invalid size/header, extra fields, swapped/duplicate/missing kinds, other scope/job/attempt/hash/filename, and injected receipt authority. Start build then mutate caller claim/result buffers to prove snapshots precede awaits. Validate exact staged replay and closed response.
- [x] Run new tests before production edits: `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-storage.test.mjs`. Record expected feature-missing assertion, not syntax/setup error.
- [x] Implement core by snapshotting raw claim/result synchronously, parsing claim with pinned image, rebuilding and deep-comparing attestation, encoding copied report/DWG into existing protocol frame and decoding it with independent claim-derived expected identity. Copy exact attestation UTF8 text. Derive ordered metadata with Node SHA256; validate immutable receipt/path schemas. Keep server path derivation shared inside this module.
- [x] Factor one private Storage transport using two explicit profiles; preserve source-free API/error behavior. Imported validation checks exact project/job/attempt/hash/filename path and bounded sizes, immutable copied POST, x-upsert:false. Only explicit Duplicate/ResourceAlreadyExists is exists; read full bounded bodies. Unknown POST fetch/body failure uses uncertain class; definite before-send or fully consumed HTTP refusal uses confirmed class only for new profile. Caller must still verify full readback before publication.
- Task1 review clarification: synchronous throws after invoking request are uncertain, like rejected promises. Confirmed non-duplicate HTTP initially means only fully consumed401 + InvalidJWT; unknown/malformed/status-mismatched4xx and all5xx remain uncertain. Tests must start a real owned loopback POST before a synchronous injected throw and cover explicit401 rejection versus503/unknown4xx.
- [x] Real loopback HTTP tests exercise no-upsert/copied body, success/duplicate/definite HTTP refusal, after-start disconnect/body failure uncertainty, bounded upload-response/read streams, lowered caps and cross-profile kind/path rejection. No paid/remote request; server fixture teardown is test-only. Source-free regression command: `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-worker.test.mjs`.
- [x] Run focused/new plus existing resave worker/protocol and source-free Storage tests once, self-review and write exact commands/results/RED/GREEN and any limits to task-1-report.md. Controller independently reviews exact delta; no commit.

## Task 2: Durable immutable publication and retention authority

**Files:**
- Create a new CLI-generated migration under platform/supabase/migrations; suffix drawing_native_dwg_resave_publication.sql. Do not edit accepted control/source migrations.
- Modify platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts (completed/failure enums, latest status only).
- Create platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts (receipt/descriptor and stage/close/publish adapters; imports Task1 core, never opposite).
- Create platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs and platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs.
- Modify platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs narrowly: extract its existing real clone→edit→approval setup as createApprovedNativeDwgResaveRevision({owner,ids,imported}) returning {unchangedScope,editedScope}; both old/new proofs consume it without losing prior assertions. Replace the obsolete advisors-only literal32779 port assertion with validated nonempty local loopback port and existing m1_ database identity check; actual container ownership is verified by controller before opt-in runs.
- Modify platform/tests/drawing-workspace-m1-real-database.test.mjs narrowly at existing actual imported-resave fixture integration; retain the separate finite drawing-workspace-m1-database.test.mjs tests.

**Interfaces:**
- Export getLatestNativeDrawingDwgResaveStatus(userClient,rawScope,signal?) → validated existing status|null; existing getStatus remains explicit-job.
- createApprovedNativeDwgResaveRevision is a test-only real operation/review fixture, not a production approval bypass. Existing role/JWT helpers stay test-only; no forged approved snapshot.
- Export getNativeDrawingDwgResaveReceipt(userClient,rawScope,jobId,signal?), getNativeDrawingDwgResaveDownloadDescriptor(userClient,rawScope,jobId,kind,signal?). Reverify authenticated user, strict scope/results, complete ordered receipt and exact descriptor path. Descriptor stays server-side.
- SQL signatures and return schemas are exactly the five numbered RPCs in spec. Task2 exports authenticated receipt/descriptor adapters; Task3 owns service stage/close/publish calls through its reused 5s worker helper and exact Task1 validators. Existing strict jobs RPC can be narrowly exported as callNativeDrawingDwgResaveJobRpc for authenticated Task2 reuse at its existing 30s deadline. Do not add a second general RPC framework.
- Failure codes add upload_failed and publication_failed. Completed outcome/status does not alter existing status shape. Receipt schemaVersion is 1hk-dwg-resave-receipt/1, published attempt only.

- [x] Build a real PostgreSQL regression fixture from existing canonical import→clone→literal LINE operation→review/approve flow. Production mutation expected to break tests: allowing terminal/reclaim/retention while an upload is open, accepting changed metadata, or returning another attempt's receipt. Independent concurrent clients and explicit lock barriers, not sleeps.

```js
const staged = await serviceRpc("lukas_drawing_stage_native_dwg_resave", {p_job_id: claim.jobId, p_attempt_number: 1, p_lease_token: claim.leaseToken, p_artifacts: metadata});
assert.equal(staged.uploadState, "open");
await expectSqlState("PNR13", () => serviceRpc("lukas_drawing_publish_native_dwg_resave", identityArgs));
await serviceRpc("lukas_drawing_close_native_dwg_resave_upload", identityArgs);
const receipt = await serviceRpc("lukas_drawing_publish_native_dwg_resave", identityArgs);
assert.equal(receipt.schemaVersion, "1hk-dwg-resave-receipt/1");
assert.deepEqual(await serviceRpc("lukas_drawing_publish_native_dwg_resave", identityArgs), receipt);
```

- [x] Run before migration against owned disposable full-chain DB; record missing RPC/expected failure. CLI help first, explicit owned loopback only; no --linked. Generate migration through installed CLI.
- [x] Add attempt upload state/timestamp consistency; forced-RLS, revoked direct grants, immutable artifact/export tables and exact composite FKs/indexes. Server owns managed paths. Stage validates four ordered unique bounded artifacts and request/authority hashes+lengths against admitted attestation. Close is historical exact-token cleanup, including expiry/revocation, and cannot publish/reopen. Publish atomically closes outcome/job after live source+attestation and final clock check; exact committed replay stable. Service role AND JWT, project→job→attempt locks.
- [x] Update existing guard/claim/fail/ack paths to block ALL open attempts; cancel intent alone still allowed. Retry only closed/not-started under existing limits/backoff. Preserve stage conflictPNR12 and stalePNR13. Latest status authorizes before optional-ID lookup.
- [x] Extend retention manifests/counts/purge/finalize with ALL staged artifacts, active/open blockers, stable job lock order and full managed-prefix leftovers. Revoke direct authenticated/anon Storage prefix access; preserve other prefixes. Read applicable latest function definitions, not first historical migration.
- [x] Adapter tests use actual schemas/compiler and precise RPC-boundary doubles to catch malformed envelopes, normalized identity/strict extras, missing auth, wrong receipt/descriptors and null latest. DB tests cover replay/different metadata, cancel-first/publish-first, historical close, open expiry/reclaim/fail/ack/retention, requester revoke/source tamper/outsider, direct table/Storage denial and immutable approved/source data. Run existing real DB suite once in owned runtime, schema advisors (report existing warnings), focused TS tests and owned-copy typecheck. Write report and review exact delta; no commit.

## Task 3: Cancellation-aware publication worker

**Files:**
- Create platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts
- Modify platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts narrowly to export callNativeDrawingDwgResaveAttemptRpc, readNativeDrawingDwgResaveAttemptControl, NativeDrawingDwgResaveStaleLease. Native behavior unchanged.
- Create platform/tests/drawing-native-dwg-resave-publication.test.mjs using Task1 fixture and actual production core.

**Interfaces:**
- publishNativeDrawingDwgResaveArtifacts({prepared,serviceClient,storage,imageId,signal?}); prepared is existing {outcome:"prepared",claim,result}.
- callNativeDrawingDwgResaveAttemptRpc(client:NativeDrawingDwgImportRpcClient,name:string,args:Record<string,unknown>):Promise<unknown> is the existing private5s RPC unchanged, just exported/renamed. readNativeDrawingDwgResaveAttemptControl(client,claim:ReturnType<typeof parseNativeDrawingDwgResaveClaim>) returns the existing strict Control union after exact identity validation; no parent-signal parameter is introduced. NativeDrawingDwgResaveStaleLease renames/exports existing private StaleLease; native check closure calls the exported reader, preserving its first-refusal latch.
- runNativeDrawingDwgResaveToStorage(options) takes accepted attempt options plus storage; calls actual runNativeDrawingDwgResaveAttempt once; nonprepared passes through, prepared goes to publisher.
- storage is the actual return type of createNativeDwgResaveStorageTransport: upload({kind,path,bytes:Uint8Array,signal})→Promise<"uploaded"|"exists"> and read({kind,path,signal})→Promise<Uint8Array>. Capture options and bound Storage method references before awaiting the native attempt. Reuse NativeDwgConfirmedUploadError from the existing worker transport module; all other upload errors are uncertain. Do not classify by error-name strings or rebuild transport/error classes.
- Result includes accepted nonprepared variants plus {outcome:"completed",receipt} or {outcome:"publication_uncertain"}; uncertain upload/close uses settlement_uncertain. Invoke Task2 SQL RPCs through the reused 5s helper and strict Task1 validators; no dependency on a later task.

- [x] Write RED tests with real artifact builder, controlled RPC/Storage boundary promises and independent literal sequence expectations. Example:

```js
const run = publishNativeDrawingDwgResaveArtifacts(options);
await transport.postStarted.promise;
control.cancel();
assert.equal(calls.includes("close"), false);
transport.postSettled.resolve("uploaded");
assert.equal((await run).outcome, "cancelled");
assert.ok(calls.indexOf("close") < calls.indexOf("ack"));
```

  Existing Storage upload resolves "uploaded"|"exists". Cover parent already aborted, A→late-control-refusal, no-op pass-through, mutation after call, upload/read corruption, ignored abort, typed confirmed/untyped unknown rejection, lost stage/close/publish, closed replay no POST, publish replay exact same identity, no cancellation ACK until every owned call and upload closure are proven.
- [x] Run new tests to expected missing API failure, then implement snapshot→control→stage→four sequential uploads/readbacks→close→stop+await poll→final control→publish. 1000ms poll, existing 5s RPC deadlines, first refusal latch, separate cleanup signal. Closed stage readback only. Never race-abandon POST. Unknown stage attempts exact close; unconfirmed closure stays uncertain. Unknown publish performs one same-identity replay; never fail/new admission based on lost reply.
- [x] Reuse exact accepted fail/cancel control behavior after closure, map integrity to output_invalid and definite Storage rejection to upload_failed. Do not modify native cleanup or qualify native outputs.
- [x] Run new worker tests plus accepted worker/jobs/protocol tests and source-free transport once; owned-copy typecheck; report RED/GREEN and external-boundary limits, review delta. No commit.

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

- [x] Write RED resource/download tests: same-origin JSON≤4096; strict route/scope/body; unavailable missing trusted image; no client image/actor/path; null latest and completed receipt only. Download test revokes between read and second descriptor and expects no attachment. Exact example:

```js
const response = await handleNativeDrawingDwgResaveDownload({request, ...dependencies});
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), artifact.sha256);
```

  Use bounded actual loopback stalled/abort-ignoring body tests, secure no-referrer/nosniff headers and generic errors.
- [x] Implement route adapters and actual bounded authenticated descriptor→Storage/hash→fresh descriptor equality. No raw authority/locator leakage. Keep source-free download contract intact.
- [x] Extract accepted public schemas only when adding the UI consumer; keep client imports free of .server and Node modules. Run existing artifact/jobs/adapter contract tests to prove behavior unchanged, then use these exact schemas for client JSON parsing.
- [x] Write and run failing component tests for single conditional imported/source-free control, real-backend/checkpoint/outbox readiness, click request, same requestID retry, status/own-cancel, completion-only four downloads, relogin latest, actor/scope/open generation including A→B→A. No request merely on open. Implement minimal existing-form/style UI with experimental warning and namespaced actor+scope storage. Existing source-free tests remain gates.
- [x] Entry tests validate config and production dependency wiring, sanitized logs, shutdown cleanup. Implement CLI using immutable cached resaver image config, fixed 900s lease default/180–900 and 1000ms poll default/100–60000. Do not start production worker or deploy.
- Actual entry subprocess tests must run node --experimental-strip-types native-dwg-worker/src/resave.ts, not only Vite SSR. Controller preflight reproduced ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at resave jobs constructor; Node26.5 also rejects the removed --experimental-transform-types option. Convert only the two identified error constructors to erasable syntax and preserve source-free error behavior with covering tests; do not add a transpiler dependency or suppress startup failure.
- [x] Run focused route/component/entry/source-free tests; owned-copy build/typecheck; React best-practice review after TSX edits. Record exact tests and limitations; review delta, no commit.

## Task 5: Actual imported edit→publication→download acceptance

**Files:**
- Modify platform/scripts/run-drawing-workspace-m1-e2e.mjs with narrow dwg-resave profile and owned runtime config.
- Create platform/e2e/drawing-native-dwg-resave.spec.ts; reuse platform/e2e/utils/drawing-estimator-fixture.ts, drawing-collaboration-fixture.ts and drawing-native-dwg-export-evidence.ts patterns.
- Update platform/DEPLOYMENT.md with imported worker config/run/uncertain-session operation and explicit experimental limits.
- Public evidence under this plan's controller/ directory only.

**Interfaces:**
- Actual Supabase Auth/PostgREST/Storage, production import→apply→review/approve RPCs, Task4 UI/CLI, cached immutable resaver, browser downloads. Only owned disposable loopback resources and the public 10987byte AC1024 fixture named in spec.

- [ ] Add failing real story to owned runner profile; verify app-visible imported control and source SHA before any edits. The literal supported edit is LINE4A endpoint (120,21), with other native entities/layers preserved. Do not seed a forged approval or substitute native output.
- [ ] Exercise upload→verified analysis→canonical import→edit→review/approve→request→actual worker→receipt4downloads→logout/relogin→latest completed status/download. For each attachment compare receipt hash/size, native semantic readback, headers, original source hash; verify no service keys/lease/path in browser responses.

```ts
expect(receipt.qualification).toBe("experimental-unqualified");
expect(receipt.persistenceAuthority).toBe("not-issued");
expect(receipt.artifacts.map(x => x.kind)).toEqual(["dwg", "edit_request", "authority", "report"]);
expect(sourceShaAfter).toBe("bcc54d3c768444c9ade41a23e4ef2b9f5b5668d9972522ee4a4adbc98c670434");
```

- [ ] Real cancellation/retry, viewer/outsider/fresh revoke and direct Storage denial. Use deterministic barriers at external boundaries where necessary and label those finite controls; do not count them as independent CAD qualification. Test source-free M1 and R2 create/save/restore permissions regressions in owned copy.
- [ ] Run owned-copy build/full scoped suite, actual DB/native/browser stories; gather screenshots, hashes, exact command outcomes, unchanged index/preview health. Test resources have explicit owned labels/loopback scope; clean only confirmed owned resources and report removal. No private DLL, remote mutation or global bucket limit change.
- [ ] Update deployment guidance with exact environment names and manual operational reconciliation after uncertain POST; no auto-closure based on elapsed time. State 50MiB local test bucket and synthetic acceptance do not qualify 200MiB performance or independent CAD delivery. Keep R5 package/recipient qualification work explicit.
- [ ] Independent whole-unit review of exact task deltas and deferred findings, then one reviewed fix wave if needed. Update ledger and continuation map, keep overall goal active unless every approved R2/R4/R5 criterion truly passes. No commit/push/deploy.

## Controller self-review

All spec sections map to Tasks1–5. Two-profile transport is Task1; open upload/retention fencing Task2; uncertain publication Task3; bounded authenticated download and generation-safe UI Task4; actual native/Auth/browser and regression evidence Task5. Acyclic artifact RPC adapter boundary is explicit. Existing function names/test filenames must be resolved from source when the narrow task brief is generated; no private artifacts or original build are execution targets. Table of producer/consumer checks and rulings is recorded in the public ledger before Task1 dispatch.
