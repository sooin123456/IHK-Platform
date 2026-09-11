# Imported DWG resave jobs — continuation preparation

Read-only source map prepared alongside R2 work on 2026-09-06. This is not an accepted implementation design, an implemented job, or a production delivery claim. Recheck the named authority boundaries when writing the next binding spec; do not reimplement the already accepted compiler/protocol.

## Existing reuse points

- `platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql`: private `lukas_drawing_native_dwg_resave_source_for_actor(uuid,jsonb)` checks actor, exact approved snapshot, anchors, import report, verified upload and clone lineage. Public authenticated `lukas_qto_drawing_native_dwg_resave_source(p_scope jsonb)` exposes browser-safe data, not a Storage locator.
- `platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts`: `projectApprovedNativeDrawingDwgResaveSource(rawRequest,rawPayload)` and `loadApprovedNativeDrawingDwgResaveSource(client,rawRequest)` yield scope, approved authority, analysis receipt, bindings and selected edits.
- `drawing-native-dwg-jobs.server.ts`: reuse the six-field NativeDrawingDwgScopeSchema without changing source-free eligibility.
- `drawing-native-dwg-selected-edits.server.ts`: exact selected-edit request compiler; `request:null` means no-op, not an executable resave job.
- `drawing-native-dwg-resave-protocol.server.ts`: exact source/request framing and strict output decoder; `drawing-native-dwg-sandbox.server.ts`: runIsolatedNativeDrawingDwgResaver already accepts AbortSignal.
- `20260905234036_drawing_native_dwg_import_jobs.sql` and `drawing-native-dwg-import-jobs.server.ts`: immutable request identity, bounded three-attempt leases, project→job lock order, live source rechecks.
- `drawing-native-dwg-import-worker.server.ts`: uncertain completion remains publication_uncertain rather than automatic retry.
- `platform/native-dwg-worker/src/import-supabase.ts`: verified immutable source Storage transport, once a service-only source descriptor is available.
- `20260905185231_drawing_native_dwg_export_jobs.sql`, `drawing-native-dwg-worker.server.ts` and `drawing-native-dwg-download.server.ts`: staged immutable artifacts, no-overwrite upload, readback, publication and final hash-verified authorized download patterns. Source-free artifact kinds are not interchangeable with imported resave kinds.

## Minimal next contract to settle

Use a separate imported-resave jobs namespace. Public request remains scope + requestId; trusted code compiles exact edits from approved authority, hashes exact UTF-8 request bytes and produces attestation. Never accept browser-provided native edit JSON as authority. Bind immutable job identity to requester, scope, request ID, source/report/analysis identity, compiled request bytes/hash/size/handles, authority bytes/hash and pinned resaver image. Limit attempts to three.

The proposed control-plane states are queued, processing, retry_wait, cancel_requested, cancelled, completed and failed; these are candidates pending binding design, not current APIs.

Three seams require explicit implementation:

1. **Internal source claim:** current public resave source RPC omits bucket/path and is authenticated-only. Add a narrowly granted service companion that rechecks the same actor/snapshot authority and supplies the exact immutable verified locator only to a claim. Do not widen the public response or reuse the draft-only import source helper for approved resave.
2. **Cancellation:** existing namespaces have no job cancellation protocol. Poll/check live lease, cancellation and authorization with an independent control signal, then abort the controller passed to the actual resaver. Merely changing a database status does not stop its container. Cancel and publish must serialize using the same project→job lock order; cancel-first denies publication, publish-first preserves completed immutability.
3. **Artifact publication:** separate content-addressed native-dwg-resave namespace with dwg, edit_request, authority and report. Recheck lease/cancel/authority at settle/publication; preserve uncertain publication handling. Do not reuse source-free source_manifest semantics.

## Suggested implementation boundary

