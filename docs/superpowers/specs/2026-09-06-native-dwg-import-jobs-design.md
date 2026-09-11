# Native DWG durable analysis before canonical import

## Place in the approved goal

The active Universal Workspace goal remains unchanged: R2 quick start and recovery, R4 native DWG editing/resave/recipient delivery, and R5 practical templates/delivery packages. This is the next independently verifiable R4 subsystem, not a reduction of the goal or a claim that imported DWG editing is finished.

Already verified: immutable/header-verified DWG uploads, ACadSharp 3.7.1 native reading/projection and selected-edit experiments, and credential-free/no-network Linux reader isolation. Missing: a durable service pipeline from the verified upload to the report that a future canonical import issuer can consume.

Implement that pipeline now. The next subsystem must introduce distinct `dwg_entity`/`dwg_import`, exact operation attestation, canonical grouped history/checkpoints/P6, and the actual workspace import/recovery UI. Imported-source resave authority and external recipient-CAD qualification still follow. Keep those requirements explicit; do not weaken source-free native export to appear complete.

## Boundaries and reuse

- Reuse Postgres RPC jobs and the existing isolated reader; no new queue product, state library, CAD dependency, collaboration server or paid service.
- The new job's terminal success is `analyzed`, never `completed`, `editable`, `approved`, or delivery-qualified. Every successful receipt explicitly says `qualification: experimental-unqualified`, `persistenceAuthority: not-issued`.
- No drawing objects, operations, approvals, source links, or raw source bytes are changed by this subsystem. Do not expose an unfinished import button in the workspace.
- Local implementation and disposable tests only. No staging, commit, push, deployment, remote DB change or paid license. Preserve all existing dirty changes.

## Durable identity

Strict request scope has exactly `projectId`, `documentId`, `revisionId`, `canvasId`, `sourceFileId`, `sourceSha256`, `unitOverride` (null or 1/2/4/5/6). Client supplies a separate request UUID. The actor is always the verified authenticated session, not a payload field. Actor/request UUID replays the same job only for the identical scope.

At request, claim and result publication, resolve an active real actor with current editor/admin capability and drawing feature entitlement; active document, draft/unfrozen revision and its canvas; immutable `kind=dwg` file in that project; and exactly one consumed verification row for that file. The verification row must agree on project, path, SHA-256, byte size (1..209715200) and six-byte `AC[0-9]{4}` header. Reject ambiguous receipts, wrong kind, source/target mismatch, anonymous/deleted/banned users, revoked roles, archived/deleted targets, and review/freeze boundaries. Consumed evidence may be expired; expiry matters before upload finalization, not afterward.

Persist the verification UUID, file identity, byte size, header, path, scope, actor and request UUID immutably. Claim includes the source descriptor, not a browser-provided download URL. Status omits the private path and raw report. The original requesting actor owns status/read-result access and must still have current authority; no project-wide leakage of another user's job by UUID.

## State machine and database authority

`queued -> processing -> analyzed` or `processing -> retry_wait -> processing -> failed`.

- At most 5 active jobs per project and at most 3 attempts per job.
- Lease duration 180..900 seconds; default worker 300. Reader total limit remains 120 seconds plus its bounded cleanup. Use a deadline below the lease with a publication margin.
- Claim only matching pinned immutable `sha256:<64 lowercase hex>` reader image. First claim pins the image; reclaims cannot silently change it. Use project-before-job locking and `FOR UPDATE SKIP LOCKED`; separate connections must prove single ownership.
- Each attempt records its unique lease token, attempt number, image, start/expiry and terminal outcome. Expired/reclaimed token cannot publish or fail a later attempt. Permission/source loss fails the job safely, without publishing a result.
- A completion RPC that detects revoked authority raises `PNI03` and publishes nothing. Its transaction does not pretend to retain a failure update after raising; the matching lease failure RPC or the next claim's authority revalidation terminalizes the job. No success-shaped null receipt.
- Retry after 30 then 60 seconds; at attempt 3, retryable failure is terminal. Bound caller failure codes to a small allowlist; do not store/log raw exceptions or secrets.
- Only actual database `service_role` plus signed service claims may claim/publish/fail. Session RPCs are authenticated-only. All new tables have ENABLE/FORCE RLS, no direct grants to public/anon/authenticated/service_role. Security-definer functions use empty search_path and fully qualified names, explicit execute revokes/grants.
- Protect immutable job identities/attempts/results with triggers even for table-owner diagnostics. Reuse the existing marked project-retention cascade delete guard. Normal document/file deletion must not erase analysis evidence; full authorized project purge must leave no residue.

## Result and hashing

