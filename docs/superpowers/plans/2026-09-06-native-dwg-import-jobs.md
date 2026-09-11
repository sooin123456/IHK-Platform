# Native DWG Import Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make verified DWG uploads produce durable, isolated, retryable native analysis evidence for the next canonical-import subsystem.

**Architecture:** Reuse existing Supabase job authority, immutable verified sources and the isolated native reader. A strict server pipeline stores exact report evidence without issuing drawing-operation authority; it leaves current DXF/canonical/export behavior unchanged.

**Tech Stack:** Existing PostgreSQL/Supabase, Node/TypeScript/Zod, Docker/Linux, ACadSharp 3.7.1.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-import-jobs-design.md`

## Global Constraints

- The active Universal Workspace goal remains unchanged: R2 quick start and recovery, R4 native DWG editing/resave/recipient delivery, and R5 practical templates/delivery packages.
- The new job's terminal success is `analyzed`, never `completed`, `editable`, `approved`, or delivery-qualified. Every successful receipt explicitly says `qualification: experimental-unqualified`, `persistenceAuthority: not-issued`.
- No drawing objects, operations, approvals, source links, or raw source bytes are changed by this subsystem. Do not expose an unfinished import button in the workspace.
- Reuse Postgres RPC jobs and the existing isolated reader; no new queue product, state library, CAD dependency, collaboration server or paid service.
- Local implementation and disposable tests only. No staging, commit, push, deployment, remote DB change or paid license. Preserve all existing dirty changes.
- Task-owned tests must fail against missing/broken behavior first; use real PostgreSQL for SQL authority, not PGlite/static text. Never weaken the source-free native-export predicate.
- Workdir: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform`. Read the spec, which contains the binding exact RPC contract and bounds. Do not read sibling-plan private workspaces.

## Task 1: Durable analysis database authority

**Files:**
- Modify the CLI-created empty migration `platform/supabase/migrations/20260905234036_drawing_native_dwg_import_jobs.sql`.
- Create `platform/tests/fixtures/drawing-native-dwg-import-jobs-database.mjs`.
- Modify `platform/tests/drawing-workspace-m1-real-database.test.mjs` to call the fixture and register cleanup targets.
- Modify `platform/database.types.ts` only for exact new tables/RPCs if manually maintained repository conventions require it.

**Interfaces:** Implement all six frozen RPCs in the spec, with the exact JSON contracts. The DB test fixture exports `proveNativeDwgImportJobAuthority({owner,workerA,workerB,ids})`, creates its own verified DWG source by real finalization and blank document, returns its project ID, and registers cleanup intent before risky setup via a callback if needed. The controller supplies an explicitly disposable local PostgreSQL URL; do not start containers or change a remote database.

- [x] Write behavioral real-DB fixture tests for absence of authority, legitimate editor source/target creation, same-request replay and changed scope rejection, viewer/outsider/anonymous rejection, ambiguous consumed verification, all table/function grants, dual-worker claim race, pinned reader image, stale/expired lease, exact report/source/hash rejection, exact publication replay, role/freeze/source revocation, three-attempt retry termination and evidence immutability. Reuse existing real M1 runner and local fixture conventions.
- [x] Run focused real M1 test before adding SQL; retain the expected missing-RPC failure.
- [x] Implement scoped private validation/helpers, forced-RLS tables, leases/attempts/results and RPCs with explicit grants, actual DB-role plus claims service check, project-before-job locks and existing marked retention delete guard. No generic new operation authority or copied 1,400-line export state machine.
- [x] Run the real M1 test until green; ensure prior export/source/approval tests still run. Report exact commands, RED/GREEN evidence, output and owned files. Do not commit.

## Task 2: Strict service adapter and isolated read worker

**Files:**
- Create `platform/app/lukas/lib/drawing-native-dwg-import-jobs.server.ts`.
- Create `platform/app/lukas/lib/drawing-native-dwg-import-worker.server.ts`.
- Create `platform/native-dwg-worker/src/import-supabase.ts` and `src/import.ts`.
- Modify `platform/native-dwg-worker/README.md` and `platform/package.json` for the real import command (no dependency installation).
- Create `platform/tests/drawing-native-dwg-import-jobs.test.mjs` and `drawing-native-dwg-import-worker.test.mjs`.

