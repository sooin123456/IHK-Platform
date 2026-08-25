# 1HK Drawing Workspace P2 Structure and Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the verified P0/P1 drawing editor with multi-page canvases, reusable styles and blocks, approved-revision templates, typed custom properties, schedules, and deterministic PDF/PNG/SVG export.

**Architecture:** Preserve the canonical-domain → command → IndexedDB outbox → hardened Supabase RPC flow. Add one strict `mutate_structure` operation for P2 entities, backfill each existing page to an authoritative paper canvas, and include every P2 entity in canonical snapshot schema v2. Render/export only from canonical geometry and resolved styles; Konva JSON remains a view artifact.

**Tech Stack:** React Router 7, React 19, TypeScript, Zod, Konva/react-konva, native IndexedDB/Canvas/XML APIs, Supabase Postgres/RLS/RPC, PGlite tests, PDF.js, exact MIT `pdf-lib` for multi-page PDF writing.

**Spec:** `docs/superpowers/specs/2026-08-25-drawing-workspace-p2-design.md`

## Global Constraints

- Never update PDF/IFC source rows or Storage bytes from editor/export actions.
- All new public tables use the `lukas_` prefix, explicit grants, RLS, project-scoped composite FKs, covering indexes, and approved-revision guards.
- Add one new migration after `20260824154700`; never rewrite or remotely apply prior migrations.
- Keep exact idempotency payload binding and SQLSTATE `P1C01`/`P1R01`; `40001`/`40P01` remain retryable.
- No state-management, table/grid, SVG, template, or export framework is added.
- Add only exact `pdf-lib` after a license test proves MIT and update `THIRD_PARTY_NOTICES.md`.
- Snapshot v1 stays byte-for-byte immutable and readable; all P2 approvals use canonical snapshot v2.
- P3 Yjs/Hocuspocus and P4 semantic schedules remain out of scope.
- Every task uses RED → GREEN TDD, full affected regression tests, self-review, a fresh reviewer, and a focused commit.

---

### Task 1: Canonical P2 domain and structure-operation contracts

**Files:**
- Modify: `platform/app/lukas/lib/drawing-workspace.types.ts`
- Create: `platform/app/lukas/lib/drawing-structure.ts`
- Modify: `platform/app/lukas/lib/drawing-commands.ts`
- Test: `platform/tests/drawing-workspace-structure.test.mjs`
- Test: `platform/tests/drawing-workspace-commands.test.mjs`

**Interfaces:**
- Consumes: `DrawingGeometrySchema`, `DrawingStyleSchema`, canonical UUID/version rules
- Produces: `DrawingPageSchema`, `DrawingCanvasSchema`, `DrawingStyleDefinitionSchema`, `DrawingBlockSchema`, `DrawingBlockInstanceSchema`, `DrawingPropertySchemaSchema`, `DrawingPropertyValueSchema`, `DrawingTableSchema`, `DrawingStructureActionSchema`, `resolveDrawingStyle()`, `applyDrawingStructureActions()`

- [ ] **Step 1: Write failing strict-schema and inverse tests**

```js
test("structure actions reject unknown fields and restore exact prior entities", () => {
  const state = p2State();
  const action = putCanvas(canvas({ version: 1 }), null);
  const applied = applyDrawingStructureActions(state, [action]);
  assert.deepEqual(applied.inverse, [{ kind: "delete_canvas", id: action.entity.id, baseVersion: 1 }]);
  assert.throws(() => DrawingStructureActionSchema.parse({ ...action, authority: "admin" }));
});

test("resolved style merges a referenced definition with finite validated overrides", () => {
  assert.deepEqual(resolveDrawingStyle(objectWithStyle("style-1", { fill: "#ffffff" }), styles), {
    stroke: "#111111", strokeWidth: 2, fill: "#ffffff", fontSize: 12,
  });
});
```

- [ ] **Step 2: Run RED tests**

Run: `cd platform && node --test tests/drawing-workspace-structure.test.mjs tests/drawing-workspace-commands.test.mjs`

Expected: FAIL because the P2 schemas/module and `mutate_structure` command do not exist.

- [ ] **Step 3: Add exact canonical schemas**

Implement the spec field-for-field. Use strict discriminated unions. Enforce:

```ts
const DrawingPropertyValueSchema = z.object({
  id: Uuid,
  schemaId: Uuid,
  objectId: Uuid.nullable(),
  blockInstanceId: Uuid.nullable(),
  value: z.union([z.string(), Finite, z.boolean(), z.null()]),
  version: PositiveInteger,
}).strict().refine((v) => Number(v.objectId !== null) + Number(v.blockInstanceId !== null) === 1);
```

