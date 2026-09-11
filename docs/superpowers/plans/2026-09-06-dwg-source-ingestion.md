# DWG Source Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely upload and retain first-class DWG originals in the existing project workflow.

**Architecture:** Reuse immutable resumable uploads, service-owned verification and the existing finalizer. Header detection is evidence only, never an editing qualification. No new job/store/router abstraction.

**Tech Stack:** Existing React Router, Zod, Supabase PostgreSQL/Storage/Edge, TUS, Node tests and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-dwg-source-ingestion-design.md`

## Global Constraints

- Preserve all pre-existing dirty worktree changes; capture per-task baselines, do not commit/push/deploy or mutate remote data.
- No new dependency or external service for this slice.
- Header is ASCII `/^AC[0-9]{4}$/`; source maximum is 200 MiB; DWG upload MIME is `application/octet-stream`; storage overwrite remains disabled.
- `dwg_header_version` is service-ledger-only, required for DWG and null for other kinds; finalizer returns `dwgHeaderVersion`.
- Never auto-supersede DWGs or admit unqualified DWGs to existing workspace/native export source guards.
- Existing actor roles and immutable bytes must be preserved; consumed replay requires current authority.
- UI states `원본 보관 완료 · 편집 호환성 미검증`, without pretending import/edit/delivery is implemented.
- Root owns disposable DB/Storage/browser operations. File-disjoint implementation can run in parallel; each task gets an author-independent review. User's no-repeat-approval instruction supersedes intermediate execution-choice prompts.

### Task 1: Verified DWG ledger and finalization authority

**Files:** Create one CLI-named forward migration and `platform/tests/fixtures/drawing-dwg-source-ingestion-database.mjs`; modify `platform/tests/drawing-workspace-m1-real-database.test.mjs` and `platform/tests/project-upload-finalization-migration.test.mjs`.

**Interfaces:** Consume service-derived `dwg_header_version`; retain `lukas_qto_finalize_verified_upload(uuid,uuid,uuid)`; add nullable `dwgHeaderVersion` in both result branches. Fixture exports `proveDwgSourceIngestionAuthority({owner,workerA,workerB,ids})` and returns its project ID for existing cleanup.

- [x] Add failing migration/behavior assertions and run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/project-upload-finalization-migration.test.mjs`.

```sql
CHECK ((kind = 'dwg' AND dwg_header_version IS NOT NULL AND dwg_header_version ~ '^AC[0-9]{4}$')
    OR (kind <> 'dwg' AND dwg_header_version IS NULL))
```

- [x] Implement the forward migration: two kind constraints; evidence column/check; move current actor query before consumed replay; use established actor deletion/ban compatibility pattern; wrap advisory/latest/same-hash work in `kind not in ('other','dwg')`. Preserve P8U codes, grants, expiry replay and other kinds.
- [x] Add real-SQL fixture positives (owner/editor), negatives (viewer/outsider, missing/invalid/wrong-kind version, raw DWG workspace P1R01 with immutable PDF/IFC source refusal), revoked replay, banned/deleted/anonymous actor cases where fixture supports them, same-verification concurrent equality and distinct DWG zero-revision assertions. Each transaction restores role/JWT. Root executes against marked disposable stack.
- [x] Rerun focused tests, self-review and save report with RED/GREEN output; do not commit.

### Task 2: Authoritative DWG stream verification

**Files:** `platform/supabase/functions/lukas-qto-upload-verify/index.ts`, `platform/tests/project-file-upload-verifier.test.mjs` only.

**Interfaces:** DWG input requires `.dwg` and stored/request `application/octet-stream`. Add service-only `dwg_header_version` (null for others) to inserted verification evidence and exact-evidence duplicate comparison. Derive from downloaded bytes, never JSON input.

- [x] Extend real ReadableStream test scenario for kind/file/chunk choices and captured record; add a failing split-header test with `AC` + `10` + `32` plus body, expected version `AC1032` and complete SHA.

```js
assert.equal(inserted.dwg_header_version, 'AC1032');
assert.equal(inserted.sha256, createHash('sha256').update(bytes).digest('hex'));
```

