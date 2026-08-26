# P4 Task 4 implementation report

Base: `4b56b5c20b3d60a38826596c21c526c0e3db35ae`

## Summary

- Added the grouped, keyboard-operable `건축 객체` control for wall, opening, space, area, grid, and arc tools without adding a UI/runtime dependency.
- Extended the pure tool controller with exact semantic defaults, snapping and Shift constraints, polygon/arc sessions, transient previews, repeat mode, and fail-closed capability, layer, and advisory-lock behavior. Each successful completion emits one existing `add_objects` command.
- Rendered and hit-tested all six semantic geometries in Konva, including hosted-opening resolution, wall thickness, polygon and grid labels, sampled arcs, selection/drag previews, and Awareness outlines. Hosted references remain resolvable when their layer is hidden, while hidden objects remain non-interactive.
- Added the focused, lock-aware semantic inspector using version-aware `update_objects`, dirty fields, strict geometry parsing, browser `미리보기`, and an explicitly unconfirmed `서버 계산 · V1` state.
- Kept semantic objects outside blocks and reused the existing command, geometry, layer, selection, Awareness, and workspace paths.

## RED evidence

- Initial pure/route RED: 23 discovered; 17 passed and 6 failed on the absent semantic tool sessions, grouped controls, renderer hooks, and inspector.
- Initial Chromium RED: 11 discovered; 10 passed and 1 failed because `건축 객체` was absent.
- Focused lock RED: a wall on a locked layer incorrectly accepted an opening; the new eligibility case failed before the layer guard and passed afterward.
- Focused hosted-render RED: the workspace passed only visible rows to Canvas, so a visible opening could lose its hidden wall reference; the route contract failed before Canvas received the complete active-canvas object map and passed afterward.

## GREEN and verification evidence

- Focused P4 tool/route suite: 23/23 passed, 0 failed.
- Relevant tool, route, Awareness, command, and block suites: 115/115 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 565 discovered; 564 passed, 0 failed, 1 explicitly skipped disposable-PostgreSQL fixture.
- Full local Chromium shell: 11/11 passed, including real wall authoring, semantic selection/inspector, keyboard menu behavior, and zero document/toolbar overflow at 1440×900 and 768×1024.
- `npm run typecheck`: exit 0. `npm run build`: exit 0.
- Prettier checks and `git diff --check`: exit 0.
- Real browser shell check: meaningful content, all six architectural menu items, no Vite overlay, and no document/toolbar overflow.
- Screenshot: `/Users/h/Documents/GoAgent/.worktrees/drawing-workspace-p0-p1/platform/test-results/p4-task4-architectural-tools.png`
- Screenshot SHA-256: `197948a439d032a6dd47f95b8ef86ef0b89931852acf003580c3466f1922db37`.

## Commit

- `feat: author architectural drawing objects`

## Residuals

- Server-derived V1 measurement evidence and semantic schedules remain P4 Task 5; browser measurements stay visibly unconfirmed.
- Populated semantic preview/export and collaboration/offline/history vertical evidence remain P4 Task 6.
- The disposable-PostgreSQL concurrency fixture remains explicitly skipped; no real-PostgreSQL pass is claimed by this UI task.
