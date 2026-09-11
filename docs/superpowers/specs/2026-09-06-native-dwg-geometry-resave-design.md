# Native DWG geometry resave

Architectural continuation of the approved R4 goal. This necessary writer dependency does not replace authenticated approved-resave integration or independent recipient qualification.

## Decision

Extend the existing ACadSharp 3.7.1 selected-handle writer, not the source-free native-canvas writer. A fresh source read and an exact selected-edit request preserve the original DWG file; the existing CLI performs no-edit and edited read-back comparisons. Rebuilding only visible overlay entities would discard nonprojected contents, and adding a conversion engine now would introduce another fidelity and licensing boundary. Keep the pinned engine/dependencies unchanged and surface their limits.

At the start of this unit the compiler supported only LINE endpoints and TEXT value. Add explicit versioned five-type geometry edits. Keep old internal `1hk-dwg-edits/1` requests readable with their existing LINE/TEXT semantics, including nonplanar LINE edits. The updated compiler emits only `1hk-dwg-edits/2`. No production caller currently sends this compiler output to approved native-canvas export jobs; do not silently redirect those jobs or weaken source-free gates.

## Exact v2 wire contract

Root exact keys: `schemaVersion:"1hk-dwg-edits/2"`, `sourceSha256:<64 lowercase hex>`, `coordinateSystem:"WCS_NATIVE_UNITS"`, `edits`.

All edit records have canonical uppercase nonzero hex `handle` (1–16 digits), exact `type`, and exactly these remaining fields:

| Type | Fields |
| --- | --- |
| LINE | `start:[x,y,0]`, `end:[x,y,0]` |
| LWPOLYLINE | `points:[[x,y,0],...]`, `closed:boolean` |
| CIRCLE | `center:[x,y,0]`, `radius:number` |
| ARC | `center:[x,y,0]`, `radius:number`, `startAngleRadians:number`, `endAngleRadians:number` |
| TEXT | `insert:[x,y,0]`, `height:number`, `text:string` |

Strict UTF-8/Unicode, no duplicate/unknown/missing fields. Request ≤2 MiB, 1–10,000 distinct edit handles. Finite native numbers have absolute value ≤999,999,999,999; sizes >0. LINE endpoints differ. Polyline ≥2 points, at least two distinct points, ≤100,000 aggregate points across edited polylines. ARC raw angle difference is nonzero and absolute difference ≤2π; wrapped native pairs are valid and 0→2π must not collapse. TEXT nonempty, ≤10,000 UTF-16 units, no controls/U+2028/U+2029 or CAD %%/%< expressions. No Xrefs are followed.

## TypeScript compilation

Keep `buildNativeDrawingDwgSelectedEdits({importInput,objects})` and result `{request,qualification:"experimental-unqualified",persistenceAuthority:"not-issued"}`. Derive baseline/bindings from the existing strict native report projector. Require the complete same object set, stable names/layers/style references/kinds, nondecreasing versions, and strict object schema. No browser report grants authorization.

Convert changed millimeter geometry to native units using the frozen projection selection. Retain exact raw native values for unchanged point/radius/height fields; for polyline vertices compare each indexed projected point before replacing it. If both ARC start and sweep are unchanged, retain the original raw angle pair, including wraps/full turns; otherwise convert the current positive sweep (0<degrees≤360) without modulo-normalizing its end. Negative edited sweeps fail explicitly rather than changing orientation silently. No-op returns null, edits sort by numeric handle. Reject output geometry outside the existing ±9e9mm projected extent.

Final numerical clarification: if start-plus-sweep rounding produces a difference above the strict one-turn bound, lower only the computed end by its immediate representable predecessor. Require the result to remain positive, ≤2π and within the existing 1e-9 numeric tolerance of the requested sweep; otherwise reject. Never alter unchanged raw source pairs or widen the native loader/reader contract. Validate final native edits through a private prospective invocation of the actual projector with the frozen units, including its fresh TEXT width/height rules. Discard that internal preview; it is not a reader report, source evidence or authorization.

TEXT permits origin, content and style.fontSize edits (height); width remains a display estimate and cannot be edited through this protocol. Other style keys remain immutable. Use raw text height/origin when unchanged. New/deleted objects, metadata/style changes, rotated/formatted text and unsupported geometry remain explicit errors, not silently omitted work. These are remaining R4 requirements where broader behavior is needed.

