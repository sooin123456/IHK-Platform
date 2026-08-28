# Third-party notices

The following packages were acquired with `npm`. No source code from these
packages has been modified or copied into this repository.

| Package              | Version | Upstream                                   | License    | Modified | Acquisition | Purpose                                       |
| -------------------- | ------- | ------------------------------------------ | ---------- | -------- | ----------- | --------------------------------------------- |
| Konva                | 10.3.1  | https://github.com/konvajs/konva           | MIT        | No       | npm         | Drawing canvas rendering                      |
| react-konva          | 19.2.5  | https://github.com/konvajs/react-konva     | MIT        | No       | npm         | React drawing canvas bindings                 |
| @electric-sql/pglite | 0.5.3   | https://github.com/electric-sql/pglite     | Apache-2.0 | No       | npm         | Database contract tests                       |
| pdf-lib              | 1.17.1  | https://github.com/Hopding/pdf-lib         | MIT        | No       | npm         | Drawing export                                |
| pdfjs-dist           | 6.2.108 | https://github.com/mozilla/pdf.js          | Apache-2.0 | No       | npm         | Immutable PDF background rendering            |
| three                | 0.185.1 | https://github.com/mrdoob/three.js         | MIT        | No       | npm         | IFC WebGL scene rendering                     |
| web-ifc              | 0.0.77  | https://github.com/ThatOpen/engine_web-ifc | MPL-2.0    | No       | npm         | IFC parsing at the package/runtime boundary   |
| fflate               | 0.8.3   | https://github.com/101arrowz/fflate        | MIT        | No       | npm         | Formula-free Verified BOQ XLSX ZIP generation |
| yjs                  | 13.6.32 | https://github.com/yjs/yjs                 | MIT        | No       | npm         | CRDT document and updates                     |
| y-indexeddb          | 9.0.12  | https://github.com/yjs/y-indexeddb         | MIT        | No       | npm         | Offline Yjs update persistence                |
| @hocuspocus/provider | 4.6.0   | https://github.com/ueberdosis/hocuspocus   | MIT        | No       | npm         | Browser collaboration provider and Awareness  |
| @hocuspocus/server   | 4.6.0   | https://github.com/ueberdosis/hocuspocus   | MIT        | No       | npm         | Node collaboration service runtime            |
| y-protocols          | 1.0.7   | https://github.com/yjs/y-protocols         | MIT        | No       | npm         | Awareness protocol types and helpers          |
| jose                 | 6.2.10  | https://github.com/panva/jose              | MIT        | No       | npm         | Supabase asymmetric JWT verification          |

## P7 Drawing dependency closure

This is the complete direct and transitive closure inspected by the P7 release
gate. Package paths distinguish independently installed versions.

| Package path | Version | License |
| --- | --- | --- |
| node_modules/@electric-sql/pglite | 0.5.3 | Apache-2.0 |
| node_modules/@hocuspocus/common | 4.6.0 | MIT |
| node_modules/@hocuspocus/provider | 4.6.0 | MIT |
| node_modules/@hocuspocus/server | 4.6.0 | MIT |
| node_modules/@lifeomic/attempt | 3.1.0 | MIT |
| node_modules/@pdf-lib/standard-fonts | 1.0.0 | MIT |
| node_modules/@pdf-lib/standard-fonts/node_modules/pako | 1.0.11 | (MIT AND Zlib) |
| node_modules/@pdf-lib/upng | 1.0.1 | MIT |
| node_modules/@pdf-lib/upng/node_modules/pako | 1.0.11 | (MIT AND Zlib) |
| node_modules/@types/react-reconciler | 0.28.9 | MIT |
| node_modules/async-mutex | 0.5.0 | MIT |
| node_modules/crossws | 0.4.12 | MIT |
| node_modules/fflate | 0.8.3 | MIT |
| node_modules/isomorphic.js | 0.2.5 | MIT |
| node_modules/its-fine | 2.0.0 | MIT |
| node_modules/jose | 6.2.10 | MIT |
| node_modules/kleur | 4.1.5 | MIT |
| node_modules/konva | 10.3.1 | MIT |
| node_modules/lib0 | 0.2.117 | MIT |
| node_modules/pdf-lib | 1.17.1 | MIT |
| node_modules/pdf-lib/node_modules/pako | 1.0.11 | (MIT AND Zlib) |
| node_modules/pdf-lib/node_modules/tslib | 1.14.1 | 0BSD |
| node_modules/pdfjs-dist | 6.2.108 | Apache-2.0 |
| node_modules/react-konva | 19.2.5 | MIT |
| node_modules/react-konva/node_modules/@types/react-reconciler | 0.33.0 | MIT |
| node_modules/react-reconciler | 0.33.0 | MIT |
| node_modules/scheduler | 0.27.0 | MIT |
| node_modules/three | 0.185.1 | MIT |
| node_modules/tslib | 2.8.1 | 0BSD |
| node_modules/web-ifc | 0.0.77 | MPL-2.0 |
| node_modules/y-indexeddb | 9.0.12 | MIT |
| node_modules/y-protocols | 1.0.7 | MIT |
| node_modules/yjs | 13.6.32 | MIT |

`web-ifc` is received unmodified under MPL-2.0. Its covered source is available
from the upstream project linked above and the npm distribution includes its
license text. MPL-2.0 is weak-copyleft, not a permissive license, so the P7
permissive-only release policy remains `NOT_MET` until `web-ifc` is replaced or
an explicit policy exception is approved outside this audit.
