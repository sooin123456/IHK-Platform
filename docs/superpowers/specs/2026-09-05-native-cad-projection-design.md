# Native CAD projection contract

2026-09-05. Architectural implementation step under the approved Universal Workspace / mandatory DWG delivery goal. The user has authorized continuing implementation without repeated design approvals.

## Outcome and boundary

Implement a deterministic, strict TypeScript projection from a canonical native drawing graph to a versioned CAD manifest. This is the first input to the real ACadSharp writer, not a new renderer or an export-completion claim. All four native templates and the 24 original block symbols must project without dropping geometry. Existing graphics, collaboration, approval and original definitions remain unchanged.

Alternatives considered: exporting SVG and converting it loses editable dimensions/blocks; feeding canonical semantic geometry directly to C# duplicates wall/opening/annotation rules; projecting with existing TypeScript helpers and writing native CAD entities keeps the authoritative geometry in one place. Choose the third.

This module is pure and has no public route, storage write, job authorization or approval decision. A graph hash proves content identity, not persistence, permission or approval. The subsequent trusted worker must load an immutable authorized snapshot itself, bind its database snapshot hash and lease, and reject unfinished or stale revisions. This step must not invent approved snapshot IDs for generated fixtures.

## Contract

`buildDrawingCadManifest(input: unknown): Promise<DrawingCadManifest>` accepts exactly `{ projectId, documentId, operationSequence, canvasId, structure, outputProfile }`. UUIDs and a nonnegative safe integer sequence are required; structure revision must agree throughout its graph. `outputProfile` is required and must satisfy the existing canvas/profile dimension contract, including a match with any persisted profile. Native version-1 template definitions lack the persisted profile; supplying their authored profile is explicit and must not mutate them.

`DrawingCadManifestSchema` parses strict finite JSON, with no unknown properties or dangling/duplicate IDs. `DrawingCadManifest` is its inferred type. Both producer and later writer use `schemaVersion: "1hk-native-cad/1"`, `qualification: "experimental-unqualified"`, `units: "mm"`, `coordinateSystem: "WCS_X_RIGHT_Y_UP"`, `targetVersion: "AC1024"`. Scope contains projectId, documentId, revisionId, operationSequence and **structureSha256**. Hash the exact validated source graph using the existing canonical JSON/SHA helper; do not call this the database snapshot hash.

Manifest fields are scope, canvas, layers, blocks, entities, lineage, metadata and policies. The canvas carries its ID/page ID/name, unchanged model width/height, physical paper profile, and a centered viewport: paper center `(paperWidth/2,paperHeight/2)`, view center `(modelWidth/2,-modelHeight/2)`, `viewHeight = modelHeight`, `scale = 1/scaleDenominator`. Map world coordinates `(x,y)` to `(x,-y)` once; do not rescale model coordinates. Block local points get the same reflection, insert rotation changes sign, signed scale factors remain unchanged.

Each CAD entity has a unique deterministic string `id`, nullable `layerId` (null only in block definitions), `style` (`{ kind: "resolved", ...resolvedCanonicalStyle, requestedPaperLineweightMillimeters }`, or `{ kind: "block-defined" }` only for INSERT), and a discriminated `geometry`. Canonical instances have no style of their own; INSERT uses its block primitive styles, without inventing a default stroke/lineweight:

- `line`: start/end.
- `polyline`: points/closed.
- `circle`: center/radius.
- `arc`: center/radius/startAngleDegrees/endAngleDegrees, counterclockwise CAD sweep; map reflected endpoints/direction without tessellating an arc.
- `text`: origin/text/width/fontSize/lineHeight, top-left, authored-newlines-only, rotationDegrees. Literal text, never executable MTEXT markup. The writer must escape it.
- `dimension`: start/end/dimensionLinePoint/textPosition/fontSize/precision (1)/suffix (` mm`)/measurementMillimeters. Emit a true aligned dimension downstream; the existing layout resolves placement and detects invalid calibration. Do not replace it with a group of lines and text.
- `hatch`: boundary/color/opacity; boundary is a closed simple point array or `{ type: "circle", center, radius }` for true circular fill. A separate polyline/CIRCLE outline retains its stroke. No circle tessellation or white-filled fake cut-outs.
- `insert`: blockId/origin/rotationDegrees/scaleX/scaleY; block definitions are ordinary editable CAD blocks, not exploded instances.

Use ASCII CAD-safe layer/block names derived from canonical UUIDs and keep the full original Unicode names in the manifest. A layer's visible/locked state is retained; hidden layers and entities are not omitted. Model entities preserve the existing combined object/instance layer-sort-order, ID and host-before-opening order, rather than placing all INSERTs on top. Reuse the canonical canvas item ordering with visibility overridden only on a copy for full data export; never change source layer visibility. Every selected-canvas object and block instance has one lineage entry `{ id, kind, name, version, entityIds }`; every emitted model entity maps to exactly one such entry. Blocks have their original ID/name/version and primitives' stable local identity. Preserve referenced definitions, and report unmapped/unsupported content instead of filtering it away.

