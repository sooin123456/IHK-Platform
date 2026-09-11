# Imported DWG verified publication and download

## Purpose and selected approach

Complete the next R4 vertical: approved imported DWG → real resaver → immutable four-file publication → authenticated status/cancel/download UI. Reuse the accepted native execution and source-free Storage/download patterns. The overall R2/R4/R5 goal remains intact; exact-revision DWG/PDF/BOQ packaging and independent recipient CAD qualification remain subsequent acceptance, not inferred here.

Alternatives considered: a universal rewrite of both export systems increases regression surface; a separate Storage service adds a dependency without changing the required authority boundaries. Selected: imported-resave evidence/RPC namespace over existing Supabase Storage, with shared bounded transport primitives and unchanged source-free eligibility/caps. Database upload state is necessary because native cleanup alone cannot prove that a POST has stopped.

This is an architectural subsystem extension. The user's standing instruction to implement without further approval prompts applies. No approval/commit gate is reintroduced. Previous goal turn is progress: accepted control code and fresh275focused+1realPG+1actualnative/build evidence changed the next action to publication. Do not redispatch the completed control plan.

## Global constraints

- Preserve existing dirty worktree changes; no stage, commit, merge, push or deployment.
- No new dependency, paid service, license contract or remote DB/Storage mutation.
- Original source bytes and approved revisions remain immutable.
- Source-free native export eligibility, artifact kinds, limits and RPC behavior remain unchanged.
- Native output remains experimental-unqualified; persistenceAuthority remains not-issued.
- Do not modify or restart live port4173 or overwrite authoritative platform/build assets; build and run acceptance in an owned copy.
- Use only owned disposable local fixtures and public synthetic DWG; no customer data or private .superpowers/sdd artifacts.

## Artifact identity

Four ordered kinds: dwg, edit_request, authority, report. Each public metadata item is exactly {kind,sha256,byteSize}. SHA-256 is64lowerhex; sizes are safe positive integers. DWG minimum6/max209715200bytes; edit_request max2097152; authority max67108864; report max1048576. No-op request has no files and stays terminal no_changes.

Storage bucket is lukas-qto. Server-generated path is projects/{projectId}/native-dwg-resave/{jobId}/{attemptNumber}/{sha256}/{filename}, with normalized UUIDs and attempt1–3. Filenames respectively resaved.dwg, edit-request.json, authority.json, native-report.json. Never accept a browser or worker-supplied alternative path. The worker compares returned paths to this exact derivation before any POST.

Use exact UTF-8 attestation.request.text and attestation.authority.text without pretty printing or a newline. Copy native reportBytes and dwgBytes before asynchronous work. Revalidate the parsed claim against the pinned image, rebuild the full attestation and compare it exactly, then reuse decodeNativeDrawingDwgResaveOutput for source/request/report/output integrity. Construct expected source from claim.source's sha256/byteSize/headerVersion and request identity from the attestation. Require report object and reportBytes to agree. Do not rerun native conversion or duplicate its geometry validator to build artifacts.

New core module exports:

```ts
NATIVE_DWG_RESAVE_ARTIFACT_LIMITS;
NativeDrawingDwgResaveArtifactKindSchema;
NativeDrawingDwgResaveReceiptSchema;
NativeDrawingDwgResaveDescriptorSchema;
buildNativeDrawingDwgResaveArtifacts(rawClaim, rawResult, imageId)
  // Promise<{claim,bytesByKind,metadata}>; snapshots caller inputs before awaits.
nativeDrawingDwgResaveArtifactPath(scope, jobId, attemptNumber, metadata)
validateNativeDrawingDwgResaveStagedArtifacts(raw, claim, metadata)
validateNativeDrawingDwgResaveReceipt(raw, claim, metadata)
```

Receipt is exactly {schemaVersion:"1hk-dwg-resave-receipt/1",jobId,attemptNumber,scope,resaverImageId,sourceSha256,qualification:"experimental-unqualified",persistenceAuthority:"not-issued",artifacts,createdAt}. Scope is the strict existing six-field normalized scope; artifacts are the four ordered metadata records. A receipt proves stored byte provenance, not native delivery qualification. No actor, lease token, bucket/path, authority text or source locator is public.

