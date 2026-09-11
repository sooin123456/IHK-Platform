# Native DWG Workspace Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect native DWG analysis and canonical import to project entry, editor UI, and durable outbox recovery.

**Architecture:** Reuse the native analysis/preparation authority and a shared CAD client kernel behind preserved DXF APIs. One focused React control owns analysis request identity and status, while the existing editor command queue/Yjs/outbox owns drawing mutations.

**Tech Stack:** Existing TypeScript, React Router, React, Zod, Yjs, Supabase, Node test and Playwright; no dependency additions.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-workspace-import-design.md`

## Global Constraints

- Work only in `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; preserve all existing dirty changes. No commits, staging, push, deploy, remote DB changes, or new dependencies.
- Analysis is not editing authority. Only `prepareNativeDrawingDwgProjectImport` may produce `operation-attested` plans.
- Reuse the existing command queue, Yjs bridge, and outbox. Native source kind stays `dwg_entity`, history kind stays `dwg_import`; never convert identity to DXF.
- DWG original bytes remain immutable. Existing native export qualification stays fail-closed.
- No browser report/receipt grants authority. All native jobs and plans remain `experimental-unqualified` for DWG resave/delivery.
- No new primary DWG background: native source is an overlay import into a blank/current canvas; PDF/IFC behavior remains unchanged.
- Independent tasks may run in parallel with disjoint file ownership and frozen interfaces. Controllers review, implementers test-first and self-review; no nested reviewer agents.

---

### Task 1: Shared CAD client and native recovered send gate

**Files:**
- Create: `platform/app/lukas/lib/drawing-cad-import-client.ts`, `platform/app/lukas/lib/drawing-native-dwg-import-client.ts`
- Modify: `platform/app/lukas/lib/drawing-dxf-import-client.ts`
- Test: `platform/tests/drawing-native-dwg-import-client.test.mjs`, existing `platform/tests/drawing-dxf-import-client.test.mjs`

**Interfaces:**
- Preserve every existing DXF export/signature and behavior via wrappers. The existing file's format-neutral operation/receipt/materialized-prefix code moves into the CAD kernel; no second copy.
- Native wrapper exports `DrawingNativeDwgImportClientError`, `applyNativeDrawingDwgImportOperations(state,actorId,operations,canonicalReceipts=[])` returning the existing applied-sequence shape, `createNativeDrawingDwgImportSendGate()` with same rememberPrepared/send API shape as DXF, and `prepareNativeDrawingDwgImportOverHttp({action,request,fetch?,signal?})`.
- Native request type `NativeDrawingDwgQueuedGroupPrepareRequest = {revisionId:string;canvasId:string;jobId:string;sourceSha256:string}`; HTTP sends only revision_id,canvas_id,job_id and intent prepare_native_dwg_import. Never reconstruct frozen unit override.
- Kernel validates one homogeneous kind across all group metadata and corresponding forward/inverse sources; DWG group source identity additionally requires one analysisJobId and one reportSha256. Cache identity includes kind. Undo/redo derived operations bypass original import re-attestation as before.

- [x] Write behavior tests using the real native plan builder and literal small report (or accepted public synthetic report). Capture RED when native APIs/behavior are absent. Test originals, grouped undo/redo, receipt prefix recovery, two native source jobs/report hashes mixed, mixed dxf/dwg history kinds even on source-free chunks, invalid/incomplete/reordered group, altered inverse and prepare mismatch/no-send.
```js
await assert.rejects(() => gate.send({ operation: altered, knownOperations: async () => plan.operations, prepare, send }));
assert.equal(sent, 0);
```
- [x] Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-import-client.test.mjs` from platform and record expected failure.
- [x] Extract common kernel and implement thin wrappers. Shared exact comparison is the authority check, not a trusted boolean. Prepared native responses require operation-attested and experimental-unqualified fields before use.
```ts
form.set("intent", "prepare_native_dwg_import");
form.set("revision_id", request.revisionId);
form.set("canvas_id", request.canvasId);
form.set("job_id", request.jobId);
```
- [x] Run native + existing DXF client tests and app typecheck; record outputs and changed file list in task report. No commit.

### Task 2: Authenticated DWG actions and project entry

**Files:**
- Create: `platform/app/lukas/lib/drawing-native-dwg-import-action.server.ts`, `platform/tests/drawing-native-dwg-import-action.test.mjs`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`, `platform/app/lukas/lib/drawing-workspace.server.ts`, `platform/app/lukas/lib/drawing-entry.ts`, `platform/app/lukas/screens/project.tsx`, `platform/app/lukas/screens/drawing-workspace-new.tsx`, `platform/app/lukas/components/drawing-workspace-start.tsx` (actual create_dwg form intent/label)
- Test: `platform/tests/drawing-workspace-entry-flow.test.mjs`, `platform/tests/project-dwg-source.test.mjs`, `platform/tests/drawing-dxf-route-contract.test.mjs` and focused entry tests as needed.

**Interfaces:**
- Produce the three exact native HTTP intents/responses defined in the spec (copy them verbatim). Use a focused server helper for parsing/current workspace scope/verified file selection and existing native RPC/preparation calls. It accepts the actual application Supabase client without caller casts; new dynamic RPC adaptation stays inside strict boundary.
- Add `drawingWorkspaceDwgUploadPath(projectId,workspaceId):string` in drawing-entry.ts, mirroring DXF with `kind=dwg`. DWG new-workspace and upload-return carry `dwgSourceFileId` (DXF remains dxfSourceFileId).
- Extend only source catalog file-kind acceptance to dwg; don't expand primary source PDF/IFC checks.
- Native status uses stored context RPC `{p_job_id,p_include_result:false}` then exact current project/document/revision/canvas comparison. No source/report paths exposed.

