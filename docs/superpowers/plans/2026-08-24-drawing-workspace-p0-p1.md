# 1HK Drawing Workspace P0/P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 PDF/IFC 협업실을 보존하면서 별도 route에서 빈 도면 또는 PDF 배경 위에 기본 여섯 도형을 작성·편집·저장·복구하는 P0/P1 단일 사용자 작업실을 완성한다.

**Architecture:** React Router loader/action과 Supabase RLS/RPC가 권한과 저장의 최종 경계다. 클라이언트는 도메인 객체와 command store를 소유하고 Konva는 렌더링 adapter로만 사용하며, 모든 미확정 operation은 IndexedDB outbox에 보존한다. P3의 Yjs/Hocuspocus는 이 계획에서 구현하지 않지만 현재 store와 operation 계약을 교체하지 않고 collaboration adapter로 연결할 수 있어야 한다.

**Tech Stack:** React 19, React Router 7.18.2, TypeScript 5.9, Konva 10.3.1, react-konva 19.2.5, pdfjs-dist 6.2.108, Zod 3, Supabase Postgres/RLS/Storage, IndexedDB, Node test runner, Playwright 1.62.1

**Spec:** `docs/superpowers/specs/2026-08-24-drawing-workspace-design.md`

## Global Constraints

- 기존 `/projects/:projectId/drawings/:fileId` 협업실과 PDF/IFC 검토 흐름을 유지한다.
- 새 route는 `/projects/:projectId/drawings/:fileId/workspace`다.
- 월드 길이 단위는 millimeter이며 화면 좌표를 저장하지 않는다.
- PDF/IFC 원본 byte와 `lukas_qto_files.sha256`은 수정하지 않는다.
- Konva JSON은 DB 계약으로 저장하지 않는다.
- 상용 코드에 직접 포함하는 새 코드는 MIT, Apache-2.0, BSD 계열만 허용한다.
- UI, action/RPC, RLS에서 동일한 capability를 검증한다.
- 승인된 revision은 직접 update/delete할 수 없다.
- 브라우저 계산은 미리보기이며 승인 수량 계산은 이 계획의 범위 밖이다.
- 기존 Node test runner와 Playwright를 사용하고 새 테스트 framework를 추가하지 않는다.
- 기존 untracked `docs/plans/`와 사용자 변경은 수정하거나 stage하지 않는다.

## File Map

### Domain and client state

- Create `platform/app/lukas/lib/drawing-workspace.types.ts`: object, style, page, layer, capability, operation Zod contracts
- Create `platform/app/lukas/lib/drawing-geometry.ts`: world/screen transforms, calibration, bounds, hit-test and snapping helpers
- Create `platform/app/lukas/lib/drawing-commands.ts`: command application, inverse generation, undo/redo state
- Create `platform/app/lukas/lib/drawing-outbox.client.ts`: IndexedDB operation queue and retry state

### Server and database

- Create `platform/supabase/migrations/20260824110000_drawing_workspace_core.sql`: P0/P1 tables, guards, RLS, RPCs, indexes
- Create `platform/app/lukas/lib/drawing-workspace.server.ts`: context loading, initial document creation, room loading, mutation parsing
- Create `platform/app/lukas/screens/drawing-workspace.tsx`: route loader/action and full-screen screen
- Modify `platform/app/routes.ts`: register the workspace route
- Modify `platform/app/lukas/screens/drawing-room.tsx`: add an explicit link to the workspace without replacing the room

### Rendering and UI

- Create `platform/app/lukas/components/drawing-workspace.client.tsx`: editor orchestration and save state
- Create `platform/app/lukas/components/drawing-canvas.client.tsx`: Konva stage, background, tools, selection
- Create `platform/app/lukas/components/drawing-inspector.tsx`: selected object properties
- Create `platform/app/lukas/components/drawing-layers-panel.tsx`: layer create, visibility, lock
- Create `platform/app/lukas/components/drawing-command-menu.tsx`: searchable tool/action command menu
- Create `platform/app/lukas/lib/pdf-page-renderer.client.ts`: shared PDF document/page rendering primitives
- Modify `platform/app/lukas/components/pdf-drawing-viewer.client.tsx`: consume the shared PDF rendering primitive
- Modify `platform/package.json` and `platform/package-lock.json`: add exact Konva packages and deterministic test scripts
- Create `platform/THIRD_PARTY_NOTICES.md`: dependency and selectively ported-code notices

### Tests

- Create `platform/tests/drawing-workspace-geometry.test.mjs`
- Create `platform/tests/drawing-workspace-commands.test.mjs`
- Create `platform/tests/drawing-workspace-database.test.mjs`
- Create `platform/tests/drawing-workspace-server.test.mjs`
- Create `platform/tests/drawing-workspace-route.test.mjs`
- Create `platform/tests/drawing-workspace-outbox.test.mjs`
- Create `platform/tests/drawing-workspace-license.test.mjs`
- Create `platform/e2e/drawing-workspace.spec.ts`
- Modify `platform/e2e/utils/drawing-collaboration-fixture.ts`: provision and clean workspace rows for existing four-role users

---

### Task 1: Geometry and calibration contract

**Files:**
- Create: `platform/app/lukas/lib/drawing-workspace.types.ts`
- Create: `platform/app/lukas/lib/drawing-geometry.ts`
- Test: `platform/tests/drawing-workspace-geometry.test.mjs`

