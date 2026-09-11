# 1HK Universal Workspace M2 Editor and Company Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the M2 editor/company-standard vertical so precision and tablet authoring, reusable organization templates, version-bound drawing exports, and evidence-triggered price-book standardization are production-shaped and auditable.

**Architecture:** Extend the existing canonical drawing document, `mutate_structure` operation, organization library, export receipt, and Supabase authority. Keep drawing state in the current external store/Yjs boundaries and introduce no parallel editor model, state library, collaboration server, export engine, or price-book registry until measured evidence requires one.

**Tech Stack:** React Router 7, React 19, TypeScript, Konva/react-konva, Supabase/Postgres/RLS, Node crypto, existing PDF/PNG/SVG exporters, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-universal-workspace-estimator-vertical-slice-design.md`

## Global Constraints

- PDF, IFC, RVT, drawing snapshots, organization-library payloads, and price-book source bytes/SHA-256 values remain immutable.
- Use the current revision-scoped external store, IndexedDB outbox, Yjs document, y-indexeddb persistence, Hocuspocus room, and Supabase Realtime boundaries.
- Do not add Zustand unless duplicated subscriptions, untestable cross-panel state, or material prop drilling is measured and recorded.
- Do not add a new CRDT, collaboration server, drawing model, export renderer, spreadsheet library, decimal engine, or organization price-book registry in this plan.
- A drawing export receipt must identify the exact project, workspace, revision, and revision version that produced its artifact bytes.
- A price-book SHA becomes a registry candidate only after existing data proves use in at least two distinct projects in one organization.
- Viewer/nonmember mutation must fail in UI, route action, and database authority. Organization management remains owner/admin/staff only.
- Expected validation and authorization failures render bounded Korean messages, not the global unexpected-error boundary.
- Existing unrelated dirty-worktree changes belong to the user. Do not commit or stage them.

---

## Completed M2 Baseline Carried Into This Plan

- Precise wall/dimension coordinate editing, exact fixed-point parsing, semantic host/opening validation, and explicit dirty-draft conflict resolution are implemented and covered by the precision browser authority.
- Page/canvas/layer/style/block/property/table structure uses the existing `mutate_structure` operation with versioned optimistic concurrency, undo data, outbox persistence, and read-only Viewer rendering.
- A source-free canonical workspace can attach one immutable project PDF through an idempotent database transaction that binds document, canvas, operation ledger, and SHA-256 provenance.
- Existing PDF/PNG/SVG renderers already export canonical geometry; Task 3 binds those bytes to the exact revision that produced them instead of introducing another renderer.
- Current state-boundary inspection found no measured need for Zustand: the existing external document store remains authoritative and drawing/BOQ/money state is not duplicated.

The exact baseline commands and counts live in `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-precision-touch.md` and `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-structure-source.md`. Task 5 refreshes stale counts after all remaining changes.

---

## File Structure

### New files

- `platform/e2e/drawing-workspace-touch.spec.ts` — real CDP touch selection, drawing, cancellation, pinch, and PDF calibration authority.
- `platform/app/lukas/lib/drawing-touch-gesture.ts` — pure one-touch/pinch transition used by the current canvas controller.
- `platform/supabase/migrations/20260901224223_drawing_export_revision_lineage.sql` — additive export receipt lineage and drawing-only audited RPC; this is the exact Supabase CLI-created path.
- `platform/supabase/migrations/20260901224653_organization_price_book_reuse_evidence.sql` — read-only organization reuse-candidate RPC; this is the exact Supabase CLI-created path.
- `platform/tests/drawing-workspace-m2-price-book-reuse-database.test.mjs` — RLS/function/runtime counterexamples for the reuse gate.

### Existing files to modify

- `platform/app/lukas/components/drawing-canvas.client.tsx` — defer a calibration tap until release and let second-finger pinch or Space-pan cancel it.
- `platform/e2e/drawing-workspace-m1-estimator.spec.ts` — production-shaped custom organization-template publish/import journey.
- `platform/app/lukas/components/drawing-export-dialog.tsx` — submit the mounted revision version with PDF/PNG/SVG artifacts.
- `platform/app/lukas/components/drawing-workspace.tsx` — pass canonical workspace/revision/version into the existing export dialog.
- `platform/app/lukas/screens/drawing-workspace-export.ts` — exact form parsing and stale/mismatched lineage rejection.
- `platform/app/lukas/screens/drawing-workspace-export.server.ts` — server-only parsing and audit handler kept out of the client route chunk.
- `platform/app/lukas/lib/project-export-audit.server.ts` — call the lineage-aware receipt RPC for drawing artifacts while preserving existing project exports.
- `platform/tests/drawing-workspace-p7-export-audit.test.mjs` — route/helper lineage contracts and stale-version counterexamples.
- `platform/tests/drawing-workspace-p7-retention-database.test.mjs` — PGlite receipt lineage constraints and idempotency.
- `platform/e2e/drawing-workspace-p7-production.spec.ts` — verify actual PDF/PNG/SVG bytes and receipt columns with their real schema names.
- `platform/app/lukas/lib/organization-drawing-library.server.ts` — load authorized price-book reuse evidence with the existing organization catalog.
- `platform/app/lukas/screens/organization-drawing-library.tsx` — render a read-only candidate/insufficient-evidence section.
- `platform/tests/drawing-workspace-p7-library-route.test.mjs` — server and accessible UI contracts for the evidence section.
- `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-precision-touch.md` — tablet/calibration verification.
- `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-structure-source.md` — structure/source/template/export verification.

---

### Task 1: Complete touch-safe PDF calibration

**Files:**

- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Test: `platform/e2e/drawing-workspace-touch.spec.ts`
- Test: `platform/tests/drawing-workspace-touch.test.mjs`

**Interfaces:**

- Consumes: `drawingTouchGestureTransition`, the existing calibration input router, viewport state, and the current pointer-capture boundary.
- Produces: one pending calibration touch owned by pointer ID; release emits one existing calibration `pointer_down`, second touch cancels it and pinches, and Space delegates to the existing pan route.

- [x] **Step 1: Add a failing release-versus-pinch browser test**

```ts
await touch(client, "touchStart", [{ id: 51, ...first }]);
await expect(page.getByText("1번째 점을 선택하세요.")).toBeVisible();
await touch(client, "touchStart", [
  { id: 51, ...first },
  { id: 52, ...pinchSecond },
]);
await touch(client, "touchMove", [
  { id: 51, x: first.x - 40, y: first.y },
  { id: 52, x: pinchSecond.x + 80, y: pinchSecond.y },
]);
await touch(client, "touchEnd", []);
await expect(page.getByText("1번째 점을 선택하세요.")).toBeVisible();
```

- [x] **Step 2: Prove the current pointer-down behavior fails**

Run:

```bash
cd platform
E2E_BASE_URL=http://127.0.0.1:61253 npx playwright test e2e/drawing-workspace-touch.spec.ts --grep "touch calibration" --project=chromium --workers=1 --reporter=line
```

Expected: FAIL because the first touch immediately advances calibration.

- [x] **Step 3: Defer the calibration tap in the existing canvas controller**

```ts
const shouldDeferCalibration =
  calibrationOwnsSingle &&
  !spacePressedRef.current &&
  type === "pointer_down" &&
  previousTouch.pointers.length === 0;
