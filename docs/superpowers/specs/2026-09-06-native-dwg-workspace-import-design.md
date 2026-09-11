# Native DWG workspace import

Approved Universal Workspace continuation; this unit does not redefine R2/R4/R5 completion.

## User outcome

An Editor can select a verified DWG already uploaded to the project, request analysis, see its real queued/processing/retry/failed/analyzed state, and explicitly import supported entities into the active draft canvas. Reopening resumes the same analysis request and the same ordinary durable operation outbox. Viewer cannot request or apply imports. DWG is never disguised as DXF or used as a PDF/IFC primary background.

## Chosen boundary

Reuse the existing native reader, analysis jobs, canonical preparation/attestation, DXF operation application and recovery logic, Yjs bridge, and outbox. Extract a narrowly parameterized CAD client kernel with DXF-compatible wrappers and native DWG wrappers. Do not duplicate the existing 1,137-line client, introduce dependencies, change SQL authority, or create another collaboration/state engine.

Analysis is not editing authority. Only `prepareNativeDrawingDwgProjectImport` may produce `operation-attested` plans. Raw report/receipt input from browsers is never accepted as authority. Native source identity includes the analysis job and report hash. Recovered DWG groups are re-prepared by job ID; never infer the frozen unit override from source unitSource. Exact ordered operation comparison, receipt hashes, grouped undo/redo, and source-kind pairing remain mandatory.

## HTTP contract

All actions POST to the existing canonical workspace action and suppress unrelated loader revalidation, including bounded failures. Existing authenticated session/project/document/revision/canvas/capability checks apply, with draft/freeze authority rechecked by existing RPCs.

The action URL preserves `?revision=<active revision>` for request, status, and prepare. The shared route selects the revision from the URL before validating the form; an explicitly opened older editable draft must not silently select the highest-sequence draft. A mismatching form revision remains a scope conflict.

- `request_native_dwg_import`: `revision_id`, `canvas_id`, `source_file_id`, `request_id`, `unit_code` (`""|"1"|"2"|"4"|"5"|"6"`). Server derives document/project and verified immutable source SHA; response `{ok:true,kind:"native_dwg_import_requested",error:null,result:{jobId}}`.
- `native_dwg_import_status`: `revision_id`, `canvas_id`, `job_id`. Server calls existing context RPC, validates stored scope against current workspace, returns `{ok:true,kind:"native_dwg_import_status",error:null,result:NativeDrawingDwgImportStatus}`. No source paths or report payload.
- `prepare_native_dwg_import`: `revision_id`, `canvas_id`, `job_id`. Server invokes existing production preparation and returns `{ok:true,kind:"native_dwg_import_prepared",error:null,result:PreparedNativeDrawingDwgProjectImport}`. Browser never supplies native report or authority fields.
- Failures use bounded existing route errors; current draft remains intact. Missing workers remain queued rather than fabricated completion.

## Browser lifecycle

One focused DWG import control in the existing source area, not a second editor. Select source and unit before requesting analysis. Persist a small versioned request pointer in localStorage before sending: actor/project/document/revision/canvas/source ID+SHA/unit/requestId/jobId. Storage failure prevents claiming durable recovery. A lost response retries the same request ID. A remount checks the stored matching scope; it never silently creates a new analysis job. Poll once every 2 seconds only while active, online, authorized, and pending; abort on scope switch/unmount and reject stale responses. Stop polling on terminal state/network error and expose retry/check status. Terminal failure retry creates a new request only through explicit user action. Unit/source changes get a distinct identity. No report, drawing objects, credentials, or outbox duplication in localStorage.

An analyzed job enables explicit `편집 객체로 가져오기` only when ordinary local persistence/checkpoint is ready. Use the existing command queue, bridge and outbox. Check authority/scope again when the queued callback executes; apply a plan only if current actor/revision/canvas still match. Register its exact operations in the send gate, hydrate verified canonical history if needed, and persist only unapplied suffix operations. Recovered outbox groups re-attest before ordinary send. Don't reimport on rerender or overwrite subsequent edits.

Show supported LINE/LWPOLYLINE/CIRCLE/ARC/TEXT scope, unsupported entity count/warnings, immutable original, and `DWG 편집 가져오기 · 실험 기능 / DWG 재저장·납품 호환성 미검증`. Generic editing remains available; existing native export qualification stays fail-closed.

## Entry

Project DWG open creates/opens a blank workspace with `dwgSourceFileId` query preselection; upload return accepts `dwg` and preserves the canonical workspace. Add a DWG upload link beside CAD import. Update storage-only/DXF conversion copy only where working native import now replaces it. Existing DXF/PDF/IFC flows remain unchanged. Catalog includes verified immutable DWG but primary source creation remains PDF/IFC only.

## Verification and remaining full-goal gates

Test real planner/client/command/outbox behavior for native apply, grouped undo, prefix/reload recovery, exact job/report matching, cross-kind tampering, prepare failure, and no send before re-attestation. Test route helper behavior with boundary doubles, and actual React control interactions in a browser (clearly labeled controlled transport, not production auth). Run DXF/entry/authority regressions, application and worker types, and build. Existing real reader + PostgreSQL canonical evidence remains valid unless touched; no new SQL is planned.

Actual deployment-backed browser Auth/PostgREST/Storage/worker validation, populated-ledger upgrade rehearsal, full native DWG writer/resave/recipient qualification, and remaining R5 delivery package remain outstanding full-goal gates. Do not call this unit or the full goal deployed/qualified merely because local tests pass.