**Interfaces:**
- Consumes: no new application interface
- Produces: `Point`, `Bounds`, `Viewport`, `PdfCalibration`, `DrawingStyle`, `DrawingObject`, `DrawingLayer`, `DrawingOperationInput`, `DrawingGeometrySchema`, `worldToScreen()`, `screenToWorld()`, `calibratePdf()`, `geometryBounds()`, `snapWorldPoint()`

- [ ] **Step 1: Write the failing coordinate round-trip and calibration tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  calibratePdf,
  screenToWorld,
  worldToScreen,
} from "../app/lukas/lib/drawing-geometry.ts";

test("world coordinates round-trip independently from viewport pixels", () => {
  const viewport = { x: 120, y: -40, zoom: 2 };
  const world = { x: 1500, y: 900 };
  assert.deepEqual(screenToWorld(worldToScreen(world, viewport), viewport), world);
});

test("PDF calibration converts normalized page distance to millimeters", () => {
  const calibration = calibratePdf(
    { x: 0.1, y: 0.2 },
    { x: 0.6, y: 0.2 },
    5000,
  );
  assert.equal(calibration.millimetersPerNormalizedUnit, 10000);
});

test("snapping uses a screen-pixel tolerance converted through zoom", () => {
  assert.deepEqual(
    snapWorldPoint({ x: 98, y: 202 }, [{ x: 100, y: 200 }], { gridSize: 50, tolerancePixels: 8, zoom: 2 }),
    { point: { x: 100, y: 200 }, kind: "object" },
  );
});
```

- [ ] **Step 2: Run the geometry test and verify the missing module failure**

Run: `cd platform && node --test tests/drawing-workspace-geometry.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `drawing-geometry.ts`.

- [ ] **Step 3: Define domain primitives and the six P0/P1 geometry schemas**

```ts
export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };

export const DrawingGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("line"), start: PointSchema, end: PointSchema }),
  z.object({ type: z.literal("polyline"), points: z.array(PointSchema).min(2), closed: z.boolean() }),
  z.object({ type: z.literal("rectangle"), origin: PointSchema, width: PositiveFinite, height: PositiveFinite, rotation: Finite }),
  z.object({ type: z.literal("circle"), center: PointSchema, radius: PositiveFinite }),
  z.object({ type: z.literal("text"), origin: PointSchema, width: PositiveFinite, text: z.string().max(10000) }),
  z.object({ type: z.literal("dimension"), start: PointSchema, end: PointSchema, offset: Finite, calibrationId: z.string().uuid().nullable() }),
]);

export const DrawingStyleSchema = z.object({
  stroke: z.string().regex(/^#[0-9a-f]{6}$/i),
  strokeWidth: PositiveFinite.max(1000),
  fill: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i).nullable(),
  fontSize: PositiveFinite.max(10000).optional(),
});

export const DrawingOperationInputSchema = z.object({
  clientOperationId: z.string().uuid(),
  revisionId: z.string().uuid(),
  type: z.enum(["add_objects", "update_objects", "delete_objects", "add_layer", "update_layer"]),
  baseVersions: z.record(z.string().uuid(), z.number().int().positive()),
  forward: z.record(z.string(), z.unknown()),
  inverse: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
```

Use `Number.isFinite` refinements for every coordinate. Reject zero-length lines, repeated-only polylines, non-positive dimensions, and text containing NUL.

- [ ] **Step 4: Implement exact viewport and calibration helpers**

```ts
export function worldToScreen(point: Point, view: Viewport): Point {
  return { x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y };
}

export function screenToWorld(point: Point, view: Viewport): Point {
  if (!Number.isFinite(view.zoom) || view.zoom <= 0) throw new Error("확대 배율이 올바르지 않습니다.");
  return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom };
}
```

Implement `calibratePdf()` from Euclidean normalized distance and reject coincident points or non-positive real length. Implement `geometryBounds()` for all six types; dimension bounds include its offset line.

Implement `snapWorldPoint(point, objectCandidates, options)` with a tolerance of `tolerancePixels / zoom`. Prefer object endpoints/corners/centers over the grid when distances tie. Return the unchanged point with `kind: null` when no candidate is within tolerance.

- [ ] **Step 5: Add invalid geometry and bounds cases, then run the test**

Run: `cd platform && node --test tests/drawing-workspace-geometry.test.mjs`

Expected: PASS for round-trip, calibration, all geometry bounds, and invalid finite/length cases.

- [ ] **Step 6: Commit the geometry contract**

```bash
git add platform/app/lukas/lib/drawing-workspace.types.ts platform/app/lukas/lib/drawing-geometry.ts platform/tests/drawing-workspace-geometry.test.mjs
git commit -m "feat: define drawing workspace geometry"
```

### Task 2: Command engine and user-scoped undo/redo

**Files:**
- Create: `platform/app/lukas/lib/drawing-commands.ts`
- Test: `platform/tests/drawing-workspace-commands.test.mjs`

**Interfaces:**
- Consumes: `DrawingObject`, `DrawingLayer`, `DrawingOperationInput` from `drawing-workspace.types.ts`
- Produces: `DrawingDocumentState`, `DrawingCommand`, `applyDrawingCommand()`, `undoDrawingCommand()`, `redoDrawingCommand()`

- [ ] **Step 1: Write failing add, move, delete, and undo tests**

```js
test("undo appends an inverse without deleting another actor's command", () => {
  const added = applyDrawingCommand(emptyState(), addRectangle("actor-a"));
  const movedByB = applyDrawingCommand(added.state, moveObject("actor-b", 10, 0));
  const undone = undoDrawingCommand(movedByB.state, "actor-a");
  assert.equal(undone.operation.actorId, "actor-a");
  assert.equal(undone.operation.type, "delete_objects");
  assert.equal(undone.state.operations.some((op) => op.actorId === "actor-b"), true);
});
```