```

Store only `pointerId` and the local screen point. Clear the pending record on second-touch cancellation, pointer cancel, blur, unmount, or calibration deactivation. On an uncancelled release, route the stored point through `createDrawingCalibrationInputRouter`; do not call `onPoint` through a second model.

- [x] **Step 4: Add and pass the Space-pan regression**

```ts
await surface.focus();
await page.keyboard.down("Space");
await touch(client, "touchStart", [{ id: 49, ...first }]);
await touch(client, "touchMove", [
  { id: 49, x: first.x + 70, y: first.y + 35 },
]);
await touch(client, "touchEnd", []);
await page.keyboard.up("Space");
```

Assert viewport X/Y changes and the UI still asks for the first calibration point.

- [x] **Step 5: Run touch regression and independent review**

Run:

```bash
cd platform
E2E_BASE_URL=http://127.0.0.1:61253 npx playwright test e2e/drawing-workspace-touch.spec.ts --project=chromium --workers=1 --reporter=line
npm run typecheck
git diff --check -- app/lukas/components/drawing-canvas.client.tsx e2e/drawing-workspace-touch.spec.ts
```

Expected: Playwright `3/3`, TypeScript exit `0`, diff check clean, reviewer Critical `0`, Important `0`, Ready `YES`.

---

### Task 2: Prove the custom organization workspace-template lifecycle

**Files:**

- Modify: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`
- Modify only if the browser test exposes a real defect: `platform/app/lukas/screens/organization-drawing-library.tsx`
- Modify only if the browser test exposes a real defect: `platform/app/lukas/screens/drawing-workspace-new.tsx`
- Test: `platform/tests/drawing-workspace-p7-library-route.test.mjs`
- Test: `platform/tests/drawing-workspace-p7-library-database.test.mjs`

