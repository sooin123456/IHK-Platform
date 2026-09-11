# Approved imported-DWG resave source

## Goal and boundary

Connect the existing five-entity selected-edit compiler to actual approved canonical revisions, including cloned revisions. This is an R4 integration unit, not completion of the Universal Workspace goal or a production DWG qualification. R2 authenticated runtime validation can run independently against a frozen copy of the current worktree.

The existing source-free native export resolver, worker, receipts and UI retain their contract. Imported resave needs its own authority branch; widening the source-free resolver would silently discard source provenance. This unit implements source resolution and compilation, not a second queue, public download endpoint, licensed engine, billing or deployment.

## Inputs and authority

- The caller supplies only `{projectId, documentId, revisionId, revisionVersion, canvasId, snapshotSha256}`, using the existing strict `NativeDrawingDwgScopeSchema`.
- New authenticated RPC: `public.lukas_qto_drawing_native_dwg_resave_source(p_scope jsonb) -> jsonb`.
- New private resolver: `private.lukas_drawing_native_dwg_resave_source_for_actor(p_actor_id uuid,p_scope jsonb) -> jsonb`. No direct application-role grants on the private helper. The public function requires a verified nonanonymous current session and current project access. Private resolution checks live actor/membership, inactive/deleted/banned actors, project retention/archive/deletion and exact scope before returning source evidence.
- Result shape is `{approved, analysis}`. `approved` has the same project/document/canvas/revision/snapshot/approvalDecision envelope as the existing approved source payload, without source-free semantics. `analysis` is `{scope, result}`: existing strict import scope and import result/receipt/report-text schemas. No bucket, storage path, credentials, signed URLs or arbitrary browser edits are returned.
- Exact approved/superseded snapshot version/hash/approval, digest recomputation, schema version 2 and existing 20 MiB snapshot bound are required. Frozen snapshot is the only edited-object authority.
- Exactly one page and one canvas, no PDF/IFC/background/calibration, no blocks/instances or unsupported source families. Each active canonical object has exactly one DWG source. All sources refer to one analysis job/report/verified file/unit choice and cover the analyzed report's imported entities exactly. No added/deleted/duplicated/mixed-source objects may be silently ignored. Empty unrelated default layers are allowed, but every imported layer must retain its native semantics.
- Join the immutable analyzed import job/result to the immutable DWG file and exactly one consumed verified upload. Validate project, source SHA/size/header, report SHA/byte size/content digest, reader receipt and unit choice. The historical analysis revision may differ after a trusted clone; do not use the draft-only import resolver after approval.
- Historical deleted source rows, incompatible document source/background, foreign IFC bindings and mismatched canonical/live scope must fail closed. DB source/source-handle checks and strict server projection jointly enforce eligibility; neither preview output nor analysis receipt grants persistence authority.

## Server adapter

New `drawing-native-dwg-resave-source.server.ts` exports:

```ts
projectApprovedNativeDrawingDwgResaveSource(rawRequest: unknown, rawPayload: unknown)
loadApprovedNativeDrawingDwgResaveSource(client: { rpc: unknown }, rawRequest: unknown)
```

Both return the validated scope, approved snapshot identity, immutable public import receipt and the existing selected-edit result under `selectedEdits`. The projector rehashes exact snapshot/report bytes, hydrates the existing authority snapshot, rebuilds the native import baseline from the stored report and frozen units, and maps canonical objects to projected IDs through strictly validated DWG handle/owner/layer/type/source anchors. Clone-only IDs are normalized internally; geometry, name, style and native layer semantics are never normalized away to suppress a mismatch. Map each canonical imported layer one-to-one to the corresponding report layer before adapting object layer IDs. Current geometry/version and permitted TEXT font-size changes reach the unchanged compiler. Return current object ID to native handle bindings for audit.

No-op keeps `selectedEdits.request === null`. Unsupported edits reject; do not generate an empty native request or claim a new artifact. Errors use a single non-sensitive `DrawingNativeDwgResaveSourceError` with code `NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE` and no raw SQL/report/path leakage. Result remains `experimental-unqualified`, `persistenceAuthority: not-issued`.

## Verification and continuation

TDD against real functions, not source-text assertions. Test approved original and clone, changed five-type geometry, no-op, tampered snapshot/report, wrong scope/unit/handle/type/layer, missing/extra/duplicate sources or objects, changed unsupported styles, unauthorized/foreign/anonymous/banned actors and unapproved snapshots. Execute the DB RPC against disposable real PostgreSQL with canonical import, approval and clone operations; retain original source-free resolver rejection of imported drawings. Test server RPC mapping and error normalization.

Reuse the actual native CLI test for compiler output where a fresh DLL is available; qualify path-based CLI execution is only a local proof and never a production worker. Independent CAD recipients, immutable resave queue/isolated protocol/Storage publication/UI and same-approved-revision delivery package remain explicit next units of the active full goal.

## Global constraints

- Preserve existing dirty worktree changes; no commit, stage, merge, push or deployment.
- No new dependency, paid service, license contract or remote DB/Storage mutation.
- No changes to source-free native export or selected-edit compiler contracts.
- Original source bytes and approved revisions remain immutable.
- Native output remains experimental-unqualified; persistenceAuthority remains not-issued.
- Do not modify or restart the live port 4173 preview, or overwrite its platform/build assets.
- Use only owned disposable local fixtures; do not use customer data.

## Design choice

Compared with extending the existing source-free export or trusting client edits, a separate resolver reuses the snapshot/import/compiler building blocks while preserving their authority distinctions. A complete duplicate export queue is intentionally not added before this source contract is exercised. The cost is one subsequent queue/protocol integration unit; no UI claim is made prematurely.
