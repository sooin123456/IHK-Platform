# Direct drawing start and DWG qualification implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development and test-driven-development. Continue without another approval question.

**Goal:** Finish R2's project-input-free entry and execute an isolated DWG engine qualification while preserving the already completed product-entry/R1/R3 changes.

**Architecture:** A narrow server-authorized RPC ensures one personal default project per authenticated user. The existing `/workspace` POST action reuses the existing idempotent document/scaffold creation or routes to the existing template/file flow. GET requests remain read-only. The CAD experiment is a separate local console tool, not an unqualified production import/export feature.

**Tech Stack:** Existing React Router, Supabase/Postgres, Zod, Konva/Yjs/Hocuspocus, Node tests/Playwright; .NET 8 with one pinned ACadSharp dependency only in the qualification tool.

**Spec:** `docs/superpowers/specs/2026-09-05-simple-workspace-dwg-oss-design.md` §§3.2, 6, 7 and `docs/superpowers/specs/2026-09-05-1hk-business-model-design.md`.

**Execution result (2026-09-05):** Tasks1–5 implemented and independently reviewed. Final focused178/178, isolated M122/22, responsive preview4/4, CAD self-test9/9 passed; production/client/server/collaboration builds passed. See `docs/superpowers/evidence/2026-09-05-direct-drawing-start.md` and the current SDD progress ledger for individual RED/GREEN and fixes. This closes this bounded plan only: display-unit metadata, R5 practical assets/delivery and native production DWG qualification remain in the active goal.

## Global Constraints

- Preserve the existing dirty worktree, prior changes and all canonical document routes. No staging, commits, push, operating-system cleanup or operating deployment in this plan.
- Upload/project/contact input is not required to start a blank drawing. Internally every drawing still belongs to a project and organization.
- No data mutation in GET/loader, no service key in the browser, no anonymous Auth writes. User/organization authority comes from verified server context, never a submitted owner ID.
- Repeated creation requests return the same project/document. Preserve request UUID and creation timestamp on retry. Existing document operations, outbox, approvals, calculations and source hashes remain authoritative.
- A retained, archived, deleted-requested or moved default project must not be silently restored, moved or replaced. Explain recovery and keep explicit project entry available.
- Keep quota/entitlement guards, RLS and exact current-user permissions. Do not turn pricing hypotheses into new entitlements.
- Existing explicit-project creation, shared-project entry, template provenance and file upload failure containment remain available.
- Native DWG re-save/delivery stays mandatory. Engine-generated synthetic fixtures prove only an internal experiment, not independent-CAD/customer acceptance. Do not claim production DWG readiness or silently flatten source entities.
- No package added to the web app. CAD dependency restore may occur in the isolated tool, with pinned versions and license/lock evidence. No paid engine contract or customer-file transfer.
- Tests use real production code; substitute only external boundaries. Document RED, GREEN, exact results and remaining release gates.

## Work units

### Task 1: Atomic personal default project authority

**Files:**
- Modify the CLI-created empty migration `platform/supabase/migrations/20260905065400_personal_drawing_quick_start.sql`.
- Create `platform/app/lukas/lib/drawing-personal-project.server.ts`.
- Extend `platform/tests/drawing-workspace-m1-database.test.mjs` and `platform/tests/drawing-workspace-m1-real-database.test.mjs` within their existing complete database fixtures.
- Create `platform/tests/drawing-personal-project.test.mjs` for the server boundary.

**Interfaces:** `ensurePersonalDrawingProject(client): Promise<{ projectId: string; organizationId: string }>` calls `lukas_drawing_ensure_personal_project` with no caller-supplied identity. The public RPC is `SECURITY INVOKER`; any privileged private function validates non-null `auth.uid()` and non-anonymous session before access. Task 2 consumes this exact helper.

- [ ] RED: add executable migration tests before populating the migration. Assert first creation yields a personal project owned by the caller with owner membership; second request returns identical IDs and project count stays one. Use existing fresh-user fixtures, not source-string assertions.
- [ ] RED: assert a second actor gets a different project, anon/missing identity is denied, authenticated users cannot read/write the private mapping, quota failure creates neither mapping nor project, and a mapped archived/moved project is not reused or silently restored. Test malformed/null RPC result in the real server wrapper.
- [ ] Implement private `user_id → project_id, organization_id` mapping with unique identities and no direct application-role table grants; RLS enabled as defense in depth. Keep mapping immutable through direct client access. Use project FK cascade only for genuine authorized deletion so test/retention cleanup is not obstructed.
- [ ] Serialize same-user ensure calls with an actor-specific transaction lock. Validate existing mapping by joining project+personal organization and checking owner, organization, archive/deletion and current drawing entitlement/capability. On first creation insert a project named `내 도면` owned by `auth.uid()` and reuse the existing prepare/membership/quota triggers. Never adopt a same-name unrelated project.
- [ ] In this new migration, minimally replace `private.lukas_qto_prepare_project()`'s personal-organization select/insert race with `INSERT ... ON CONFLICT (owner_id) WHERE is_personal DO NOTHING`, then SELECT and `INSERT ... ON CONFLICT DO NOTHING` for the owner membership. Preserve all existing ownership/organization checks and the separate entitlement guard. This protects simultaneous normal and quick project creation for a first-time user.
- [ ] Implement strict result validation and bounded existing error types:

```ts
const PersonalProject = z.object({ projectId: z.string().uuid(), organizationId: z.string().uuid() }).strict();
export async function ensurePersonalDrawingProject(client: SupabaseClient<any>) {
  const { data, error } = await client.rpc("lukas_drawing_ensure_personal_project");
  // Classify rejected/conflict/retryable transport errors using the existing DrawingWorkspace error classes.
  return PersonalProject.parse(data);
}
```

- [ ] GREEN: run `node --test tests/drawing-personal-project.test.mjs tests/drawing-workspace-m1-database.test.mjs`. Add real-Postgres concurrent same-user calls with two sessions to the existing M1 database test; root runs that gate through the disposable M1 runner.
- [ ] Self-review and report exact RED/GREEN, security reasoning and changed paths in this plan's `task-1-report.md`. Do not commit.

### Task 2: Direct creation and recent drawings in the existing dashboard

**Files:**
- Modify `platform/app/lukas/screens/workspace.tsx` and `platform/app/lukas/components/workspace-dashboard.tsx`.
- Create focused `platform/app/lukas/components/workspace-quick-start.tsx` if needed to keep request/form logic out of the large dashboard.
- Extend `platform/tests/drawing-workspace-entry-flow.test.mjs`; add `platform/tests/workspace-quick-start.test.mjs` if a separate boundary fixture is clearer.

**Interfaces:** Consume Task 1's helper. Add a typed optional `quickStartRequests` prop keyed by `blank | template | file`, each `{ clientRequestId, clientCreatedAt }`, and bounded `quickStartFailure` carrying the same kind/pair. Add optional `drawings` summaries `{ id, project_id, title, updated_at }[]` from the already scoped loader query. Existing preview callers without these props must remain safe/read-only.

- [ ] RED: real action-boundary tests for authenticated blank creation with no project/name/contact fields, anonymous rejection before reading the body, unknown/duplicate/forged fields before RPC, exact request UUID/timestamp passed to existing creation, and retry identity/error preservation. Verify loader performs no creation RPC.
- [ ] RED: render new start entry and recent source-free documents, ensuring links use each document's real project/document ID. Existing explicit-project action remains functional and preview does not submit production writes.
- [ ] In the existing action branch on `quick_blank`, `quick_template`, `quick_file`; parse each strictly before ensure. Reuse the original explicit new-project branch for forms without quick intent. The quick blank branch is:

```ts
const { projectId, organizationId } = await ensurePersonalDrawingProject(client);
const created = await createDrawingWorkspaceStart(client, {
  projectId, organizationId, title: "새 도면", sourceFile: null, definition: null,
  clientRequestId: mutation.clientRequestId, clientCreatedAt: mutation.clientCreatedAt,
});
return redirect(drawingWorkspacePath(projectId, created.documentId), { headers });
```

- [ ] `quick_template` ensures the same default project then opens `drawingWorkspaceNewPath(projectId) + '#starter-workspace-title'`. Existing template preview/selection/immutable clone flow creates the document. `quick_file` opens `/projects/${projectId}/files`; existing verified uploads lead to the canonical workspace. These choices do not create an unnecessary blank document.
- [ ] Use one `새 도면` start control with `빈 도면으로 시작 / 템플릿에서 시작 / 파일 가져오기`; explain personal storage and that project-specific start remains in project cards. Reuse native/installed primitives. Disable duplicate submits while pending, show inline bounded error with retry using the original request identity, never inject raw SQL messages. Preserve refreshed response cookies.
- [ ] Extend existing scoped document SELECT with title. Show recent drawings separately from project containers, including source-free drawings, and fix card wording that says no drawing exists when one does. Keep recent list bounded with existing project drawing-list links for all older documents. Preserve one organization menu and responsive focus behavior.
- [ ] GREEN: run focused action/UI tests and previous153 regression files. Self-review and report in this plan's `task-2-report.md`, no commit.

### Task 3: Executable OSS DWG engine qualification

**Files:** Create only `tools/dwg-engine-qualification/` with a .NET8 console project, exact package lock, executable self-test/harness, generated-output ignore rules, README and license/source notices. Do not edit the web app or its manifests.

**Interfaces:** Local tool consumes only an explicit input path and explicit output directory. Emits inventory/semantic comparison JSON and a separate output DWG. It must refuse overwriting the input. Results state `experimental` and record independent-CAD verification as not performed.

