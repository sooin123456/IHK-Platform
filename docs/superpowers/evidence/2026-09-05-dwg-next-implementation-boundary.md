# DWG next implementation boundary

Read-only code assessment,2026-09-05. This records the next engineering direction under the existing full R4 goal; no DWG product completion or release qualification is claimed.

## Current authoritative state

`tools/dwg-engine-qualification` is an isolated .NET8 experiment pinned to ACadSharp3.7.1. Its latest retained synthetic report (`artifacts/run-attribute-gap-final/qualification-report.json`) says `passed-with-inventory-gaps`, `productionDwgDeliveryQualification:not-qualified` and `independentCadVerification:not-performed`. It covers a same-engine generated9-entity fixture and declared line/text edits; viewport inventory and reader style warnings remain. It is not an application worker or a validated customer-DWG editor.

The application still stores DWG as `other` and does not import it as DXF (`platform/app/lukas/lib/drawing-entry.ts`). The existing PDF/PNG/SVG export artifact RPC does not accept `drawing_dwg`; adding a button or renaming an output is not an implementation. The immutable-snapshot/export authority and IFC worker's claim/hash/bounded-temp/timeout/publish/complete pattern are reusable references, not already completed DWG plumbing.

## Next real path

Build a canonical saved/approved drawing → strict CAD-job manifest → ACadSharp native writer → re-read/semantic report path for blank/native-template drawings. Then integrate its authorized idempotent jobs and output receipts. This is a necessary generation leg, not a substitute for subsequently importing/editing/preserving existing DWG documents.

The4 native examples contain walls, hosted openings, spaces/areas, text/dimensions and block instances. They cannot be supported by a primitive-only writer that silently skips the rest. Reuse the existing semantic geometry resolver on the TypeScript side and preserve canonical object→one/many CAD handle lineage. C# should not independently reimplement architectural geometry rules.

The manifest needs exact project/workspace/revision/version/checkpoint hash, source identities, mm units, canvases/output profiles, layers/styles, objects and blocks/instances. Unknown fields/types, unresolved semantics, missing style/font/plot policy or unfinished local changes must not silently become a deliverable.

Required mapping and proof include:

- LINE, LWPOLYLINE, rectangle-as-closed-polyline, circle and arc; wall cuts/opening geometry and area/space representation.
- Real text/MTEXT and dimensions with style, width, alignment, precision and rotation; explicit Korean font policy.
- Layer visibility/lock, RGB/lineweight/fill; ordinary blocks and transforms; properties and schedule representation with lineage.
- Model space plus A3 paper layout/1:50 viewport, correct units and print configuration; editable output settings must not rescale model geometry to fake printing.
- All4 native snapshots as independent golden fixtures; unsupported-case rejection, complete object coverage, write/re-read entity/layer/block/layout/coordinate comparison, idempotent scope/hash/permission tests and failure cleanup.

Worker authority/CPU-memory-time limits, no unsolicited external URL/path/Xref reads, explicit dependency manifests and source byte preservation remain required before processing uploaded customer files. Public product access must distinguish experimental/unsupported outputs from qualified delivery.

## Release gates retained

Existing DWG edit/re-save, no-edit writer round trips, licensed30-file corpus, independent AutoCAD or named recipient CAD open/save/print checks, fonts/SHX/Xrefs, preserved unsupported objects and actual recipient acceptance remain mandatory. Neither internal round-trip success nor the4 native templates closes those gates.

Pinned-engine/license source references: [ACadSharp3.7.1 package](https://www.nuget.org/packages/ACadSharp/3.7.1), [tagged MIT license](https://github.com/DomCR/ACadSharp/blob/v3.7.1/LICENSE). These establish package provenance, not delivery fidelity or the main application's license.
