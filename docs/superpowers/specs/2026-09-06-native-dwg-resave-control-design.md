# Imported DWG resave admission and cancellation

## Scope and decisions

This is the next R4 backend subsystem, not completion of R4/R5. Reuse the accepted approved-source projector, five-type compiler, immutable source transport and isolated native resaver. Build immutable admission, leased claims, live control and actual execution cancellation. Artifact upload/publication, download receipts and UI/CLI scheduling are the immediately following integration unit; this subsystem must not advertise completed or downloadable output.

The user has instructed continued implementation without further approval prompts. This design records the selected behavior before implementation. It does not authorize staging, deployment or customer-data mutations.

Compared with compiling after claim, compile-before-admission fixes the exact request/authority bytes at the user's request boundary. Compared with widening source-free export, a separate namespace retains imported-source provenance. Chosen approach: authenticated source read and verified user identity → trusted server compilation → service-only admission with live database revalidation. The worker recompiles the freshly claimed authority and compares exact attestation bytes before executing.

### Global constraints

- Preserve existing dirty worktree changes; no commit, stage, merge, push or deployment.
- No new dependency, paid service, license contract or remote DB/Storage mutation.
- No changes to source-free native export or selected-edit compiler contracts.
- Original source bytes and approved revisions remain immutable.
- Native output remains experimental-unqualified; persistenceAuthority remains not-issued.
- Do not modify or restart the live port 4173 preview, or overwrite its platform/build assets.
- Use only owned disposable local fixtures; do not use customer data.

## Authority and exact serialization

Browser-facing input remains the six fields of `NativeDrawingDwgScopeSchema` plus `requestId`; reject additional actor, edits, image, path and attestation fields. Canonicalize UUIDs to lowercase before hashing or transport. Server identity comes from `userClient.auth.getUser()`, followed by the existing authenticated approved-source RPC; never accept an actor ID from a browser field. The resaver's immutable `sha256:<64lowerhex>` image ID is a trusted server argument, not a browser option.

`buildNativeDrawingDwgResaveAttestation(rawScope, rawPayload, rawImageId)` calls the existing `projectApprovedNativeDrawingDwgResaveSource`. Its result is exactly:

```ts
type NativeDrawingDwgResaveAttestation = {
  resaverImageId: string;
  request: { text: string; sha256: string; byteSize: number; handles: string[] } | null;
  authority: { text: string; sha256: string; byteSize: number };
};
```

For a real edit, `request.text` is `JSON.stringify(projected.selectedEdits.request)` with no BOM, whitespace or trailing newline. SHA-256 and byte count use exact UTF-8 bytes; maximum2MiB,1–10000 numerically sorted unique uppercase native handles. A no-op has `request:null` and is never framed or executed.

`authority.text` is `JSON.stringify` of the following keys in this insertion order (maximum64MiB), without a trailing newline:

1. `schemaVersion: "1hk-dwg-resave-authority/1"`
2. `scope`: strict normalized six-field scope in existing schema order
3. `approved`: projector's `{revisionId,revisionVersion,snapshotSha256,operationSequence}` in that order
4. `analysis`: `{scope: payload.analysis.scope, receipt: projected.analysisReceipt}`, using the existing strict schemas' property order
5. `bindings`: projector's numerically handle-sorted `{objectId,handle}` bindings
6. `request`: `{sha256,byteSize,handles}` in that order, or null
7. `resaverImageId`
8. `snapshotCanonicalJsonText`: exact original approved snapshot text, not reserialized JSON
9. `qualification: "experimental-unqualified"`

Current mutable revision status is excluded: approved→superseded must not change immutable snapshot identity. Snapshot and analysis content are still revalidated by the existing projector. The authority envelope carries the approved snapshot and immutable analyzed-report receipt, not a Storage locator or duplicated report text. Hashes are not authority by themselves; admission rechecks current database evidence, and execution recompiles the exact stored report/snapshot.

## Permissions and namespace