Keep `DrawingObject.style` backward compatible by accepting a complete inline style when `styleId` is null and a partial override when `styleId` is present. `resolveDrawingStyle()` must return a complete `DrawingStyleSchema` result or throw a domain error.

- [ ] **Step 4: Implement pure immutable structure reduction**

`applyDrawingStructureActions(state, actions)` validates base versions against one captured pre-state, then validates references against the sequential cloned state, applies all-or-nothing, increments exact versions, and returns inverse actions in reverse order. It rejects deletion of the last canvas, default paper canvas, referenced style/block/schema, and a page containing canvases unless the same action batch removes children first. Include strict `put_object`/`delete_object` actions only for a compound batch that also creates or reverses a block definition and instance; reject them in every other structure batch so ordinary object edits remain on the existing operation path.

- [ ] **Step 5: Extend the command operation union minimally**

Add only:

```ts
type DrawingCommand = ExistingDrawingCommand | {
  type: "mutate_structure";
  actions: DrawingStructureAction[];
};
```

Record strict forward/inverse payloads and result versions without changing existing object/layer behavior.

- [ ] **Step 6: Run focused/full verification and commit**

Run: `cd platform && node --test tests/drawing-workspace-structure.test.mjs tests/drawing-workspace-commands.test.mjs && npm run typecheck && git diff --check`

Commit: `feat: define drawing workspace P2 contracts`

### Task 2: Additive P2 schema, canvas backfill, hardened mutation RPC, and snapshot v2

**Files:**
- Create: `platform/supabase/migrations/<generated>_drawing_workspace_p2_structure.sql`
- Modify: `platform/tests/drawing-workspace-database.test.mjs`
- Modify: `platform/tests/drawing-workspace-database-runtime.test.mjs`

**Interfaces:**
- Consumes: Task 1 entity/action JSON contracts, existing final hardened RPCs and guards
- Produces: seven approved P2 tables, `canvas_id` layer ownership, P2-aware `lukas_drawing_apply_operation`, snapshot schema v2, template-clone RPC

- [ ] **Step 1: Generate the additive migration and write RED SQL contract tests**

Use the Supabase CLI migration generator when available. Tests require exactly:

```js
for (const table of [
  "lukas_drawing_canvases", "lukas_drawing_styles", "lukas_drawing_blocks",
  "lukas_drawing_block_instances", "lukas_drawing_property_schemas",
  "lukas_drawing_property_values", "lukas_drawing_tables",
]) assert.match(sql, new RegExp(`create table public\\.${table}`));
assert.match(sql, /check \(operation_type[\s\S]*mutate_structure/);
assert.match(sql, /schema_version[^;]*2/);
```

- [ ] **Step 2: Add tables and migrate page authority to canvas**

Create columns and constraints matching the spec. Add `version > 0`, trimmed-name checks, JSON type/size checks, project/revision/page composite uniqueness, RLS, explicit grants, and covering indexes. Add nullable `canvas_id` to layers, insert one paper canvas per existing page from legacy page fields, assign every existing layer, then set `canvas_id NOT NULL`. Keep legacy page background columns read-only.

- [ ] **Step 3: Add invariant and immutability guards**

Triggers must enforce one default paper canvas per page, at least one canvas per page, one visible unlocked non-source layer per active canvas, style/block/property referential integrity, typed property values, no used-definition deletion, and approved/review-requested immutability. Parent draft cascades remain allowed only through authenticated/capability-checked FK depth.

- [ ] **Step 4: Extend the final hardened apply RPC**

Rename the current final function to a private implementation and wrap it. For `mutate_structure`, validate the strict action array, lock revision first, verify every ancestry/base version, apply actions transactionally, append the exact operation and canonical inverse, and return result versions. For legacy operation types, delegate without weakening SQLSTATE or idempotency binding.

- [ ] **Step 5: Implement canonical snapshot schema v2**

The review RPC must serialize sources, pages, canvases, layers, objects, styles, blocks, instances, property schemas/values, tables, and issues in deterministic order. Existing snapshot rows are never rewritten. New P2 review requests require version 2 and required property validation.

- [ ] **Step 6: Add template clone RPC**

`lukas_drawing_create_from_template(p_source_revision_id, p_title, p_source_file_id)` requires an approved same-project snapshot, creates a new document/revision, generates new row IDs, preserves object lineage, rebinds FKs, and copies source references only when explicitly supplied and SHA-matched.

