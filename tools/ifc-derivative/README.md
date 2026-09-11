# IFC derivative generator

This isolated native tool converts IFC bytes into the two immutable artifacts
accepted by the 1HK Drawing Workspace:

- a canonical semantic manifest matching `IfcDerivativeManifestSchema`
- a self-contained GLB with an embedded BIN chunk

It uses [`oxideav-ifc`](https://github.com/OxideAV/oxideav-ifc) at Git commit
`b6dce78735558c631950fc6a700440855ceb9953`. The dependency is pinned in both
`Cargo.toml` and `Cargo.lock`, with default registry features disabled.

## Use

Rust 1.80.1 or newer is required. Running the contract tests also requires
Node.js for the manifest's cross-runtime canonicalization check.

```sh
cargo run --release -- \
  source.ifc manifest.json geometry.glb \
  --source-file-id 20000000-0000-4000-8000-000000000003
```

The source is read only. Both complete artifacts are built and size-checked in
memory before publication. Existing targets are never overwritten. A normal
publication failure rolls back a newly linked first target, so a failed fresh
run leaves neither target behind.

The manifest contains only `elements`, `geometry`, `schemaVersion`, and
`source`. JSON object keys are recursively sorted, UTF-8 is compact, and no
newline is appended. Numeric tokens use ECMAScript-compatible formatting
(`ryu-js` for floating point), so the server's parse plus `JSON.stringify`
canonicalization is byte-for-byte stable across fixed/scientific notation
boundaries. Each meshed IFC product has one stable `ifc-<expressId>` GLB node
and one manifest primitive claim.

The GLB stores positions as `FLOAT VEC3`, indices as unsigned 32-bit scalars,
and no external URI. Solid geometry uses glTF triangles. An exact mapped
`FootPrint` → `GeometricSet` → `IfcPolyline` shape uses glTF lines so authored
window footprints are retained. Node extras contain exactly `ifcExpressId`
and `ifcNodeId`; the node matrix preserves the IFC placement.

## Coordinate and failure policy

Geometry and placement translations are converted from the project's declared
IFC length unit to metres. An IFC containing `IfcProject` but no resolvable
length unit fails closed. The small handwritten legacy fixture has no project
context and is treated as metres; the millimetre fixture protects the real
unit-conversion path.

Malformed STEP, dangling references, invalid or duplicate GlobalIds,
non-finite/f32-overflowing geometry, invalid placement, unsafe JSON integers,
and unsupported represented geometry fail the whole derivative. Products
without authored representations are omitted because the platform element
contract requires a mesh claim.

Default limits are 256 MiB input, 8 million STEP instances, nesting depth 64,
16 MiB per decoded string, 10 million vertices, 60 million indices, 32 MiB
manifest output, and 200 MiB GLB output. All size arithmetic rejects overflow.
The production worker rejects source files above its stricter 200 MiB ingress
limit before invoking this standalone parser.

At the pinned commit the engine covers tessellated and polygonal face sets,
faceted Breps, common swept solids/profiles, mapped items, several boolean and
CSG forms, swept disks, sectioned solids, and the exact mapped polyline
footprint case above. Other unsupported represented geometry is reported
instead of silently publishing incomplete output.

## Verification

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

Generate locked dependency metadata and run the permissive-license allowlist:

```sh
cargo metadata --locked --format-version 1 > /tmp/ifc-derivative-metadata.json
node scripts/check-licenses.mjs /tmp/ifc-derivative-metadata.json
```

The checker follows enabled dependencies from Cargo's resolved root and accepts
only selectable branches composed of MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, and ISC. Missing metadata or a required term outside the
allowlist fails closed.

## WASM boundary

`cargo build --lib --release --target wasm32-unknown-unknown` works for the
pinned parser and geometry engine, but this crate intentionally exposes no
browser ABI. The production boundary is the native worker CLI; adding a second
runtime is deferred until an actual deployment need justifies it.