- [ ] **Step 2: Run the command test and verify the missing export failure**

Run: `cd platform && node --test tests/drawing-workspace-commands.test.mjs`

Expected: FAIL because `applyDrawingCommand` is not defined.

- [ ] **Step 3: Implement the explicit command union**

```ts
export type DrawingCommand =
  | { type: "add_objects"; actorId: string; objects: DrawingObject[] }
  | { type: "update_objects"; actorId: string; updates: ObjectUpdate[] }
  | { type: "delete_objects"; actorId: string; objectIds: string[] }
  | { type: "add_layer"; actorId: string; layer: DrawingLayer }
  | { type: "update_layer"; actorId: string; layerId: string; patch: LayerPatch };
```

Each application returns `{ state, operation }`. The operation contains a UUID `clientOperationId`, object base versions, forward payload, inverse payload, and timestamp. Never mutate the input state.

- [ ] **Step 4: Implement actor-scoped undo and redo stacks**

Undo finds the latest non-undone operation by the requested actor, validates current base versions, and applies its inverse as a new operation. Redo reapplies the original forward payload as another new operation. Return `{ kind: "conflict", objectIds }` instead of overwriting a changed object.

- [ ] **Step 5: Run command tests**

Run: `cd platform && node --test tests/drawing-workspace-commands.test.mjs`

Expected: PASS for add/update/delete, copy with new IDs, layer locking, actor-scoped undo/redo, and version conflicts.

- [ ] **Step 6: Commit the command engine**

```bash
git add platform/app/lukas/lib/drawing-commands.ts platform/tests/drawing-workspace-commands.test.mjs
git commit -m "feat: add drawing command history"
```

### Task 3: Core database, RLS, revision freeze, and idempotent operation RPC

**Files:**
- Create: `platform/supabase/migrations/20260824110000_drawing_workspace_core.sql`
- Test: `platform/tests/drawing-workspace-database.test.mjs`

**Interfaces:**
- Consumes: existing `lukas_qto_projects`, `lukas_qto_files(id, project_id, sha256)`, `private.lukas_qto_project_role(uuid)`
- Produces: P0/P1 tables, `private.lukas_drawing_workspace_capability()`, `public.lukas_drawing_create_document()`, `public.lukas_drawing_apply_operation()`, `public.lukas_drawing_request_review()`, `public.lukas_drawing_record_revision_decision()`

- [ ] **Step 1: Write a failing migration contract test**

```js
test("workspace migration binds sources by project and SHA and freezes approved revisions", async () => {
  const sql = await read("supabase/migrations/20260824110000_drawing_workspace_core.sql");
  assert.match(sql, /foreign key\s*\(source_file_id,\s*project_id,\s*source_sha256\)/i);
  assert.match(sql, /references public\.lukas_qto_files\s*\(id,\s*project_id,\s*sha256\)/i);
  assert.match(sql, /approved drawing revision is immutable/i);
  assert.match(sql, /unique\s*\(revision_id,\s*client_operation_id\)/i);
});
```

- [ ] **Step 2: Run the DB contract test and verify it fails**

Run: `cd platform && node --test tests/drawing-workspace-database.test.mjs`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create only the P0/P1 tables from the approved spec**

Create documents, revisions, pages, layers, objects, operations, snapshots, revision approvals, object sources, and object issue links. Include:

```sql
constraint lukas_drawing_objects_page_fkey
  foreign key(page_id, revision_id, project_id)
  references public.lukas_drawing_pages(id, revision_id, project_id) on delete cascade,
constraint lukas_drawing_objects_layer_fkey
  foreign key(layer_id, revision_id, project_id)
  references public.lukas_drawing_layers(id, revision_id, project_id) on delete restrict,
unique(revision_id, client_operation_id)
```

Use `jsonb_typeof(geometry) = 'object'`, positive versions, non-empty names, and explicit object/revision status checks. Do not create P2/P3/P6 tables in this migration.

- [ ] **Step 4: Add capability mapping and least-privilege RLS**

```sql
create or replace function private.lukas_drawing_workspace_capability(p_project_id uuid)
returns text language sql stable security definer set search_path=public,private as $$
  select case private.lukas_qto_project_role(p_project_id)
    when 'owner' then 'admin'
    when 'staff' then 'admin'
    when 'estimator' then 'editor'
    when 'reviewer' then 'reviewer'
    when 'site' then 'commenter'
    when 'procurement' then 'commenter'
    when 'viewer' then 'viewer'
  end
$$;
```

Authenticated project members may select. Only admin/editor may mutate draft rows. Reviewer may insert revision approval only when the creator differs. Revoke update/delete on operations, snapshots, and approvals. Revoke all from `anon`.

- [ ] **Step 5: Add immutable revision and source-file guards**

Before object/page/layer update or delete, lock the parent revision and raise `Approved drawing revision is immutable` unless status is `draft`. Source FK must include file ID, project ID, and SHA. No trigger or RPC may update `lukas_qto_files`.

- [ ] **Step 6: Add the atomic document creation RPC**

`lukas_drawing_create_document(p_project_id uuid, p_source_file_id uuid, p_title text, p_blank boolean)` derives the actor, requires admin/editor, locks and verifies the optional source file by project and SHA, then inserts document, draft revision 1, page 1, locked `원본` layer, and editable `작업` layer in one transaction. `p_blank=true` leaves the page background source null; otherwise only a PDF source becomes the page background. An IFC-backed entry creates a blank 2D page while retaining the IFC source link on the document.

