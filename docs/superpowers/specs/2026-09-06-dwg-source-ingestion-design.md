# DWG source ingestion — executable boundary

Approved parent: active 1HK Universal Workspace goal. This is the next independently usable R4 slice, not a claim of completed DWG editing/delivery. User authorized scoped development without repeated approval; no deployment, purchase, commit, or destructive cleanup is implied.

## User outcome

Choose DWG in the existing project file uploader, upload through the existing resumable path, and see an immutable DWG original in the file list. Downloaded bytes must equal the uploaded bytes. List copy states `원본 보관 완료 · 편집 호환성 미검증`; no processing/qualification job exists yet, so no queued/successful conversion status is invented. Existing `other` DWGs stay unchanged.

## Contract

- Add `dwg` to existing kind policies, validators and the two SQL kind constraints.
- DWG extension is case-insensitive `.dwg`. Normalize browser MIME to `application/octet-stream` consistently in direct upload, TUS metadata and pending-resume matching. Storage already permits this MIME; retain `upsert:false` and 200 MiB maximum.
- DWG's actual TUS fingerprint lookup must use canonical MIME too; changed browser MIME cannot hide the prior journaled transfer. Preserve file name, size, last-modified time and endpoint identity plus existing exact object-path/URL checks. Non-DWG fingerprint behavior remains unchanged. Tests must exercise installed browser SDK fingerprint-keyed lookup, not unconditionally return prior candidates.
- Edge verifier reads the first six actual stored bytes across arbitrary stream boundaries and accepts the ASCII header family `/^AC[0-9]{4}$/`. This identifies a header, not parseability or compatibility. Complete stream SHA-256 and exact size remain authoritative; request fields cannot supply detected version.
- Service-only `lukas_qto_verified_uploads.dwg_header_version` is required for `dwg`, must match that six-byte family, and is null for all other kinds. The consumed ledger binds this evidence to the immutable file; do not duplicate this unqualified claim into the public file record.
- Finalizer retains signature and service-only grants. Return `dwgHeaderVersion` from locked ledger evidence (null for other kinds). Authenticated app schemas validate kind/version consistency; older non-DWG payloads may omit this newly added field for rolling compatibility.
- Recheck live actor existence, non-anonymous/non-deleted/non-banned state and existing owner/member-owner-or-estimator/staff authority before consumed replay as well as new finalization. Expired consumed evidence can replay only with current authority.
- Distinct DWG uploads are distinct originals: no same-kind advisory lock, same-SHA rejection or automatic supersedes edge. Same verification remains idempotent under the existing row lock. Preserve non-DWG behavior.
- Keep raw DWG outside existing PDF/IFC workspace creation, DXF import attestation and source-free native export authority. Do not create an editor link for raw unqualified DWG.
- Preserve existing PDF signature checks, source immutability, downloads, roles, original hashes, local journal, collaboration and approvals. No new dependency or external service for this slice.

## Verification

Focused behavioral tests for normalized upload/resume, schemas, actual streaming verification (split/invalid/short header, forged metadata, exact hash/size), and unchanged PDF behavior. A marked disposable real PostgreSQL proof covers constraints, live roles/revocation, same-verification concurrency, independent DWGs and raw-workspace denial. Real local Storage/HTTP/browser proof must upload an actual synthetic DWG, verify file-list status and download SHA, and reject invalid bytes without creating a file. Report any unexecuted gate honestly.

## Required R4 follow-on

Qualification/import worker and receipts; browser entity-to-native-handle mapping; authorized edits and approved resave; preservation of unsupported entities/resources; independent recipient-CAD delivery checks. Existing selected-handle experimental CLI and native new-DWG worker do not satisfy this complete customer-DWG flow. Continue the active goal after this source slice.

## Deployment boundary

No production deployment in this unit. For a separately authorized release, apply the forward schema migration first, deploy the upload verifier second, then deploy the application that selects the new ledger field and offers DWG. Existing non-DWG evidence remains null/omittable; immutable original bytes are never migrated. A successful local gate is not proof that these three production components have been deployed.
