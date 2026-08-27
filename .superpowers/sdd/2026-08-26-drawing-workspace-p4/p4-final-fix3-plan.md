# Drawing Workspace P4 Awareness Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagents are prohibited for this residual.

**Goal:** Make parent transient selection and every local Awareness publication consume the same dependency-aware visible semantic object set as the canvas and render/export adapter.

**Architecture:** Reuse `drawingVisibleCanvasObjects` inside `deriveDrawingTransientState`, preserving existing layer editability and semantic block rules. In the workspace, bind publication to the derived selection rather than raw React input and prune raw selection after visibility changes so restoration cannot resurrect it. Observe the real preview Awareness adapter in Chromium.

**Tech Stack:** TypeScript, React, Yjs Awareness, Node test runner, Playwright Chromium.

**Spec:** `.superpowers/sdd/2026-08-26-drawing-workspace-p4/p4-final-rereview2.md`

## Global Constraints

- Use TDD and watch the regression fail before production edits.
- No subagents, dependencies, state manager, CRDT changes, prior migration edits, or P5 work.
- Preserve controller-owned `progress.md` and test-generated screenshots.
- Host-layer visibility is inherited by hosted openings; host locking does not redefine visibility.

---

### Task 1: Canonical parent transient selection

**Files:**
- Modify: `platform/tests/drawing-document-store.test.mjs`
- Modify: `platform/app/lukas/lib/drawing-document-store.ts`
- Reuse: `platform/app/lukas/lib/drawing-blocks.ts`

**Interfaces:**
- Consumes: `drawingVisibleCanvasObjects(objects, layers): DrawingObject[]`
- Produces: `deriveDrawingTransientState(...).selectedIds` filtered by host-aware visibility plus existing editability rules.

- [x] **Step 1: Write the failing test**

  Add one literal fixture with a wall on a hidden host layer, its opening and an unrelated rectangle on a visible layer, and a multi-selection containing both opening and rectangle. Assert only the unrelated rectangle remains; restore the host using the already-pruned IDs and assert the opening does not return. Assert a visible but locked host does not make the opening visually hidden.

- [x] **Step 2: Run test to verify it fails**

  Run: `node --test tests/drawing-document-store.test.mjs`

  Expected: the hidden-host opening remains in `selectedIds` before the fix.

- [x] **Step 3: Write minimal implementation**

  Import `drawingVisibleCanvasObjects`, derive its ID set from the active-canvas slice, and require object selections to belong to that set in addition to their existing eligible own-layer rule. Do not change block-instance or lock semantics.

- [x] **Step 4: Run test to verify it passes**

  Run: `node --test tests/drawing-document-store.test.mjs`

  Expected: all tests pass.

### Task 2: Immediate canonical local Awareness publication

**Files:**
- Modify: `platform/e2e/drawing-workspace-p4.spec.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`

**Interfaces:**
- Consumes: `transient.selectedIds` from Task 1.
- Produces: every local publisher update defaults to the current canonical derived selection; a selection-pruning effect persists the derived IDs; the preview exposes the payload received by its real Awareness adapter.

- [x] **Step 1: Write the failing mounted test**

  Restore the hidden host layer, select its opening, confirm the real outgoing local Awareness payload contains that opening, then hide the host without another pointer event. Assert mounted parent selection and outgoing local Awareness both become empty. Restore the host and assert local selection stays empty while independent remote overlay state returns.

- [x] **Step 2: Run test to verify it fails**

  Run: `npx playwright test e2e/drawing-workspace-p4.spec.ts --config=playwright.p4-functional.config.ts --project=chromium --workers=1 --grep "hidden host visibility"`

  Expected: parent selection and outgoing local Awareness retain the opening after the host is hidden.

- [x] **Step 3: Write minimal implementation**

  Keep a render-current ref of `transient.selectedIds`; when a publisher patch omits `selectedIds`, merge that canonical ref instead of stale `awarenessLocalRef` selection. Key the selection publication effect by the derived selection, and prune raw selection state when it differs. Extend only the local preview adapter with an observation callback for the exact state passed to `setLocalState`.

- [x] **Step 4: Run mounted and focused tests**

  Run the focused Chromium test and `node --test tests/drawing-document-store.test.mjs tests/drawing-workspace-blocks.test.mjs tests/drawing-awareness.test.mjs`.

  Expected: all pass; remote state remains independent and local restoration does not resurrect selection.

### Task 3: Verification, evidence, and commits

**Files:**
- Create: `.superpowers/sdd/2026-08-26-drawing-workspace-p4/p4-final-fix3-report.md`
- Preserve: `.superpowers/sdd/2026-08-26-drawing-workspace-p4/progress.md`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: product commit and source-bound verification report.

- [x] **Step 1: Run regression gates**

  Run focused/full Drawing Workspace tests, application and collaboration typechecks/builds, Chromium functional/IndexedDB, `git diff --check`, and the exact local release proportionately.

- [x] **Step 2: Write the report**

  Record the red failure, shared authority change, mounted outgoing-payload evidence, exact gate results, and honest real-PostgreSQL/production/performance status without editing the ledger or P5.

- [x] **Step 3: Commit separately**

  Commit product code/tests first, then force-add the ignored report/plan and refreshed evidence only if the exact release changed it. Leave controller-owned screenshots and ledger unstaged.
