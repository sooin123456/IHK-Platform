# Native DWG export jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved native drawing DWG requests durable, run the existing writer, retain exact verified artifacts, and expose authorized progress/download in the existing export dialog.

**Architecture:** PostgreSQL authority owns requests, three bounded lease attempts, staged file identities and immutable receipts. A .NET-backed Node worker reuses the approved source adapter; scoped resources and the current React export dialog expose the result. Existing source/image exports and protected approvals remain intact.

**Tech Stack:** Existing PostgreSQL/Supabase, TypeScript/Zod/React Router, Node stdlib, ACadSharp 3.7.1/.NET8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-export-jobs-design.md`.

**Status (2026-09-06):** All four tasks implemented, verified and independently reviewed. Final checks: 309 focused tests, 5 actual DB/Storage gates and 23 browser scenarios passed; only two conditional unconfigured-environment notices skipped. The marked disposable stack was stopped and removed; generated evidence is retained. This unit is complete, but the full customer-DWG/recipient-delivery goal remains active. No commit or deployment.

## Global Constraints

- No commit, push, deployment, paid service, license contract, or remote project mutation is authorized. Preserve the dirty worktree and previous evidence.
- The browser sends exactly projectId,documentId,revisionId,revisionVersion,canvasId,snapshotSha256,requestId. No geometry, output profile, actor, engine path/build, storage path or artifact bytes are accepted.
- Authenticate and authorize before replay. Viewer may export an approved source without receiving edit authority. Keep the public approved-source RPC authenticated-only.
- No new package dependencies. Do not alter the pinned native manifest/writer contract or claim production DWG delivery qualification.
- Keep lukas-qto private; reserved projects/<project UUID>/native-dwg/ is inaccessible to authenticated/anon Storage operations through an AS RESTRICTIVE FOR ALL policy with USING and WITH CHECK.
- Register all four immutable artifacts before the first upload. Keep failed/unpublished rows and uncertain open upload sessions. Lease expiry is not proof an upload stopped.
- Source snapshot SHA, structure SHA, native manifest SHA, report SHA and DWG SHA remain separate.
- Requests/claims/publication and retention use project-first locks. Normal worker lease 900 seconds, whole-attempt budget840 seconds, writer120 seconds, Storage request30 seconds; max3 attempts, retries30*2^(attempt-1) seconds, max5 active project jobs.
- Native output is experimental-unqualified. Customer DWG import/edit/re-save, recipient CAD qualification, draft exports and complete delivery package remain required goal work.

## Task 1: Database job, artifact and retention authority

**Files:** CLI-create one new migration `drawing_native_dwg_export_jobs`; create `platform/tests/fixtures/drawing-native-dwg-jobs-database.mjs`; modify only the callback arguments of `platform/tests/fixtures/drawing-native-dwg-source-database.mjs` to include `tx`; minimally change its M1 invocation in `platform/tests/drawing-workspace-m1-real-database.test.mjs` to run the new wrapper proof. Align that test's minimal Storage bootstrap with verified actual platform prerequisites: storage.objects RLS enabled and SELECT/INSERT/UPDATE/DELETE granted to anon/authenticated/service_role before repository migrations. These fixture-only grants reproduce the actual local Supabase catalog, never loosen product migration permissions. No application/UI/worker changes in this task.

**Interfaces:** All scope JSON below has exactly six camelCase keys (the browser request minus requestId), validated as UUIDs, positive safe revisionVersion and lowercase64hex SHA. Unknown/null fields fail bounded.

```ts
type Scope = { projectId:string; documentId:string; revisionId:string;
  revisionVersion:number; canvasId:string; snapshotSha256:string };
// User RPCs, EXECUTE authenticated only:
lukas_drawing_request_native_dwg_export(p_scope: Scope, p_request_id: uuid)
  => {accepted:true, jobId:string, requestId:string};
lukas_drawing_native_dwg_export_status(p_scope: Scope, p_job_id: uuid|null = null)
  => null | {jobId:string,status:'queued'|'processing'|'retry_wait'|'completed'|'failed',
    attemptCount:number,lastErrorCode:string|null,createdAt:string,
    qualification:'experimental-unqualified',receipt:null|Receipt};