- [ ] **Step 7: Run actual PGlite behavioral tests**

Cover fresh install, P0/P1 upgrade/backfill, direct RLS denial, base conflict, exact retry, partial-action rollback, snapshot v1 immutability/v2 determinism, approved mutation denial, template clone, cross-project existence uniformity, and parent cascade.

Run: `cd platform && node --test tests/drawing-workspace-database.test.mjs tests/drawing-workspace-database-runtime.test.mjs`

Commit: `feat: persist drawing workspace P2 structure`

### Task 3: P2 server parsing, pagination, loader, and actions

**Files:**
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/tests/drawing-workspace-server.test.mjs`

**Interfaces:**
- Consumes: P2 schemas/RPCs from Tasks 1–2
- Produces: paginated `DrawingWorkspaceRevision` P2 collections; action intents `apply_operation`, `create_from_template`, `export_snapshot`

- [ ] **Step 1: Write RED loader/action tests**

Require >1,000 rows pagination for block instances/property values, strict snake_case conversion, active source SHA binding, same-project template lookup, and rejection of browser authority fields.

- [ ] **Step 2: Add typed row adapters and pagination**

Use the existing `loadAllDrawingRows()` pattern for every unbounded collection. Parse JSON through Task 1 Zod schemas; never cast raw JSON. Return pages with canvases and page-scoped layer/object/instance collections without selecting `pages[0]`.

- [ ] **Step 3: Parse `mutate_structure` and template intents**

Accept only canonical operation fields. Template action accepts source revision ID/title/optional source file ID; project, actor, destination IDs, role, and SHA are server-derived. Map `P1C01` to 409, `P1R01` to 400/404 uniform unavailable response, and `40001`/`40P01` to retryable 503.

- [ ] **Step 4: Load template candidates read-only**

Return same-project approved revision IDs, document titles, approval time, and snapshot SHA. Do not expose snapshot JSON or foreign IDs before capability filtering.

- [ ] **Step 5: Verify and commit**

Run: `cd platform && node --test tests/drawing-workspace-server.test.mjs tests/drawing-workspace-route.test.mjs && npm run typecheck`

Commit: `feat: load drawing workspace P2 documents`

### Task 4: Extend IndexedDB recovery and client document state for P2

**Files:**
- Modify: `platform/app/lukas/lib/drawing-outbox.client.ts`
- Create: `platform/app/lukas/lib/drawing-document-store.client.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Test: `platform/tests/drawing-workspace-outbox.test.mjs`
- Test: `platform/tests/drawing-workspace-structure.test.mjs`

**Interfaces:**
- Consumes: strict `mutate_structure` operations and P2 loader state
- Produces: native `useSyncExternalStore` document store, P2 replay/recovery, active page/canvas selection

- [ ] **Step 1: Write RED recovery tests**

Test atomic offline replay of a page+canvas+layer batch, conflict without partial state, ack-chain reconstruction, legacy v1 outbox quarantine, active canvas invalidation, and review drain including P2 operations.

- [ ] **Step 2: Add the minimal external store**

```ts
export type DrawingDocumentStore = {
  getSnapshot(): DrawingDocumentState;
  subscribe(listener: () => void): () => void;
  dispatch(command: DrawingCommand): AppliedDrawingCommand;
  replace(state: DrawingDocumentState): void;
};
```

Use a closure, `Set` of listeners, and existing pure reducers. Do not add a package, context framework, selector framework, or persistence to the store.

- [ ] **Step 3: Extend outbox recovery by action result versions**

Replay all P2 actions against captured versions, restore exact acknowledged effects over stale loader snapshots, and preserve ambiguity as durable conflict evidence. `mutate_structure` is one atomic replay unit.

- [ ] **Step 4: Add active identity fail-closed behavior**

Store active page/canvas as UI identity, not persisted authority. On deletion, permission downgrade, or loader replacement, choose the first sorted accessible paper canvas and cancel tool/selection/drag before render.

- [ ] **Step 5: Verify and commit**

Run: `cd platform && node --test tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-structure.test.mjs tests/drawing-workspace-route.test.mjs && npm run typecheck`

Commit: `feat: recover drawing P2 document state`

### Task 5: Multi-page/canvas navigation and real layer ordering