**Interfaces:**

- Consumes: the approved estimator revision, `lukas_drawing_create_library_draft`, `lukas_drawing_publish_library_version`, `create_library_template`, and the existing import ledger.
- Produces: one immutable published custom `workspace_template` version and one source-independent canonical document in a second project, bound by `target_document_id`, `target_revision_id`, `content_sha256`, and `client_request_id`.

- [x] **Step 1: Add the failing production-shaped browser journey after drawing approval**

```ts
const libraryPath = `/organizations/${fixture.organizationId}/drawing-library`;
const ownerPage = await authenticateContext(
  fixture,
  ownerContext,
  fixture.owner,
  baseUrl,
  libraryPath,
);
await ownerPage
  .getByRole("button", { name: "이 리비전으로 초안 만들기" })
  .click();
await ownerPage.getByRole("button", { name: "발행" }).click();
```

Query the version row before import and retain its `content_sha256` and `canonical_payload` for the after assertion.

- [x] **Step 2: Start from the published company template in the second project**

```ts
await editorPage.goto(
  `${baseUrl}/projects/${fixture.emptyProjectId}/workspaces/new`,
);
const templateButton = editorPage.getByRole("button", {
  name: /회사 템플릿으로 시작$/,
});
const retryForm = await formValues(templateButton);
await templateButton.click();
await expect(editorPage).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
```

Assert the target revision contains the template payload's pages, canvases, layers, styles, blocks, property schemas/values, and tables. Assert exactly one import-ledger row points to the new document and revision.

- [x] **Step 3: Prove idempotency and immutable provenance**

Resubmit `retryForm` to the new-workspace action with `maxRedirects: 0`. Assert the redirect targets the same document, document/import counts remain one, and the source version's `content_sha256` and `canonical_payload` are byte-for-byte unchanged.

- [x] **Step 4: Keep lifecycle counterexamples at database/route authority**

Run:

```bash
cd platform
node --test tests/drawing-workspace-p7-library-route.test.mjs tests/drawing-workspace-p7-library-database.test.mjs
```

Expected: Viewer/nonmember create/publish/import attempts are rejected, and deprecated versions cannot create a new workspace. Do not duplicate every denial in the long browser journey when the real RPC tests already execute it.

- [x] **Step 5: Run the disposable M1 production authority**

Run:

```bash
cd platform
npm run test:e2e:drawing-workspace-m1:local
```

Result: real PostgreSQL M1/M2 gates passed and the expanded serial browser suite passed `10/10` with no source SHA mutation. The journey also proved Viewer/nonmember denial, exact retry idempotency, and deprecated-template rejection.

---

### Task 3: Bind PDF/PNG/SVG receipts to an exact drawing revision

**Files:**

- Create via CLI: `platform/supabase/migrations/20260901224223_drawing_export_revision_lineage.sql`
- Create via CLI after hosted review: `platform/supabase/migrations/20260904102443_drawing_export_approved_snapshot_required.sql`
- Modify: `platform/app/lukas/screens/drawing-workspace-export.ts`
- Modify: `platform/app/lukas/lib/project-export-audit.server.ts`
- Modify: `platform/app/lukas/components/drawing-export-dialog.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Test: `platform/tests/drawing-workspace-p7-export-audit.test.mjs`
- Test: `platform/tests/drawing-workspace-p7-retention-database.test.mjs`
- Test: `platform/e2e/drawing-workspace-p7-production.spec.ts`
- Test: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`

**Interfaces:**

- Consumes: `recordProjectExport`, the unchanged five-argument `lukas_qto_record_project_export`, the additive `lukas_qto_record_drawing_export`, canonical `workspaceId`, `revisionId`, `revision.version`, collaboration `operationSequence`/snapshot SHA, and existing artifact SHA/byte size.
- Produces: nullable lineage columns for legacy/non-drawing exports and mandatory workspace/revision/version/operation-checkpoint lineage for `drawing_pdf`, `drawing_png`, and `drawing_svg`. Exact retries return before live-version rejection, while new stale requests fail closed.