Descriptor is exactly {jobId,attemptNumber,kind,bucket:"lukas-qto",path,sha256,byteSize}. It is returned only by the authenticated exact-scope download RPC and remains server-side. Validate attempt/kind/hash/filename and the entire managed path, not merely a prefix.

Keep imports acyclic: the artifact core imports the accepted claim parser. New authenticated receipt/descriptor and service stage/close/publish adapters live in drawing-native-dwg-resave-artifact-jobs.server.ts, which imports both the artifact core and existing job types. The existing jobs module only gains completed/failure enums and latest-status support; it never runtime-imports the artifact core.

## Storage transport reuse and settlement evidence

Preserve createNativeDwgStorageTransport's source-free API. Factor its existing private POST/bounded-body/GET implementation once, with two explicit fixed profiles; export createNativeDwgResaveStorageTransport(rawConfig,runtime?) for the new kinds/caps. Tests may lower per-kind limits, never increase them. The new profile validates its exact managed path. Existing source-free kinds/caps/path acceptance remain unchanged.

POST uses x-upsert:false, fixed MIME type and copied request bytes. Only explicit Duplicate/ResourceAlreadyExists responses are exists. Both uploaded and exists require exact readback size, SHA and byte equality before publication. Preserve bounded30second Storage signals and full-response-body limits; do not claim large-corpus/performance qualification from a small synthetic file. Existing Node fetch/crypto/Zod dependencies suffice.

The imported profile exposes a typed NativeDwgConfirmedUploadError only for validation failure before sending or a fully consumed definite HTTP rejection. Existing NativeDwgUncertainUploadError covers fetch/body failure after a POST may have started. An untyped rejection from an injected transport is also unknown. Do not convert an abort or rejected Promise into proof of remote settlement. Unknown upload keeps the durable session open, returns settlement_uncertain and issues no close/fail/cancel acknowledgement. A fulfilled uploaded/exists response proves that owned call settled even if cancellation arrived meanwhile; skip further uploads and close before cancellation acknowledgement. Never abandon a pending upload Promise and claim cleanup.

Task1 review clarification: once request(...) is invoked, both synchronous throws and Promise rejection are uncertain; local validation must occur before invocation to establish no-write. Initially the only non-duplicate HTTP rejection classified confirmed is fully consumed HTTP401 with Storage code InvalidJWT, the documented authentication rejection. Other 4xx, all5xx, malformed/unknown bodies and status/code mismatches stay uncertain. This conservative boundary can require reconciliation for errors that were actually harmless. Do not broaden the set without proving the rejection precedes object mutation. Reference: https://supabase.com/docs/guides/storage/debugging/error-codes (checked2026-09-06).

## Database evidence and races

Generate a new CLI migration; do not edit the accepted control migration. Add upload_state not_started|open|closed and upload_closed_at to attempts, with monotonic transitions and consistency constraints. Add immutable forced-RLS/direct-grant-revoked lukas_drawing_native_dwg_resave_artifacts and lukas_drawing_native_dwg_resave_exports, using composite project/job/attempt foreign keys and required indexes. Exports has one row per job, exact attempt and completed_at. Receipt is projected from immutable job/export/artifact rows. All deletion uses existing guarded project-retention authority.

Extend job status and attempt outcome with completed. Extend failure codes with upload_failed and publication_failed; retryable only after confirmed closure, within the existing3attempt/30×attempt backoff and live authority checks. Keep the existing public status fields, adding only these enum cases. Existing job/attempt IDs and attestation fields stay immutable.

All mutating RPCs use project→job→exact attempt lock order and existing role AND JWT service guard. Required new RPCs:

1. lukas_drawing_stage_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_artifacts jsonb): strict exact four unique bounded metadata records; current processing/unexpired exact attempt and live source/attestation; request/authority hash+size must equal admitted identities. Atomically insert server paths and open upload state before POST. Return exactly {jobId,attemptNumber,leaseToken,uploadState:"open"|"closed",artifacts:[metadata+path]}. Exact metadata replay is stable; changed metadata conflictsPNR12. Closed replay never reopens or grants upload authority. Worker refuses to upload on a closed stage response.
2. lukas_drawing_close_native_dwg_resave_upload(p_job_id,p_attempt_number,p_lease_token): exact historical staged attempt, service-only; monotonic open→closed and exact replay. Return exactly {jobId,attemptNumber,leaseToken,uploadState:"closed"}. Permit closure after expiry, requester revocation and cancel intent; do not require current-job token or change job/outcome. This releases a blocker, never publication authority. not_started/stale identity refuses.
3. lukas_drawing_publish_native_dwg_resave(p_job_id,p_attempt_number,p_lease_token): exact published-attempt replay returns same receipt, even after lease expiry; never exposes locators. New publication requires current processing, unexpired job AND attempt leases, closed uploads, four exact artifacts, current source+approved attestation. Recheck time after authority work. Atomically insert export, finish attempt completed and set job completed/failure null. Cancel-first denies publication; publish-first is immutable and later cancellation leaves completion intact.
4. lukas_drawing_native_dwg_resave_receipt(p_scope jsonb,p_job_id uuid): verified current collaborator/exact approved or superseded source authority, completed job/export/published attempt only; public receipt or unavailablePNR11. Do not grant source-free eligibility.
5. lukas_drawing_native_dwg_resave_download_descriptor(p_scope,p_job_id,p_kind text): same fresh user authority, exact completed export's artifact; server-only descriptor. Direct Storage access for application roles to native-dwg-resave prefix is prohibited.

For initial/relogin UI discovery, extend existing status RPC to accept null p_job_id as latest exact-scope job by created_at DESC,id DESC, returning null if no job exists. Explicit nonnull unknown IDs still refuse. Authorization is checked before either lookup. Existing getNativeDrawingDwgResaveStatus keeps its required job ID; add getLatestNativeDrawingDwgResaveStatus for null lookup. Any currently authorized exact-scope collaborator can read status, as already decided.

Open-upload fencing is load-bearing: update the existing resave guard, claim, fail and cancel acknowledgement. Before claim's expired-cancellation finalization, expiry outcome, authority/exhaustion failure or new token, inspect ALL job attempts and skip unchanged if any is open. Guard forbids job terminal/retry/replacement and attempt outcome while open; processing→cancel_requested remains allowed. Fail/ack independently refuse open sessions. Time does not prove upload closure.

Update retention storage manifest/dependency counts/purge/finalize and reserve the imported prefix. Lock imported jobs in stable ID order under the existing project lock. Both purge phases refuse active jobs or any open attempt; include ALL staged artifacts, including unpublished failed/cancelled attempts; finalization also checks the entire imported prefix for unexpected leftover objects. Preserve existing source-free/import/IFC/original-file retention checks.

Unknown POST completion can require operational reconciliation; never invent an automatic expiry-based closure or advertise successful cancellation. Retain exact attempt/path evidence so an operator can verify transport shutdown before service closure. Automatic reconciliation without proof is not part of this unit and remains an explicit operational release concern.

## Publication worker

Keep runNativeDrawingDwgResaveAttempt's native-only API/outcomes intact. Add runNativeDrawingDwgResaveToStorage(options) that invokes the real accepted attempt and, only on prepared, performs artifact publication. Add publishNativeDrawingDwgResaveArtifacts({prepared,serviceClient,storage,imageId,signal?}) for the bounded publication phase and direct tests. Prepared inputs are revalidated/snapshotted by the core builder; no mocked approval bypass in production.

Reuse the existing5second RPC deadline and exact-identity control reader by exporting narrow helpers from the native attempt module. Keep native cleanup/lifecycle unchanged. The publication phase independently starts a successful control check, polls every1000ms, latches the first refusal and aborts its execution signal. Separate cleanup/close/ack signals stay alive. Await the current transport call through settlement and await pending control polls on exit.