**Files:**
- Create: `platform/app/lukas/components/drawing-pages-panel.tsx`
- Modify: `platform/app/lukas/components/drawing-layers-panel.tsx`
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Test: `platform/tests/drawing-workspace-route.test.mjs`
- Test: `platform/tests/drawing-workspace-structure.test.mjs`

**Interfaces:**
- Consumes: active page/canvas store state and version-aware structure/layer commands
- Produces: accessible page tree, paper/model canvas switch, canvas-scoped rendering, layer reorder/move

- [ ] **Step 1: Add failing accessible interaction tests**

Require add/rename/reorder page, add paper/model canvas, switching isolation, last/default canvas deletion denial, active canvas fallback, Viewer mutation-control absence, and labeled tree/buttons.

- [ ] **Step 2: Implement pages/canvases panel**

Use native buttons/list/tree semantics. Page/canvas creation uses UUID/time factories and one `mutate_structure` command. Delete controls include explicit disabled reasons for default/last/nonempty/immutable cases.

- [ ] **Step 3: Scope layers and objects to active canvas**

Remove every first-page/flat-revision assumption. Layer create/reorder/move includes `canvasId`/`sortOrder`. The canvas receives only resolved active-canvas layers, objects, block instances, styles, and background.

- [ ] **Step 4: Render actual layer order**

Group Konva nodes by sorted domain layer or render a deterministic sorted object list. Hidden/locked/source behavior and 10k hit testing remain domain-driven; no Konva layer object is persisted.

- [ ] **Step 5: Run React/browser verification and commit**

Run focused Node tests, typecheck/build, and a Playwright page/canvas smoke. Apply React best-practices: derive filtered collections, refs for transient gestures, primitive effect dependencies, no per-object listener addition.

Commit: `feat: navigate drawing pages and canvases`

### Task 6: Reusable style library and live effective-style rendering

**Files:**
- Create: `platform/app/lukas/components/drawing-styles-panel.tsx`
- Create: `platform/app/lukas/lib/drawing-style-resolution.ts`
- Modify: `platform/app/lukas/components/drawing-inspector.tsx`
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Test: `platform/tests/drawing-workspace-styles.test.mjs`

**Interfaces:**
- Consumes: style definitions, object/block overrides, `mutate_structure`, `update_objects`
- Produces: style CRUD, apply/detach/override/reset commands, memoized effective style map

- [ ] **Step 1: Write RED resolution and reference tests**

Test inline legacy styles, definition+override merge, missing/invalid definition fail-closed, definition rename/value update, used deletion denial, multi-selection apply/reset, and snapshot resolution.

- [ ] **Step 2: Implement pure resolution cache**

Resolve once per `{styleId, styleVersion, override}` key in a render pass. Do not introduce global mutable cache. Canvas nodes receive complete `DrawingStyle` only.

- [ ] **Step 3: Implement accessible style panel/inspector**

Native labeled inputs edit name/stroke/strokeWidth/fill/fontSize. Applying a style sets `styleId` and `{}` override; editing an object style writes only changed override fields; detach writes the current effective style inline.

- [ ] **Step 4: Verify and commit**

Run: `cd platform && node --test tests/drawing-workspace-styles.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-route.test.mjs && npm run typecheck && npm run build`

Commit: `feat: reuse drawing styles`

### Task 7: Block definitions, instances, and transforms

**Files:**
- Create: `platform/app/lukas/components/drawing-blocks-panel.tsx`
- Create: `platform/app/lukas/lib/drawing-blocks.ts`
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/app/lukas/components/drawing-inspector.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Test: `platform/tests/drawing-workspace-blocks.test.mjs`

**Interfaces:**
- Consumes: selected canonical objects, style resolver, structure operation
- Produces: `createBlockFromSelection()`, instance renderer/hit bounds, instance transform/copy/delete

- [ ] **Step 1: Write RED geometry and atomic-command tests**

Verify world→relative primitive conversion, instance matrix transform, rotated/scaled bounds, style resolution, exact block update propagation, atomic replace-selection inverse, copy identity, used-definition denial, and hidden/locked layer exclusion.

- [ ] **Step 2: Implement pure block geometry**

Use existing point/bounds/geometry transforms. No matrix dependency. Reject zero/nonfinite scale and nested blocks. `blockInstanceBounds()` must enclose every transformed primitive.

- [ ] **Step 3: Implement compound block creation through one operation**

The server-compatible command creates the definition and instance and deletes selected objects through the structure operation's restricted `put_object`/`delete_object` compound actions in one exact forward/inverse payload. The authoritative validator permits those actions only when the same batch creates or reverses the corresponding block definition and instance. If any selected object becomes stale or ineligible, apply nothing.