## Geometry and style policy

- Reuse `resolveDrawingOpening`, `drawingOpeningMarkerSegments`, `drawingDimensionLayout`, `drawingDimensionContextForCanvas`, `drawingTextLayout`, `drawingSemanticLabelLayout`, `resolveDrawingStyle`, `validateDrawingStructureState` and the existing runtime schemas. Extract and reuse only the existing combined item ordering as `orderDrawingCanvasItems` from `drawing-blocks.ts`; keep live renderer visibility, bounds and hit testing unchanged. CAD ordering must not calculate repeated block rendering bounds. Do not call the screen export traversal because it hides layers and explodes blocks.
- Rectangle becomes a rotated closed polyline. Circle and arc remain true types. Spaces/areas retain boundary, fill and readable label. Grid geometry is not present in the four templates; reject it explicitly in this contract until its dashed linetype/bubble mapping is implemented.
- Walls become filled polygon strips with square outer end caps. Cut opening intervals using the shared resolved host endpoints, merging overlaps/touching intervals. Do not draw a full wall then hide it behind white paint. Opening markers have their own lineage. Fully opened walls have an explicit zero-entity lineage with `representation: "fully-opened-wall"`; reject zero mappings for all other authored objects.
- Existing opening marker widths and semantic fill/label metrics are reused. Convert requested stroke width from world mm to paper mm by the output scale; retain its exact request. ACadSharp's later nearest supported lineweight choice must be reported, not silently treated as exact. Alpha colors retain RGB and opacity.
- Text policy is `fontFile: "NotoSansKR-Regular.ttf"`, `fontStatus: "not-verified"`, `fontRedistributed: false`, authored newlines only and no implicit wrapping. This records the requested font, not its presence or a licensed bundle. The writer must preserve literal Korean, backslashes and braces, with no embedded fonts or arbitrary file reads.
- Plot policy is direct RGB/lineweights, `plotStyleFile: null`, not a claim of CTB/STB compatibility. Downstream generated dimension blocks need their actual child text style/font checked, not only their DIMSTYLE record.

## Metadata and unsupported cases

The graph remains the authority: metadata includes its selected-canvas canonical objects/block instances, referenced blocks/styles, property schemas/values/tables relevant to selected objects, and original source identities. Non-spatial tables have no authored CAD position; preserve them as structured sidecar metadata and explicitly mark `schedulePlacement: "not-authored"`. Do not invent a TABLE location or imply schedules are laid out for delivery. R5 must later add explicit placement/export settings.

Validate all known graph collections using existing strict schemas, collection key=ID, unique cross-collection identities and revision/reference checks before projection. Unknown extra graph fields, malformed Unicode/numbers, unresolved hosts, background PDF/raster, source-linked objects, unsupported grid, unconfirmed dimension calibration, invalid profile, unreferenced data that cannot be assigned to a selected canvas, or any unhandled geometry are actionable errors, not partial success. Native provenance comes from the graph; no fictitious original-file SHA/IFC identity. This initial contract supports one selected native canvas, and rejects additional canvases rather than omitting them.

Budget input collections/points/entities and canonical serialized bytes before expensive work; concrete ceilings are 10,000 objects+instances, 1,000 blocks, 100,000 aggregate primitive points and 20 MiB canonical input, including metadata. Filled polygon boundaries additionally stop at4,096 vertices to bound pairwise topology checks; larger filled boundaries fail explicitly, never truncate. Fail before array expansion exceeds those limits. These are bounded internal conversion limits, not performance/production qualification.

## Verification and remaining goal

Hand-derived tests cover all native templates/symbols, a 6,000 mm wall cut by a 900 mm opening centered at canonical offset2,750 mm (gap2,300..3,200 mm), literal Korean text, dimension 6,000.0 mm, layer hidden/locked, block translation/rotation/mirroring, arc reflection, rgba fill, paper420×297/scale1:50 with unchanged21000×14850 model, strict rejects and source graph immutability. The existing opening offset is its center, not its leading edge. Tests must not compute expected geometry using the converter under test.

Next units remain real ACadSharp write/re-read with complete type/handle/layout inventory; authorized idempotent worker jobs and snapshot receipts; existing DWG import/edit/re-save/preserved unsupported objects; independent licensed30-file recipient CAD corpus, fonts/Xref/CTB/STB and recipient acceptance; approved DWG+PDF+permitted dependency delivery. This contract alone closes none of those product release gates.
