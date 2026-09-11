# Native DWG import projection

## Intent and scope

Continue R4 with a real DWG-byte reader and an application-side projection into existing drawing objects. This is an architectural interface, not a replacement CAD application. The user authorized continuous development without repeated approval gates. Existing dirty worktree changes remain; no commit, deployment, paid engine, remote DB mutation or source overwrite is authorized by this unit.

The selected approach reuses pinned ACadSharp 3.7.1 and the current Node native-process boundary. Converting to DXF and calling the DXF importer would bind derivative bytes rather than native DWG identity. A new generic conversion service would add infrastructure before its concrete import contract exists. Neither alternative is selected.

## Deliverable

An actual native DWG is read without writing it. A strict report contains native model-space geometry, layers, stable native handles, declared units, complete category counts and bounded unsupported examples. Node validates the report against independently supplied original byte identity and maps supported geometry to existing `DrawingObjectSchema` objects with deterministic identities. Each object retains a separate native binding (source SHA, original handle, owner and native geometry). It is not mislabeled `dxf_entity`.

This unit does not issue canonical source attestations or enable a public route. Its output explicitly says `persistenceAuthority: "not-issued"`; it must not contain operations that a caller could accidentally persist without native authority. Browser application and DB-attested history are the next dependent unit, not completed by this projection. Native resave/delivery remains unqualified.

The existing subprocess limits are not an OS security sandbox. Do not expose arbitrary customer DWG parsing through a public route until the import worker has filesystem/network confinement and CPU/memory limits. Here, native code uses only supplied bytes and prohibits resource resolution, but no claim of enforced OS-level isolation is made.

## Native reader contract

CLI: `read-native --input <source.dwg> --output-dir <fresh-directory>`. Only `native-import.json` is produced, exclusively; input stays outside output, existing directories/links are rejected using existing path guards. Read at most 200 MiB from one read-only stream, validate six ASCII `ACdddd` bytes, hash the exact bytes parsed, and recheck the input afterward. No writer, Xref/font/image loading, network calls or embedded path traversal. Reject external references rather than resolving them.

Set ACadSharp `Failsafe=false`, `KeepUnknownEntities=true` and `KeepUnknownNonGraphicalObjects=true` explicitly: its defaults can continue after a parse failure or omit unsupported records. Count materialized unknown graphical entities as unsupported; do not claim a byte-complete native inventory or that an engine writer preserves unknown/proxy data. Original bytes remain the recovery source and native delivery qualification stays open.

Report (camelCase JSON):

```json
{
  "schemaVersion": "1hk-dwg-import/1",
  "qualification": "experimental-unqualified",
  "source": {"sha256": "64 lowercase hex", "byteSize": 1, "headerVersion": "AC1024"},
  "engine": {"name": "ACadSharp", "version": "3.7.1"},
  "coordinateSystem": "WCS_NATIVE_UNITS",
  "unitCode": 4,
  "modelSpaceHandle": "1F",
  "layers": [{"handle":"10","name":"0","visible":true,"locked":false}],
  "entities": [],
  "coverage": {"modelSpaceEntities":0,"importedEntities":0,"unsupportedEntities":0,"nonModelSpaceEntities":0},
  "unsupported": [],
  "readerNotificationCount": 0
}
```

Every entity is `{handle, ownerHandle, layerHandle, type, geometry}`. Handles are canonical nonzero uppercase uint64 hex (1–16 characters, no leading zero), unique across entity records; owner must equal modelSpaceHandle; layer must exist. Geometry stays in original units and WCS, not screen pixels:

- LINE: `{start:[x,y,z], end:[x,y,z]}`.
- LWPOLYLINE: `{points:[[x,y,z],...], closed:boolean}` (straight, zero-width, default normal, no bulge).
- CIRCLE: `{center:[x,y,z], radius:number}`.
- ARC: `{center:[x,y,z], radius:number, startAngleRadians:number, endAngleRadians:number}` (counterclockwise).
- TEXT: `{insert:[x,y,z], height:number, text:string}` (plain, unrotated, default alignment/normal, width factor 1, no oblique/mirror/thickness).

Unsupported model entities are counted by `{type, reason, count, sampleHandles}`. Reasons: `unsupported_type`, `unsupported_geometry`, `unsupported_text`; at most 100 groups and 10 sample handles per group. Unknown type strings must be bounded safe identifiers. Full count remains exact; if a hard count bound cannot be met reject the entire report. Non-model-space entities are counted separately, not flattened into model space. Reject zero/duplicate identity, inconsistent owners, malformed numeric/text identity, more than 10000 total entities (all block records), 1000 layers or 100000 total vertices. Coordinates must be finite and absolute <=999999999999. Supported shapes must be planar Z=0, default +Z normal and zero thickness. Empty/zero-length shapes are unsupported, never fabricated. Invalid source/engine failure must not leave a success report. Raw engine notification strings and local paths never leave the report; only their count does.

