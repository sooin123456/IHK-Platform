# Native DWG Canonical Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn analyzed DWG evidence into durable canonical editable objects with exact native source lineage and normal grouped operation authority.

**Architecture:** Share the existing DXF phase planner and canonical history while adding a distinct native source branch and report-backed service attestation. Authenticate result retrieval before server projection; no alternate database insertion or frontend authority.

**Tech Stack:** Existing TypeScript/Zod, Supabase/PostgreSQL, Node tests, isolated ACadSharp reader.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-canonical-import-design.md`

## Global Constraints

- Existing approved active goal remains R2, R4 native DWG edit/resave/delivery, R5 templates/packages. This unit does not complete the goal.
- Local only; no staging, commit, push, deployment, remote DB changes, paid services or licenses. Preserve the exact dirty baseline; never reconstruct files from HEAD.
- No source byte mutation, DXF relabeling, new collaboration/queue/state engine or native export predicate weakening.
- Distinct `dwg_entity` source and `dwg_import` history. Exact contracts and trust boundary are in the spec; read it completely.
- The service worker/projector is the trusted issuer; do not duplicate coordinate projection in SQL or add signing infrastructure.
- Unit selection is frozen in job scope. Exact same-job replay only; a different report/job cannot overwrite existing sources.
- Do not expose an unfinished UI button. UI/polling/recovered-client re-attestation and recipient-qualified resave are explicit required next integrations.
- TDD runtime tests and real PostgreSQL authority tests; missing requested integration infrastructure must fail, not skip. No broad formatting of dirty large files.
- Worktree `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; app `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform`.

## Task 1: Native source contracts and shared canonical plan

**Files:**
- Create `platform/app/lukas/lib/drawing-cad-import-plan.server.ts`, `drawing-native-dwg-import-plan.server.ts`, `platform/tests/drawing-native-dwg-import-plan-server.test.mjs`.
- Modify `platform/app/lukas/lib/drawing-dxf-import-plan.server.ts`, `drawing-workspace.types.ts`, `drawing-workspace.server.ts`, `drawing-structure.ts`, `drawing-yjs-draft.ts` and source-kind consumers `drawing-quantity-lineage.ts`, `drawing-quantity-lineage.server.ts`, `verified-boq-v1-1.server.ts`, `platform/app/lukas/components/verified-boq-drawing-sources.tsx` only where exhaustive native compatibility requires it.
- Test existing DXF planner/source/structure/Yjs suites; add focused source hydration/quantity cases to their existing tests where applicable.
- Modify `platform/app/lukas/components/drawing-workspace.tsx` only for explicit native source labels if existing inspector fallbacks otherwise mislabel DWG as DXF; no import controls.

**Interfaces:** Export `buildNativeDrawingDwgImportPlan(input)` with exact input/output in spec and exported native plan/source types. `DrawingObjectSourceSchema` gains exact native fields; SQL `dwg_entity_json` contains the ten fields after sourceKind listed in spec. Shared phase builder preserves existing DXF public signatures, IDs and output. History schemas/validators accept homogeneous `dwg_import` without weakening DXF. Do not modify route/workspace component import controls, jobs worker, migration, M1 runner or client send gate.

