# Drawing Workspace P4 Architectural Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visible wall, hosted opening, space, area, grid, and arc authoring with deterministic V1 measurement and room/door/finish schedules while preserving P0-P3 operation, collaboration, approval, RLS, offline, and immutable-source authority.

**Architecture:** Extend the current strict `DrawingGeometry` union and existing object commands. Cross-object opening integrity is validated after atomic batches in TypeScript and Postgres. One dependency-free fixed-point module drives server-authoritative measurement and derived schedules; Konva remains a view adapter, and Yjs continues to carry the existing immutable operation envelopes.

**Tech Stack:** React Router 7, TypeScript, Zod, Konva/react-konva, Supabase Postgres/RLS/RPC, Yjs/y-indexeddb/Hocuspocus, Node test runner, PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-drawing-workspace-p4-design.md`

## Global Constraints

- PDF/IFC source rows, SHA-256 values, and bytes are immutable; P4 writes only overlay objects, operations, and existing structured metadata.
- Exact P4 object types are `wall | opening | space | area | grid | arc`, each with `semanticVersion: 1` and the exact fields in the P4 spec.
- P4 numeric geometry accepts at most six decimal places and bounded finite values; polygons contain 3-4096 points and must be simple/non-degenerate.
- Rule identifier is exactly `P4_MEASUREMENT_V1`; fixed-point quantum is exactly `0.000001 mm`; derived values are locale-independent strings.
- No new P4 operation discriminator, public table, measurement RPC, React state manager, CRDT collection, geometry service, or runtime dependency.
- P4 semantic objects are top-level objects; blocks remain limited to the original six P0/P1 geometry types.
- Browser numbers are previews. Server evidence is recomputed from authorized Postgres-loaded state with the shared fixed-point module and bound to revision/checkpoint/object/rule.
- Existing P3 Yjs envelope/document schema versions remain unchanged. Web and the one-replica collaboration service are coordinated for rollout.
- P5/P6/P7 features remain out of P4: IFC cross-selection, revision overlay, approved quantities/rates/BOQ, organization libraries, multi-instance fanout, and full 10,000-object optimization.
- Any copied or substantially adapted MIT source records exact upstream repository, commit, file, license, and modifications in `THIRD_PARTY_NOTICES.md`; no copyleft or source-available source is copied.
- Every product change follows RED -> verify expected failure -> GREEN -> focused regression -> fresh task review. Missing production authorities are `UNEXECUTED`, never skipped green.

---

### Task 1: Strict semantic geometry and fixed-point measurement kernel

**Files:**
- Modify: `platform/app/lukas/lib/drawing-workspace.types.ts`
- Modify: `platform/app/lukas/lib/drawing-geometry.ts`
- Create: `platform/app/lukas/lib/drawing-semantic-geometry.ts`
- Create: `platform/app/lukas/lib/drawing-measurements.ts`
- Create: `platform/tests/drawing-workspace-p4-geometry.test.mjs`
- Create: `platform/tests/drawing-workspace-measurements.test.mjs`
- Modify: `platform/tests/drawing-workspace-geometry.test.mjs`

**Interfaces:**
- Consumes: current `Point`, `DrawingGeometry`, `DrawingObject`, object map, snap/bounds contracts.
- Produces: exact six P4 Zod variants; `DrawingSemanticVersion = 1`; `isSimpleDrawingBoundary(points)`; `projectPointToDrawingWall(point, wall)`; `resolveDrawingOpening(opening, objects)`; exhaustive P4 snap/bounds helpers; `DRAWING_MEASUREMENT_RULE_VERSION = "P4_MEASUREMENT_V1"`; `measureDrawingObject(object, objects)`; `formatDrawingMeasurement(measurement, unit)`.

- [ ] **Step 1: Write RED schema and geometry tests**

Add literal fixtures for all six valid variants and mutations that must fail: unknown key, unsafe range, seventh decimal place, equal wall/grid endpoints, zero/negative dimensions, door sill other than zero, duplicate closing polygon point, adjacent duplicate, zero area, bow-tie self-intersection, 4097 points, zero/over-360 arc sweep, missing/non-wall opening resolver host, and out-of-wall offset. Assert exact default names and finite bounds/snap endpoints for every valid type.

- [ ] **Step 2: Verify the geometry RED state**

Run: `cd platform && node --test tests/drawing-workspace-p4-geometry.test.mjs tests/drawing-workspace-geometry.test.mjs`

Expected: FAIL because P4 geometry variants and semantic helpers do not exist; existing P0-P3 tests remain discoverable.

- [ ] **Step 3: Implement exact P4 schemas and semantic geometry helpers**

Keep P0/P1 variants unchanged. Add a block-specific primitive schema that explicitly retains only the original six types. Use a bounded O(n^2) polygon segment-intersection check for at most 4096 points. `resolveDrawingOpening` returns `{ host, center, start, end, wallAngleDegrees }`; it never mutates inputs. Extend snap/bounds only where geometry is context-free and route opening context through the resolver.

- [ ] **Step 4: Write RED fixed-point measurement tests**

Use hand-derived literals for: 3-4-5 wall length, diagonal grid length, 900x2100 opening, clockwise/counter-clockwise 1000x500 polygon, half-square-millimetre polygon, 90/180/360-degree arcs using the fixed PI rational, large safe coordinates, unavailable `null` versus zero, repeated byte-identical JSON, and Korean/English locale independence. Mentally mutate rounding, sign, scale, and PI to ensure a test fails for each.

- [ ] **Step 5: Verify the measurement RED state**

Run: `cd platform && node --test tests/drawing-workspace-measurements.test.mjs`

Expected: FAIL because the V1 module/constant does not exist.

- [ ] **Step 6: Implement the smallest dependency-free V1 kernel**

Convert validated P4 numbers to micromillimetre `BigInt`; implement integer square root and exact shoelace doubled area; use one named rational PI numerator/denominator; round once with a documented half-away-from-zero helper. Return exact strings and `count: "1"`. Do not call `toLocaleString`, persist measurements, or add a package.

- [ ] **Step 7: Verify focused and baseline geometry suites**

Run: `cd platform && node --test tests/drawing-workspace-p4-geometry.test.mjs tests/drawing-workspace-measurements.test.mjs tests/drawing-workspace-geometry.test.mjs && npm run typecheck`

Expected: PASS with no unhandled exhaustive-switch error.

- [ ] **Step 8: Commit**

Commit: `feat: define drawing semantic geometry and measurements`

### Task 2: Semantic references, commands, undo, clipboard, and block boundary

**Files:**
- Modify: `platform/app/lukas/lib/drawing-commands.ts`
- Modify: `platform/app/lukas/lib/drawing-structure.ts`
- Modify: `platform/app/lukas/lib/drawing-blocks.ts`
- Modify: `platform/app/lukas/lib/drawing-properties.ts`
- Modify: `platform/tests/drawing-workspace-commands.test.mjs`
- Modify: `platform/tests/drawing-workspace-structure.test.mjs`
- Modify: `platform/tests/drawing-workspace-blocks.test.mjs`
- Modify: `platform/tests/drawing-workspace-properties.test.mjs`
- Create: `platform/tests/drawing-workspace-p4-commands.test.mjs`

**Interfaces:**
- Consumes: Task 1 P4 schemas, resolver, current `DrawingDocumentState`, object commands, reference cleanup, clipboard.
- Produces: `validateDrawingSemanticReferences(state)`; host-aware translation/move; `deleteDrawingWallWithOpeningsCommand`; final-graph validation after object batches; clipboard host remapping; P4 custom-property applicability; semantic block rejection.

- [ ] **Step 1: Write RED final-graph and command tests**

Cover add wall+opening atomically; opening-before-wall rejection; foreign canvas/layer host rejection; wall translation with unchanged opening row and changed resolved centre; opening drag changing only offset; invalid shrink; ordinary host delete conflict; explicit opening-first compound delete plus property/table cleanup; inverse restores exact IDs/versions/references; undo/redo/revert/checkpoint restore; copied wall+opening ID remap; opening-only copy retaining a valid same-revision host; absent-host/cross-document paste rejection; all P4 types accepted by custom properties; all P4 types rejected as block primitives.

- [ ] **Step 2: Verify command RED**

Run: `cd platform && node --test tests/drawing-workspace-p4-commands.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-structure.test.mjs tests/drawing-workspace-blocks.test.mjs tests/drawing-workspace-properties.test.mjs`

Expected: FAIL on the first missing semantic reference/command behavior, not fixture syntax.

- [ ] **Step 3: Implement final semantic graph validation**

Validate opening host type, active presence, layer canvas, offset/width fit, and sill/height after the full candidate batch. Invoke it in document hydration and after `add_objects`, `update_objects`, `delete_objects`, `mutate_objects_with_references`, and structure object actions. Preserve current error types and OCC/base/result-version behavior.

- [ ] **Step 4: Implement host-aware movement/deletion/copy**

Extend exhaustive translation for wall, space, area, grid, and arc. Opening movement projects to its host; generic XY translation is forbidden. Build one explicit delete command with ordered opening/reference cleanup then wall deletion. Remap clipboard host IDs in one preallocated identity pass.

- [ ] **Step 5: Enforce block and property boundaries**

Reject P4 geometry in block creation/conversion even though the global object schema accepts it. Extend P2 `appliesTo` types and keep all existing reference cleanup semantics.

- [ ] **Step 6: Verify focused and outbox/document regressions**

Run: `cd platform && node --test tests/drawing-workspace-p4-commands.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-structure.test.mjs tests/drawing-workspace-blocks.test.mjs tests/drawing-workspace-properties.test.mjs tests/drawing-document-store.test.mjs tests/drawing-workspace-outbox.test.mjs && npm run typecheck`

Expected: PASS; inverses and operation payloads remain existing discriminators.

- [ ] **Step 7: Commit**

Commit: `feat: enforce drawing semantic references`

### Task 3: Forward Supabase migration and strict server authority

**Files:**
- Create via CLI: `platform/supabase/migrations/<generated>_drawing_workspace_p4_semantic_objects.sql`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Create: `platform/tests/drawing-workspace-p4-database-contract.test.mjs`
- Modify: `platform/tests/drawing-workspace-database.test.mjs`
- Modify: `platform/tests/drawing-workspace-database-runtime.test.mjs`
- Modify: `platform/tests/drawing-workspace-server.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-2 exact keys/ranges/reference rules, latest wrapped `lukas_drawing_apply_operation`, existing RLS/revision/source guards.
- Produces: twelve-type object check; strict SQL geometry/property/block validation; generated nullable `host_object_id`; composite self-FK/index; final semantic host guard; P4 loader/RPC compatibility without a new public endpoint.