- [x] **Step 1: Write RED contracts before changing the receipt**

Assert the dialog submits revision version plus canonical operation checkpoint/SHA, exact form parsing rejects extra/missing fields, a new stale request is rejected, the helper passes all lineage arguments, a failed HTTP response preserves its request ID for retry, and PGlite cannot record mismatched workspace/revision/version/checkpoint tuples.

- [x] **Step 2: Create the migration with the Supabase CLI**

Run:

```bash
cd platform
npx supabase migration new drawing_export_revision_lineage
```

Expected: one path ending `_drawing_export_revision_lineage.sql`; use the CLI-printed prefix everywhere.

- [x] **Step 3: Add the smallest receipt schema and RPC validation**

Add `workspace_id`, `revision_id`, `revision_version`, `operation_checkpoint`, `checkpoint_sha256`, and nullable approved `revision_snapshot_sha256` to the existing append-only export event table. Preserve the existing five-argument RPC and its request hash for rolling deploys and non-drawing artifacts. Add a separately named drawing-only RPC to avoid PostgREST overload ambiguity. It must require a verified non-anonymous session, enforce same-project document/revision/version plus the current canonical operation sequence/SHA under lock, and require a matching approved snapshot before a new drawing receipt is inserted. A pre-migration five-field drawing event with the same request identity remains exactly retryable. Because the first lineage migration was already hosted before the approved-snapshot review, the fail-closed correction is delivered as the separate forward migration listed above rather than by rewriting applied history.

```sql
select r.document_id,r.version into v_document_id,v_revision_version
from public.lukas_drawing_revisions r
where r.id=p_revision_id and r.project_id=p_project_id
for no key update;

if v_document_id is distinct from p_workspace_id
   or v_revision_version is distinct from p_revision_version
   or v_operation_checkpoint is distinct from p_operation_checkpoint
   or v_checkpoint_sha256 is distinct from p_checkpoint_sha256 then
  raise exception using errcode='P1C01',
    message='Drawing export canonical checkpoint does not match';
end if;
```

- [x] **Step 4: Carry the mounted revision version through the existing route**

Use exact integer parsing for `revision_version` and `operation_checkpoint`, and exact lowercase SHA parsing for `checkpoint_sha256`. Pass lineage only for drawing artifacts; keep other `recordProjectExport` call sites source-compatible through an optional lineage object. The new application calls the drawing-only RPC and falls back to the legacy five-argument RPC only for `PGRST202` during app-first rollout. Enable the dialog only when save status is `저장됨` and the outbox is ready. Preserve one request ID for the same options after a failed response; clear it after success or when options change.

- [x] **Step 5: Prove all three real artifact formats**

In the production test, download PDF, PNG, and SVG, compute each SHA/byte size, then query `artifact_sha256` and `artifact_byte_size` plus the new lineage/checkpoint columns. Replace any stale `sha256,byte_size` receipt query with the real column names.

Run:

```bash
cd platform
node --test tests/drawing-workspace-p7-export-audit.test.mjs tests/drawing-workspace-p7-retention-database.test.mjs
npm run typecheck
```

Result refreshed on 2026-09-04: the canonical disposable real-login approval scenario executed PDF, PNG, and SVG downloads and verified actual byte SHA/size plus exact workspace, approved revision/version, operation checkpoint/SHA, and non-null approved snapshot SHA for every receipt while source SHA evidence remained unchanged. Focused export/retention authority passed `30/31` with `0` failures and one environment-gated real-PostgreSQL skip; the final disposable browser suite passed `18/18`; application/collaboration typechecks and builds, formatting, and diff checks passed. The approved-snapshot forward migration was applied to production and the verified web candidate was promoted. The separate credentialed hosted P7 three-identity browser gate remains unexecuted. Independent re-review reported Critical `0`, Important `0`, Minor `1`, Ready `YES`.

---

### Task 4: Add an evidence-only organization price-book reuse gate

**Files:**