lukas_drawing_native_dwg_download_descriptor(p_scope: Scope,p_job_id:uuid,p_kind:text)
  => {jobId:string,kind:Kind,bucket:'lukas-qto',path:string,sha256:string,byteSize:number};
// Service RPCs, EXECUTE service_role only plus an explicit service role check:
lukas_drawing_claim_native_dwg_export(p_writer_build_sha256:text,p_lease_seconds:int=900)
  => null | {jobId:string,projectId:string,attempt:number,leaseToken:string,
    leaseExpiresAt:string,writerBuildSha256:string,source:{request:Scope,payload:unknown}};
lukas_drawing_stage_native_dwg_export(p_job_id:uuid,p_attempt:int,p_lease_token:uuid,
  p_structure_sha256:text,p_artifacts:ArtifactMetadata[])
  => Array<ArtifactMetadata & {path:string}>;
lukas_drawing_settle_native_dwg_upload(p_job_id:uuid,p_attempt:int,p_lease_token:uuid)
  => 'closed';
lukas_drawing_publish_native_dwg_export(p_job_id:uuid,p_attempt:int,p_lease_token:uuid)
  => Receipt;
lukas_drawing_fail_native_dwg_export(p_job_id:uuid,p_attempt:int,p_lease_token:uuid,
  p_error_code:text,p_retryable:boolean) => 'retry_wait'|'failed'|'stale';
type Kind = 'dwg'|'source_manifest'|'authority'|'report';
type ArtifactMetadata = {kind:Kind,sha256:string,byteSize:number};
type Receipt = {jobId:string,attempt:number,qualification:'experimental-unqualified',
  source:Scope,writerBuildSha256:string,structureSha256:string,
  artifacts:ArtifactMetadata[],createdAt:string};
```

Use `PNJ01` for unavailable/unauthorized scope, `PNJ02` request replay conflict, `PNJ03` invalid/stale/expired lease, `PNJ04` artifact identity conflict, `PNJ05` project active capacity. Fixed messages contain no raw payload/SQL/path. Public source wrapper retains `PND01` unchanged. Job error enum: source_unavailable,lease_expired,conversion_failed,verification_failed,upload_failed,publication_failed,budget_exceeded.

- [x] Add new real SQL proof before production code. New exported `proveNativeDwgExportJobAuthority({owner,ids})` calls the existing `proveNativeDwgSourceAuthority` and uses its awaited callback `{request,payload,tx}` while the real approved source transaction is open. Preserve the existing source assertions/rollback. M1 invokes the new wrapper once in the existing position after proveStarterRollback, so original source coverage remains. First RED proves new request acceptance is absent:

```js
const [row] = await asActor(tx, ids.users.editor, sp => sp`
  select public.lukas_drawing_request_native_dwg_export(
    ${sp.json(request)}::jsonb,${requestId}::uuid) value`);