- [ ] Verify official ACadSharp repository/release API and package contents; pin a .NET8-compatible released version and record its actual dependency/license data. Do not copy third-party DWG test assets without explicit license evidence.
- [ ] Write a runnable failing self-test for input overwrite rejection, output path bounds and semantic comparison catching removed or changed untouched entities before implementing those guards/comparisons.
- [ ] Implement create-generated-fixture, read inventory, no-edit round-trip and a supported line/text edit round-trip. Start with explicit lines, polylines, circles/arcs, layers, text and ordinary blocks that the installed API supports. Record entity handle/type/owner/layer, geometry, block/layout identities, units, font/xref metadata and diagnostics; do not hide unsupported fields behind a success boolean.
- [ ] Preserve input bytes and hash; save a separate working copy, re-read, compare expected edited fields and every inventoried untouched entity. Tolerances are declared before comparing. Exceptions/warnings are report data, not swallowed. Reject unresolved external references for this first offline experiment, never follow paths/URLs inside DWG.
- [ ] Run synthetic tests and the actual engine round-trips. Report version, commands, counts, warnings and failures; if source/entity fidelity cannot be verified, mark that capability unqualified. No production upload flag or fake `.dwg` export.
- [ ] Write `task-3-report.md` and tool README clearly separating executable internal evidence from remaining30-file, independent-CAD, font/Xref, quota/role and recipient acceptance gates. No paid purchase/contract.

### Task 4: Integrate, review and prove the user workflow

**Files:** Root owns `platform/e2e/drawing-workspace-m1-estimator.spec.ts`, this plan/evidence/ledger and local preview browser tests. No overlapping implementation writes.

- [ ] Capture pre-turn baselines for changed existing files; compare task-only diffs, cross-review spec and code, resolve Important/Critical findings. Tool-limit fallback is cross-review with existing non-author agents, recorded honestly.
- [ ] Add actual authenticated browser tests: no project input→blank→edit→save→reload; a second new drawing shares the default project but not document ID; duplicate same POST returns the same document; both are reachable from recent drawings. Template and file entries require no project details and retain canonical destination. A Viewer cannot redirect quick creation into someone else's project.
- [ ] Run combined focused tests, production/typecheck/collaboration builds and the full isolated `npm run test:e2e:drawing-workspace-m1:local` including Task1 concurrent database proof. Run responsive public/dashboard/editor smoke checks with the existing preview environment.
- [ ] Record exact test outcomes and engine qualification limits in `docs/superpowers/evidence/2026-09-05-direct-drawing-start.md`. Keep the overall goal active while native production DWG and R5/customer delivery gates remain incomplete. Proceed to the next bounded implementation after this plan; no unsupported completion claim.

### Task 5: Name the drawing after immediate start (execute before Task 4 final verification)

**Files:** Create `platform/app/lukas/lib/drawing-document-title.server.ts`, `platform/app/lukas/components/drawing-document-title.tsx`, `platform/tests/drawing-document-title.test.mjs`; minimally modify `platform/app/lukas/screens/drawing-workspace.tsx` and `platform/app/lukas/components/drawing-workspace.tsx`. Root extends its new browser flow for title persistence. Any real-database assertions are coordinated with Task1 after that owner's edits finish.

**Reason:** Spec §3.2 says the name can be changed in the canvas after immediate start. The current h1 is read-only; leaving every blank document permanently named `새 도면` would not finish R2.

**Interfaces:** `renameDrawingDocument(client, { projectId, documentId, expectedTitle, title }): Promise<{id:string,title:string}>`. Existing workspace POST intent `rename_drawing_document` consumes only `intent`, `expectedTitle`, `title` (IDs come from canonical route scope). Use existing workspaceContext/capability and action error normalization, no new mutation route or DB migration.

- [ ] RED: server helper calls a real boundary fake that verifies scoped UPDATE and compare-and-set on expected title; reject empty/oversize/duplicate/unexpected input, zero affected row conflict and rejected transport. Test component renders h1, opens accessible edit form, and does not offer editing for preview/Viewer/non-draft. Tests must catch permission/input/UPDATE scope breaks.
- [ ] Update only `{title}` on `lukas_drawing_documents`, with `.eq('project_id',projectId).eq('id',documentId).eq('title',expectedTitle).select('id,title').maybeSingle()`. Existing RLS + document trigger freeze any document with a non-draft revision and guard source/creation identity. Never weaken them or retry with service-role authority. Empty result is a bounded conflict/restriction, not success.
- [ ] Add a minimal title edit control in the existing h1 area, with `도면 이름 변경`, textbox `도면 이름`, `이름 저장`, `취소`. Use existing fetcher and native form/installed controls, Enter submits, cancel retains original. Keep failed draft text and visible bounded error; server revalidation updates title in the header, recent list and export metadata without keying/remounting the canvas or changing source/operation state.
- [ ] Only current editable draft capabilities expose editing. Route rechecks admin/editor plus draft; database enforces all-history freeze. No rename UI in loopback fixture preview; don't fabricate local-only persistence.
- [ ] GREEN: focused helper/component and shell tests; root browser renames newly created drawing, reloads, verifies recent list name and unchanged geometry, then replays original quick-create payload to the same document. Report exact result and changed paths in `task-5-report.md`.

## Preflight interpretation

R1/R3 are already implemented; do not redo them. R2's minimum blank/template/import paths reuse canonical existing screens, and all older drawings remain reachable. This plan is not the detailed production-CAD worker/DB design: the executable engine evidence must inform that next plan. R5 practical geometry templates and delivery packages follow with existing immutable template versioning preserved. External recipient acceptance cannot be fabricated by synthetic tests.