- [ ] **Step 1: Generate the forward migration with the installed CLI**

Run: `cd platform && npx supabase migration new drawing_workspace_p4_semantic_objects`

Use only the emitted filename. Do not edit an existing migration or commit a database password.

- [ ] **Step 2: Write RED source and PGlite counterexamples**

Run the same literal valid/invalid JSON corpus through Zod and SQL. Cover fresh install and committed P0-P3 upgrade; twelve-type check; exact-key/precision/polygon limits; property applies-to widening; semantic block rejection; generated host UUID cast; same revision/project/canvas/type/active host; offset fit; host direct delete; invalid shrink; opening-first compound delete; editor draft success; viewer/reviewer/nonmember/review-requested/approved denial; idempotent retry/result versions; snapshot v2/template clone/approved-child-draft/review-freeze preservation; source file row and SHA invariance.

- [ ] **Step 3: Verify database RED**

Run: `cd platform && node --test tests/drawing-workspace-p4-database-contract.test.mjs tests/drawing-workspace-database-runtime.test.mjs --test-name-pattern='P4'`

Expected: FAIL because the forward migration and SQL validators do not exist.

- [ ] **Step 4: Implement one additive migration**

Replace constraints/functions forward-safely, preserve fixed `search_path`, explicit revokes/grants, RLS, approval guards, and current RPC signature/error mapping. Add the generated host column/FK/index and a transaction-safe final graph guard. Do not expose private collaboration state or add a measurement table/RPC.