- [ ] **Step 4: Render and inspect instances**

One instance is one selection target. Inspector edits name, layer, origin, rotation, scaleX/scaleY. Editing a definition updates all instances without instance version changes.

- [ ] **Step 5: Verify 1,000-instance fixture and commit**

Run focused tests plus a synthetic render/hit test and build. Keep the performance target reported, not assumed.

Commit: `feat: add reusable drawing blocks`

### Task 8: Project templates from approved revisions

**Files:**
- Create: `platform/app/lukas/components/drawing-template-dialog.tsx`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Test: `platform/tests/drawing-workspace-template.test.mjs`
- Test: `platform/tests/drawing-workspace-database-runtime.test.mjs`

**Interfaces:**
- Consumes: same-project approved snapshot v1/v2, template clone RPC
- Produces: blank/source-bound clone flow and deterministic lineage/source mapping

- [ ] **Step 1: Write RED clone contract tests**

Require approved-only, same-project, maker/editor capability, new IDs, preserved lineage, v1 default-canvas promotion, v2 full P2 clone, explicit source SHA match, foreign/missing uniform error, and idempotent document creation.

- [ ] **Step 2: Implement accessible template dialog**

List approved project revisions by title/date/SHA. User enters a new title and chooses blank or verified current source. No company/global catalog appears in P2.

- [ ] **Step 3: Revalidate loader and navigate**

After authoritative RPC success, navigate to the new workspace document. Never materialize template rows in the browser or clone with client UUID loops.

- [ ] **Step 4: Verify and commit**

Run focused server/PGlite/route tests, typecheck/build.

Commit: `feat: start drawings from approved templates`

### Task 9: Typed custom properties and simple schedules

**Files:**
- Create: `platform/app/lukas/components/drawing-properties-panel.tsx`
- Create: `platform/app/lukas/components/drawing-tables-panel.tsx`
- Create: `platform/app/lukas/lib/drawing-properties.ts`
- Create: `platform/app/lukas/lib/drawing-tables.ts`
- Modify: `platform/app/lukas/components/drawing-inspector.tsx`
- Test: `platform/tests/drawing-workspace-properties.test.mjs`
- Test: `platform/tests/drawing-workspace-tables.test.mjs`

**Interfaces:**
- Consumes: property/table schemas, object/instance current state, structure operation
- Produces: typed schema/value commands, required-property review check, deterministic table resolver

- [ ] **Step 1: Write RED typed-value tests**

Cover text/finite number/boolean/ISO date/enum, exactly-one target, appliesTo, required review failure, invalid schema evolution, deleted target cascade, and Viewer read-only behavior.

- [ ] **Step 2: Implement property schema/value panel**

Use native input types: text, number, checkbox, date, select. Schema editing is Editor/Admin only. Inspector shows schemas applicable to the selected object/instance and emits one atomic action batch for multi-selection.

- [ ] **Step 3: Write RED table resolver tests**

```js
assert.deepEqual(resolveDrawingTable(table, document), [
  { object_name: "Door 01", width: 900, fire_rating: "60 min" },
]);
```

Require stable row/column order, missing target marker, property type formatting, manual cell restrictions, and no formulas/evaluation.

- [ ] **Step 4: Implement semantic DOM schedule UI**

Reuse `app/core/components/ui/table.tsx`. Resolve derived columns during render from immutable maps; store only manual cells and target IDs. Add CSV download only if it is a trivial native serialization helper; do not add XLSX in P2.

- [ ] **Step 5: Verify and commit**

Run focused properties/tables/route/server tests, typecheck/build, accessible locator smoke.

Commit: `feat: add drawing properties and schedules`

### Task 10: Deterministic PNG, SVG, and multi-page PDF export