- [x] Write failing behavioral tests: editor request emits server-derived SHA and scope; viewer/approved/wrong canvas/wrong project/unverified/non-DWG fail before request/admin; status wrong stored scope/job fails; prepare passes server actor and job only; unknown/malformed forms rejected. Boundary doubles assert exact RPC args and no side effects on reject.
```js
assert.equal(requestedScope.sourceSha256, verifiedFile.sha256);
assert.equal(requestedScope.documentId, workspace.document.id);
assert.equal(adminLoads, 0); // invalid/unauthorized request or status
```
- [x] Capture RED, then implement helper and bounded route branches with existing auth headers/error handling. Request idempotency belongs to existing RPC; no job insertion through tables.
```ts
return { ok: true, kind: "native_dwg_import_requested", error: null, result: await requestNativeDrawingDwgImport(rpcClient, scope, requestId) };
```
- [x] Add DWG catalog selection and true DWG project/new-workspace/upload-return links. Replace coercion/storage-only copy where linked, preserving secure upload verifier and primary-source exclusions. shouldRevalidate must leave unsaved local state alone for these intents.
- [x] Run helper and entry/DXF route regressions, app typecheck, self-review and report. No commit, no migration or production configuration changes.

### Task 3: Durable analysis UI and editor integration

**Files:**
- Create: `platform/app/lukas/components/drawing-native-dwg-import.tsx`, `platform/app/lukas/lib/drawing-native-dwg-import-session.ts`, `platform/tests/drawing-native-dwg-import-session.test.mjs`, `platform/e2e/drawing-native-dwg-import-control.spec.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Optional owned test harness: `platform/e2e/utils/drawing-native-dwg-import-control.tsx`, `platform/playwright.native-dwg-import.config.ts`

**Interfaces:**
- Consume Task 1 native client exports and Task 2 HTTP contracts/source catalog/query/upload link. Native prepared plan type is existing `PreparedNativeDrawingDwgProjectImport` via type-only import.
- Focused control props: action URL; scope `{actorId,projectId,documentId,revisionId,canvasId}`; sources `{id,sha256,originalFilename,byteSize}[]`; optional initialSourceId; canRequest; canApply; online; and `onPrepared(plan):Promise<void>`. Exact exported props/type name is implementer-local, record in report.
- Session helper owns strict pointer parsing/key/read/write; localStorage only small versioned request pointer, never drawing state. Pointer identity includes actor/project/doc/revision/canvas/source ID+SHA/unit/request ID/job ID.
- Main workspace owns `onPrepared`: check latest authorization and scope inside command queue, call native apply, rememberPrepared, hydrate canonical history, persist suffix using existing bridge/outbox. Compose native and DXF send gates in existing outbox flush; no new send path.

- [x] Write failing session tests for scope isolation, persistent request before network, lost-response same request ID retry, storage failure surfaced, source/unit changes new identity, malformed pointer ignored safely. Write real component browser tests with controlled HTTP transport for queued→analyzed→explicit apply, failed/unauthorized state, same request across remount, scope switch cancels stale response, viewer no request, offline no polling.
```ts
await page.getByRole("button", {name:"DWG 분석 시작", exact:true}).click();
await expect(page.getByRole("status")).toContainText("분석 대기");
await page.reload(); // controlled storage/session fixture remains; no new request identity
```
- [x] Implement one compact source-area control with 2-second bounded pending polling, explicit retry/check/apply, no auto-import, real worker queue semantics, scope/authority cancellation, and support/qualification warning. Unit selection precedes analysis; changed units explicitly start another request.
- [x] Wire the control in the existing workspace, native gate lifecycle and prepare callback, and queued mutation handling. Apply readiness mirrors DXF checkpoint/outbox guard; recheck inside queued callback. Use explicit `dwgSourceFileId` preselection and DWG upload path. Surface counts/warnings and distinguish queued local persistence from canonical saved state.
- [x] Run session/client regressions and real browser control tests against local disposable harness; clearly label HTTP double vs actual Auth/Storage. Run typecheck and report TDD output/owned files. No commit/deploy.

### Task 4: Cross-task validation and evidence

**Files:**
- Create: `docs/superpowers/evidence/2026-09-06-native-dwg-workspace-import.md` and its log directory.
- No unrelated production edits; send review fixes back to owners.

**Interfaces:** Consume tasks 1–3 reports and current-baseline scoped diffs; verify actual browser control + shared recovery path without changing native SQL/export boundaries.

- [x] Review each task (spec + quality), resolve concrete important findings with scoped follow-up reviews. Check exact producer/consumer contracts and all native outbox send locations.
- [x] Run combined native/DXF client/action/entry/source/quantity/command/outbox/Yjs regressions plus app/collaboration/native worker typechecks and production build. Capture return codes and immutable code hashes.
```sh
NODE_OPTIONS=--no-experimental-webstorage npm run typecheck
NODE_OPTIONS=--no-experimental-webstorage npm run build
```
- [x] Run browser control spec and record screenshot/output; run broader real DB only if changed logic requires new SQL evidence. Never represent controlled browser transport as real Supabase Auth/PostgREST/Storage.
- [x] Final whole-unit review against current dirty baseline, then one consolidated fix wave if needed. Publish evidence, preserve HEAD/index and unrelated files, retain private recovery records because no commits authorized. Keep full goal active with remaining native resave/delivery/R5 gates explicit.
