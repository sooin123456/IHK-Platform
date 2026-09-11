# Native Drawing Content Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute the approved R5 goal without another approval loop; preserve the shared dirty worktree and do not commit, stage, push, or deploy.

**Goal:** Author and verify 24 original, dimensioned native symbols and four editable practical templates as the first R5 content release, with reproducible provenance and real native SVG output.

**Architecture:** A separately versioned, first-party content module compiles directly to existing `DrawingBlockPrimitive` and `DrawingStructureState` values. This unit does not change the released four-row starter catalog, introduce a second drawing engine, or activate an unverified database import path. A small export verifier exercises the actual native graph, measurements, and existing SVG renderer; later authenticated import can consume the same validated native graph.

**Tech Stack:** Existing TypeScript, Zod, native Web Crypto, Node test runner, existing drawing renderer/measurement/structure validators. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-simple-workspace-dwg-oss-design.md`, especially section 5 and R5; business context `docs/superpowers/specs/2026-09-05-1hk-business-model-design.md`.

## Global Constraints

- Preserve all existing dirty work, old starter rows, keys, versions, payloads, hashes, parsers, RPCs and routes.
- Reuse the existing native drawing schemas and graph validators; canonical geometry stays millimeters. Never rescale source evidence or final quantities.
- New content is independently authored schematic example content, not copied Rayon, Supaplate UI assets, customer CAD, or unknown external libraries.
- No source file, PDF anchor, IFC GlobalId, customer measurement, verified quantity, final price, approval or legal/safety compliance may be fabricated.
- Each item has a stable key, version 1, name, description, first-party author, source path, attribution, explicit licensing status, and a reproducible SHA-256 over its canonical definition. Use `NOASSERTION` for unassigned redistribution license, not a fabricated open-source grant. No public distribution is performed by this task.
- Existing `platform/LICENSE.md` is a restricted Supaplate license; record a release review requirement without changing or interpreting the contract as a granted license.
- This is the R5 content/compiler unit, not all R5. Authenticated atomic/idempotent cross-organization import, persisted output-profile editing, three-user/customer delivery acceptance, R2 display units, and production DWG remain open. Never claim catalog content alone completes them.

## Interfaces

Task 1 owns `drawing-native-symbols.ts` and `drawing-native-assets.ts`.

```ts
type NativeAssetProvenance = {
  author: "1HK"; sourcePath: string; attribution: string;
  license: "NOASSERTION"; origin: "first-party-generated";
};
type NativeDrawingSymbol = {
  schemaVersion: "1hk-native-symbol/1"; key: string; version: 1;
  name: string; description: string; units: "mm";
  classification: "door" | "window" | "wall" | "furniture";
  recommendedLayer: string;
  insertionPoint: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
  primitives: DrawingBlockPrimitive[]; provenance: NativeAssetProvenance;
};
function listNativeDrawingSymbols(): NativeDrawingSymbol[]; // independent copies
function getNativeDrawingSymbol(key: string): NativeDrawingSymbol; // unknown => error
function nativeAssetCanonicalJson(value: unknown): string; // plain finite JSON only, sorted object keys, original array order
function nativeAssetSha256(value: unknown): Promise<string>;
```

Task 2 owns `drawing-native-templates.ts` and consumes the above exact exports.

```ts
type NativeDrawingTemplateKey = "measured-plan" | "office-layout" | "remodel-phases" | "finishes-takeoff";
type NativeDrawingTemplate = {
  schemaVersion: "1hk-native-template/1"; key: NativeDrawingTemplateKey;
  version: 1; name: string; description: string; units: "mm";
  provenance: NativeAssetProvenance;
  outputProfile: { paper: "A3"; orientation: "landscape";
    widthMillimeters: 420; heightMillimeters: 297; scaleDenominator: 50 };
  structure: DrawingStructureState;
};
function listNativeDrawingTemplateKeys(): NativeDrawingTemplateKey[];
function buildNativeDrawingTemplate(key: NativeDrawingTemplateKey): NativeDrawingTemplate;
```

Definitions use stable versioned UUIDs, never tenant IDs. Each return is independent; consumers may not accidentally mutate released content. Model canvas is 21000 × 14850 mm (A3 landscape at 1:50), all examples fit it with sheet margins; graph IDs are unique and correctly linked. This compiler is not a tenant clone API.

### Task 1: Original dimensioned symbols and canonical asset identity

**Files:** Create `platform/app/lukas/lib/drawing-native-assets.ts`, `drawing-native-symbols.ts`; test `platform/tests/drawing-native-symbols.test.mjs`.

**Consumes:** `DrawingBlockPrimitiveSchema`, `PointSchema`, `BoundsSchema`, existing `geometryBounds` where useful.
**Produces:** Exact Task 1 interfaces above. Export a strict symbol schema for validation.

- [x] Write failing behavioral tests: 900 mm single-door opening with jamb/leaf/swing representation, 1200 mm window frame/panes, a 1200×600 desk; 24 distinct keys, four classifications, no unknown fields/nonfinite geometry/duplicate local IDs/dangling style IDs; insert point inside bounds; reject incorrect declared extents and empty/zero-sized assets; fresh return survives caller mutation. Actual schema validation, not source grep.
- [x] Run `node --test tests/drawing-native-symbols.test.mjs`, record expected RED.
- [x] Implement 24 original schematic definitions: doors 800/900/1000 single, 1600 double, 1800 sliding; windows 600/900/1200/1500/1800; wall segments 100/150/200 thick (1000 long), 100 mm L partition; furniture desk 1200×600 and 1600×800, chair, 4-seat and 6-seat meeting table, two-seat and three-seat sofa, cabinet, single bed, double bed. Labels must describe actual dimensions and distinguish schematic symbols from host-connected semantic openings.
- [x] Reuse native lines/polylines/rectangles/circles with full inline styles and null style IDs. Swing curves may be explicitly sampled polylines; exact endpoint/extents and documented schematic nature matter, not unsupported arc primitives. Bound validation uses geometric extents, not stroke overshoot.
- [x] Canonical JSON rejects cycles, unsupported values, NaN/Infinity, sparse arrays, getters/nonplain objects rather than silently dropping data. Native SHA-256 uses Web Crypto and known independent test vectors; keys sorted, array order preserved.
- [x] Run focused tests GREEN, self-review, write report with RED/GREEN and task-only changed files. Do not commit.

### Task 2: Four practical editable native templates

**Files:** Create `platform/app/lukas/lib/drawing-native-templates.ts`; test `platform/tests/drawing-native-templates.test.mjs`.

**Consumes:** Task 1 exact interfaces, existing native geometry/property/table schemas, `validateDrawingStructureState`, measurements and `collectExportPrimitives` in tests.
**Produces:** Task 2 exact interfaces above, all native relationships intact.

- [x] Write failing tests for concrete semantics: measured plan contains a 6000×4000 mm room (24 m²) with dimension; office includes four desk instances and a meeting table; remodel has separate existing/demolition/new layers with distinct old/new walls; finishes has a 24 m² source area connected to an example quantity/schedule row. Every template includes actual layers, styles, dimension objects, at least one block instance, object-linked example quantity/property/table data, mm units and A3 1:50 output profile.
- [x] Run `node --test tests/drawing-native-templates.test.mjs` and record RED. Preparation can run parallel with Task 1, GREEN after Task 1 settles.
- [x] Build native graphs directly with stable UUIDs. Host-connected openings use real same-graph wall IDs; door/window symbols remain reusable schematic blocks. Use assumptions label `예제·가정값 — 현장 확인 필요`, no fabricated source/approval/price. No numeric example is labeled measured or final.
- [x] Reuse one small graph builder for actual repeated native construction only; no generalized asset engine or clone authority. Validate every graph, per-entity schema and reference integrity. Validate claimed hand-derived lengths/areas/counts with real measurement code in tests.
- [x] Prove caller mutation cannot affect future calls; unknown keys fail closed; semantic host relationship, styles, property schemas, table row targets and primitive types reach existing renderer. Do not write tests merely comparing an implementation to itself.
- [x] Run focused GREEN and report with exact tests, limitations and files. Do not modify Task 1 files without controller coordination; no commit.

### Task 3: Real export validation and content release evidence

**Files:** Create `platform/scripts/verify-native-drawing-content.mjs`, `platform/tests/drawing-native-content-export.test.mjs`; create shared evidence `docs/superpowers/evidence/2026-09-05-native-drawing-content-pack.md`. Root owns these integration files.

**Consumes:** Task 1+2 interfaces and existing `exportDrawingSvg`, native command/state creation and measurements.
**Produces:** A runnable local evidence tool with manifest hashes, 24 symbol previews and 4 template SVGs; explicit example/licensing/DWG qualification status.

- [x] Write RED test invoking the executable in a fresh temporary directory: all expected native assets export, source definitions unchanged, SVG root is 420mm×297mm with native 21000×14850 viewBox; template scale is 1:50. Existing destination or unsafe output names are rejected without overwriting files. Test actual output parsing, not exact source strings.
- [x] Implement a small exporter that calls the existing SVG renderer for geometry, adjusts only SVG root physical sheet dimensions using a verified anchored root match (does not transform native coordinates), and emits manifest with schema version, exact asset hashes, first-party provenance, dimensions and explicit non-production status. Do not duplicate renderer code or run a server.
- [x] Inspect the four actual SVG outputs in a real browser at a readable size, check text/geometry margins and content. Correct clipping/illegible authored layout. These are diagrams, not copied images.
- [x] Run focused native suites plus existing block, structure, export, measurement and old starter suites; run app typecheck. Full browser/DB M1 suite only if integration touches production paths; this pure pack changes none.
- [x] Independent task and final review; fix Critical/Important issues, write evidence with exact commands/results, link remaining UI/DB/units/DWG/customer gates. Retain task-only diff evidence because no commits are permitted; do not delete unrelated plan workspaces.

## Acceptance boundary

This plan passes when real reusable native content and exports validate and review clean. It does not advertise new creation/import controls, alter operating DB state, or satisfy full goal by itself. The next unit consumes these definitions in a separately authorized, atomic immutable import/catalog flow and persists output profiles. Publishing/contract checks and real recipient acceptance remain mandatory.

### Task 4: Shared native annotation context, rendering and selection

**Why added:** Task 2 review and actual Task 3 screenshots found every native dimension rendered as a 12-unit `미보정` label, and semantic annotation styles ignored. This prevents the planned readable 1:50 outputs. Resolve the existing shared root cause, not template-specific fake calibration or output-only labels. This is within approved R2/R5 native-world-unit requirements; no stored geometry or authority change.

**Files:** Modify `platform/app/lukas/lib/drawing-layout.ts`, `drawing-blocks.ts`, `drawing-geometry.ts`, `drawing-export.ts`, `drawing-document-store.ts` only if its cached projection consumes the changed context; components `drawing-canvas.client.tsx`, `drawing-workspace.tsx`, `shared-drawing-viewer.client.tsx`. Test `platform/tests/drawing-native-annotations.test.mjs` (new), and narrowly extend existing `drawing-workspace-blocks.test.mjs`, `drawing-workspace-export.test.mjs` where their real integration contract changes. Root owns native content export test/runner and full M1 test fixture. No other source edits without coordination; preserve file-baseline dirty contents.

**Consumes:** Canonical `DrawingCanvas.background` and existing true PDF calibration, resolved native styles; existing shared render projection and native structure.

**Produces:** Explicit native vs PDF dimension context shared by live drawing, SVG/PNG and selection bounds. Keep old bare calibration callers working with legacy conservative semantics; add context-aware functions/types at the shared layout seam. No DB/snapshot schema or stored calibration ID changes.

```ts
type DrawingDimensionContext =
  | { kind: "native_millimeters" }
  | { kind: "pdf"; calibration: DrawingDimensionCalibration | null };