- [ ] **Step 7: Add the operation RPC**

`lukas_drawing_apply_operation(p_revision_id uuid, p_client_operation_id uuid, p_operation_type text, p_base_versions jsonb, p_forward jsonb, p_inverse jsonb)` must:

1. derive the actor from `auth.uid()`;
2. require admin/editor capability;
3. lock the draft revision;
4. return the existing operation when `(revision_id, client_operation_id)` already exists;
5. validate every target object version;
6. apply only validated add/update/delete/layer changes;
7. append the operation and return its sequence plus resulting versions.

- [ ] **Step 8: Add canonical snapshot and maker-checker revision RPCs**

`lukas_drawing_request_review(p_revision_id uuid)` locks a draft revision, orders pages/layers/objects by stable IDs, builds one canonical `jsonb` snapshot, hashes `convert_to(snapshot::text, 'UTF8')` with `pgcrypto.digest(..., 'sha256')`, inserts the immutable snapshot, and moves the revision to `review_requested`.

`lukas_drawing_record_revision_decision(p_revision_id uuid, p_subject_version bigint, p_snapshot_sha256 text, p_decision text, p_note text)` requires owner/staff/reviewer, rejects the revision creator, locks and rechecks subject version and snapshot SHA, inserts an append-only decision, and either sets `approved` or returns a rejected revision to `draft` with an incremented version. Direct status updates remain forbidden.

- [ ] **Step 9: Extend the contract test for every table, policy, grant, guard, RPC, and index**

Run: `cd platform && node --test tests/drawing-workspace-database.test.mjs tests/drawing-database-grants.test.mjs tests/drawing-database-performance.test.mjs`

Expected: PASS. Existing collaboration grants and indexes remain unchanged.

- [ ] **Step 10: Commit the database contract**

```bash
git add platform/supabase/migrations/20260824110000_drawing_workspace_core.sql platform/tests/drawing-workspace-database.test.mjs
git commit -m "feat: add drawing workspace database"
```

### Task 4: Server contract and route registration

