# 1HK IfcPlusPlus derivative spike

Conservative native IFC-to-GLB experiment pinned to IfcPlusPlus commit
`7b80900197b1f17cdafe47e0548e8eec056a3c9c` (MIT). It produces a
self-contained GLB and a canonical backend manifest. The manifest is the
commit marker and is published only after the GLB.

The current spike intentionally supports only `IfcTriangulatedFaceSet` items
without object placement. Every represented product and every representation
item is enumerated. Any other geometry, property kind, invalid index, or
placement fails the entire conversion without a manifest. This is not yet a
general IFC production converter.

The build patch compiles only the parser/model and STEP value-serialization
translation units needed by this spike, removing the file writer, geometry
stack, `zip.c`, and the `zippy`/`nowide`
include and code path.
The CLI accepts plain IFC streams only. `license-sbom.mjs` derives its evidence
from the active CMake compile database and compiler dependency files and rejects
ZIP/nowide or unknown bundled dependencies.

## Reproducible macOS build

The evaluated tool was the official CMake 4.4.3 macOS universal archive. Its
official SHA-256 file records:

```
0c5d65251c14cc884bfa16bdbed3c263ce5bffe2e21c0d0d00962cb0610464fa  cmake-4.4.3-macos-universal.tar.gz
```

Keep the archive and extracted application in a task-local directory. Do not
install it or modify the global `PATH`.

```sh
CMAKE_BIN=/private/tmp/.../CMake.app/Contents/bin/cmake \
  CMAKE_ARCHIVE=/private/tmp/.../cmake-4.4.3-macos-universal.tar.gz \
  CMAKE_SHA256_FILE=/private/tmp/.../cmake-4.4.3-SHA-256.txt \
  IFCPP_BUILD_DIR=/private/tmp/1hk-ifcplusplus-build \
  ./build.sh

node ./license-sbom.mjs \
  /private/tmp/1hk-ifcplusplus-build/native \
  /private/tmp/1hk-ifcplusplus-build/vendor/ifcplusplus

IFCPP_DERIVATIVE_BIN=/private/tmp/1hk-ifcplusplus-build/native/ifcplusplus-derivative \
  GLTF_VALIDATOR_MODULE=/private/tmp/.../node_modules/gltf-validator/index.js \
  node --test ./tests/contract.test.mjs
```

The contract suite uses the official Khronos `gltf-validator` npm module pinned
to `2.0.0-dev.3.10` from a task-local `/private/tmp` install. It is a test-only
Apache-2.0 dependency and is not linked into the converter.

CLI:

```sh
ifcplusplus-derivative source.ifc manifest.json geometry.glb \
  --source-file-id FILE_ID --max-input-bytes 536870912 \
  --max-entities 2000000 --max-vertices 10000000 \
  --max-indices 30000000 --max-output-bytes 1000000000
```

The GLB is installed first and the manifest last. The manifest is therefore the
readiness/commit marker. This is not filesystem-transactional across both
files: a process or host crash may leave an unreferenced GLB, which must be
garbage-collected; it must never be treated as committed without its manifest.