assert.equal(row.value.accepted,true);
assert.equal(row.value.requestId,requestId);
```

Root owns all disposable DB actions; notify root when the failing proof is ready and wait for the observed missing-RPC RED. Do not write migration implementation before that result. Tests may reuse role/savepoint patterns, never grant access to make a test pass. The source callback may additionally expose a transaction-local `createApprovedNativeScope(key)` factory using its existing import/approval helpers, so valid-scope conflict tests exercise real approval without duplicate helper implementations. Existing source assertions remain unchanged.
- [x] CLI-create the migration using discovered CLI help. Create the four tables and strict constraints/indexes from the spec. Artifact kinds/limits are exactly dwg100MiB,source_manifest20MiB,authority20MiB,report32MiB; stages require every kind exactly once and no extra keys. Path is DB-generated `projects/<project>/native-dwg/<job>/<attempt>/<sha>/<fixed filename>`. All tables force RLS and revoke direct grants; add exact guarded immutability/deletion rules, no broad policy.
- [x] Move the existing current approved-source SQL selection/native predicates into private `lukas_drawing_native_dwg_source_for_actor(p_actor_id, p_project_id,p_document_id,p_revision_id,p_revision_version,p_canvas_id,p_snapshot_sha256)`. Private actor read helper checks current auth.users not anonymous/deleted/banned and current owner/member or raw_app_meta_data staff. The public source wrapper first verifies current auth.uid/session/current project access and calls this helper. Preserve all original source payload keys, hashes and PND01 failure mapping; revoke external helper EXECUTE. No stored canonical JSON duplicate or JWT impersonation.
- [x] Implement authenticated request/status/descriptor and service lifecycle RPCs with the exact interfaces above. Request locks project, checks source before replay and five-active cap; `(requested_by,request_id)` unique and exact acceptance replay. Claim skips locked project/job candidates, reloads source, pins first build, writes a new attempt, and fails revoked/unavailable or exhausted jobs without queue-head livelock. Stage requires active matching attempt/token/build and exact four tuples; settle closes only its own retained attempt even when stale; publish requires current live lease plus closed session and atomically inserts the receipt/completes the job. Publish exact replay is immutable; stale fail returns stale without mutation. Fixed max3/retry schedule.
- [x] Add restrictive Storage prefix policy with USING and WITH CHECK; keep existing permissive grants unchanged. Extend current retention storage-files union to every registered native artifact. Extend dependency evidence with nativeDwgJobs/nativeDwgArtifacts/nativeDwgOpenUploads. Replace current prepare/finalize definitions with narrowly amended copies adding native job locks/counts and open upload refusal, preserving existing IFC/order/protected-dependency logic; finalizer checks native prefix absence in addition to existing paths/IFC prefix. Do not replace protected approval counts with zero or add cleanup authority.
- [x] Expand real proof with positive owner/editor/viewer request/status/descriptor, strict/foreign/draft/anonymous/revoked/replay-conflict/capacity negatives, three attempts and stale token cases, wrong build/structure/kind/size/path metadata, exact stage/publish replay, closed-session requirement, immutable rows, no-direct-table/service-to-user-RPC grants, prefix RLS SELECT/INSERT/UPDATE/move/delete denials, retained old open attempts and protected/open-session purge refusal. Verify all original canonical text/hash and revision/approval counts unchanged. Actual concurrent HTTP/worker proof is Task4, not asserted from source text here.
- [x] Root applies only this migration to a marked disposable DB, runs real M1 database suite and focused146 source/helper/share/CAD baseline plus TypeScript, records commands/errors/hashes, then task review. Keep historical migration notices separate from new failures. Freeze/report, no commit.

## Task 2: Real writer worker and immutable Storage publication

**Files:** create `platform/app/lukas/lib/drawing-native-dwg-worker.server.ts`, `platform/native-dwg-worker/src/supabase.ts`, `platform/native-dwg-worker/src/index.ts`, `platform/native-dwg-worker/tsconfig.json`, `platform/native-dwg-worker/README.md`, `platform/tests/drawing-native-dwg-worker.test.mjs`; minimally add build/start worker scripts to existing package.json. Reuse existing dependencies and .NET tool without changes. New worker-specific modules stay below native-dwg-worker; no generic conversion framework.

**Interfaces:** consume exact Task1 camelCase RPC payloads and `projectApprovedNativeDrawingCadSource(request,payload)`. Export `runNativeDrawingDwgWorkerOnce(dependencies, runtime?)` returning idle/completed/retry_scheduled/failed, `runNativeDrawingDwgWriter({dotnetPath,publishedDirectory,manifestBytes,expectedWriterBuildSha256},runtime?)` returning three verified native artifacts (DWG, source manifest and report; authority comes from the approved adapter as the fourth publication artifact), and `createSupabaseNativeDwgWorkerDependencies(client,config)` mapping claim/stage/settle/publish/fail through existing supabase-js. Write the concrete dependency types alongside core; injected slow I/O only, real validation/projection stays exercised.

- [x] Write an initial failing worker test with a real approved-source fixture and controlled external writer/storage methods. The observable completed result requires an actual projectApprovedNativeDrawingCadSource manifest, exact source/manifest hashes, four stage tuples before any upload, four matching readbacks, then settle and publish. Use hand-checked expected event sequence:

```js
assert.deepEqual(events,['claim','convert','stage','upload:dwg','read:dwg',
 'upload:source_manifest','read:source_manifest','upload:authority','read:authority',
 'upload:report','read:report','settle','publish']);