- [ ] **Step 5: Widen the server row/parser boundary**

Keep the existing keyset query and strict `DrawingObjectSchema` parse. Server-derived measurement later consumes only the authorized loaded document and its operation checkpoint; ignore any client measurement fields.

- [ ] **Step 6: Verify migration history and server regressions**

Run: `cd platform && node --test tests/drawing-workspace-p4-database-contract.test.mjs tests/drawing-workspace-database.test.mjs tests/drawing-workspace-database-runtime.test.mjs tests/drawing-workspace-server.test.mjs && npm run typecheck`

If disposable PostgreSQL is unavailable, its existing gate must report `UNEXECUTED`; PGlite/source contracts must pass.

- [ ] **Step 7: Commit**

Commit: `feat: persist drawing semantic objects`

### Task 4: Konva authoring tools, rendering, and semantic inspector

**Files:**
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Create: `platform/app/lukas/components/drawing-semantic-inspector.tsx`
- Modify: `platform/app/lukas/components/drawing-inspector.tsx`
- Modify: `platform/app/lukas/components/drawing-command-menu.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Create: `platform/tests/drawing-workspace-p4-tools.test.mjs`
- Modify: `platform/tests/drawing-workspace-route.test.mjs`
- Modify: `platform/e2e/drawing-workspace-shell.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-2 geometry/commands/resolver, current tool controller, Konva render adapter, inspector locks/capabilities.
- Produces: six tool/session variants; grouped `건축 객체` control; contextual semantic rendering; semantic inspector; server/preview measurement labels.

