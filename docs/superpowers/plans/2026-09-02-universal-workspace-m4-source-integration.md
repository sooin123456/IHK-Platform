# Universal Drawing Workspace M4 Source Integration Plan

> Required skills: `subagent-driven-development`, `test-driven-development`, `verification-before-completion`, `ponytail`, and `supabase` for database boundaries.

**Goal:** Complete the universal source workflow on the canonical signed-in Drawing Workspace: proven PDF/IFC cross-selection, source attachment from a blank workspace, bounded DXF import with entity lineage, and an explicit native-DWG boundary.

**Architecture:** Reuse the existing PDF.js, IFC viewer, Konva canvas, operation/outbox pipeline, and `drawing_object_sources` lineage. Parse DXF only on the server with a pinned permissive dependency. Normalize accepted entities to millimeters and persist them through existing drawing operations; do not add a second canvas, CAD service, CRDT, or client state library.

## Constraints

- Source PDF, IFC, DXF, and retained DWG bytes remain immutable and SHA-256 addressable.
- Native DWG is retained as an original file only; editing requires an explicit user-supplied DXF conversion.
- Missing DXF units are never guessed. Import pauses until the user chooses the source unit.
- Unsupported or unsafe DXF entities are reported as `skipped` or `blocking`; they are never silently approximated.
- Parser limits are independent of the general upload limit and include bytes, entities, points, block depth, coordinates, and elapsed work.
- Imported IDs and request IDs are deterministic so a response-loss retry cannot duplicate layers, objects, or lineage.
- Initial DXF scope is import and canonical persist/reload, not DXF export.

## Task 1 — Canonical PDF/IFC release gate

- [x] Add one direct canonical workspace browser test with real PDF and IFC fixtures.
- [x] Prove PDF region and IFC GlobalId can be attached to one object and selected in both directions.
- [x] Prove PDF revision markers render and PDF/IFC source SHA values remain unchanged.
- [x] Prove Editor mutation and Viewer denial on the same canonical route.

## Task 2 — Source-optional workspace catalog

- [x] Add failing server and route tests for a blank workspace listing project PDF/IFC candidates.
- [x] Remove the `primarySource === null` source-catalog early return while preserving project and SHA authorization.
- [x] Load signed bytes or IFC derivatives only for the selected source, not for the whole catalog.
- [x] Add a canonical browser test for blank canvas → choose existing project source → reopen.

## Task 3 — Verified DXF kind and explicit DWG boundary

- [x] Add one forward migration for the `dxf` file kind and update generated/server validation contracts.
- [x] Extend upload verification with exact extension, kind, MIME, and immutable SHA checks.
- [x] Reject CAD-import attempts for `.dwg` with a bounded Korean DXF-conversion explanation while retaining original-file storage.
- [x] Add upload UI, route, Edge Function, database, and cross-project/RLS counterexamples.

## Task 4 — Bounded server DXF adapter

- [x] Fixture-test `dxf-parser@1.1.2` against the approved entity corpus before adding the exact pinned dependency and notice.
- [x] Reject NUL, non-finite numbers, unsafe coordinates, excessive bytes/entities/points/block depth, and work beyond the parser deadline.
- [x] Convert `LINE`, `LWPOLYLINE`/`POLYLINE`, `CIRCLE`, `ARC`, and `TEXT`; flatten only bounded validated `INSERT` transforms.
- [x] Map DXF layers to existing drawing layers and normalize declared or user-selected units to millimeters.
- [x] Return deterministic `imported`, `converted`, `skipped`, and `blocking` reports.

## Task 5 — DXF entity lineage and idempotent persistence

- [x] Extend `drawing_object_sources` with a strict `dxf_entity` variant containing source file/SHA, entity key/type, source layer, and optional handle.
- [x] Generate deterministic layer, object, source, operation, and request IDs from the source SHA and entity identity.
- [x] Persist layer creation, object creation, and source links through existing operations/outbox only.
- [x] Extend quantity, export, snapshot, and source normalization consumers without reusing IFC fields.
- [x] Add response-loss retry, partial failure, deletion/undo, and cross-project source counterexamples.

## Task 6 — Customer fixture and release evidence

- [ ] **UNEXECUTED:** Run `upload → parse → persist → reload/relogin → exact geometry` against an approved customer fixture.
- [ ] **UNEXECUTED:** Verify the approved customer fixture's source SHA before/after, deterministic report totals, layer mapping, and entity lineage.
- [x] Run focused/unit/database tests, TypeScript checks, production build, canonical M1–M4 browser suites, `git diff --check`, and independent review.
- [x] Record fixture redistribution status and exact executed/unexecuted evidence; do not claim hosted proof without a hosted run.
- [x] Prove bounded parser interoperability against the pinned MIT-licensed `dxf-parser` `extendeddata.dxf` fixture, including deterministic output and unchanged coordinate-bomb defenses. This is OSS interoperability evidence, not customer acceptance.