- New tables: `lukas_drawing_native_dwg_resave_jobs`, `lukas_drawing_native_dwg_resave_attempts`. Force RLS; revoke direct application, service and collaboration-role table privileges. Only narrowly granted RPCs act on them. Retention cleanup reuses the existing guarded project-delete mechanism.
- Request: any verified nonanonymous current collaborator whose exact approved/superseded scope passes the existing resave authority. This explicitly matches approved-export access, not draft editing authority; Viewer can request a derived approved artifact but cannot edit a drawing.
- Status: any verified current collaborator with that exact approved scope. Return only jobId,requestId,status,attemptCount,failureCode,hasChanges; no actor/attestation/source locator/lease/receipt.
- Cancel: the requester or a current admin, with verified session and current scope access. No other editor/viewer may cancel another user's job. Workers independently stop revoked jobs even if the former requester can no longer cancel.
- Public source response remains `{approved,analysis}` and unchanged. A new private context helper calls the existing private actor resolver, then retrieves the exact import-job source it already verified. Only service claim exposes `{payload,source}`. No reuse of draft-only import eligibility.

## Admission and identity

Service-only `lukas_drawing_admit_native_dwg_resave(p_actor_id uuid,p_scope jsonb,p_request_id uuid,p_attestation jsonb)` requires both database role and JWT role `service_role`. It locks project, then actor/request advisory identity, then any matching job. Identity is unique across projects for `(requested_by,request_id)`.

Revalidate active actor, entitlement, archive/retention, approved exact snapshot and source context under the project lock. Validate strict attestation object shape, byte bounds/digests, request metadata/handles/source SHA, and parsed authority envelope equality with the fresh database evidence. Trusted server compilation determines edit geometry; authenticated roles cannot call admission. Immutable job fields are actor/request ID, normalized scope, full verified source, entire attestation including text hashes, and pinned image. Same identity returns the same `{jobId,requestId,hasChanges}`; changed scope or attestation conflicts (`PNR12`), including real-job request ID reused against a no-op.

A fresh no-op is recorded in the same table as terminal `no_changes`, has zero attempts, and consumes no active-job capacity. Do not return before replay checks. Active capacity is five per project. Replay succeeds even at capacity. Browser/server errors expose only invalid/unavailable/conflict/stale/capacity classifications, not SQL, report text, paths or credentials.

## Lease state machine

States for this unit: queued,processing,retry_wait,cancel_requested,cancelled,no_changes,failed. There is deliberately no completed state or download receipt. Attempts are append-only except their one final outcome; all request fields and terminal rows are immutable. Delete uses the existing project-retention guard.

- Claim: service-only `lukas_drawing_claim_native_dwg_resave(p_resaver_image_id text,p_lease_seconds integer default300)`. Lease180–900seconds, default300. Choose eligible queued/retry_wait or expired processing jobs for the exact pinned image; lock project→job with skip-locked. Recheck live source/authority. Maximum three attempts. Mark expired attempt before issuing a new random lease token; exhaustion or revoked authority becomes failed. Cancel-requested jobs never receive another attempt; expired cancellation can be finalized without publication.
- Claim result: `{jobId,attemptNumber,leaseToken,leaseExpiresAt,actorId,scope,source,attestation,payload}`. Source is existing strict verified full import source; payload is fresh `{approved,analysis}`. Worker must rebuild attestation and compare it exactly before source download or native invocation.
- Control: service-only `lukas_drawing_native_dwg_resave_control(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)`. Use project→job locks and exact token/attempt. Return `{jobId,attemptNumber,leaseToken,action,reason}` where action is continue/cancel/stop; reason is null/cancel_requested/authority_revoked/lease_expired. A stale token raises `PNR13`. Continue requires processing, unexpired lease and unchanged live source plus approved authority. Cancel has precedence for the matching cancel-requested attempt; it does not itself confirm process cleanup.
- Failure: service-only `lukas_drawing_fail_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_failure_code text,p_retryable boolean)`. Exact active unexpired lease. Source unavailable/resaver failure/interruption may retry within three attempts with30×attempt seconds backoff; source mismatch, authority mismatch/revocation and invalid output are terminal. A cancel-requested attempt cannot be changed to retry_wait by a concurrent failure acknowledgement. Unknown settlement is not treated as success or an immediate new request.

Failure codes: source_unavailable,source_mismatch,resaver_failed,output_invalid,worker_interrupted,authority_revoked. Error codes: `PNR11` unavailable/invalid, `PNR12` identity conflict, `PNR13` stale lease, `PNR15` capacity. Existing resave-source `PNR01` is unchanged.

