# Native CAD Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project all four canonical native templates and original symbols into a strict deterministic manifest suitable for a real native DWG writer.

**Architecture:** Reuse the existing TypeScript canonical schemas and semantic geometry resolvers, then emit editable CAD entity contracts with complete lineage and explicit paper/model coordinates. The pure module performs no approval, remote write or job authorization; the graph hash is not an approved snapshot receipt.

**Tech Stack:** Existing TypeScript, Zod, native Web Crypto, Node test runner; downstream pinned ACadSharp3.7.1/.NET8, no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-05-native-cad-projection-design.md`

## Global Constraints

- All four native templates and the 24 original block symbols must project without dropping geometry.
- Existing graphics, collaboration, approval and original definitions remain unchanged.
- A graph hash proves content identity, not persistence, permission or approval.
- Map world coordinates `(x,y)` to `(x,-y)` once; do not rescale model coordinates.
- Do not draw a full wall then hide it behind white paint.
- No public DWG button, paid contract, dependency installation, commit, push or operating deployment in this unit.
- Keep `qualification: "experimental-unqualified"`; this is not existing-DWG edit/re-save or recipient delivery qualification.
- Preserve all user-owned dirty files and private evidence.

---

### Task 1: Strict native graph → CAD manifest and semantic projection

**Files:**
- Create: `platform/app/lukas/lib/drawing-cad-manifest.ts` — versioned finite entity/output contract and strict runtime validation.
- Create: `platform/app/lukas/lib/drawing-cad-projection.ts` — canonical graph validation, semantic projection and deterministic source identity.
- Test: `platform/tests/drawing-cad-projection.test.mjs` — real native graphs and hand-derived edge cases.
- Create if needed: `platform/tests/fixtures/drawing-cad-fixtures.mjs` — test-only graph helpers/independent literal expectations.
- Modify narrowly: `platform/app/lukas/lib/drawing-blocks.ts` — extract only the existing combined item sort/host precedence into shared `orderDrawingCanvasItems`; keep rendering visibility/bounds/hit-test behavior unchanged. Run existing block tests for this extraction.
- Do not edit native content definitions or DB/approval modules.

**Interfaces:**
- Consumes: `DrawingStructureState`, existing `Drawing*Schema` schemas, `validateDrawingStructureState`, `resolveDrawingStyle`, `resolveDrawingOpening`, `drawingOpeningMarkerSegments`, `drawingDimensionLayout`, `drawingDimensionContextForCanvas`, `drawingTextLayout`, `drawingSemanticLabelLayout`, `nativeAssetCanonicalJson`, `nativeAssetSha256`.
- Produces: `buildDrawingCadManifest(input: unknown): Promise<DrawingCadManifest>` from projection module; `DrawingCadManifestSchema` and inferred `DrawingCadManifest` from manifest module. Input and all output fields/geometry policy are defined in the spec, which the implementer must read fully. Do not introduce a service interface/factory around one implementation.
- Shared ordering interface: `orderDrawingCanvasItems<T extends { id: string; layerId: string }>(items: readonly T[], layers: Record<string, { sortOrder?: number }>, hostId: (item: T) => string | null): T[]`. Existing `drawingCanvasRenderItems` passes its full render items and existing host lookup; CAD passes lightweight canonical object/instance items. Ordering requires no render bounds or repeated block expansion.

- [x] **Step 1: Write the first failing native projection test.** Import the new module namespace and assert the function exists, then exercise a real measured-plan graph with explicitly supplied author profile. Example test body (test-only fixture IDs use existing valid IDs and do not claim DB approval):

```js
const template = buildNativeDrawingTemplate("measured-plan");
const before = nativeAssetCanonicalJson(template.structure);
const result = await projection.buildDrawingCadManifest({
  projectId: "10000000-0000-4000-8000-000000000001",
  documentId: "10000000-0000-4000-8000-000000000002",
  operationSequence: 0,
  canvasId: Object.keys(template.structure.canvases)[0],
  structure: template.structure,
  outputProfile: template.outputProfile,
});
assert.equal(result.units, "mm");
assert.equal(result.qualification, "experimental-unqualified");
assert.equal(result.canvas.modelWidthMillimeters, 21000);
assert.equal(result.canvas.modelHeightMillimeters, 14850);
assert.equal(result.canvas.outputProfile.scaleDenominator, 50);
assert.deepEqual(result.canvas.viewport.viewCenter, { x: 10500, y: -7425 });
assert.equal(nativeAssetCanonicalJson(template.structure), before);
```

- [x] **Step 2: Run RED.** `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-cad-projection.test.mjs` from platform. Record actual missing-feature failure in the task report; do not substitute a typo failure for behavior evidence.
- [x] **Step 3: Implement the strict manifest and graph projection.** Follow the spec's finite discriminated entities, scoped graph hash, single selected native canvas, complete source validation and explicit unsupported errors. Reuse shared helpers. The coordinate change is exactly:

```ts
const cadPoint = ({ x, y }: Point): Point => ({ x, y: y === 0 ? 0 : -y });
// Render and measure remain in world millimeters. No scale multiplication here.
```

Wall polygon projection is the only new semantic-output construction: use the existing opening resolver, merge canonical opening intervals, subtract them from the host span, then create closed polygon strips with half-thickness normals and square outer caps. Circle/arc/insert/dimension remain actual CAD entity contracts. Keep helper functions local unless a second real consumer needs them.

- [x] **Step 4: Extend RED→GREEN coverage with independent cases.** All four templates: exact object/instance lineage completeness, non-empty entities (except explicit fully-open wall), profile/model dimensions, relevant metadata and deterministic full JSON; all24symbol definitions in a test graph, ordinary block inserts. Add a hand-derived horizontal wall `(0,0)→(6000,0)`, thickness150, opening center offset2750 width900: no wall fill crosses x2300..3200 and thickness is y±75, outside caps x−75 and6075. Check mirrored block rotations/scales, reflected arc sweep, measured dimension6000.0mm, explicit text newlines and Unicode, hidden/locked layers, rgba fill. Reject unknown keys, duplicate/cross-scope IDs, out-of-scope host, source/background, additional canvas, invalid calibration/profile, unsupported grid, oversize input and dangling references. Do not derive expected positions with projection helpers.
- [x] **Step 5: Run focused GREEN and existing adjacent suites.** Run new test plus `drawing-native-templates.test.mjs`, `drawing-native-symbols.test.mjs`, `drawing-native-annotations.test.mjs`, `drawing-output-profile.test.mjs`, `drawing-workspace-p4-geometry.test.mjs`, `drawing-workspace-semantic-schedules.test.mjs`, `drawing-workspace-blocks.test.mjs`. Record counts and warnings verbatim; no full M1/build by a subagent.
- [x] **Step 6: Self-review and task review.** Generate a new-files plus exact dirty-baseline drawing-blocks diff; hand it, brief and report to an independent reviewer for both spec and quality. Resolve findings through tested fixes. Confirm native source hashes stayed unchanged. Controller runs `NODE_OPTIONS=--no-experimental-webstorage npm run test:e2e:drawing-workspace-m1:local` after source freeze; it builds/typeschecks app+collaboration and checks the shared renderer through actual browser regression. Controller final integration review covers this bounded unit; it is not a review/approval of the giant pre-existing dirty branch.
- [x] **Step 7: Publish bounded evidence.** Store hand-checkable four-template manifests with source hashes in a new evidence directory, mark this unit complete only after checks/review, and retain remaining DWG writer/worker/edit/re-save/delivery gates. Keep all private RED/GREEN logs; no commit or deployment.