- [x] Add failing tests using `native-import.json` public evidence and literal handle/object/source relationships. Assert `sources.every(s => s.sourceKind === 'dwg_entity')`, three-phase inverse correctness, no unknown extra native keys, no report/handle/unit mismatch, deterministic replay and oversized plan rejection.
- [x] Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-import-plan-server.test.mjs` and record meaningful RED before implementation.
- [x] Extract only reusable phase/chunk construction from DXF; implement native source mapping around the existing projector. Extend strict canonical hydration, source compounds, history/checkpoint and source quantity labels; keep legacy/native identity explicit.
- [x] Run focused tests, DXF regressions and `npm run typecheck`; report exact output and owned files with TDD evidence. No commit.

## Task 2: Native canonical database authority

**Files:**
- Modify CLI-created `platform/supabase/migrations/20260906011309_drawing_native_dwg_canonical_import.sql`.
- Create `platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs`.
- Modify `platform/tests/drawing-workspace-m1-real-database.test.mjs` only for focused fixture import/invocation/cleanup registration.

**Interfaces:** Implement exact context and attestation RPCs in spec. Native source fields and history kind match Task 1. Export test fixture `proveNativeDwgCanonicalImportAuthority({owner,workerA,workerB,ids,registerProject})`. Controller provides an explicitly disposable DB URL; do not provision containers. Consume production `buildNativeDrawingDwgImportPlan` when available, or coordinate with controller on a literal fixture before Task 1 is complete. Do not change TS app files. Ordinary service issuer trust is not compromised-key threat model.

- [x] Write behavioral real-DB assertions for missing RPC, strict source schema, report identity, full coverage, bad source/layer/handle/units, exact replay and changed payload, viewer/other actor/direct DML/ordinary-source creation rejection, current draft/freeze checks, complete group apply/undo/redo and source snapshot/clone/restore preservation.
- [x] Run the focused real M1 runner with supplied disposable DB before SQL; retain expected missing function/authority failure, not unrelated setup failures.
- [x] Add separate `dwg_entity_json`, explicit privileges and immutable report relationship validation. Narrowly share existing CAD phase/history/apply mechanics, preserving outputProfile and DXF wrappers. Implement `lukas_drawing_native_dwg_import_context(p_job_id,p_include_result)` and service `lukas_drawing_attest_dwg_import_plan(p_job_id,p_operations)` with exact spec receipts and guards.
- [x] Exercise real PostgreSQL until green, including inherited export/source/approval checks. Report RED/GREEN commands, outputs, limitations and changed file list. No commit.

## Task 3: Authenticated production preparation and complete canonical proof

**Files:**
- Create `platform/app/lukas/lib/drawing-native-dwg-import-source.server.ts` and `platform/tests/drawing-native-dwg-import-source-server.test.mjs`. Preserve the existing approved-export `drawing-native-dwg-source.server.ts` unchanged.
- Modify `platform/app/lukas/lib/drawing-dxf-source.server.ts` only to extract shared exact prefix receipt validation into `drawing-cad-import-receipts.server.ts` if useful.
- Create `platform/tests/fixtures/drawing-native-dwg-canonical-pipeline.mjs` for production preparation and canonical round trip from a freshly analyzed native job. After Task 2 releases the M1 runner, minimally modify `platform/tests/fixtures/drawing-native-dwg-import-pipeline.mjs` with an optional post-analysis callback after existing no-canonical-change assertions, and wire that callback in `platform/tests/drawing-workspace-m1-real-database.test.mjs`. Preserve previous default pipeline assertions and cleanup. The callback uses explicit test SQL transport and returns separate canonical proof evidence; no claim of real PostgREST/JWT/Storage.
- Controller publishes `docs/superpowers/evidence/2026-09-06-native-dwg-canonical-import.md` with scoped logs and remaining requirements.

**Interfaces:** Implement `prepareNativeDrawingDwgProjectImport(client,{projectId,revisionId,canvasId,jobId,actorId},loadAdminClient?)`; consume native plan from Task 1 and exact context/attest RPCs from Task 2. Prepared output appends verified `canonicalReceipts` and changes only prepared plan authority to `operation-attested`. Analysis/projector receipt remains `not-issued`. Reuse exact DXF receipt digest/prefix validation without weakening it. Keep error returns or safe thrown errors consistent and document the exported type.

- [x] Write failing runtime tests for authenticated target mismatch, report hash/byte/source corruption, invalid analysis receipt/status, service laziness, strict attestation response, same-job replay, exact prefix receipt recovery and changed stored operation rejection.
- [x] Implement strict authenticated context parsing, report verification, native plan projection and lazy service attestation. Reject raw client reports and partial authority.
- [x] Connect real native evidence through production preparation to real SQL, then edit/undo/redo/checkpoint/fresh read. Assert unchanged original SHA and exact native handle/job/report/source lineage. Label loopback transport accurately.
- [x] Run fresh focused native and DXF regressions, real M1 and typechecks; independent task and whole-unit reviews, scoped fixes and evidence publication. Keep overall goal active and list UI/outbox/resave qualification as unfinished.

## Controller self-review

The spec's native schema/shared planner/hydration is Task 1, SQL and all inherited source authority paths are Task 2, authenticated preparation and actual persisted proof are Task 3. The two first tasks have disjoint ownership and frozen interfaces, so they may run concurrently. Task 3 server preparation may begin against those frozen interfaces, but its shared DB fixture integration waits for Task 2 review. No new workflow is promised complete without its tests.