**Files:**
- Create: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Create: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/routes.ts`
- Modify: `platform/app/lukas/screens/drawing-room.tsx`
- Test: `platform/tests/drawing-workspace-server.test.mjs`
- Test: `platform/tests/drawing-workspace-route.test.mjs`

**Interfaces:**
- Consumes: geometry/operation schemas, existing `drawingContext()` and immutable file records
- Produces: `loadDrawingWorkspace()`, `createDrawingDocument()`, `parseWorkspaceMutation()`, loader/action data contract

- [ ] **Step 1: Write failing route and mutation parsing tests**

```js
test("workspace route is additive and keeps the collaboration room", async () => {
  const routes = await read("app/routes.ts");
  assert.match(routes, /drawings\/:fileId\/workspace/);
  assert.match(routes, /drawings\/:fileId"/);
});

test("mutation input rejects browser-supplied actor and malformed geometry", () => {
  assert.throws(() => parseWorkspaceMutation(formWith({ actorId: crypto.randomUUID() })));
  assert.throws(() => parseWorkspaceMutation(formWith({ geometry: { type: "circle", radius: -1 } })));
});
```

- [ ] **Step 2: Run tests and verify missing route/server failures**

Run: `cd platform && node --test tests/drawing-workspace-server.test.mjs tests/drawing-workspace-route.test.mjs`

Expected: FAIL for missing module and route.

- [ ] **Step 3: Implement typed loading without trusting browser roles**

`loadDrawingWorkspace(client, projectId, fileId)` must validate the file belongs to the project, kind is `pdf` or `ifc`, and select the latest accessible document revision. If none exists, return `document: null` without inserting from the loader.

- [ ] **Step 4: Implement explicit creation and operation mutations**

`createDrawingDocument()` calls `lukas_drawing_create_document()` so document, revision 1, page 1, and two layers (`원본`, `작업`) are atomic. The source layer is locked. The creation form exposes `빈 도면` and, for PDF files, `PDF 배경 사용`; an IFC entry creates a blank 2D page linked to the IFC source. `parseWorkspaceMutation()` accepts only:

```ts
type WorkspaceMutation =
  | { intent: "create_document"; title: string }
  | { intent: "apply_operation"; operation: DrawingOperationInput }
  | { intent: "create_layer"; name: string }
  | { intent: "link_issue"; objectId: string; issueId: string }
  | { intent: "request_review"; revisionId: string }
  | { intent: "record_revision_decision"; revisionId: string; subjectVersion: number; snapshotSha256: string; decision: "approved" | "rejected"; note: string };
```

Define the narrow `DrawingWorkspaceDatabase` Supabase table/RPC type in `drawing-workspace.server.ts`, following the existing `DrawingDatabase` pattern. The server derives actor, project, and capability; none appear in form input.

- [ ] **Step 5: Add the route and collaboration-room entry link**

Register:

```ts
route(
  "/projects/:projectId/drawings/:fileId/workspace",
  "lukas/screens/drawing-workspace.tsx",
),
```

Add a `도면 편집 작업실` link to the existing room header. Do not change the existing default room URL.

- [ ] **Step 6: Run server and route tests**

Run: `cd platform && node --test tests/drawing-workspace-server.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-collaboration.test.mjs`

Expected: PASS, including the old room route contract.

- [ ] **Step 7: Commit the server route**

```bash
git add platform/app/lukas/lib/drawing-workspace.server.ts platform/app/lukas/screens/drawing-workspace.tsx platform/app/routes.ts platform/app/lukas/screens/drawing-room.tsx platform/tests/drawing-workspace-server.test.mjs platform/tests/drawing-workspace-route.test.mjs
git commit -m "feat: add drawing workspace route"
```

### Task 5: Konva dependency, notices, and shared PDF renderer

**Files:**
- Modify: `platform/package.json`
- Modify: `platform/package-lock.json`
- Create: `platform/THIRD_PARTY_NOTICES.md`
- Create: `platform/app/lukas/lib/pdf-page-renderer.client.ts`
- Modify: `platform/app/lukas/components/pdf-drawing-viewer.client.tsx`
- Test: `platform/tests/drawing-workspace-license.test.mjs`
- Test: `platform/tests/pdf-drawing-font-assets.test.mjs`

**Interfaces:**
- Consumes: existing `pdfjs-dist` worker, `/pdfjs/cmaps/`, `/pdfjs/standard_fonts/`
- Produces: `openPdfDocument()`, `renderPdfPageToCanvas()`, installed `konva` and `react-konva`

- [ ] **Step 1: Write a failing license and shared-renderer contract test**

```js
test("drawing editor dependencies are permissive and noticed", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const notice = await read("THIRD_PARTY_NOTICES.md");
  assert.equal(typeof pkg.dependencies.konva, "string");
  assert.equal(typeof pkg.dependencies["react-konva"], "string");
  assert.match(notice, /Konva.*MIT/is);
  assert.match(notice, /react-konva.*MIT/is);
});
```

- [ ] **Step 2: Run and verify the dependency test fails**

Run: `cd platform && node --test tests/drawing-workspace-license.test.mjs`

Expected: FAIL because Konva and the notice file are absent.

- [ ] **Step 3: Install exact current compatible packages**

Run: `cd platform && npm install --save-exact konva@10.3.1 react-konva@19.2.5`

Expected: `package.json` and lockfile contain exact versions; npm reports no high/critical production vulnerability introduced by these packages.

- [ ] **Step 4: Add third-party notices**

Record package name, exact version from the lockfile, upstream URL, MIT license, whether code was modified, and `npm` as acquisition method. Do not claim OpenPlan3D or Arcada code was copied unless a later task actually copies it.

- [ ] **Step 5: Extract PDF rendering without changing review behavior**

Move worker setup, `getDocument({ cMapUrl, cMapPacked, standardFontDataUrl })`, page render cancellation, and cleanup into `pdf-page-renderer.client.ts`. Keep review viewer controls and normalized region behavior unchanged.

- [ ] **Step 6: Run PDF and license regression tests**

Run: `cd platform && node --test tests/drawing-workspace-license.test.mjs tests/pdf-drawing-font-assets.test.mjs tests/pdf-anchor.test.mjs`

Expected: PASS. CMaps and standard fonts remain self-hosted.

- [ ] **Step 7: Commit dependencies and PDF reuse**

```bash
git add platform/package.json platform/package-lock.json platform/THIRD_PARTY_NOTICES.md platform/app/lukas/lib/pdf-page-renderer.client.ts platform/app/lukas/components/pdf-drawing-viewer.client.tsx platform/tests/drawing-workspace-license.test.mjs
git commit -m "feat: add permissive drawing canvas runtime"
```

### Task 6: Workspace shell, viewport, grid, and immutable background

**Files:**
- Create: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Create: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Test: `platform/tests/drawing-workspace-route.test.mjs`

**Interfaces:**
- Consumes: loader data, geometry transforms, shared PDF renderer, Konva Stage/Layer/Image
- Produces: `DrawingWorkspaceClient`, `DrawingCanvas`, `DrawingCanvasHandle`, viewport events

- [ ] **Step 1: Add failing shell and accessibility assertions**

Assert the screen exposes `도면 작업실`, save status, undo/redo buttons, layer panel region, canvas region, inspector region, and a back link to the collaboration room. Assert buttons have accessible names.

- [ ] **Step 2: Run route test and verify the shell assertions fail**

Run: `cd platform && node --test tests/drawing-workspace-route.test.mjs`

Expected: FAIL because the client shell is absent.

- [ ] **Step 3: Implement the full-screen shell with a client-only canvas import**

The route renders semantic top bar, left panel, center canvas, bottom toolbar, and right inspector. The top bar exposes `검토 요청` for editors and approve/reject controls for eligible reviewers when status is `review_requested`. Dynamically import the Konva client component so SSR never accesses `window`.

- [ ] **Step 4: Implement viewport pan, wheel zoom, and grid**

Use one `Viewport` value for background and vector layers. Zoom around the pointer using `screenToWorld()` before changing zoom and preserve that world point afterward. Clamp zoom to `0.05..32`. Space+drag and middle-button drag pan; selection tool drag does not pan.

- [ ] **Step 5: Render the PDF as a locked background canvas source**

For PDF, render the current page to an offscreen canvas and pass it to a non-listening Konva Image in the source layer. For blank documents render a paper boundary. For IFC in P0/P1, show the existing IFC view beside a blank 2D overlay entry message; 2D/3D split synchronization remains P5.

- [ ] **Step 6: Run route, PDF, typecheck, and build checks**

Run: `cd platform && node --test tests/drawing-workspace-route.test.mjs tests/pdf-drawing-font-assets.test.mjs && npm run typecheck && npm run build`

Expected: PASS with no SSR `window is not defined` error.

- [ ] **Step 7: Commit the workspace shell**

```bash
git add platform/app/lukas/components/drawing-workspace.client.tsx platform/app/lukas/components/drawing-canvas.client.tsx platform/app/lukas/screens/drawing-workspace.tsx platform/tests/drawing-workspace-route.test.mjs
git commit -m "feat: render drawing workspace shell"
```

### Task 7: Six drawing tools and live previews

**Files:**
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Create: `platform/app/lukas/components/drawing-command-menu.tsx`
- Test: `platform/tests/drawing-workspace-commands.test.mjs`
- Test: `platform/tests/drawing-workspace-route.test.mjs`

**Interfaces:**
- Consumes: `DrawingCommand`, geometry schemas, active unlocked layer
- Produces: tools `select | pan | line | polyline | rectangle | circle | text | dimension`, searchable command registry

- [ ] **Step 1: Add failing command tests for every tool's completed geometry**

Test line click-click, polyline multi-click plus Enter, rectangle drag in any direction, circle center-radius drag, text non-empty submit, and dimension with/without calibration. Assert every committed point passes through `snapWorldPoint()` and Escape cancels without an operation.

- [ ] **Step 2: Run command tests and verify missing tool builders fail**

Run: `cd platform && node --test tests/drawing-workspace-commands.test.mjs`

Expected: FAIL for missing tool completion helpers.

- [ ] **Step 3: Implement tool state as a discriminated union**

```ts
type ToolSession =
  | { tool: "idle" }
  | { tool: "line"; start: Point }
  | { tool: "polyline"; points: Point[] }
  | { tool: "rectangle"; start: Point }
  | { tool: "circle"; center: Point }
  | { tool: "text"; origin: Point }
  | { tool: "dimension"; start: Point; end?: Point };