## Engine application and preservation

V2 reuses the actual `NativeDwgReader.TryGeometry` eligibility rule (minimal internal visibility change), so only supported planar/default-normal/zero-thickness types can be targeted. Validate source SHA, model-space target membership, exact runtime type (ARC is not CIRCLE), all payloads and every target before mutating any entity. Keep the existing entity/handle/owner/layer and non-target fields. Update embedded polyline vertices and closed flag without losing PLINEGEN. Apply TEXT insert/height/value without altering style/alignment/normal.

In addition to the request-point budget, v2 checks the resulting document's global 100,000-vertex reader budget before mutation: include every untouched `IPolyline` in model/block/paper space and substitute prospective point counts for edited lightweight polylines. A request within its own budget must not create output the actual reader rejects because of retained vertices. The compiler cannot infer unprojected vertex counts from coverage summaries; this check belongs in the actual engine document boundary.

Use strict parser settings (`Failsafe=false`, retain unknown graphical and non-graphical objects) for qualification reads. ACadSharp's retained unknown objects lack writable payload; v2 must reject any such object before output DWGs are produced. Do not claim unknown/proxy preservation. Known unedited content is retained and compared to the extent inventoried; comparison gaps remain disclosed. Input and working-copy bytes are unchanged, existing output paths are never overwritten.

Review clarification: rejection must include the complete retained document registry and extension dictionaries, including those attached to ordinary entities, tables or blocks. The pinned engine has no public registry enumeration; one exact .NET8 `UnsafeAccessor` to its verified private registry is permitted, with fail-closed behavior if that pinned contract is unavailable. Do not replace complete coverage with an unbounded handle scan or a partial hand-maintained ownership list. This is an explicit engine-version dependency, not a generic abstraction.

Review also exposed that the pinned writer drops nonzero lightweight-polyline vertex identifiers. Retaining them only inside `Apply` is not file preservation. V2 must reject retained nonzero vertex IDs, including untouched content, before mutation/output until a preserving writer is qualified. For eligible zero-ID polylines, retain existing vertex instances/metadata by index where correspondence exists; additional vertices use defaults and removed vertices are the explicit geometry edit. Keep v1 behavior unchanged. This temporary eligibility gate does not waive full R4 fidelity requirements or qualify customer delivery.

## Verification

Test-first compiler cases for all five types, native-unit conversion, raw precision retention, no-op/ordering, wraps/full turns, text move/height, v2 limits, metadata rejection and atomic failure. C# self-tests execute actual writer/readback and preserve v1 coverage. Include unknown/proxy rejection, unsupported target/late invalid target, PLINEGEN, non-target block/entity preservation and strict payload failures.

One cross-runtime test must generate a real native fixture, read it with the actual CLI, project and edit using actual app commands, compile the exact request, run the actual selected writer, reread output and assert hand-derived edited values, retained non-target inventory and original SHA. Exercise at least a normal and wrapped/full-turn arc case, not merely request serialization. No fake writer or fake DWG header is evidence. Use an explicit installed .NET prerequisite and unique disposable output; unavailable prerequisites fail rather than skip the acceptance check.

All results remain experimental: same-engine synthetic roundtrip is not Auth/Storage/worker browser integration, an OS write sandbox, a customer-file corpus, independent CAD acceptance, or production delivery. Full goal remains active. Follow-on dependencies: approved snapshot/source binding and resave-job authority, isolated writer execution and downloadable artifact receipts, authentic browser persistence/approval flows, unknown-object engine strategy, recipient/corpus validation, R5 packages.

## Sources checked

- Installed ACadSharp 3.7.1 XML/API and lockfile; [pinned release](https://github.com/DomCR/ACadSharp/releases/tag/v3.7.1).
- [Pinned Arc implementation](https://github.com/DomCR/ACadSharp/blob/v3.7.1/src/ACadSharp/Entities/Arc.cs): raw angle setters; full-turn/wrap handling must be tested rather than normalized away.

No license purchase, dependency upgrade, commit, deployment, remote database or customer-file mutation is authorized by this unit.
