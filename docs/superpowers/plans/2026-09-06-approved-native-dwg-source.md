# Approved native DWG source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect an exact approved database snapshot to the existing native CAD writer input without trusting browser geometry or losing approval lineage.

**Architecture:** Extract existing share hydration into one strict graph adapter; add a read-only authorized snapshot RPC and server native projection adapter. Root verifies disposable PostgreSQL and actual unchanged DWG writer integration. Queue, storage publication and customer DWG roundtrip remain separate required slices.

**Tech Stack:** Existing TypeScript/Zod, PostgreSQL/Supabase, native CAD projection and pinned ACadSharp 3.7.1. No dependency additions.

**Spec:** `docs/superpowers/specs/2026-09-06-approved-native-dwg-source-design.md`

## Global Constraints

- No commit, paid license, remote mutation, or deployment is authorized here.
- Request scope is exactly projectId, documentId, revisionId, revisionVersion, canvasId and snapshotSha256.
- RPC requires a verified, non-anonymous authenticated actor and existing project read access.
- Use PostgreSQL's SHA-256 of the exact UTF-8 canonical_json::text; return that text as the preimage, not a JavaScript reserialization.
- The SHA of PostgreSQL snapshot text and native structureSha256 are distinct values and must not be substituted for one another.
- The selected canvas must have an explicit persisted outputProfile.
- The native manifest remains version 1, unchanged writer/schema.
- Source lookup is read-only; no UI/queue/storage mutation or production-qualified claim.

## Task 1: Shared strict approved graph hydration

**Files:** create `platform/app/lukas/lib/drawing-authority-snapshot.server.ts`; modify `platform/app/lukas/lib/drawing-share.server.ts`; create `platform/tests/drawing-authority-snapshot.test.mjs`. Existing share tests read-only. Capture dirty baseline before changes.

**Interfaces:** Export `hydrateDrawingAuthoritySnapshot(input: unknown)`, consuming `{projectId,documentId,revision:{id,sequence,version,status},snapshot:{sha256,schemaVersion:2,operationSequence,canonicalJson}}`. Frozen statuses match existing share (`review_requested|reviewed|approved|superseded`). Return `{state, canonicalJson}`. Throw bounded validation Error; share wrapper maps it to existing 404. This helper does not claim DB authorization or independently verify snapshot digest.

- [x] Write a real template-to-canonical fixture with canonical object lineage IDs, layer page IDs and issue links; call the new helper in a failing test. Assert literal retained identity, type/page checks and preserved frozen structure. Use current Vite SSR test loader pattern for server imports.
- [x] Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-authority-snapshot.test.mjs`; record intended RED (missing helper/export).
- [x] Move (not copy) share's bootstrap/identity/hydrate/lineage/issue checks and field-stripping helper into the new module. Keep the share wrapper and existing source/token checks. Use this exact call shape:

```ts
const {state} = hydrateDrawingAuthoritySnapshot({
  projectId: authority.project.id, documentId: authority.document.id,
  revision: authority.revision, snapshot: authority.snapshot,
});
return state;
```

- [x] Test malformed scope/revision/sequence/version, layer page, object type/page/lineage, duplicate collections and issues. Each mutation must fail real validation, with source unchanged. Reuse existing hydration/schema logic rather than adding parallel graph validators.
- [x] Run new tests and `tests/drawing-revision-share.test.mjs`, `tests/drawing-revision-share-route.test.mjs`; `npx tsc --noEmit`. Record exact output/hashes; freeze files for independent review. No commit.

## Task 2: Read-only approved source RPC and native adapter

**Files:** CLI-create `platform/supabase/migrations/<CLI timestamp>_drawing_native_dwg_source_authority.sql`; create `platform/app/lukas/lib/drawing-native-dwg-source.server.ts`, `platform/tests/drawing-native-dwg-source.test.mjs`, `platform/tests/fixtures/drawing-native-dwg-source-database.mjs`; minimally integrate the latter's proof function into `platform/tests/drawing-workspace-m1-real-database.test.mjs`.

**Interfaces:** `loadApprovedNativeDrawingCadSource(client:{rpc:unknown}, request:unknown):Promise<{manifest,authority}>`; internal pure adapter may be exported as `projectApprovedNativeDrawingCadSource(request:unknown,payload:unknown)` for worker reuse. Both parse strict request. RPC `public.lukas_qto_drawing_native_dwg_source(uuid,uuid,uuid,bigint,uuid,text)` named args `p_project_id,p_document_id,p_revision_id,p_revision_version,p_canvas_id,p_snapshot_sha256` returns JSONB `{projectId,documentId,canvasId,revision:{id,sequence,version,status},snapshot:{sha256,schemaVersion,operationSequence,canonicalJsonText},approvalDecision:'approved'}`.

- [x] Write native template canonical payload tests first, including explicit persisted profile, literal geometry/scope and separate PostgreSQL-text SHA vs structure SHA. Request revisionVersion=7 and operationSequence=19. Assert canonical object lineage and issues survive in `authority`. Run RED.
- [x] Create migration using `supabase migration new drawing_native_dwg_source_authority --workdir platform`; record returned path, then apply_patch its content. Exact approval join and digest are:

```sql
join public.lukas_drawing_snapshots s on s.revision_id=r.id
 and s.project_id=r.project_id and s.revision_version=r.version