```

Keep preview geometry outside the persisted document and emit one command only when a tool completes.

- [ ] **Step 4: Add keyboard and pointer completion rules**

Escape cancels, Enter completes polyline/text, Backspace removes the last polyline point, Shift constrains line/dimension to 45-degree increments, and tool completion returns to select unless the user enabled repeat mode.

- [ ] **Step 5: Add the searchable command menu**

Define one command registry containing tool commands and `undo`, `redo`, `duplicate`, `delete`, `zoom_to_fit`. Open it with Cmd/Ctrl+K, filter Korean and stable command IDs case-insensitively, run the selected enabled command on Enter, and close on Escape. Render it with a labeled native dialog/input/listbox; do not add a command-menu dependency.

- [ ] **Step 6: Run tests and typecheck**

Run: `cd platform && node --test tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-route.test.mjs && npm run typecheck`

Expected: PASS for all six tools, snapping, cancellations, and command search keyboard behavior.

- [ ] **Step 7: Commit basic drawing tools**

```bash
git add platform/app/lukas/components/drawing-canvas.client.tsx platform/app/lukas/components/drawing-workspace.client.tsx platform/app/lukas/components/drawing-command-menu.tsx platform/tests/drawing-workspace-commands.test.mjs platform/tests/drawing-workspace-route.test.mjs
git commit -m "feat: add basic drawing tools"
```

### Task 8: Selection, move, multi-select, copy, delete, and shortcuts

**Files:**
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Modify: `platform/app/lukas/lib/drawing-commands.ts`
- Test: `platform/tests/drawing-workspace-commands.test.mjs`

**Interfaces:**
- Consumes: object bounds, layer lock state, command engine
- Produces: `SelectionState`, marquee selection, transform-to-command conversion

- [ ] **Step 1: Add failing selection and shortcut tests**

Cover click selection, Shift toggle, marquee intersection, locked/hidden layer exclusion, arrow-key move, Shift+arrow 10 mm move, Cmd/Ctrl+C/V, duplicate, Delete, Cmd/Ctrl+Z, and Cmd/Ctrl+Shift+Z.

- [ ] **Step 2: Run tests and verify selection helpers fail**

Run: `cd platform && node --test tests/drawing-workspace-commands.test.mjs`

Expected: FAIL for missing selection and clipboard operations.

- [ ] **Step 3: Implement selection against domain bounds**

Use Konva events only to identify candidate IDs. Confirm selection with domain visibility, layer lock, and `geometryBounds()`. A marquee selects objects whose bounds intersect the world-space marquee.

- [ ] **Step 4: Convert drag/transform into one update command**

During pointer movement update only preview nodes. On pointer-up emit one `update_objects` command with every selected object's original version and final geometry. Reset Konva node transforms after committing domain geometry.

- [ ] **Step 5: Implement clipboard and destructive-key guards**

Clipboard stores domain objects without IDs, versions, audit fields, or source links. Paste assigns new IDs and lineage IDs and offsets by 20 mm. Ignore global shortcuts while a text input, textarea, select, or contenteditable owns focus.

- [ ] **Step 6: Run command and type checks**

Run: `cd platform && node --test tests/drawing-workspace-commands.test.mjs && npm run typecheck`

Expected: PASS for selection, transforms, clipboard, delete, undo/redo, and focus guards.

- [ ] **Step 7: Commit editing interactions**

```bash
git add platform/app/lukas/components/drawing-canvas.client.tsx platform/app/lukas/components/drawing-workspace.client.tsx platform/app/lukas/lib/drawing-commands.ts platform/tests/drawing-workspace-commands.test.mjs
git commit -m "feat: edit drawing objects"
```

### Task 9: Layers and inspector

**Files:**
- Create: `platform/app/lukas/components/drawing-layers-panel.tsx`
- Create: `platform/app/lukas/components/drawing-inspector.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Test: `platform/tests/drawing-workspace-route.test.mjs`
- Test: `platform/tests/drawing-workspace-commands.test.mjs`