First unit: immutable request/status/claim/cancel control plane, actor/source attestation and actual worker AbortSignal cancellation bridge, with real PostgreSQL replay/conflict/lease/authority tests. Reuse `platform/tests/fixtures/drawing-native-dwg-import-jobs-database.mjs` and `drawing-native-dwg-resave-source-database.mjs`. Then connect staged artifacts, receipt-only downloads and authenticated browser handoff as the next independently testable unit. Do not expose a completed/downloadable result before artifact publication actually exists.

The broader required end state still includes real imported DWG edit→approve→resave→relogin→download, cancellation/retry, recipient CAD qualification and exact-approved-revision DWG/PDF/BOQ delivery. Licensing/recipient acceptance cannot be inferred from synthetic tests.

## Further bounded source trace during R2 acceptance

The service locator is already verified internally: `20260906043637_drawing_native_dwg_resave_source_authority.sql` constructs `{verificationId,fileId,bucket,path,sha256,byteSize,headerVersion}`, compares it to the analyzed import job's `source`, and returns only `{approved,analysis}` publicly. A service companion must recheck that same approved authority and expose the matching locator under the claim's locks; it must not widen the existing public response or use the draft-only import-source helper. The existing `createNativeDrawingDwgImportSourceTransport` can consume this exact full descriptor unchanged.

Before implementation, bind these two remaining design details explicitly:

- Exact canonical authority-envelope bytes and compilation placement. If a web server compiles before insertion, the insertion RPC accepting compiled request/attestation bytes must be service-only with an explicit verified actor; an authenticated-granted RPC must never accept browser-forged native edits as authority. Alternatively compile after service claim, but then define immutable job identity accordingly. Current code does not define the new envelope serialization.
- No-op replay semantics. `selectedEdits.request === null` must never be framed or invoke native code. Define request-ID behavior when the identity has already been used for a real job; do not silently bypass replay/conflict guarantees merely because a later projection is a no-op.

Cancellation needs an independent bounded control-poll signal alongside the execution signal. Abort the latter for cancellation, lost lease or revoked authority, pass it through download and the existing actual resaver, and keep control/cleanup alive long enough to acknowledge safely. Recheck immediately around native return as well as under final publication locks. Existing sandbox cleanup already uses a separate signal; do not duplicate its container lifecycle.

This trace was performed read-only by `r2_restore_acceptance`; no R4 implementation, new RPC, worker, migration or binding design is included here.

## Permission and cancellation distinction confirmed during shell completion

A further read-only trace by `r2_connection_review`, spot-checked by the main agent, adds two required design decisions rather than new implementation. The resave-source authority currently permits any non-null collaborator capability and an approved or superseded exact revision; the import-source helper requires admin/editor and draft. Therefore neither the source reader's access rule nor the import execution rule can silently define the new resave request/status/cancel policy. Specify those capabilities explicitly before exposing the control-plane endpoint; keep source-free export eligibility unchanged.

The import worker deliberately classifies external abort as retryable `worker_interrupted`, which may settle to `retry_scheduled`. A user's resave cancellation must instead be terminal and must abort the actual download/native execution without scheduling another attempt. Reuse transport/sandbox cleanup, not this retry semantic. Cover cancel-first versus settle/publish-first ordering, immediate-post-native cancellation, live authority loss, lease expiry and uncertain acknowledgement with actual control-loop tests.

The next binding design still needs exact authority serialization/compile placement, no-op request-ID replay semantics, request/cancel permissions and terminal/uncertain cancellation semantics. No completed/downloadable state may be exposed by the control-plane-only unit. Official Supabase [function privilege guidance](https://supabase.com/docs/guides/database/functions#function-privileges) and [API security guidance](https://supabase.com/docs/guides/api/securing-your-api) were consulted on2026-09-06; explicit grants and actor authorization remain separate boundaries. No database query, schema change or remote mutation was performed for this trace.

The2026breaking-change index was also scanned. [The Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) reinforces that new-table reachability must use explicit intended grants, independently of row policies; do not depend on platform default grants. No change to API gateways, managed schemas, extensions, GraphQL, SAML or client versions is proposed by this unit.