**Files:**
- Create: `platform/app/lukas/lib/drawing-export.ts`
- Create: `platform/app/lukas/components/drawing-export-dialog.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Modify: `platform/package.json`
- Modify: `platform/package-lock.json`
- Modify: `platform/THIRD_PARTY_NOTICES.md`
- Test: `platform/tests/drawing-workspace-export.test.mjs`
- Test: `platform/tests/drawing-workspace-license.test.mjs`

**Interfaces:**
- Consumes: canonical snapshot/document state, style/block resolvers, PDF.js-rendered background pixels
- Produces: `exportDrawingSvg()`, `exportDrawingPng()`, `exportDrawingPdf()`, native download flow

- [ ] **Step 1: Add RED license/export contract tests**

Require exact `pdf-lib` MIT metadata/notice, no GPL/MPL/source-available dependency, deterministic SVG XML, PNG dimensions/pixel ratio, PDF paper-canvas page count/order, hidden-layer exclusion, block/style equivalence, source SHA invariance, and explicit failure on tainted/missing background.

- [ ] **Step 2: Install exact `pdf-lib` and notice it**

Use `npm install --save-exact pdf-lib@<verified-current-version>`. Record project URL, exact version, MIT license, and unmodified dependency use. Do not copy Excalidraw/Penpot code.

- [ ] **Step 3: Implement one canonical vector traversal**

`collectExportPrimitives(document, canvasId)` resolves visible sorted layers, objects, styles, blocks, and instances into normalized primitives. SVG/PNG/PDF all consume this function.

- [ ] **Step 4: Implement SVG and PNG**

SVG uses native XML escaping and deterministic attribute order. PNG draws the PDF.js background canvas then vector primitives into an offscreen canvas at 1x/2x/4x and returns a Blob. Never read Konva JSON.

- [ ] **Step 5: Implement multi-page PDF**

Create one PDF page per visible paper canvas in page/canvas sort order, convert millimeters to points (`72 / 25.4`), embed the rendered PNG, set document metadata, and return bytes. Model canvases require explicit selection.

- [ ] **Step 6: Verify rendered artifacts visually and commit**

Render fixture PDF pages to images using the PDF skill/runtime, inspect SVG/PNG/PDF bounds, run focused tests/typecheck/build, and verify source metadata/bytes unchanged.

Commit: `feat: export drawing workspace documents`

### Task 11: P2 end-to-end, performance, migration, and release evidence

**Files:**
- Create: `platform/e2e/drawing-workspace-p2.spec.ts`
- Modify: `platform/e2e/utils/drawing-collaboration-fixture.ts`
- Create: `platform/tests/drawing-workspace-p2-contract.test.mjs`
- Modify: `platform/package.json`
- Modify: `platform/DEPLOYMENT.md`
- Modify: `docs/P0_P5_IMPLEMENTATION_MATRIX.md`

**Interfaces:**
- Consumes: every P2 public contract
- Produces: executable P2 production gate, upgrade/rollback instructions, performance evidence

- [ ] **Step 1: Write RED E2E source/behavior contract**

Require the 12 release gates from the P2 spec, separate Editor/Viewer/Reviewer contexts, P0/P1 upgrade fixture, snapshot v2 approval, direct RLS mutation denial, source byte SHA before/after, cleanup error accumulation, and honest credential gating.

- [ ] **Step 2: Add deterministic performance fixture**

Seed 20 canvases, 10,000 objects, 1,000 instances, 20 styles, 20 properties, and 5 tables. Measure active canvas first usable time, 120 pan/zoom frames, selection, page/canvas switch p95, and export duration. Assert event effects and catastrophic thresholds; report 60fps/250ms targets separately from pass thresholds until measured tuning.

- [ ] **Step 3: Implement serial browser workflow**

Exercise page/canvas isolation, layer order, live style, block update, property/table, offline reload, template clone, PNG/SVG/PDF downloads, review/approval, and immutable direct/RPC rejection. Use exact accessible locators and downloaded artifact parsing, not string-only claims.

- [ ] **Step 4: Document deploy/rollback**

Add duplicate/invariant preflight SQL, backup/schema snapshot, migration order, type regeneration, tests/build/E2E, preview smoke, promotion, and forward-fix/rollback constraints. Never roll back by rewriting an applied migration.

- [ ] **Step 5: Run complete verification**

```bash
cd platform
npm run test:drawing-workspace
node --test tests/*.test.mjs
npm run test:ifc
npm run typecheck
npm run build
npx playwright test e2e/workspace-preview-room.spec.ts --project=chromium
```

Run the P2 production spec only when its four credential variables exist; otherwise mark it unexecuted. Run whole-branch code review, ponytail review, React review, and fresh final verification.

- [ ] **Step 6: Commit release evidence**

Commit: `test: verify drawing workspace P2 structure`

## P2 Completion Boundary

P2 completes structured multi-page documents and reusable content. It does not claim real-time multi-user editing. The next plan must implement P3-A Realtime events/roles, then P3-B Yjs + y-indexeddb + Hocuspocus with the two-browser cursor/selection/offline-merge gate.