## Application projection

`projectNativeDrawingDwgImport({report, expectedSource, revisionId, canvasId, sourceFileId, unitOverride?})` validates exact report keys, every identity/count/reference and byte hash/size/header against `expectedSource` before object construction. Unit codes 1/2/4/5/6 map to in/ft/mm/cm/m and 25.4/304.8/1/10/1000 mm per native unit. Unknown/unitless inputs require explicit supported override; do not guess. A supported declared unit cannot be silently overridden to another unit.

Produce deterministic request/layer/object/binding IDs using a domain-separated SHA of source identity, revision, canvas and resolved units; repeated calls must agree and different sources/targets must not collide. Retain exact unscaled native geometry in bindings. Existing geometry is millimeters; cap absolute resulting coordinates at 9e9 mm, normalize to six decimals, preserve native Y-up convention used by existing DXF projection, and report display approximations. Text box width is a declared estimate `max(height, scalarCount * height * 0.6)`, no font file is opened. Existing defaults provide stroke/fill; warn that line styles/fonts/plot appearance are not reproduced. Use real `DrawingObjectSchema`, `DrawingStructureLayerSchema` and existing `geometryBounds`, not a parallel editor model.

The `source` result is the validated `{sha256,byteSize,headerVersion}`. `units` is `{code,label,millimetersPerUnit,source:"declared"|"user_selected"}`. Warnings are stable `{code,detail}` records.

`runNativeDrawingDwgReader({dotnetPath,publishedDirectory,sourceBytes,expectedSource,expectedWriterBuildSha256,signal?})` uses the existing process and published-build verification functions. Verify source identity before spawning, run with isolated fresh temporary paths, no shell and no inherited credentials, 120s deadline and 64KiB combined output cap. Accept only the single bounded regular report file (32MiB), check source working copy and published build again, clean only the validated created temp directory, and return the strictly validated native report. Abort, mutated bytes/build, malformed/oversized output, links or unexpected files reject.

## Selected-edit bridge

`buildNativeDrawingDwgSelectedEdits({importInput,objects})` recomputes the baseline with the real projector; it never trusts caller-provided bindings. Validate edited objects with the existing schema. Require the exact baseline ID set, no duplicate/new/missing objects, and unchanged names/layers/styles/kinds. Version can only remain equal or increase and is not written to DWG. Object order may change. Only LINE endpoints and TEXT content may differ; other geometry changes, text insertion/width changes, deletion/new objects and any unsupported change fail the entire batch. TEXT changes must satisfy the existing selected-DWG plain-text limits (10000 UTF-16 units, valid Unicode, no controls/line separators/CAD fields).

Return `{request,qualification:"experimental-unqualified",persistenceAuthority:"not-issued"}`. A no-op has `request:null`; otherwise request exactly matches existing `1hk-dwg-edits/1` with original source SHA, `WCS_NATIVE_UNITS`, original handles and only changed LINE/TEXT fields. Convert changed coordinates from mm back to original units, retain exact raw native triples for unchanged endpoints (do not rewrite them from rounded display coordinates), reject nonfinite/out-of-native-bound/zero-length results, and order edits by native handle. This compiles a proposed internal edit, not approved operation authority. The real evidence path reads a DWG, edits projected LINE/TEXT objects, compiles the request, invokes the existing selected-handle copy/resave CLI and verifies the reread plus original SHA. It must retain the CLI's inventory-gap/unqualified labels.

Match the existing selected-edit reader's 1–10000 edits and 2MiB UTF-8 request limit before returning a request (`JSON.stringify` compact bytes). A transport that reformats JSON must enforce the byte cap again on its exact submitted bytes.

## Verification and boundary

TDD: actual generated DWG readback with manually checked LINE/TEXT and other supported primitives; malformed/header-only source, existing-output refusal, SHA preservation, unsupported block content, nonplanar/bulge/text handling. Application tests validate literal projected coordinates/IDs consistency/native handles, unit override/error behavior, count/identity tampering and source drift. Run actual .NET command through the Node reader and feed it into the real application projector. Run current native writer and selected-edit self-tests and focused Node native-export regressions. Tests are synthetic same-engine evidence, not independent customer CAD qualification.

Next: service-issued `dwg_entity` source authority and import job receipt, canonical operation/history/checkpoint support, existing outbox/UI integration, then source-preserving approved edit/resave. Do not loosen source-free export eligibility or DXF attestation to implement this unit.