assert.equal(outcome,'completed');
```

- [x] Implement ordered published-file build hashing with no symlinks, absolute configured host/directory, exclusive task-local input, shell:false execution, bounded output, actual subprocess timeout and confined cleanup. Limits: whole840s inside900s lease, writer120s, Storage30s, source20MiB, DWG100MiB/report32MiB/authority20MiB. Validate exact AC1024/report qualification/internal success, input/output hashes and bytes before staging. Resolve report filenames only through fixed allowed outputs. Check build bytes before and after writer. No raw stderr/paths in errors.
- [x] Map Task1 RPCs and Storage semantics using existing private bucket and database-derived paths. upsert:false; verify all bytes after a confirmed upload or a fully consumed, explicitly coded duplicate response. Matching readback does not establish that an uncertain/lost upload settled: that attempt must remain open without settle/publication. On failure, do not delete artifacts. Stale lease cannot publish; fail can't overwrite completed/new attempts. Use abort-aware RPC builders and a focused Storage transport with required explicit server credentials, actual abort/deadline ownership through headers and body, and running byte limits; not an optional caller fetch convention or bare Promise.race. Preserve original source/manifest bytes.
- [x] Add real-behavior negatives for tampered approved source, report/input/output hashes, wrong build/path/symlink, over-limit output, nonzero writer/timeout, malformed claim/stage/receipt, stale lease, upload conflict matching/mismatching readback, no stage→no upload, uncertain upload→no settle/publication, post-read deadline, cleanup path confinement and source unchanged. Run focused test and worker tsc.
- [x] Root publishes existing .NET project into a fresh task-owned directory and runs the new real wrapper against recorded and fresh approved native source. Preserve actual output/hash/report and repeat with deliberate corruption. This is internal engine verification, not recipient CAD qualification. Freeze/report and review; no deployment.

## Task 3: Scoped request/status/download and export dialog

**Files:** create `platform/app/lukas/lib/drawing-native-dwg-jobs.server.ts`, `platform/app/lukas/screens/drawing-native-dwg-export.ts`, `platform/app/lukas/screens/drawing-native-dwg-download.ts`, `platform/app/lukas/components/drawing-native-dwg-export.tsx`, `platform/tests/drawing-native-dwg-jobs.test.mjs`, `platform/tests/drawing-native-dwg-export-ui.test.mjs`; modify app/routes.ts, drawing-workspace-paths.ts and drawing-export-dialog.tsx only where needed. Resource routes export only framework handlers; testable HTTP/parser/download logic lives in focused `drawing-native-dwg-export.server.ts` and `drawing-native-dwg-download.server.ts` under lib, keeping server-only imports out of the client bundle. Typegen files generated normally. No new menu/sidebar or state store.

**Interfaces:** helpers `requestNativeDrawingDwgExport(client,request)`, `getNativeDrawingDwgExportStatus(client,scope,jobId?)`, `resolveNativeDrawingDwgDownload(client,scope,jobId,kind)`. Existing export dialog passes its exact project/workspace/revision/version/checkpoint/canvas props to the dedicated DWG control. Use routes `/projects/:projectId/workspaces/:workspaceId/native-dwg` GET+POST and `/projects/:projectId/workspaces/:workspaceId/native-dwg/:jobId/download/:kind` GET only. workspaceId maps to documentId. All Task1 DTOs remain unchanged.

- [x] TDD server helpers/route boundary with actual validation and Response behavior: strict six-scope+requestId, route mismatch, only expected methods, bounded body, CSRF/origin, access denial before service client creation, preserved cookies/no-store, no raw error payload. Test missing completed receipt and unknown artifact kind never read Storage.
- [x] Implement user RPC helpers and thin routes using existing drawingContext/body/security patterns. Download checks a user-authorized descriptor, lazily imports server service client, fetches only the exact managed object with bounded size/hash verification, reauthorizes before returning a streamed fixed MIME attachment named `drawing-experimental.<extension>` (source/authority/report use distinct fixed .json names). Set private no-store,nosniff,no-referrer. Never give browser a signed Storage URL or user-controlled redirect/path.
- [x] Add DWG (시험) to existing format selection, render dedicated control only for that format and preserve original three-format export lifecycle. Explicitly explain approved single-canvas/native eligibility and independent CAD qualification gap. Persist requestId across uncertain POST/reopen keyed by six-scope; status reload resolves latest exact-scope job. Poll active jobs only while open; abort on close/unmount/scope change, never claim server cancellation. Render bounded stages/retry/failure/completed receipt; links for all four artifacts only after completed. Unconfigured/preview backend explains unavailable real export, no fake job.
- [x] Exercise actual rendered control for pending/retrying/failed/completed and accessible status, request-id reuse vs scope change/new retry, double-click prevention, close/reopen, stale responses, four links, unsupported-source error. Preserve existing PDF/PNG/SVG UI/unit tests. Run relevant tests, typegen/tsc; freeze/report and review.

## Task 4: Full vertical database, worker, Storage and browser evidence

**Files:** minimally extend `platform/scripts/run-drawing-workspace-m1-e2e.mjs`/Playwright M1 fixture only as needed to run the worker and existing published writer in the marked disposable environment; add focused production-shaped native DWG scenario to `platform/e2e/drawing-workspace-m1-estimator.spec.ts`, keeping detailed checks in a focused `platform/e2e/utils/drawing-native-dwg-export-evidence.ts` helper called from the existing real native-template approval/PDF scenario; create `docs/superpowers/evidence/2026-09-06-native-dwg-export-jobs.md` and generated artifact directory. No hardcoded credentials/paths or app-only test mutation APIs.

Integration-discovered regression maintenance: repair only the four stale assertions in `platform/tests/drawing-workspace-route.test.mjs` for the added native catalog notice, narrower measurement-consumer gate and shared dimension-label module. Preserve original mandatory-PDF, deferred-evidence, tool and accessibility assertions; no production change or weakened expected behavior.

- [x] Start a marked disposable stack using existing exact authority/cleanup helpers and freshly built app/worker. Create real users/project/native template via existing app/RPCs, perform actual review and approval, POST the scoped export, run two real worker claim calls concurrently, and prove only one active lease owns a job. Exercise stale worker completion after expiry/new claim and repeated actual publication RPCs without duplicate receipts. Layered evidence boundary: uncertain/lost publication response behavior is covered by the reviewed worker fault tests; this real integration does not deliberately drop a publication response.
- [x] Use real PostgREST and Storage API for stage/write/readback/settle/publication. Assert no completed status before all four artifacts verify. Authenticated direct reserved-prefix Storage access fails; authorized route downloads byte-identical AC1024 with receipt hashes; outsider/revoked reader is denied. Preserve originals and exact test-only source identities. Unknown/uncertain upload sessions remain retained; do not delete protected approvals to manufacture a passing purge.
- [x] Browser flow: approved native drawing→DWG(시험)→queued/processing→close/reopen→completed→DWG/report download. Verify exact request identity, no duplicate buttons/menus, readonly reader access, error recovery, original PDF/image exports. Do not claim independent recipient CAD verification.
- [x] Run app/worker/collaboration typechecks and builds, focused new and existing source/share/CAD/export tests, full M1 DB/browser regression. Record full commands/results, allowed prior warnings separately, actual source/build/manifest/authority/report/DWG hashes and limitations.
- [x] Final integration review of captured plan delta, resolve findings, update only verified checkboxes and evidence. Preserve dirty user work and private recovery evidence; no commit/deployment. Keep full user goal active unless customer DWG roundtrip and every remaining goal gate are actually achieved.
