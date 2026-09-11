# Workspace Issue Regions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the in-workspace collaboration loop by creating issues inline and making persisted canvas-region anchors visible, accessible, and selectable on the drawing.

**Architecture:** Reuse the existing project issue mutation, route authority, realtime revalidation, and canvas viewport. The workspace derives exact-boundary annotation view models and passes them to a small DOM overlay in `DrawingCanvas`; no persistence or collaboration subsystem is added.

**Tech Stack:** React 19, React Router 7, TypeScript, Konva/DOM hybrid canvas, Supabase/Postgres, Node test runner, Playwright

**Spec:** `docs/superpowers/specs/2026-09-05-workspace-issue-regions-design.md`

## Global Constraints

- Do not add a dependency, database migration, RPC, RLS policy, Yjs type, state-management library, or collaboration server.
- Reuse `parseDrawingMutationForm`, `mutateDrawingIssue`, `drawingWorkspaceCanComment`, and `reconcileDrawingIssueSelection`.
- Authorization is exact: Admin, Editor, Commenter, and Reviewer may create issues; Viewer and Approver may not.
- Persisted annotations are read-only and render only for exact active revision, page, and canvas identity.
- PDF and IFC source bytes and the drawing operation graph remain unchanged.
- DOM owns annotation interaction and accessibility; Konva remains the bulk drawing renderer.
- Follow strict test-first RED, GREEN, and focused regression verification.

---

### Task 1: Complete the workspace issue-to-region collaboration loop

**Files:**
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/tests/drawing-workspace-p3-social.test.mjs`
- Modify: `platform/tests/drawing-workspace-p4-tools.test.mjs`
- Modify: `platform/tests/drawing-workspace-route.test.mjs`
- Modify: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`
- Test: `platform/tests/drawing-pagination.test.mjs`

**Interfaces:**
- Consumes: `parseDrawingMutationForm(form)`, `mutateDrawingIssue(client, actorId, projectId, mutation)`, `drawingWorkspaceCanComment(capability)`, `reconcileDrawingIssueSelection(issues, selectedIssueId, initialIssueId, previousInitialIssueId)`, `worldToScreen(point, viewport)`.
- Produces: exported `DrawingCanvasRegionAnnotation` with `id`, `issueId`, `label`, `x`, `y`, `width`, `height`, and `selected`; exported `drawingVisibleCanvasRegionAnnotations(...)`; exported `drawingCanvasRegionAnnotationScreenBounds(annotation, viewport)`; optional `regionAnnotations` and `onRegionAnnotationSelect` canvas props.

- [x] **Step 1: Write failing route and workspace behavior tests**

Add tests that fail until `create_issue` uses the exact comment authority, selection reconciliation works, exact-boundary annotation derivation works, and viewport projection exists. The core authorization assertion is:

```js
for (const role of ["admin", "editor", "commenter", "reviewer"])
  assert.equal(drawingWorkspaceCanComment(role), true);
for (const role of ["approver", "viewer"])
  assert.equal(drawingWorkspaceCanComment(role), false);
```

The authenticated browser test in Step 8 must exercise forged `FormData` with `intent=create_issue` and prove denied roles return 403 through the real route, rather than treating a source-text search as authorization evidence.

- [x] **Step 2: Run the focused tests and capture RED**

Run:

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=dummy node --test \
  tests/drawing-workspace-p3-social.test.mjs \
  tests/drawing-workspace-p4-tools.test.mjs \
  tests/drawing-workspace-route.test.mjs \
  tests/drawing-pagination.test.mjs
```

Expected: failures identify the missing `create_issue` route branch, inline form/selection reconciliation, and annotation projection/handoff.

- [x] **Step 3: Add the minimal canonical route authority**

Extend the existing collaboration mutation branch without creating a second handler:

```ts
if (
  intent === "create_issue" ||
  intent === "comment" ||
  intent === "add_canvas_region_anchor"
) {
  if (!drawingWorkspaceCanComment(capability))
    throw new Response("댓글을 작성할 권한이 없습니다.", { status: 403 });
  const mutation = parseDrawingMutationForm(form);
  // Keep the existing current-revision guard for region anchors only.
  return mutateDrawingIssue(client, user.id, project.id, mutation);
}
```

- [x] **Step 4: Reconcile issue selection and add the inline form**

Import and call `reconcileDrawingIssueSelection` in an effect keyed by the current issue list. This workspace has no URL-focused issue, so pass `null` for both initial-issue arguments: a valid manual selection remains selected and an absent selection falls back to the first current issue. Render a compact `create_issue` form whenever `canComment` is true, including when the issue list is empty:

```tsx
<Form method="post">
  <input name="intent" type="hidden" value="create_issue" />
  <input name="title" required maxLength={200} />
  <textarea name="description" maxLength={4000} />
  <select name="priority" defaultValue="normal">...</select>
  <button type="submit">새 이슈 만들기</button>