Failure settlement returns exactly `{jobId,attemptNumber,leaseToken,status}`, with status retry_wait or failed. Service cancellation acknowledgement returns the same four-field identity with status cancelled. Validate all three identity fields against the claim before treating either response as settled; these service-only receipts are not the public status shape and are not artifact publication receipts.

## Cancellation and execution

Authenticated `lukas_drawing_cancel_native_dwg_resave(p_scope jsonb,p_job_id uuid)` uses project→job locks. Queued/retry_wait becomes cancelled without another attempt. Processing becomes cancel_requested, preserving exact attempt/token; duplicate cancel is idempotent. A matching service `lukas_drawing_ack_native_dwg_resave_cancel(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)` finalizes cancelled after execution/cleanup stops; exact acknowledgement replay is safe. A replaced attempt cannot acknowledge cancellation of a newer token. Terminal no_changes/failed/cancelled rows stay terminal. Publication in the next unit must use the same lock order: cancel-first denies it; publish-first keeps an immutable completed receipt.

The execution bridge starts with a successful control check, then uses a separate execution AbortController for source transport and `runIsolatedNativeDrawingDwgResaver`. An independent bounded control poll runs every1000ms with a5000ms RPC deadline; cancellation, revocation, lease expiry or control uncertainty aborts execution. The control/acknowledgement and existing sandbox cleanup signals remain alive. Stop the poll and await owned execution cleanup on every exit. Recheck control immediately after native return; a late or abort-ignoring result is not a prepared result.

The bridge returns an internal prepared result only after byte-exact source/request/output validation and post-native control. It issues no completed receipt and is not connected to a scheduled worker/UI until immutable artifact publication is implemented. Cancellation returns cancelled only after confirmed acknowledgement; lost acknowledgement is control_uncertain, not automatic retry. Ordinary transport/native failure settles through the fenced failure RPC; failure acknowledgement uncertainty remains settlement_uncertain. Worker shutdown is interruption, not user cancellation. Reuse existing sandbox process lifecycle and verified source transport unchanged.

### Cleanup evidence boundary (pre-Task3 integration ruling)

The existing generic sandbox rejection conflates ordinary execution abort with failure to remove its owned container/config directory. Awaiting that rejection does not itself prove cleanup. Preserve the existing process lifecycle, reader contract, public error message and resource limits, but add the narrow exported `NativeDrawingDwgResaveSandboxError` with readonly `cleanupConfirmed:boolean` for resaver failures only. It exposes no locator or native error detail. Mark each owned resource unsettled before its creation attempt, and clear it only after the existing exact removal confirmation. A failure before any creation attempt can be confirmed; uncertain creation/removal or CLI-directory cleanup must remain unconfirmed. Reader errors remain the old generic Error. No lifecycle retries or new cleanup operations are introduced.

The execution bridge may acknowledge cancellation only when no native invocation occurred, the native promise fulfilled (after existing cleanup), or it rejected with this trusted sandbox error carrying cleanupConfirmed:true. An untyped native rejection or cleanupConfirmed:false is uncertainty, not proof that native work has stopped: return control_uncertain for requested cancellation, settlement_uncertain otherwise, without cancellation/failure acknowledgement or prepared output. Cover both flags, unknown errors and ordinary abort with confirmed cleanup. This narrow error metadata exception replaces the blanket “sandbox unchanged” wording only; original authority and lifecycle constraints remain binding.

## Verification and handoff

Task1 proves exact deterministic attestation from the real projector/compiler, five-type changes/no-op, invalid scope/source/report/image, and digest/canonical envelope mutation refusal. Task2 proves database grants/RLS, immutable replay/no-op conflict/capacity, live source claim, three-attempt/stale lease behavior and cancel/failure ordering using the existing real PostgreSQL fixture and independent sessions. Manufacture corruption only in rolled-back owned fixture transactions; never weaken source guards. Task3 proves actual execution signal cancellation during download/native await, post-native cancellation, cleanup and uncertain acknowledgements; pair it with a real sandbox cancellation probe when the existing immutable image is available.

Continue with content-addressed `{dwg,edit_request,authority,report}` no-overwrite/readback/publication, receipt-only authorized downloads, authenticated import→edit→approve→request→worker→relogin→download, and exact-revision DWG/PDF/BOQ handoff. Independent recipient CAD and licensed representative corpus remain external qualification, not inferred from synthetic success.
