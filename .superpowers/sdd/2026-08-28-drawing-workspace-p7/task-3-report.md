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

## Fix round 1 — review follow-up

### Reviewed findings and implementation

- **Tablet entry normalization:** verified that an awareness-lock inspector is open without any selected IDs and that the original selection-only tablet effect left the tools drawer visible after resizing from desktop. The tablet effect now closes the left drawer whenever any inspector content is open, including awareness locks and collaboration notices.
- **Inline safe areas:** added inherited, overrideable inline safe-area custom properties and constrained the floating toolbar with `left`/`right` safe-area gutters. The tablet rule also clears Tailwind's separate `translate` property so the old centering utility cannot move it under an inset.
- **Scrollable toolbar/menu:** extended browser coverage to force real toolbar overflow, set `scrollLeft`, and verify the opened architecture menu remains above the toolbar without document horizontal overflow. The existing visible-overflow menu exception is now exercised.

### RED

Command:

```sh
E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --grep "tablet entry|tablet toolbar respects" --reporter=line
```

Observed failures before the fixes:

```text
tablet entry keeps an awareness inspector exclusive with the tools drawer
Expected: hidden
Received: visible
getByRole('complementary', { name: '도면 도구 패널' })

tablet toolbar respects inline safe areas, scrolls overflow, and keeps its menu on-screen
Expected: >= 200
Received:    115
```

After the first CSS pass, the state normalization test passed but the safe-area test reproducibly exposed the remaining Tailwind translation root cause:

```text
Expected: >= 200
Received:    -4
```

The toolbar's `-translate-x-1/2` utility used CSS `translate`, not `transform`; adding `translate: none` was the isolated correction.

### GREEN

The same focused command after the state and safe-area fixes:

```text
2 passed (1.9s)
```

### Full verification

```sh
E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --reporter=line
```

```text
15 passed (11.8s)
```

```sh
npm run test:drawing-workspace
```

```text
tests 757
pass 753
fail 0
skipped 4
duration_ms 34866.896375
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
✓ built in 6.57s
✓ built in 1.19s
```

Exit status: 0. Existing bundle-size, dynamic-import, unsigned theme-cookie, and React Router future-flag warnings remain outside this task.

### Fix-round self-review and concerns

- The entry rule depends on observable inspector openness, so it covers selection, collaboration notices, and awareness locks without duplicating those states.
- Custom safe-area variables preserve real `env()` values by default and make controlled browser verification possible without simulating a device API.
- The overflow test uses the real toolbar and its real scroll container; it does not assert source text or a mock.
- User-owned P4 progress/images and `.superpowers/audits/` remain unstaged and unchanged.
