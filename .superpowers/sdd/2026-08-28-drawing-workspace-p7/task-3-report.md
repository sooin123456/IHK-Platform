# P7 Task 3 — Tablet workspace mode

## Implementation

- Added the 768–1199px tablet workspace shell. The canvas remains mounted in a fixed-height workspace while the left tools and right inspector are mutually exclusive overlay drawers.
- Selecting an object on tablet closes the tools drawer and opens the inspector. Closing either tablet drawer returns focus to the Konva canvas.
- Added tablet safe-area insets, horizontally scrollable canvas toolbar behavior, and 44px minimum targets for toolbar, dock, tools, and inspector controls.
- Preserved the existing `xl` desktop grid and keyboard dock behavior. The existing tablet architecture-tool regression now closes the drawer before using the canvas, reflecting the new deliberate drawer interaction.

## Files changed

- `platform/app/app.css`
- `platform/app/lukas/components/drawing-canvas.client.tsx`
- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/e2e/drawing-workspace-shell.spec.ts`

## TDD evidence

The first regression names the break it catches: allowing both tablet tool surfaces to remain open, retaining the old document-height stack, losing canvas focus after close, or shrinking tablet touch targets below 44px.

### RED 1

Command:

```sh
E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --grep "tablet keeps one drawer" --reporter=line
```

Expected failure observed before production edits:

```text
Expected: hidden
Received: visible
getByRole('complementary', { name: '도면 도구 패널' })
```

This proved the old 768px shell left the tools visible when the inspector was opened.

### RED 2

After adding the explicit tab target assertion, before the target-size CSS:

```sh
E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --grep "tablet keeps one drawer" --reporter=line
```

Expected failure observed:

```text
Expected: >= 44
Received:    36
```

### GREEN

The same focused command passed after the minimal shell, focus, and CSS changes:

```text
1 passed (4.1s)
```

## Verification

```sh
E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --reporter=line
```

```text
13 passed (11.4s)
```

The new browser test exercises both 768×1024 portrait and 1024×768 landscape. It checks canvas visibility/mount continuity, one surface at a time, selection-to-inspector behavior, close-to-canvas focus, 44px targets, document height, document horizontal overflow, and toolbar width.

```sh
npm run test:drawing-workspace
```

```text
tests 757
pass 753
fail 0
skipped 4
duration_ms 39591.804125
```

```sh
npm run typecheck
```

```text
react-router typegen && tsc
```

Exit status: 0.

```sh
npm run build
```

```text
✓ built in 7.01s
✓ built in 1.33s
```

Exit status: 0. Build retains pre-existing Vite chunk-size and React Router future-flag warnings.

```sh
git diff --check
```

No output; whitespace check passed.

## Self-review

- The media query is limited to 768–1199px; desktop keeps its `xl` dock grid and existing keyboard behavior.
- The canvas focus method is a small extension of the current imperative Konva handle, not a new state or drawing model.
- Drawers are absolute only at tablet widths, so they do not add to document height or unmount the canvas.
- The toolbar is raised above a drawer so core tools stay reachable; its popup menu temporarily uses visible overflow to avoid clipping.
- No state manager, dependency, drawing schema, or architecture change was introduced.
- User-owned P4 progress/images and `.superpowers/audits/` were left unedited and unstaged.

## Concerns

- Production build warnings about existing large chunks, dynamic-import chunking, unsigned theme cookie, and React Router future flags remain outside Task 3 scope.
- The tablet layout is covered in Chromium Playwright only; no separate physical-device safe-area browser authority was available.