</Form>
```

Keep the existing issue-dependent comment, object-link, picker, and lists conditional on a selected issue.

- [x] **Step 5: Derive exact-boundary region annotation models**

Export a pure `drawingVisibleCanvasRegionAnnotations(...)` helper that joins each current anchor to its issue and excludes every boundary mismatch:

```ts
const visibleRegionAnnotations = collaborationRoom.canvasRegionAnchors
  .filter(
    (anchor) =>
      anchor.revision_id === revision.id &&
      anchor.page_id === drawingState.activePageId &&
      anchor.canvas_id === drawingState.activeCanvasId,
  )
  .map((anchor) => ({
    id: anchor.id,
    issueId: anchor.issue_id,
    label: anchor.label || issueTitle || "이슈 영역",
    x: anchor.x_mm,
    y: anchor.y_mm,
    width: anchor.width_mm,
    height: anchor.height_mm,
    selected: anchor.issue_id === selectedIssueId,
  }));
```

Pass the models to `DrawingCanvas`. Its selection callback selects the issue, activates collaboration, opens a hidden left dock, and preserves compact-layout dock exclusivity.

- [x] **Step 6: Render accessible viewport-projected DOM regions**

Implement and unit-test the pure projection helper:

```ts
export function drawingCanvasRegionAnnotationScreenBounds(
  annotation: Pick<DrawingCanvasRegionAnnotation, "x" | "y" | "width" | "height">,
  viewport: Viewport,
) {
  const start = worldToScreen({ x: annotation.x, y: annotation.y }, viewport);
  return {
    left: start.x,
    top: start.y,
    width: annotation.width * viewport.zoom,
    height: annotation.height * viewport.zoom,
  };
}
```

Render an absolutely positioned pointer-transparent outline at the exact projected bounds and place one compact `<button>` label at its top-left with `data-drawing-region-anchor-id`, `aria-label={\`이슈 영역: ${label}\`}`, and `aria-pressed`. This preserves ordinary object selection inside the region. Use `pointer-events: auto` and `tabIndex=0` on the label only when the active tool is `select`, no region picker is armed, PDF calibration is inactive, and Space-pan does not own input; otherwise make it non-interactive. Guard the canvas host capture handlers from starting selection when the pointer originated inside an active annotation label. Stop keyboard propagation so Enter activates only the label and canvas commands keep their own input ownership.

- [x] **Step 7: Verify focused GREEN and regressions**

Run the Step 2 command and require zero failures. Then run:

```bash
npm run typecheck
npm run build
npm run build:collaboration
```

Expected: all commands exit 0. The pre-existing Node `ExperimentalWarning` is environment noise; no new warning or error is allowed.

- [x] **Step 8: Upgrade the canonical multi-role browser scenario**

Use unique issue titles. Start with a true zero-issue room, create the first issue through the owner workspace form, and poll `lukas_drawing_issues` by exact project/title. Exercise real authenticated creation for Admin, Editor, Reviewer, and Commenter, while Approver and Viewer receive HTTP 403 and create no row. Preserve the existing comment/mention/region flow. Verify reload persistence, exact pan/zoom projection, object-selection preservation, inactive picker/draw/calibration/Space-pan labels, Approver keyboard navigation, and compact-layout dock exclusivity.

- [x] **Step 9: Run the disposable authenticated browser gate**

Run the existing M1 disposable harness:

```bash
npm run test:e2e:drawing-workspace-m1:local
```

Expected: the complete disposable suite passes with no unauthorized mutation, missing annotation, or retained fixture.

- [x] **Step 10: Self-review and record evidence**

Confirm the diff contains no dependency, migration, source-byte, operation-graph, or unrelated refactor changes. Record RED/GREEN commands, counts, browser result, and exact changed files in the SDD report.
