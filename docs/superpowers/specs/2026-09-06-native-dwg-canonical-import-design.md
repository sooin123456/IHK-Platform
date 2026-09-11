# Native DWG canonical import authority

## Outcome and boundary

Continue the approved Universal Workspace goal by turning an existing analyzed native DWG job into a canonical, source-linked, grouped import and proving its persistence against real PostgreSQL. This unit supplies working server/import authority, not an unfinished user-facing import button. Native job polling UI, recovered-client re-attestation and recipient-qualified DWG resave remain required subsequent integration; they are not complete because this unit passes.

Reuse the native ACadSharp reader/projector, canonical collaboration operations, DXF phase/chunk planner, revision history, checkpoints and source lineage. Never relabel native DWG as DXF, mutate source bytes, bypass operation authority or weaken the source-free native export predicate.

Local implementation and disposable tests only: no staging, commit, push, deployment, remote database change, paid service or license. Preserve all existing dirty changes. Existing approval covers implementation; do not repeat approval ceremonies.

## Frozen source and operation contracts

Add an exact `dwg_entity` branch to `DrawingObjectSourceSchema`. Common fields are `id`, `objectId`, `revisionId`, `sourceFileId`, `sourceSha256`, `version`. Native fields, stored in the separate `dwg_entity_json` column, are:

```ts
{
  analysisJobId: string; // UUID
  reportSha256: string; // lowercase 64 hex
  handle: string; ownerHandle: string; layerHandle: string; // canonical nonzero uppercase hex, 1..16 chars, no leading zero
  entityType: "LINE" | "LWPOLYLINE" | "CIRCLE" | "ARC" | "TEXT";
  sourceLayer: string; // existing DrawingLayerNameSchema
  unitCode: 1 | 2 | 4 | 5 | 6;
  unitSource: "declared" | "user_selected";
  importerVersion: 1;
}
```

The immutable report is the native geometry authority keyed by job/report SHA and handle. Do not duplicate native geometry into every persisted source. Trusted clone/restore may change revision/object IDs while retaining project/file/report/native identity; it must not require the old job's target revision to equal the cloned revision.

History groups use `kind: "dwg_import"`, preserving the existing UUID/index/count shape and maximum 48 operations / 3 MiB serialized plan. Initial import uses the same three phases as DXF: create temporarily visible/unlocked layers; create atomic object/source pairs with exact inverse; restore source layer visibility/lock. No mixed native/DXF source group. Preserve all DXF IDs, bounds and public signatures.

`buildNativeDrawingDwgImportPlan(input)` in `drawing-native-dwg-import-plan.server.ts` consumes `{report, expectedSource, revisionId, canvasId, sourceFileId, unitOverride?, analysisJobId, reportSha256}`. It calls the existing strict projector, verifies the supplied report digest against exact server-owned report text before invocation in the preparation layer, and produces `{requestId, sourceSha256, units, layers, objects, sources, operations, coverage, warnings, qualification:"experimental-unqualified", persistenceAuthority:"not-issued"}`. The source ID is the projector binding ID. Layer handle/name comes from the report, not a client. Empty, invalid or oversized projections throw a typed/safe error rather than partial authority. Keep the projector unchanged.

Plan request/object/layer identities retain existing projector determinism. Exact same-job preparation replays. A second analysis job cannot overwrite an existing import whose source job/report differs; it fails closed as a conflict, even if the raw file is identical. Original job `unitOverride` is frozen; changing the interpretation requires a new analysis job, not client reinterpretation of the receipt.

## Frozen SQL API and trust boundary

The six existing analysis RPCs and their `analyzed` / `not-issued` receipts remain unchanged.

