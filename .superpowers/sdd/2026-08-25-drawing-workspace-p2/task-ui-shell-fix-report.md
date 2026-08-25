# Drawing Workspace UI shell correction report

Date: 2026-08-25

Worktree: `/Users/h/Documents/GoAgent/.worktrees/drawing-workspace-p0-p1`

Commit: this commit — `fix: keep drawing canvas visible`

## Outcome

- Keeps the top bar, drawing canvas, and canvas tools in the initial 898–900 px viewport by placing the canvas first below `xl`; the editor panels no longer stack above it.
- Preserves a wide three-column workbench at `xl` with a 15 rem tool rail, flexible canvas, and 18 rem inspector.
- Replaces the oversized left settings stack with five accessible tabs: Pages/Layers, Styles, Properties, Schedules, and Blocks. Only one `tabpanel` is visible, while hidden panels stay mounted so local form state is not discarded.
- Supports ArrowLeft/Right/Up/Down wrapping plus Home/End tab navigation, roving `tabIndex`, focus movement, `aria-controls`, `aria-selected`, and `aria-labelledby`. The tablist opts out of global drawing shortcuts so navigation arrows cannot move selected geometry.
- Bounds the narrow tool panel and inspector with internal scrolling so neither can push the canvas below the initial viewport. The header is two lines and uses the project-owned preview title/file copy; visible Rayon naming was removed.
- Adds no state library, dependency, database, persistence, or business-logic change. The existing preview-mode SSR canvas fallback remains intact.

## TDD evidence

### RED

Before production edits:

```text
node --test tests/drawing-workspace-shell.test.mjs
tests 4; pass 0; fail 4
```

Expected failures proved the old `lg:grid-cols-[14rem_..._17rem]` contract, missing ARIA tabs/key resolver, and visible `Rayon /` preview copy. The existing route contract was also changed first and failed 1/17 because `aria-label="도면 도구 패널"` did not exist.

A later browser review found that tab arrows could bubble to the global object-move shortcut. The new SSR shortcut-boundary assertion failed 1/1 until the tablist received `data-drawing-shortcuts="ignore"`.

### GREEN

```text
node --test tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-route.test.mjs
tests 21; pass 21; fail 0
```

The same focused tests now protect layout/order classes, SSR preview fallback and canvas tools, five-tab ARIA state, four hidden panels, keyboard wrapping/jumps, shortcut isolation, and project-owned preview copy.

## Browser evidence

- Playwright at 898 × 994: compact header, central preview canvas, and floating canvas toolbar are all visible before the tabbed tool panel.
- Playwright at 1440 × 1000: visible 15 rem tool rail, flexible canvas, and inspector form the intended three-column workbench; all five tool tabs are visible.
- Hydrated interaction: clicking Properties produced `aria-selected="true"` and removed `hidden` from its panel. ArrowRight from Pages/Layers selected and focused Styles, hid the prior panel, and revealed the Styles panel.

## Verification

- `npm run test:drawing-workspace` — 385 passed, 0 failed.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0 for production client and SSR builds.
- `git diff --check` — exit 0.
- Build retained pre-existing large-chunk, React Router future-flag, dynamic IFC chunk, and unsigned-theme-cookie warnings.

## Files

- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- `platform/tests/drawing-workspace-shell.test.mjs`
- `platform/tests/drawing-workspace-route.test.mjs`
- `.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-ui-shell-fix-report.md`

## Concerns

- The left and right rails intentionally become bounded below-canvas panels below `xl`; no extra drawer state was added.
- A separately started dev server re-optimized local React/Konva dependencies and later exposed an existing duplicate-React invalid-hook error when loading the dynamic Konva canvas. The layout/tab checks used the preserved preview fallback, the controller's existing 5173 route rendered the corrected UI, and full typecheck/production build/drawing tests passed. This correction does not change React, Konva, Vite, or dependency configuration.

## Important review follow-up: hydrated tab wiring

### Outcome

- Added `platform/e2e/drawing-workspace-shell.spec.ts` using the existing Playwright stack and the unauthenticated `/workspace-preview/drawing-workspace` route; no dependency or production component change was required.
- The click test selects Style through the real component handler and asserts both tabs' `aria-selected` values plus the old/new panels' rendered visibility.
- The keyboard test sends ArrowRight, End, and Home to the real tab buttons and asserts the selected tab, focused tab, and visible panel after every transition.
- The harness retries the actual state-changing click and Arrow interaction within a fixed bound, so SSR-visible buttons cannot be mistaken for a hydrated component and the test does not depend on the unrelated dynamically imported canvas chunk. Navigation, hydration, locator, and whole-test waits are explicitly bounded.

### Mutation-proven RED

The real `onClick` and `onKeyDown` handlers were temporarily replaced with no-ops and restored without changing their implementation.

```text
node --test tests/drawing-workspace-shell.test.mjs
tests 4; pass 4; fail 0

SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-preview-test-key \
  npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --reporter=line
tests 2; pass 0; fail 2
```

Both browser tests reached the hydrated route and failed on the intended mutation: Style remained `aria-selected="false"` after its click and after ArrowRight. This demonstrates why the static SSR/resolver suite alone did not protect the component wiring.

### GREEN and full verification

```text
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-preview-test-key \
  npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --reporter=line
2 passed

npm run test:drawing-workspace
385 passed; 0 failed

npm run typecheck
exit 0

npm run build
exit 0

npx prettier --check e2e/drawing-workspace-shell.spec.ts
exit 0

git diff --check
exit 0
```

The final focused GREEN command was repeated twice from clean Playwright server starts; both runs passed 2/2 in under four seconds.

The production build retained the pre-existing chunk-size, React Router future-flag, dynamic IFC chunk, and unsigned-theme-cookie warnings.
