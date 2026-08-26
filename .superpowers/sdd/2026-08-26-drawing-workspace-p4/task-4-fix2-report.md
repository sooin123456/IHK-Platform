# P4 Task 4 second review-fix report

Reviewed implementation: `ba637840dc81afec32b73906640a26dc7421b213`

## Corrections

- I1-R: wall/grid Shift authoring now canonicalizes the start and snapped endpoint first, chooses one 45-degree direction, and derives both serialized endpoint coordinates from one normalized fixed-point delta. Noncanonical first clicks, all diagonal signs, and object/grid snap competition therefore retain equal absolute micromillimetre deltas.
- I2-R: Canvas object pointer-downs, including Shift-clicks, now pass through the semantic narrow phase. Selection and Awareness receive the actual resolved fallthrough object; block/object kind exclusion remains at the Canvas boundary.
- I3-R: selection editability now uses one fail-closed predicate for capability, same-ID layer visibility/lock/system kind, and remote locks. An individually dragged opening is rejected before preview resolution can throw, and context synchronization releases pointer capture and the soft lock without emitting a command.

No dependency, CRDT schema, renderer, state authority, or parallel UI path was added.

## RED evidence

- Initial focused P4 tools run: 13 discovered; 10 passed and 3 failed. The failures reproduced the one-micromillimetre diagonal drift, missing Canvas narrow-phase/Awareness integration, and synchronous opening-preview exception after a same-ID layer downgrade.
- The first complete Chromium verification was 10/11: the architectural selection test exposed a transient selection reset caused by publishing the newly resolved soft lock before the selection callback. Reordering those existing callbacks fixed the real integration regression.

## GREEN and verification evidence

- Focused P4 tools: 13/13 passed, 0 failed.
- Relevant P4 geometry/tools, commands, Awareness, blocks, and route tests: 139/139 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 575 discovered; 574 passed, 0 failed, 1 explicitly skipped disposable-PostgreSQL fixture.
- Fresh `npm run typecheck`: exit 0.
- Fresh `npm run build`: exit 0. Existing localStorage, chunk-size, mixed dynamic/static import, React Router future-flag, and local cookie warnings remain warnings only.
- Real Chromium shell: isolated architectural regression check 1/1 passed, then the complete one-worker suite passed 11/11 at desktop/tablet coverage.
- Fresh `git diff --check`: exit 0.

## Browser artifact

No new screenshot was captured in this correction round, so none is claimed. The real Chromium assertions above are the verification evidence for the affected interactions.

## Commit

- Subject: `fix: close P4 architectural interaction residuals`
- Identity: the commit containing this report; the exact SHA is reported in the task handoff because a commit cannot embed its own content hash.

## Residuals

- The disposable-PostgreSQL concurrency fixture remains explicitly unexecuted because that external fixture is not configured; no PostgreSQL concurrency pass is claimed.
- No known P4 Task 4 rereview finding remains. Server-derived V1 evidence and semantic schedule/export work remain assigned to later P4 tasks.