1. Authenticated `lukas_drawing_native_dwg_import_context(p_job_id uuid, p_include_result boolean default false)` returns exactly `{scope,status,result}`. `scope` is the stored seven-field job scope, `status` is the existing status DTO, and `result` is null unless explicitly requested and analyzed, when it is the existing `{receipt,reportText}` DTO. Derive scope server-side and reuse current actor/editor/draft/freeze/source checks. Non-owner/currently unauthorized reads fail PNI01. No paths, tokens or privileged issuer details leak.
2. Service-only `lukas_drawing_attest_dwg_import_plan(p_job_id uuid,p_operations jsonb)` returns exactly `{planId,planCount,alreadyAppliedCount}` like the DXF receipt. Derive actor, project, document, revision, canvas, source and units from the analyzed job. Validate full supported-entity handle coverage, unique handles/object bindings, report identity, entity/layer/source relationships, valid geometry types, exact phase/group/inverse shape and current authority. Reject client direct DML, invented/unknown/duplicated/omitted sources and changed attested operations. Exact operation request SHA and prefix receipts determine consumption/replay. Homogeneous native groups participate in canonical apply, undo/redo, incomplete-group review/freeze guards and checkpoint history.

The existing `service_role` worker/projector is the trusted issuer, as in DXF. PostgreSQL validates report-backed identity, structural schema and the exact issued operation digest; it does not independently reimplement floating-point native coordinate projection or defend against a compromised trusted issuer fabricating a valid initial geometry. No new signing system, credential role or queue. Reader image IDs are not remote attestation.

All new private tables/functions have explicit grants/revokes, RLS and immutable evidence guards. Use project-before-job/revision lock ordering consistent with existing imports. Check source JSON propagation into snapshots, clone/restore, quantity anchors and retention; do not silently discard native lineage. Service attestation cannot become a generic new-source creation bypass through ordinary `mutate_objects_with_references`.

## Server preparation

`prepareNativeDrawingDwgProjectImport(client,{projectId,revisionId,canvasId,jobId,actorId},loadAdminClient?)` in `drawing-native-dwg-import-source.server.ts` returns the prepared plan plus `canonicalReceipts` and `persistenceAuthority:"operation-attested"` only after strict authenticated context/result parsing, exact report UTF-8 byte count/hash/source verification, target/actor validation, existing projector and service attestation. Lazy-load service credentials only after all session checks. Current session/role enforcement stays in SQL. Failure returns/throws a safe explicit reason and never partial prepared authority. Reconstruct and verify exact canonical prefix receipts as DXF does; one shared narrowly parameterized receipt helper is preferable to duplicated validation. The existing `drawing-native-dwg-source.server.ts` belongs to approved native export and stays unchanged.

No route or UI claims DWG editable/delivery-qualified from the analysis receipt alone. Native export remains fail closed for imported/source-linked documents until its separate edit/resave resolver is completed.

## Acceptance and implementation sequence

1. Runtime contract/planner tests show strict native lineage, exact entity/layer mapping, grouped phases/inverses, bounds and untouched DXF behavior. Canonical source hydration/quantity labels and Yjs history accept the new explicit kind without treating it as DXF.
2. Real PostgreSQL tests show analyzed job -> service plan -> normal canonical operation application -> fresh source/state read. Exact replay, changed operation, wrong actor/source/report, omitted/duplicate handles, viewer, direct writes, freeze and clone/restore are tested behaviorally.
3. Real native fixture bytes/report connect through production preparation into real SQL, then canonical edits and grouped undo/redo/checkpoint/reopen checks. Any loopback SQL transport is labeled as such, not authenticated browser/PostgREST/Storage qualification. Source SHA remains unchanged. Missing requested infrastructure fails, never silently skips.
4. Independent reviews and fresh focused regressions/typechecks establish this unit only. Publish limitations, especially UI/recovered outbox re-attestation and native recipient qualification, without marking the overall goal complete.

## Deliberate costs

Reuse the existing CAD phase/group machinery instead of a second editor or copied DXF subsystem. Keep strict native identity separate even though it touches several existing unions. Defer UI until server authority is testable end-to-end; this means the current browser is not expected to expose this unit yet. Re-analysis for a changed unit selection and conflict rather than duplicate source replacement are intentional correctness-first restrictions. Full resave/delivery remains an explicit required goal, not a silently dropped feature.
