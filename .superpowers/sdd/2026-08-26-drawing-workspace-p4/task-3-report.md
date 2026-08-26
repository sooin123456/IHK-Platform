# P4 Task 3 implementation report

Base: `e85f379`

## Summary

- Added the single CLI-generated forward migration `20260826123529_drawing_workspace_p4_semantic_objects.sql`; no prior migration was edited.
- Widened the canonical object constraint to the twelve P0-P4 types and mirrored the Task 1 strict geometry authority in SQL: exact keys, semantic version, six-decimal fixed domains, polygon bounds/simplicity, and per-variant rules.
- Kept semantic objects out of block primitives while widening custom-property applicability to the six semantic types.
- Added generated nullable `host_object_id`, a project/revision-scoped deferred composite self-FK, and its partial covering index.
- Added final semantic graph authority for active wall hosts, same revision/project/page/canvas, wall type, exact opening fit, and window height.
- Wrapped the existing operation family without adding a discriminator or public endpoint. The wrapper preserves OCC/idempotency/history fields, supports Task 2 mixed wall/opening `put_object` actions, exact undo, and opening-first compound host deletion while rejecting unsafe ordering.
- Preserved snapshot/review freeze and remapped hosted IDs for approved template clones and approved child drafts without changing versions or source evidence.
- Widened the authorized server loader to select and strictly validate `object_type`, require its geometry match, and validate the loaded semantic graph. Client renderer/measurement extras remain outside the strict parser.
- Added no public semantic/measurement table or RPC, dependency, UI, state manager, or CRDT collection.

## TDD evidence

- Shared Zod/SQL corpus RED: SQL geometry/property/migration assertions failed before the migration implementation.
- Loader RED: semantic snake-case rows failed the pre-P4 row parser before `object_type` and graph validation were added.
- RPC RED: mixed semantic actions and opening-first host deletion failed the prior reference engine before the wrapper implementation.
- Clone RED: approved semantic clone failed the generated host FK before lineage-based host remapping was added.
- Every named RED case passed after its corresponding implementation change.

## Verification evidence

- Required DB/server command: 190/190 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 556 discovered; 555 passed, 0 failed, 1 explicitly `UNEXECUTED` disposable-PostgreSQL concurrency fixture.
- `npm run typecheck`: exit 0 (`react-router typegen && tsc`).
- Real PostgreSQL gate: explicitly `UNEXECUTED: disposable PostgreSQL concurrency fixture is not configured`; no real-PostgreSQL pass is claimed.
- `git diff --check`: exit 0.

## Commit

- `feat: persist drawing semantic objects`

## Residuals

- P4 authoring tools and inspector remain Task 4.
- Server-derived V1 measurement evidence and schedules remain Task 5.
- Export, populated preview, collaboration/offline/history vertical evidence, and release gates remain Tasks 6-7.