// Existing bare-calibration second argument remains accepted for compatibility.
// Third resolved-font argument defaults to the legacy 12-unit size.
drawingDimensionLayout(geometry, contextOrLegacyCalibration?, fontSize?);
drawingDimensionBoundsPoints(geometry, contextOrLegacyCalibration?, fontSize?);
// Layout includes a warning boolean/state; color consumers use it, not null ID.
```

- [x] Write RED behavior tests: native null-ID 6000/4000 geometry -> `6000.0 mm`/`4000.0 mm`, no warning, 140-unit label; PDF null-ID remains warning `미보정`; missing/mismatched calibration remains unavailable; real matching page calibration still correct. Reject invalid font sizes/context data at the meaningful boundary. Missing canonical canvas context stays conservative, not automatically native.
- [x] Derive context only from the canonical active canvas. A missing/failed PDF raster may render with runtime `background.kind='blank'` but must stay PDF for dimension interpretation. Shared viewer's calibration identity is `canvas.pageId`, never its canvas UUID.
- [x] Thread resolved font and context through actual Canvas/SVG/PNG layout/color and through direct/transformed block render bounds, pointer/marquee selection and outline. Reuse existing unified render bounds; do not maintain a second approximate label box. Cache keys must invalidate when canonical canvas/background/calibration changes. Coordinate geometry and stored sources stay untouched.
- [x] Make semantic label layout honor resolved `style.fontSize` with default legacy metrics retained when absent; scale width/offset/line layout consistently and use the same layout in Canvas, SVG/PNG and broad render bounds. This preserves native template annotation readability without authoring duplicate static labels.
- [x] Test native and PDF output via existing SVG/PNG paths, 140-unit transformed block bounds and hit target, font/style invalidation, and unchanged legacy PDF tests. No fabricated source UUID/calibration, no weakening warning assertions. Existing missing-source/approval/quantity tests remain required.
- [x] Run focused tests, report RED/GREEN and changed paths. Root runs typecheck/build plus the full disposable M1 browser/DB regression after source settles, since production paths are now touched.
- [x] Independent shared-contract review and scoped fixes. Root re-generates all template/SVG evidence and checks actual numeric dimension text, 140-unit annotation, native model coordinates, phase-wall visibility and margins before accepting Tasks 2/3/4. R2 persisted display-unit editing and full R5/DWG remain open.