**Interfaces:**
- Consumes: selected IDs, active layer, command engine
- Produces: validated layer and object property commands

- [ ] **Step 1: Add failing layer and inspector tests**

Require at least two layers, unique trimmed names per revision, immutable source layer, active unlocked edit layer, hidden objects excluded from hit tests, and inspector edits for name, layer, stroke color, stroke width, fill, and text.

- [ ] **Step 2: Run tests and verify missing panels fail**

Run: `cd platform && node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-commands.test.mjs`

Expected: FAIL for missing panel labels and layer/property commands.

- [ ] **Step 3: Implement the layers panel**

Create layer with a server-compatible UUID and default order after the current last layer. Visibility and lock changes are commands. Prevent deleting the source layer, the only editable layer, or a layer containing objects in P0/P1.

- [ ] **Step 4: Implement the inspector with shared schemas**

Use labeled native inputs. Parse finite numeric values and colors before emitting a command. For multi-selection, show a blank mixed value and update only fields the user changed. Text controls appear only for text objects.

- [ ] **Step 5: Run tests and accessibility-focused Playwright locator smoke**

Run: `cd platform && node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-commands.test.mjs && npm run typecheck`

Expected: PASS with accessible labels for every inspector control.

- [ ] **Step 6: Commit layers and inspector**

```bash
git add platform/app/lukas/components/drawing-layers-panel.tsx platform/app/lukas/components/drawing-inspector.tsx platform/app/lukas/components/drawing-workspace.client.tsx platform/tests/drawing-workspace-route.test.mjs platform/tests/drawing-workspace-commands.test.mjs
git commit -m "feat: inspect drawing layers and objects"
```

### Task 10: IndexedDB outbox, autosave, conflict state, and reload recovery

**Files:**
- Create: `platform/app/lukas/lib/drawing-outbox.client.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Test: `platform/tests/drawing-workspace-outbox.test.mjs`

**Interfaces:**
- Consumes: `DrawingOperationInput`, workspace action endpoint
- Produces: `DrawingOutbox`, `enqueue()`, `markAcked()`, `markConflicted()`, `flush()`

- [ ] **Step 1: Write failing outbox ordering and retry tests with a fake IndexedDB adapter**

```js
test("flush keeps an operation until the server acknowledges its id", async () => {
  const outbox = createDrawingOutbox(memoryAdapter());
  await outbox.enqueue(operation("op-1"));
  await assert.rejects(outbox.flush(async () => { throw new Error("offline"); }));
  assert.deepEqual((await outbox.pending()).map((op) => op.clientOperationId), ["op-1"]);
  await outbox.flush(async () => ({ clientOperationId: "op-1", status: "acked" }));
  assert.deepEqual(await outbox.pending(), []);
});
```

- [ ] **Step 2: Run and verify the missing outbox failure**

Run: `cd platform && node --test tests/drawing-workspace-outbox.test.mjs`

Expected: FAIL because the outbox module is absent.

- [ ] **Step 3: Implement a native IndexedDB adapter and injectable test adapter**

Use database `1hk-drawing-workspace`, store `operations`, key `clientOperationId`, and indexes `(revisionId, createdAt)` and `status`. Persist the complete validated operation, never signed URLs or auth tokens.

- [ ] **Step 4: Implement ordered flush and explicit conflict handling**

Flush one revision in creation order. Stop that revision on `conflicted` or `rejected`; continue unrelated revisions. Delete only an `acked` operation whose response ID matches. Retry connection/server errors with bounded exponential delays of 1, 2, 4, 8, then 15 seconds while the tab remains open.

- [ ] **Step 5: Wire autosave and visible save states**

Enqueue before network send. Show `저장됨`, `저장 중`, `오프라인 저장`, or `충돌 검토 필요`. On load, apply pending local operations over the server snapshot only when base versions still match; otherwise retain them and show conflict instead of discarding.

- [ ] **Step 6: Run outbox and type tests**

Run: `cd platform && node --test tests/drawing-workspace-outbox.test.mjs && npm run typecheck`

Expected: PASS for failure retention, idempotent ack, ordering, conflicts, and reload recovery.

- [ ] **Step 7: Commit durable autosave**

```bash
git add platform/app/lukas/lib/drawing-outbox.client.ts platform/app/lukas/components/drawing-workspace.client.tsx platform/tests/drawing-workspace-outbox.test.mjs
git commit -m "feat: preserve drawing edits offline"
```

### Task 11: Object-to-issue link and permission enforcement

**Files:**
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.client.tsx`
- Modify: `platform/app/lukas/components/drawing-inspector.tsx`
- Modify: `platform/supabase/migrations/20260824110000_drawing_workspace_core.sql`
- Test: `platform/tests/drawing-workspace-server.test.mjs`
- Test: `platform/tests/drawing-workspace-database.test.mjs`

**Interfaces:**
- Consumes: existing `lukas_drawing_issues(id, project_id)`, selected object, capability
- Produces: `linkDrawingObjectIssue()` and inspector issue-link UI

- [ ] **Step 1: Add failing cross-project, Viewer, and approved-revision tests**

Assert a link requires object and issue in the same project, viewer cannot insert/update objects or links, reviewer cannot edit objects, estimator can edit a draft, and no role can directly mutate an approved revision.

- [ ] **Step 2: Run tests and verify missing enforcement fails**

Run: `cd platform && node --test tests/drawing-workspace-server.test.mjs tests/drawing-workspace-database.test.mjs`

