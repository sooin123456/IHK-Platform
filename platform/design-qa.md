# Workspace design QA

- Source visual: `/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/codex-clipboard-c7d3edf0-1a74-4344-a23a-fd79071edb40.png` (2838×2122)
- Rendered implementation: `/Users/h/Documents/GoAgent/platform/workspace-implementation.png` (613×998 browser viewport at DPR 2)
- Route under test: `/workspace` component rendered with representative project data in a temporary development-only fixture; the fixture route was removed after capture.

## Visual comparison

- Preserved the source's light canvas, restrained blue accent, strong project hierarchy, large readable Korean type, and rounded project cards.
- Replaced the source's passive two-column list with a responsive drawing-project launcher: status counters, searchable projects, 3D/file preview cards, progress, review/member counts, and recent work.
- On mobile, the desktop sidebar becomes a fixed four-item bottom navigation and project cards collapse to one column without horizontal overflow.
- The implementation intentionally does not reproduce the duplicated logout link, oversized whitespace, placeholder project copy, or static “continue” links from the source.

## Interaction verification

- Search narrows projects by project name, description, or latest file name.
- “검토” filters to projects with unresolved reviews.
- Grid/list view changes the project layout.
- “새 프로젝트” opens the real project creation form.
- Project cards expose real routes for latest IFC 3D, files, reviews, and members.

## Automated verification

- TypeScript typecheck: passed
- Node contract tests: 62/62 passed
- Production client/SSR build: passed
- `git diff --check`: passed

final result: passed