- Create via CLI: `platform/supabase/migrations/20260901224653_organization_price_book_reuse_evidence.sql`
- Create: `platform/tests/drawing-workspace-m2-price-book-reuse-database.test.mjs`
- Modify: `platform/app/lukas/lib/organization-drawing-library.server.ts`
- Modify: `platform/app/lukas/screens/organization-drawing-library.tsx`
- Modify: `platform/tests/drawing-workspace-p7-library-route.test.mjs`

**Interfaces:**

- Consumes: `lukas_qto_projects.organization_id`, `lukas_qto_price_books.source_sha256`, existing organization role/entitlement authority, and current library loader.
- Produces: `lukas_qto_list_organization_price_book_reuse_candidates(p_organization_id uuid)` returning only SHA groups with `count(distinct project_id) >= 2`; it performs no writes. Optional RPC/schema-cache/entitlement failures settle to an explicit unavailable state without failing the existing library loader.

- [x] **Step 1: Write failing database and loader tests**

Seed one SHA in one project, one SHA in two projects of the same organization, and the same SHA in another organization. Assert only the same-organization two-project group is returned. Assert anonymous, ordinary member without management rights, and nonmember calls fail or return no rows according to the existing RPC convention.

- [x] **Step 2: Create the additive evidence migration with the CLI**

Run:

```bash
cd platform
npx supabase migration new organization_price_book_reuse_evidence
```

Expected: one path ending `_organization_price_book_reuse_evidence.sql`.

- [x] **Step 3: Implement one read-only aggregate RPC**

```sql
select b.source_sha256,
       count(distinct b.project_id) as project_count,
       count(*) as price_book_count,
       array_agg(distinct p.name order by p.name) as project_names
from public.lukas_qto_price_books b
join public.lukas_qto_projects p on p.id=b.project_id
where p.organization_id=p_organization_id
group by b.source_sha256
having count(distinct b.project_id)>=2
order by project_count desc,b.source_sha256;
```

Wrap the aggregate in the repository's hardened function pattern: `search_path=''`, explicit verified non-anonymous actor and organization-manager check, revoke `PUBLIC`/`anon`, and grant only authenticated/service role. Do not create a registry row or copy source files.

- [x] **Step 4: Render the measured decision in the existing organization screen**

Show SHA, distinct project count, price-book count, and project names for candidates. When the list is empty, state that a company registry is intentionally deferred until the same immutable source is reused in two projects. When optional evidence is unavailable, keep the existing company library usable and render that bounded state separately. The section has no mutation control.

- [x] **Step 5: Run focused authority**

Run:

```bash
cd platform
node --test tests/drawing-workspace-m2-price-book-reuse-database.test.mjs tests/drawing-workspace-p7-library-route.test.mjs
npm run typecheck
```

Result: focused database/server/UI tests passed `15/15`, TypeScript passed, no registry/table/copy code exists, and independent review reported Critical `0`, Important `0`, Ready `YES`.

---

### Task 5: Run the combined M2 release gate and update evidence

**Files:**

- Modify: `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-precision-touch.md`
- Modify: `docs/superpowers/evidence/2026-09-02-universal-workspace-m2-structure-source.md`

**Interfaces:**

- Consumes: Tasks 1–4 and the existing M1 disposable release runner.
- Produces: exact PASS/FAIL/UNEXECUTED evidence; no hosted or performance claim without a measured run.

- [x] **Step 1: Run focused app and database authorities**

```bash
cd platform
node --test \
  tests/drawing-workspace-touch.test.mjs \
  tests/drawing-workspace-style-editor.test.mjs \
  tests/drawing-workspace-table-builder.test.mjs \
  tests/drawing-workspace-source-attach-ui.test.mjs \
  tests/drawing-workspace-p7-export-audit.test.mjs \
  tests/drawing-workspace-p7-retention-database.test.mjs \
  tests/drawing-workspace-m2-price-book-reuse-database.test.mjs \
  tests/drawing-workspace-p7-library-route.test.mjs
```

- [x] **Step 2: Run type, collaboration, build, and M2 browser gates**

```bash
cd platform
npm run typecheck
npm run typecheck:collaboration
npm run build
npm run test:e2e:drawing-workspace-m2:local -- --reporter=line
```

- [x] **Step 3: Run the disposable M1 real-database/browser regression**

```bash
cd platform
npm run test:e2e:drawing-workspace-m1:local
```

- [x] **Step 4: Inspect the combined diff and request independent review**