Store one immutable result per job, bound to its successful attempt and pinned image. Keep the exact UTF-8 report JSON text (at most 33554432 bytes) and database-computed SHA-256 over that text; compare the worker-supplied digest rather than trust it. The worker uses the existing strict whole-graph `NativeDrawingDwgImportReportSchema` after the isolated reader returns, validates exact source identity, and serializes the validated report once. SQL independently checks parseable object, protocol, experimental qualification, engine ACadSharp/3.7.1, coordinate system and exact source SHA/size/header before accepting service-issued evidence. This is analysis evidence, not operation persistence authority.

An exact replay of publication for the same successful attempt/report returns the same receipt; changed report/image/lease fails. Store no plan attestation or invented projection proof. Future plan issuance must bind this immutable result and resolved units itself.

## Frozen RPC contract

All RPCs return JSONB. Errors are bounded generic messages: `PNI01` unavailable/authorization/input, `PNI02` request identity conflict, `PNI03` stale lease/publication conflict, `PNI04` invalid report evidence, `PNI05` capacity.

- `lukas_drawing_request_native_dwg_import(p_scope jsonb,p_request_id uuid)` -> `{jobId}`.
- `lukas_drawing_native_dwg_import_status(p_scope jsonb,p_job_id uuid)` -> null for no matching owned job, otherwise `{jobId,status,attemptCount,failureCode,receipt}`. `receipt` null except analyzed. Revalidate caller scope before returning.
- `lukas_drawing_claim_native_dwg_import(p_reader_image_id text,p_lease_seconds integer)` -> null or `{jobId,attemptNumber,leaseToken,leaseExpiresAt,readerImageId,actorId,scope,source:{verificationId,fileId,bucket:'lukas-qto',path,sha256,byteSize,headerVersion}}`.
- `lukas_drawing_complete_native_dwg_import(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_reader_image_id text,p_report_text text,p_report_sha256 text)` -> receipt.
- `lukas_drawing_fail_native_dwg_import(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_failure_code text,p_retryable boolean)` -> `{jobId,status}`. Codes: `source_unavailable`, `source_mismatch`, `reader_failed`, `report_invalid`, `worker_interrupted`, `authority_revoked`.
- `lukas_drawing_native_dwg_import_result(p_scope jsonb,p_job_id uuid)` -> owned/current-authority `{receipt,reportText}` only for analyzed; unavailable otherwise.
- Receipt: `{jobId,attemptNumber,readerImageId,reportSha256,reportByteSize,source:{verificationId,fileId,sha256,byteSize,headerVersion},qualification:'experimental-unqualified',persistenceAuthority:'not-issued'}`. Receipt and scope must be strictly validated by TypeScript; no tokens/path in public receipt.

## Worker and service interfaces

`drawing-native-dwg-import-jobs.server.ts`: strict scope/status/receipt/claim codecs and bounded authenticated request/status/result helpers, matching repository RPC patterns. Service-role client remains server-only.

`drawing-native-dwg-import-worker.server.ts`: `runNativeDrawingDwgImportWorkerOnce(dependencies,{signal?})` orchestrates claim, exact bounded download, real isolated read, strict report validation, publication and failure. Dependencies define only external boundaries (RPC, byte download, isolated reader); tests exercise the orchestration, not mock existence. Snapshot caller bytes, recheck source before publication, and do not publish after abort/deadline. Never parse source through the unsandboxed native reader.

`native-dwg-worker/src/import-supabase.ts` and `src/import.ts`: actual Supabase service adapter and runnable import worker command. Reuse existing worker packaging/dependencies and safe lifecycle pattern. Source download is from configured Supabase origin only, service auth is never redirected, storage path is encoded segmentwise, responses are actually streamed/bounded to expected byte size and 200 MiB maximum, unexpected content length/redirect/status/abort fails closed. RPC calls are abort-bounded too. No source/report/credentials in logs. No native host mount or service credential in the reader.

Content-Length is optional because legitimate chunked responses omit it. When present it must be a valid exact length; whether present or absent, the actual stream must stay within the immutable descriptor's bound and finish at exactly that byte count, then match its hash/header. Do not reject an otherwise exact no-header stream merely because a proxy used chunked transfer. Reject short/overlong/stalled bodies in both modes. The import CLI's SDK RPC fetch also refuses redirects so custom service `apikey` headers cannot follow a 3xx.

## Verification

TDD with independent expected values; no source-grep acceptance tests. Actual disposable PostgreSQL proves all migrations, roles/ACL, verified finalization identity, replay/conflict/capacity, two-connection claim race, image pin, expiry/stale lease, report digest/identity, permission/freeze/source loss, terminal retry, immutable evidence and marked project cascade. Node tests prove strict codecs, orchestration branches/deadlines/abort, source corruption and bounded configured-origin HTTP transport. Actual isolated reader plus real DB job lifecycle proves uploaded native bytes -> durable report -> same report read on a new authorized request, without changing bytes or authorizing objects. Browser/outbox/canonical import is explicitly not claimed by that proof.