**Interfaces:** Consume all frozen RPCs and JSON shapes from the spec, plus existing `runIsolatedNativeDrawingDwgReader` and strict `NativeDrawingDwgImportReportSchema`/source schema. Export strict codecs/session helpers from jobs module; export `runNativeDrawingDwgImportWorkerOnce(dependencies,{signal?})` and a real Supabase dependency factory/CLI. Agree concrete TS dependency names in the task report for Task 3. Scope/source/receipt exactness must match database output, not permissive parsing. Retain output `not-issued`; projection/canonical operations are later work.

- [x] Write failing runtime tests for strict scope/claims/receipt parsing and actual orchestration branches: idle, successful report publication, source length/hash/header corruption, invalid/changed report, reader error, cancellation before and after native read, deadline before publication, stale completion, ambiguous completion response and bounded failure handling. Do not retry a possibly successful completion with a different identity.
- [x] Write actual local HTTP transport tests for configured-origin RPC/storage authorization, encoded paths, redirects, lying/missing Content-Length, oversized/short stream, early abort/stall, malicious path/origin/configuration and safe error output; keep any parser double at the native-process boundary.
- [x] Implement the minimal service pipeline with lease-aware bounded signals, immutable image pin and report digest. Source cap 209715200; report cap 33554432; lease 180..900 (default 300), parser maximum 120000 ms plus bounded cleanup; leave publication margin. Use abortable SDK RPC calls and bounded streaming HTTP for source download; fail closed on malformed external results.
- [x] Add runnable import CLI using existing worker package with SIGINT/SIGTERM abort and safe logs. Reuse configuration/lifecycle where useful without destabilizing export or introducing a universal worker framework.
- [x] Run focused Node tests and app/worker typechecks, formatting touched files, and report RED/GREEN evidence. Do not commit.

## Task 3: Real native bytes to durable analysis proof

**Files:**
- Extend `platform/tests/fixtures/drawing-native-dwg-import-jobs-database.mjs` or add `platform/tests/fixtures/drawing-native-dwg-import-pipeline.mjs` for the actual pipeline proof.
- Extend `platform/tests/drawing-workspace-m1-real-database.test.mjs` with an explicit required-native proof switch that never silently skips a requested proof.
- Add/update a focused native pipeline test if needed under `platform/tests/drawing-native-dwg-import-pipeline.test.mjs`.
- Publish verified evidence to `docs/superpowers/evidence/2026-09-06-native-dwg-import-jobs.md` and its scoped evidence subfolder. The controller owns final evidence assembly.

**Interfaces:** Consume Task 1 real PostgreSQL authority and Task 2 worker contracts. Use an existing public evidence DWG, compute source metadata from its actual bytes and finalize matching upload evidence in the disposable DB. Run the production orchestration with the actual isolated Docker reader and real SQL RPCs; any test HTTP transport must be explicitly labeled, not claimed as authenticated browser/Supabase storage verification. Better reuse a real configured local Supabase origin when readily available; no production credentials.

- [x] Add a failing integration test before implementation glue; prove a missing/wrong publication prevents a persisted result. Require explicit immutable reader image + explicit local Docker socket and fail if unavailable when requested.
- [x] Exercise actual bytes -> exact verified descriptor -> real competing claim -> isolated reader -> strict report -> actual SQL publication -> new authorized result request. Assert literal fixture entities/handles/layers, report/source hashes, byte-preservation, immutable receipt, `analyzed`/`not-issued`, no objects/operations/source-link changes, unauthorized reread rejection, and zero owned parser/DB residue after successful bounded cleanup queries.
- [x] Run fresh focused regressions, real M1 PostgreSQL with native proof, Node worker/source/sandbox tests and typechecks. Keep SQL authority and external-CAD/browser qualification claims separate.
- [x] Independent task review, whole-unit review and any required scoped fixes; then record exact verified evidence and remaining canonical DWG import/UI/resave work. Do not mark the active overall goal complete or deploy.
