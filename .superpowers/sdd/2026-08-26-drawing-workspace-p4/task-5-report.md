# P4 Task 5 implementation report

Base: `32b1f6d1777ac030ded0f40e65d9deb9ad10d6b2`

## Summary

- Added dependency-free, pure room, door, and finish schedule projections over the complete canonical revision map. Columns are fixed, semantic rows are read-only, ordering uses deterministic UTF-16 comparisons with object ID as the final tie-breaker, and area totals sum exact fixed-point measurement strings before m² formatting.
- Added `P4_MEASUREMENT_V1` server evidence derived only from the strict transactional collaboration bootstrap after the existing authorized Postgres load. Evidence is bound to revision ID, authoritative operation checkpoint, exact semantic object IDs, object ID, and rule version; local operations or any lineage mismatch make it stale.
- Rendered semantic schedules above the unchanged P2 custom schedules and composed browser-preview versus confirmed/stale/unavailable server evidence in both the Schedule and semantic-inspector surfaces.
- Preserved current capability and revision-freeze behavior: authorized viewers can read evidence and schedules, while existing draft admin/editor controls remain the only authoring path. No semantic schedule row, measurement table/RPC, client measurement input, operation discriminator, dependency, state manager, or CRDT shape was added.

## RED evidence

- New schedule/evidence golden suite: 4/4 failed after fixture validation because the pure schedule and evidence exports did not exist.
- Combined server RED: 45 established tests passed and 5 new Task 5 tests failed on the absent pure schedule/evidence and authorized-server wrapper contracts.
- Focused UI RED: 8 established table tests passed and 2 new tests failed because semantic schedules were absent and the inspector exposed only an unconfirmed browser value.

## GREEN and verification evidence

- Task 5 schedule/table/server suite: 52/52 passed, 0 failed.
- Broad database/server/route/schedule suite: 226/226 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 582 discovered; 581 passed, 0 failed, 1 explicitly skipped disposable-PostgreSQL concurrency fixture.
- Final full post-fix drawing test sweep exited 0, followed by successful typecheck and production build.
- `npm run typecheck`: exit 0. `npm run build`: exit 0; only established chunk-size, React Router future-flag, mixed-import, unsigned-theme-cookie, and localStorage warnings remain.
- Local Chromium shell: 11/11 passed. The first run exposed an accessible-name collision between the inspector and Schedule preview labels; the Schedule label was made specific and the final run passed.
- Prettier checks and `git diff --check`: exit 0.

## Files

- Added `platform/app/lukas/lib/drawing-semantic-schedules.ts`.
- Added `platform/app/lukas/components/drawing-semantic-schedules-panel.tsx`.
- Added `platform/tests/drawing-workspace-semantic-schedules.test.mjs`.
- Composed server evidence through `drawing-workspace.server.ts`, the route loader, workspace, Schedule panel, and semantic inspector.
- Extended the existing server/table tests without adding a migration, package, lockfile, or public persistence/API surface.

## Commit

- `feat: add architectural drawing schedules`

## Residuals

- The disposable real-PostgreSQL concurrency fixture remains explicitly skipped because it is not configured; no real-PostgreSQL execution is claimed.
- Populated semantic preview/export and collaboration/offline/history vertical evidence remain P4 Task 6.