The reused helper names are callNativeDrawingDwgResaveAttemptRpc and readNativeDrawingDwgResaveAttemptControl, with NativeDrawingDwgResaveStaleLease as the exported stale-identity error. The publisher's prepared input is the accepted {outcome:"prepared",claim,result} variant. Snapshot dependencies/config and result buffers before the first await. Stage refusal is not evidence that a prior replay never staged: conservatively attempt exact close; an unconfirmed or not_started refusal yields settlement_uncertain, never fabricated closure. This may require reconciliation after an RPC outage and is preferable to a false cancellation acknowledgement.

Order: validate/build artifacts → successful control → stage(open) → sequential upload/readback of4files → close acknowledgement → stop and await pending polls → final control → publish. Every phase checks refusal/shutdown before starting another side effect. On closed stage replay, perform readback only and never POST. On staged failure before any POST or confirmed finished uploads, close even if revoked/stale/cancelled, then use existing fenced cancel/fail semantics. Malformed/lost stage response may have opened state; no POST occurs; attempt exact close before any settlement. Unknown close response returns settlement_uncertain and never fail/ack/publish.

After uploads are closed, publication's database transaction arbitrates cancellation versus completion; do not keep a post-publication poll that could relabel a committed receipt as stale. A valid exact receipt is completion. A lost/malformed publication reply makes one bounded exact publish replay with the SAME identity (no new admission/attempt); a validated same receipt recovers completion. If still unknown, return publication_uncertain and do not fail or auto-retry the job. Public status/receipt may later show the committed result.

Outcomes: accepted attempt nonprepared outcomes pass through; publication adds {outcome:"completed",receipt} and {outcome:"publication_uncertain"}. No-op admission is never claimed/executed. Corrupt readback/report/metadata is output_invalid, definite Storage failure upload_failed; any retry requires confirmed close. Original source is never an upload target.

## Authenticated HTTP, UI and worker entry

Routes mirror current workspace resources: /projects/:projectId/workspaces/:workspaceId/native-dwg-resave and /projects/:projectId/workspaces/:workspaceId/native-dwg-resave/:jobId/download/:kind. GET strictly parses the existing four revision query fields plus optional jobId and returns {job,receipt}, nulls when idle; receipt resolved only for completed. POST requires same Origin, application/json,4096byte bounded body. Strict request intent body is {intent:"request",...sixFieldScope,requestId}; cancel is {intent:"cancel",...sixFieldScope,jobId}. Route IDs must match normalized scope. The handler passes only scope/request ID to the existing authenticated compiler/admission adapter. Resaver image is trusted server NATIVE_DWG_RESAVER_IMAGE_ID; browser image/path/actor/edit/attestation fields are rejected. No configured image means a bounded unavailable message, not a conversion claim.

Download uses authenticated descriptor → exact managed path/cap → bounded Storage body/hash → fresh authenticated descriptor again → exact equality → attachment. Secure headers are private,no-store; no-referrer; nosniff. No raw SQL/native/path/credentials in errors. Original source-free download remains unchanged except a narrow reusable bounded read/header helper if it demonstrably reduces duplicate logic without changing its contract. Cover stalled or abort-ignoring bodies with real bounded behavior, not signal-only claims.

DrawingExportDialog's DWG choice displays ONE control: if documentState.structure.sources contains dwg_entity, use the imported resave control; otherwise use existing source-free control unchanged. Imported readiness requires real backend, approved/superseded exact checkpoint, saved/outbox ready and selected canvas. Server projector remains final source eligibility authority. PDF/IFC-only drawings keep existing explanation; no fake fallback re-export that discards imported DWG entities.

For the actual UI consumer, extract the accepted imported public scope/status/artifact/receipt schemas into one browser-safe drawing-native-dwg-resave-contract.ts module using existing Zod only. Existing server exports re-export these same schemas, preserving their APIs and validation behavior. Keep claim/compiler/native buffers, descriptor paths, privileged RPCs and Node dependencies server-only. The new UI and server parse the same public DTO; do not copy a second handwritten receipt/status validator or restructure the existing source-free control. This extraction occurs in the UI task, when the second consumer exists.