- [ ] **Step 1: Write RED pure tool-session tests**

Cover wall/grid two-click completion and Shift constraint; opening nearest-host projection/default door `900 x 2100` with sill `0`; no-host no command; space/area point collection, Backspace, Enter/double-click completion, Escape; arc three-step start/sweep and invalid zero sweep; repeat mode; layer lock/capability/soft-lock downgrade cancellation; exactly one `add_objects` command per completion.

- [ ] **Step 2: Write RED visible shell test**

Require an accessible `건축 객체` menu with six named tools, no horizontal toolbar overflow at desktop and tablet widths, transient previews, P4 render nodes/labels, semantic inspector fields, `미리보기` versus `서버 계산 · V1`, remote semantic selection/lock description, and keyboard operation.

- [ ] **Step 3: Verify UI RED**

Run: `cd platform && node --test tests/drawing-workspace-p4-tools.test.mjs tests/drawing-workspace-route.test.mjs && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-anon-key VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-anon-key npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --workers=1`

Expected: FAIL on missing P4 tools/UI.

- [ ] **Step 4: Extend the pure tool controller**

Reuse polygon state transitions for space/area, existing snap/constraint helpers for wall/grid, Task 1 resolver/projection for opening, and a three-point arc session. Keep DOM text input only for existing name/field editing; no renderer state enters commands.

- [ ] **Step 5: Render and hit-test all semantic types**

Use wall stroke width in world units, resolved opening markers, closed polygon fill/stroke, grid name label, and sampled arc path. Memoize resolved/sampled view data by object ID/version. Extend selection/drag previews and Awareness outlines without rerendering the whole document on cursor movement.

- [ ] **Step 6: Compose the focused semantic inspector**

Single-selection only for geometry-specific fields. Use existing version-aware `update_objects`, capability, active-layer, lock, dirty-field, and pointer-cancellation paths. Display fixed-point measurement with rule/status; do not let a browser preview appear confirmed.

- [ ] **Step 7: Verify focused UI and typecheck/build**

Run: `cd platform && node --test tests/drawing-workspace-p4-tools.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-awareness.test.mjs && npm run typecheck && npm run build`

Expected: PASS without adding a UI/runtime package.

- [ ] **Step 8: Commit**

Commit: `feat: author architectural drawing objects`

### Task 5: Fixed semantic schedules and server-derived evidence