where r.project_id=p_project_id and r.document_id=p_document_id
 and r.id=p_revision_id and r.version=p_revision_version
 and r.status in ('approved','superseded') and s.schema_version=2
 and s.sha256=p_snapshot_sha256
 and s.sha256=pg_catalog.encode(extensions.digest(
   pg_catalog.convert_to(s.canonical_json::text,'UTF8'),'sha256'),'hex')
 and exists(select 1 from public.lukas_drawing_revision_approvals a
   where a.revision_id=s.revision_id and a.project_id=s.project_id
   and a.subject_version=s.revision_version and a.snapshot_sha256=s.sha256
   and a.decision='approved')
```

Authenticate before selecting source; reject bad scope with bounded unavailable error. Use current verified-session/project-role helpers, deny purge_storage_ready, exact selected canonical canvas and document project consistency, enforce 20MiB preimage bytes. `security definer set search_path=''`; revoke default PUBLIC/anon/service_role execution, grant authenticated only. No new tables or mutation.

Also enforce native provenance in DB: document source ID/hash null, every page/canvas background field null, no object-source row including deleted and no revision IFC derivative binding. Add real DB rejection probes for document-only source, dormant page background, deleted source and IFC binding; do not reject unrelated downstream BOQ/material links.
- [x] Implement hashing the returned preimage before JSON.parse, shared hydration, exact request↔response and canonical scope checks, approved status/decision only, persisted selected profile and current `buildDrawingCadManifest` native constraints. Keep deterministic canonical layer/object/issue metadata in `authority`. No fallback, defaults or swallowed invalid geometry. Bounded errors map to a stable code without serialized input/SQL.
- [x] Negative unit cases: tampered preimage/hash, wrong request IDs/version/canvas, sequence mismatch, invalid status/decision, absent profile, background/source, multiple canvases, unsupported entity, excessive preimage bytes, RPC error/null/malformed. Preserve originals on all paths.
- [x] Write a focused DB proof function receiving the existing disposable suite helpers and an actual created native document. Use real editor request_review, reviewer reviewed, approver approved; test source access as owner/editor/viewer, deny outsider/anonymous/revoked, draft/pre-approval and mismatched scope/hash/canvas; inspect privileges, snapshot hash text and no mutation. Root runs real suite against a marked disposable Supabase stack; no remote DB.
- [x] Run focused new/shared/share/CAD tests, TypeScript, then root-owned full M1 regression. Freeze implementation/report for review, fix findings, no commit.

## Task 3: Actual approved-source writer evidence and close this slice

**Files:** `docs/superpowers/evidence/2026-09-06-approved-native-dwg-source.md` and a uniquely named evidence directory with generated input/authority/report/DWG/hash index. Root-owned scripts/logs in this plan's private SDD workspace.

- [x] Capture a source from real disposable PostgreSQL approval. Build manifest through `loadApprovedNativeDrawingCadSource` using actual RPC payload, and save original canonicalJsonText + authority + manifest with exclusive creation. Never write credentials or user-provided source files.
- [x] Invoke unchanged writer `dotnet run --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- write-native --input <generated manifest> --output-dir <fresh output directory>`. Assert exit0, actual AC1024 bytes/readback inventory, exact source preimage SHA and unchanged approved source, and experimental-unqualified status.
- [x] Record test/build counts and all output hashes, explicitly distinguish this authority slice from queue, publication, DWG import/re-save and independent recipient CAD qualification.
- [x] Request final integration review for this plan's frozen delta, resolve Critical/Important findings, update checkboxes only for verified work. Preserve dirty user work and goal active. No commit/deployment/workspace cleanup.

Completion evidence: `docs/superpowers/evidence/2026-09-06-approved-native-dwg-source.md`. Final focused suite 146/146, TypeScript exit 0. Final review Critical 0/Important 0/Minor 1; issue-pair sorting recommendation fixed and scoped re-review passed. Actual source replay after that correction preserves manifest and authority bytes; prior actual DWG/DB/browser evidence is retained with its exact scope. This plan is complete, not the overall product goal.