- [x] Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/project-file-upload-verifier.test.mjs` to show RED.
- [x] Implement six-byte bounded prefix capture retaining PDF five-byte signature/early-cancel behavior; reject short/non-ASCII/nonmatching headers, actual size mismatch, actual MIME mismatch and unauthorized roles. Keep stream release and no source overwrite. Return evidence-conflict for changed detected metadata on duplicate.
- [x] Add adversarial tests for malformed/short/forged client version, missing actual stored MIME, repeated verification consistency and all previous PDF cases; run focused GREEN and write report, no commit.

### Task 3: Project upload/resume and honest DWG UI

**Files:** `platform/app/lukas/lib/drawing-entry.ts`, `project-file-upload.ts`, `project-file-verification.server.ts`, `platform/app/lukas/screens/project.tsx`; focused entry/upload/finalization tests and a new focused DWG source test if needed. Do not modify Task 1/2 files.

**Interfaces:** Export `projectUploadContentType(kind: ProjectFileKind, browserContentType: string): string` from `project-file-upload.ts`; DWG returns octet-stream, other kinds retain existing fallback. Use in direct uploader and pending comparison. Verified/finalized schemas accept new version fields with cross-kind validation; non-DWG omission remains valid.

- [x] Add failing behavioral tests for DWG kind/name, MIME normalization, stable pending resume, invalid kind/version schema, and destination remaining project files (not workspace).

```js
assert.equal(projectUploadContentType('dwg', 'application/acad'), 'application/octet-stream');
assert.equal(projectUploadContentType('pdf', 'application/pdf'), 'application/pdf');
```

- [x] Run focused tests to establish RED; implement policy/helper/schema and update verified service select to include `dwg_header_version`. Retain all PDF/DXF returnTo checks and workspace gates.
- [x] Add DWG choice/help and the exact honest status for DWG file rows in mobile and desktop existing lists; remove obsolete instruction that all DWG must use `other`. In workspace-return context, do not offer the new DWG choice that cannot be attached; normalize a direct DWG selection to a supported input before rendering. No new sidebar item, editor link, fake job/status or library.
- [x] Run focused GREEN and typecheck after all tasks settle; save report and no commit.

### Task 4: Cross-boundary actual verification and review

**Files:** `platform/e2e/drawing-dwg-source-ingestion.spec.ts`; extend `platform/scripts/run-drawing-workspace-m1-e2e.mjs` and `platform/tests/drawing-workspace-m1-release-harness.test.mjs` with a strict `--profile=dwg-source` target; `docs/superpowers/evidence/2026-09-06-dwg-source-ingestion.md`.

**Interfaces:** Consume tasks 1–3 in a fresh marked disposable local environment. Use existing real synthetic DWG artifact (not private customer file), existing seed/login/cleanup identity and exact fixture marker.

Runner profile maps only to `e2e/drawing-dwg-source-ingestion.spec.ts` and retains existing build, M1/M2/M5 real database proofs, signal handling and marked cleanup. Do not clone the runner. Reuse public generated artifact `docs/superpowers/evidence/2026-09-06-native-dwg-export-jobs/native.dwg` (13387 bytes, AC1024, SHA-256 `7d94793d0d35631bd7068971202c686f076659f4836205aa88c3894d1bf77201`). Authenticate existing marked fixtures; select DWG and use browser File MIME `application/acad` to exercise normalization. Assert header/size/hash, service evidence and no revision edges, desktop/mobile status, owner download and Viewer no uploader. Invalid header leaves no file or consumed verification. Add focused PDF upload regression using existing PDF fixture. Root runs actual profile after task review.

```js
assert.equal(parseRunnerProfile(['--profile=dwg-source']), 'dwg-source');
assert.equal(drawingWorkspacePlaywrightArgs('dwg-source')[1], 'e2e/drawing-dwg-source-ingestion.spec.ts');
```

- [x] Author-independent diff review of each task, resolve Important findings through its implementer, then run combined upload/schema/SQL-focused tests once.
- [x] Start existing disposable harness with its documented profile/commands, never production. Execute real-SQL proof including two independent connections.
- [x] Browser/actual HTTP upload synthetic DWG through existing uploader; assert immutable file record and honest list text, download it and compare SHA-256; invalid-header upload must not finalize. Preserve existing PDF regression. Record exact commands, outputs, hashes and all skipped gates.
- [x] Run typecheck/build and scoped regression after settled code; publish concise evidence and update task checkboxes only for completed gates. Keep full active goal open.