**Files:**
- Create: `platform/app/lukas/lib/drawing-semantic-schedules.ts`
- Create: `platform/app/lukas/components/drawing-semantic-schedules-panel.tsx`
- Modify: `platform/app/lukas/components/drawing-tables-panel.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Create: `platform/tests/drawing-workspace-semantic-schedules.test.mjs`
- Modify: `platform/tests/drawing-workspace-tables.test.mjs`
- Modify: `platform/tests/drawing-workspace-server.test.mjs`

**Interfaces:**
- Consumes: authorized loader state/checkpoint, Task 1 measurement module, current semantic DOM table components.
- Produces: `DrawingSemanticScheduleKind = "room" | "door" | "finish"`; `resolveDrawingSemanticSchedule(kind, state)`; fixed columns/rows/totals; server evidence bundle bound to revision/checkpoint/rule.

- [ ] **Step 1: Write RED schedule golden tests**

Use an unsorted mixed revision fixture. Assert exact columns, values, object-ID tie-break order, door-only filtering, square-millimetre-to-m² formatting, fixed-point totals before formatting, deleted-object exclusion, empty schedule shape, repeat byte identity, and mutation checks for wrong sort/filter/total. Assert P2 saved schedules remain separately resolvable/editable.

- [ ] **Step 2: Write RED server-evidence tests**

Require server derivation only after authorized workspace load, exact `revisionId`, authoritative operation checkpoint, object IDs, `P4_MEASUREMENT_V1`, and no client value acceptance. A revalidated checkpoint mismatch must mark the client value stale/unconfirmed.

- [ ] **Step 3: Verify schedule RED**

Run: `cd platform && node --test tests/drawing-workspace-semantic-schedules.test.mjs tests/drawing-workspace-tables.test.mjs tests/drawing-workspace-server.test.mjs --test-name-pattern='semantic|P4'`

Expected: FAIL because the derived schedule/evidence interfaces do not exist.

- [ ] **Step 4: Implement pure schedules and server evidence**

Derive across the full revision, never from selected rows or active canvas. Store no schedule rows. Use the Task 1 measurement strings and fixed-point totals. Server loaders/actions never accept a measurement payload.

- [ ] **Step 5: Render read-only schedules above P2 tables**

Use native table semantics and captions. Semantic cells have no input controls; source edits happen in the inspector. Keep P2 custom schedule controls unchanged and label both surfaces clearly.

- [ ] **Step 6: Verify focused tests, typecheck, and build**

Run: `cd platform && node --test tests/drawing-workspace-semantic-schedules.test.mjs tests/drawing-workspace-tables.test.mjs tests/drawing-workspace-server.test.mjs && npm run typecheck && npm run build`

Expected: PASS with stable schedule output.

- [ ] **Step 7: Commit**

Commit: `feat: add architectural drawing schedules`

### Task 6: Export, preview, collaboration, offline, and history integration

**Files:**
- Modify: `platform/app/lukas/lib/drawing-export.ts`
- Modify: `platform/app/lukas/lib/workspace-preview-state.ts`
- Modify: `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- Modify: `platform/THIRD_PARTY_NOTICES.md` only if source is substantially adapted
- Modify: `platform/tests/drawing-workspace-export.test.mjs`
- Modify: `platform/tests/local-drawing-workspace-preview.test.mjs`
- Modify: `platform/tests/drawing-workspace-collaboration.test.mjs`
- Modify: `platform/tests/drawing-workspace-outbox.test.mjs`
- Modify: `platform/tests/drawing-workspace-p3-social.test.mjs`
- Create: `platform/e2e/drawing-workspace-p4.spec.ts`

**Interfaces:**
- Consumes: all P4 types/resolver/schedules; existing SVG/Canvas/PDF export, preview, Yjs/outbox/history/review fixtures.
- Produces: P4 SVG/PNG/PDF parity; visibly populated P4 preview; semantic operation convergence/recovery/restore evidence; exact source SHA invariance.

- [ ] **Step 1: Write RED export parity tests**

One literal mixed fixture must have the same P4 visible-object count, finite bounds, hosted opening position, labels, and style semantics in SVG and Canvas/PDF render plans. Assert export creates new bytes and never calls source update/delete. Add license notice tests only if code was actually adapted.

- [ ] **Step 2: Write RED preview and collaboration tests**

Require local preview walls, door, window, space, area, grid, and arc; participant selection/locks on semantic IDs; two Y.Docs converging for different objects; same-wall invalid edit conflict; opening host preserved through remote projection; 100 offline semantic operations with exact ID equality in outbox/Yjs/materialized state; restore and approved-child-draft retain exact semantic geometry/references.

- [ ] **Step 3: Write RED P4 browser vertical flow**

In real Chromium: open preview, author every type, inspect/edit fields, move wall/opening, reject invalid shrink, undo/redo, view schedules, reload, simulate disconnect/reconnect, observe peer selection/lock, and export. Capture source PDF/IFC SHA/size before and after and require exact equality. Viewer controls are disabled and direct mutation is rejected.

- [ ] **Step 4: Verify integration RED**