```bash
cd platform
git diff --check
git status --short
```

Require Critical `0`, Important `0`, and Ready `YES` for the scoped M2 changes. Record the exact test counts and any unexecuted hosted/performance gate in evidence; do not preserve stale counts.

- [x] **Step 5: Hand off M3 without expanding M2 dependencies**

M3 starts from the existing Yjs/Hocuspocus implementation and proves canonical-route awareness, role enforcement, offline merge, and freeze behavior. Redis/pub-sub remains deferred until a measured single-instance threshold fails.

Handoff result: M2 closed with focused `72/73` (`0` failures, one environment-gated skip), both TypeScript graphs, production build, M2 Chromium `5/5`, disposable real-PostgreSQL authorities, authenticated canonical Chromium `10/10`, clean diff check, and independent Ready reviews. M3 proceeds on the existing collaboration boundary.

---

### Task 6: Bind the hosted P7 authority to the canonical workspace route

**Files:**

- Modify: `platform/e2e/drawing-workspace-p7-production.spec.ts`
- Modify: `platform/scripts/run-drawing-workspace-p7-release.mjs`
- Test: `platform/tests/drawing-workspace-p7-release.test.mjs`

**Interfaces:**

- Consumes: the exact hosted project, drawing document, revision, three production identities, and the three real drawing-export audit rows.
- Produces: a V2 raw receipt that proves all three browsers mounted `/projects/:projectId/workspaces/:workspaceId` directly and binds PDF, PNG, and SVG bytes to the configured document/revision/checkpoint/snapshot authority.

- [x] **Step 1: Add failing canonical-route and V2 receipt contracts**

  Require the production harness to enter the document route directly, never `/drawings/:fileId/workspace` or `?document=`. The receipt fixture must carry three ordered observed mounted paths and three exact drawing-export rows. Prove that missing, legacy, query-bearing, wrong-project, or wrong-workspace paths fail, that V1 receipts fail closed, and that a missing, duplicate, reordered, mismatched, or malformed drawing-export tuple fails validation.

- [x] **Step 2: Mount all three identities on the canonical route**

  Build exactly `/projects/${authority.project}/workspaces/${authority.document}` in the existing mounted-page helper. After magic-link confirmation, require the final pathname to equal that path and the search string to be empty before accepting canvas or collaboration evidence. Return each observed path and write the ordered three-value array into the raw receipt. Preserve the legacy GET compatibility route and its redirect tests.

- [x] **Step 3: Fail closed on incomplete V2 export evidence**

  Emit `schemaVersion: 2` with `P7_MOUNTED_PRODUCTION_PLAYWRIGHT_V2`. Validate exactly three ordered `drawing_pdf`, `drawing_png`, and `drawing_svg` rows with distinct UUID request IDs, positive byte sizes, lowercase SHA-256 values, the approver actor, exact document/revision, positive revision version, nonnegative operation checkpoint, and matching checkpoint/snapshot SHA values. Cross-check the existing PDF summary against the PDF row; add no table, migration, RPC, dependency, route, or product state.

- [x] **Step 4: Run the bounded release-harness gate**

  Run the focused P7 release and canonical-route contracts, application typecheck, scoped Prettier, and `git diff --check`. Run the full disposable M1 authority because the production spec shares its export and route contracts. Record the hosted three-identity execution as `UNEXECUTED` unless the complete `P7_E2E_*` authority is actually present; do not manufacture production identities or data.

Result refreshed on 2026-09-04: the harness now enters the exact query-free canonical workspace path for all three ordered identities and emits only V2 evidence. The validator binds every PDF/PNG/SVG row to the serialized approved revision version, snapshot SHA, and operation checkpoint, rejects case-variant duplicate request UUIDs, and cross-checks the PDF compatibility summary. Fresh controller authority passed P7 contracts `29/29`, canonical/legacy route contracts `2/2`, application typecheck, scoped Prettier, `git diff --check`, and the full disposable production-shaped Chromium suite `18/18` in 2.2 minutes. Independent review reported Critical `0`, Important `0`, Minor `0`, Ready `YES`. Hosted credentialed P7 remains `UNEXECUTED` because no complete real `P7_E2E_*` authority is present. This test/script-only correction changes no deployed runtime artifact, database, Edge Function, Storage policy, collaboration service, or dependency.