Expose request, current state, own-request cancel, retry SAME request after transport uncertainty, explicit fresh request only after terminal failure/cancel, four receipt-derived downloads and experimental warning. Hide download links without validated completion. Changing scope/actor/open lifecycle aborts old requests and ignores stale responses; A→B→A requires generation identity, not only scope string. Request ID storage is namespaced native-dwg-resave and actor+exact scope, separate from source-free IDs. Pass currentUserId through the export dialog only where needed. Same-user relogin restores actual latest status; no automatic conversion merely on opening a dialog. Existing admin cancel API remains server-enforced even if the first UI only offers own-request cancel.

Add native-dwg-worker/src/resave.ts using the existing import worker's client/RPC/source transport patterns and the new Storage profile. Fixed config names: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NATIVE_DWG_RESAVER_IMAGE_ID, NATIVE_DWG_DOCKER_PATH, NATIVE_DWG_DOCKER_HOST, NATIVE_DWG_RESAVE_LEASE_SECONDS(default900,180–900), NATIVE_DWG_RESAVE_POLL_MILLISECONDS(default1000,100–60000). Validate immutable image/absolute Docker path/normalized local Unix socket and origin. SIGINT/SIGTERM abort execution without killing cleanup. Logs contain events/outcomes only, no claim/keys/locators. No production worker process or deployment is started by this task.

The direct Node entry must actually import/run in the existing Node26 strip-only environment. Two currently imported error classes use unsupported constructor parameter properties; replace only those with equivalent explicit readonly fields and assignments, preserving their API/messages and source-free behavior. Add the matching package script without dependencies. Worker-once composes the existing5s claim RPC and claim parser with Task3; no independent admission/claim framework. Return idle before an already-aborted claim, but pass a claim obtained during shutdown to Task3's aborted-signal settlement. Wait the configured abortable poll interval after every turn so immediate refusals cannot create a busy retry loop.

## Verification

Contract tests use production compiler/attestation/protocol, fixed literal bytes and independent hashes. Real loopback HTTP tests prove bounded full upload/read bodies, no-upsert, duplicate/error classification, profile separation and caps. Real PostgreSQL tests use full migration chain and independent barriers for stage identity, cancel-first/publish-first, open-session expiry/reclaim/fail/ack/retention denial, historical close, immutable receipt/replay/grants/source tamper/revocation. No arbitrary sleeps for SQL ordering.

Worker tests cover control during upload/read, late or ignored abort, typed/untyped settlement, uncertain stage/close/publish, exact replay and no forbidden fail/admission. Download/HTTP/component tests cover route/body/origin/extra fields, scope/actor lifecycle, duplicate requests, completed-only links, original source-free regression and final user revocation during read.

Finish with an owned-copy real Auth/PostgREST/Storage/native/browser story using public synthetic DWG: upload→analyze/import→literal supported LINE edit→review/approve→request→worker→exact4artifact receipt→logout/relogin→download/readback, originalSHA unchanged. Test cancellation and retry separately with real authority/status and real native/Storage; explicitly label finite seams, never count them as full end-to-end. Reuse the disposable runner and update only needed profile/runtime wiring. Source-free M1/browser and R2 save/restore/permission tests remain regression gates. Preserve original4173 preview.

The qualified synthetic resaver fixture for this story is the public 10987-byte AC1024 file at docs/superpowers/evidence/2026-09-06-native-dwg-resave-protocol/controller/actual/source/synthetic-input.dwg, SHA256 bcc54d3c768444c9ade41a23e4ef2b9f5b5668d9972522ee4a4adbc98c670434. The disposable runner's existing 50MiB bucket limit is adequate for this fixture, not proof of the 200MiB application boundary or large-file performance. Any source-free native acceptance build must come from public owned source, never private historical binaries.

Official compatibility check2026-09-06: Supabase changelog fetched through curl after markdown web-reader content-type refusal. Relevant Data API explicit-grant change and Node20 deprecation were read; use explicit grants/revokes and existing Node26.5. Source references: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically ; https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20 ; https://supabase.com/docs/guides/storage/uploads/standard-uploads ; https://supabase.com/docs/guides/storage/security/access-control . No project settings changed. Standard uploads are retained as a bounded server transport; large-file reliability/performance is not established by this synthetic acceptance.