Expected: FAIL for missing link RPC/guard assertions.

- [ ] **Step 3: Add a composite-FK issue link and guarded RPC**

The link table references `(object_id, project_id)` and `(issue_id, project_id)`. `linkDrawingObjectIssue(objectId, issueId)` derives project and actor server-side, requires editor capability, locks the draft revision, inserts idempotently, and does not alter the existing issue anchor.

- [ ] **Step 4: Add the inspector link flow**

Show searchable existing project issues, current links, and `이슈 연결`. Do not create a new issue in this P0/P1 flow; existing collaboration room remains the issue creation surface. Viewer/reviewer sees links without mutation controls.

- [ ] **Step 5: Run permission and existing approval regressions**

Run: `cd platform && node --test tests/drawing-workspace-server.test.mjs tests/drawing-workspace-database.test.mjs tests/drawing-collaboration.test.mjs tests/drawing-approvals.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit issue provenance**

```bash
git add platform/app/lukas/lib/drawing-workspace.server.ts platform/app/lukas/components/drawing-workspace.client.tsx platform/app/lukas/components/drawing-inspector.tsx platform/supabase/migrations/20260824110000_drawing_workspace_core.sql platform/tests/drawing-workspace-server.test.mjs platform/tests/drawing-workspace-database.test.mjs
git commit -m "feat: link drawing objects to issues"
```

### Task 12: P0/P1 end-to-end, SHA invariance, performance fixture, and release evidence

**Files:**
- Create: `platform/e2e/drawing-workspace.spec.ts`
- Modify: `platform/e2e/utils/drawing-collaboration-fixture.ts`
- Modify: `platform/package.json`
- Create: `platform/tests/drawing-workspace-e2e-contract.test.mjs`
- Modify: `platform/DEPLOYMENT.md`
- Modify: `docs/P0_P5_IMPLEMENTATION_MATRIX.md`

**Interfaces:**
- Consumes: all P0/P1 public contracts
- Produces: deterministic local/production test entrypoints and rollout/rollback evidence

- [ ] **Step 1: Write the failing E2E source contract test**

Require the spec to cover blank/PDF opening, six tools, selection/move/copy/delete, undo/redo, two layers, inspector properties, reload/relogin, issue link, review request and separate reviewer approval, PDF/IFC SHA before/after, editor success, viewer failure, fixture cleanup, and a synthetic 10,000-object performance case. Do not require P3 cursor synchronization in this plan.

- [ ] **Step 2: Run and verify the missing E2E contract failure**

Run: `cd platform && node --test tests/drawing-workspace-e2e-contract.test.mjs`

Expected: FAIL because the E2E spec and npm entrypoint are absent.

- [ ] **Step 3: Extend the existing four-role fixture safely**

Reuse maker/reviewer/viewer/non-member users. Provision one PDF-backed workspace and one blank document through service-role setup, record original file SHA values, and cleanup in dependency order while collecting every cleanup error. Never log secrets.

- [ ] **Step 4: Implement the serial Playwright workflow**

Use accessible roles/labels. Verify every P0/P1 user action and reload with the editor account, request review, then approve from the separate reviewer context and prove subsequent direct object update/delete fails. Use the viewer browser context to assert controls are absent and a direct Supabase object mutation is rejected. Read the file rows before and after and compare SHA strings exactly.

- [ ] **Step 5: Add a deterministic 10,000-object browser fixture**

Seed mixed line/polyline/rectangle/circle/text/dimension objects in a test-only project. Record `performance.now()` around 120 pan/zoom animation frames and selection queries. Report median and p95 frame duration with browser/viewport/object composition; keep 60fps as a target report in P0/P1 and fail only on catastrophic p95 above 50ms until P7 tuning.

- [ ] **Step 6: Add exact test scripts and deployment order**

```json
{
  "test:drawing-workspace": "node --test tests/drawing-workspace-*.test.mjs",
  "test:e2e:drawing-workspace:production": "npx playwright test e2e/drawing-workspace.spec.ts --project=chromium"
}
```

Document backup/schema snapshot, migration apply, DB type regeneration, unit/build/E2E, Vercel preview, Editor/Viewer production smoke, promotion, and rollback. Mark implementation matrix rows `완료` only after evidence exists.

- [ ] **Step 7: Run the complete local regression suite**

Run:

```bash
cd platform
npm run test:drawing-workspace
node --test tests/*.test.mjs
npm run test:ifc
npm run typecheck
npm run build
npx playwright test e2e/workspace-preview-room.spec.ts --project=chromium
```

Expected: every command exits 0. If production Supabase credentials are available, also run `npm run test:e2e:drawing-workspace:production`; otherwise record it as an unexecuted release gate, not a pass.

- [ ] **Step 8: Commit P0/P1 release evidence**

```bash
git add platform/e2e/drawing-workspace.spec.ts platform/e2e/utils/drawing-collaboration-fixture.ts platform/package.json platform/package-lock.json platform/tests/drawing-workspace-e2e-contract.test.mjs platform/DEPLOYMENT.md docs/P0_P5_IMPLEMENTATION_MATRIX.md
git commit -m "test: verify drawing workspace vertical slice"
```

## P0/P1 Completion Boundary

This plan completes the single-user P0/P1 slice plus existing-issue linkage and role enforcement. It does not claim the original ten-item first release gate is complete because live cursors and concurrent object synchronization belong to P3. After this plan passes, create the P2 plan, then the P3 Yjs/Hocuspocus plan; the first full vertical release is eligible only after the P3 two-browser gate passes.