Run focused Node tests and `npx playwright test e2e/drawing-workspace-p4.spec.ts --project=chromium --workers=1` with the standard local Supabase placeholder environment.

Expected: FAIL on missing P4 integration/preview/export behavior.

- [ ] **Step 5: Implement export and representative preview**

Extend exhaustive SVG and Canvas/PDF rendering using the same semantic resolver and label placement as the canvas. Populate preview state with deterministic UUIDs/versions and valid host ordering. Record MIT attribution only for copied/substantially adapted source.

- [ ] **Step 6: Close collaboration/offline/history seams**

Keep the existing operation envelope and Yjs document versions. Ensure new schemas are imported by web/service, semantic batches are durably queued before publication, and restore/freeze paths validate the complete graph. Do not add a semantic Y.Map.

- [ ] **Step 7: Verify focused integration and visual evidence**

Run export, preview, collaboration, outbox, history, P4 Chromium, typecheck, collaboration typecheck, application build, and collaboration build. Capture desktop and tablet screenshots with no horizontal overflow or error overlay.

- [ ] **Step 8: Commit**

Commit: `feat: integrate architectural drawing workflow`

### Task 7: P4 release gates, performance baseline, and honest evidence

**Files:**
- Create: `platform/tests/drawing-workspace-p4-release.test.mjs`
- Modify: `platform/package.json`
- Modify: `platform/DEPLOYMENT.md`
- Modify: `docs/P0_P5_IMPLEMENTATION_MATRIX.md`
- Modify: `docs/DRAWING_COLLABORATION_FIELD_CHECK.md`
- Modify: `docs/PROJECT_STATE.md`
- Create: `docs/superpowers/reports/2026-08-26-drawing-workspace-p4-release.md`

**Interfaces:**
- Consumes: P4 release gates 1-12 from the spec and all P0-P3 regression commands.
- Produces: one fail-closed local/production command, measured mixed-object baseline metadata, source/license/authorization evidence, and status split `IMPLEMENTED | LOCAL PASS | LOCAL ENV UNEXECUTED | PRODUCTION UNEXECUTED | MEASURED`.

- [ ] **Step 1: Write RED executable release contracts**

Require commands to exercise—not grep—geometry/measurement, command/reference, DB/server, UI/schedules, export, two-browser/offline/history, source SHA, role denial, approved freeze, license, typechecks, builds, and P0-P3 regressions. The production command must exit nonzero and print `UNEXECUTED` when real app/Supabase/collaboration authorities are absent.

- [ ] **Step 2: Verify release RED**

Run: `cd platform && node --test tests/drawing-workspace-p4-release.test.mjs`

Expected: FAIL because P4 release scripts/evidence do not exist.

- [ ] **Step 3: Add the smallest release orchestrator and benchmark fixture**

Use existing Node/Playwright scripts and environment guard patterns. Build a deterministic 10,000 mixed-object fixture, sample at least 30 warm pan/zoom/selection frames, and record browser version, CPU, memory, viewport, object mix, and cold/warm label. Report measured values without claiming the P7 60 fps target.

- [ ] **Step 4: Run the full local gate**

Run: whole Node suite; Drawing Workspace suite; collaboration service suite; P4 Chromium; IFC geometry smoke; application/collaboration typechecks and builds; license checks; `git diff --check`; both npm audits. Record exact counts and distinguish environment gates.

- [ ] **Step 5: Record operational truth**

Document coordinated web/single-replica collaboration deployment order and rollback. Do not claim hosted RLS/WebSocket, p95, field user, Docker, linked migration, or production source-hash evidence without real output. Preserve every `UNEXECUTED` item in all status documents.

- [ ] **Step 6: Verify docs/status consistency and commit**

Run focused release contract, whole local gate, and source consistency checks.

Commit: `test: verify drawing workspace P4 semantics`

## Final whole-phase review

After all seven task reviews are clean:

- Generate a review package from the P4 starting commit through HEAD.
- Dispatch a fresh most-capable reviewer for requirement-by-requirement audit of the P4 spec, plan, ledger, migrations, source invariance, OSS notices, local evidence, and production `UNEXECUTED` claims.
- Route all Critical/Important findings through one final fix wave and one scoped re-review.
- Mark only P4 local implementation complete when every local gate is proven. Leave hosted/field gates and the full P0-P7 goal active.
