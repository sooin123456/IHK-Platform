# Third-party notices

The following packages were acquired with `npm`. No source code from these
packages has been modified or copied into this repository.

| Package              | Version        | Upstream                                       | License    | Modified | Acquisition | Purpose                                       |
| -------------------- | -------------- | ---------------------------------------------- | ---------- | -------- | ----------- | --------------------------------------------- |
| Konva                | 10.3.1         | https://github.com/konvajs/konva               | MIT        | No       | npm         | Drawing canvas rendering                      |
| react-konva          | 19.2.5         | https://github.com/konvajs/react-konva         | MIT        | No       | npm         | React drawing canvas bindings                 |
| @electric-sql/pglite | 0.5.3          | https://github.com/electric-sql/pglite         | Apache-2.0 | No       | npm         | Database contract tests                       |
| pdf-lib              | 1.17.1         | https://github.com/Hopding/pdf-lib             | MIT        | No       | npm         | Drawing export                                |
| pdfjs-dist           | 6.2.108        | https://github.com/mozilla/pdf.js              | Apache-2.0 | No       | npm         | Immutable PDF background rendering            |
| three                | 0.185.1        | https://github.com/mrdoob/three.js             | MIT        | No       | npm         | IFC WebGL scene rendering                     |
| fflate               | 0.8.3          | https://github.com/101arrowz/fflate            | MIT        | No       | npm         | Formula-free Verified BOQ XLSX ZIP generation |
| gltf-validator       | 2.0.0-dev.3.10 | https://github.com/KhronosGroup/glTF-Validator | Apache-2.0 | No       | npm         | Server-side GLB conformance validation        |
| dxf-parser           | 1.1.2          | https://github.com/gdsestimating/dxf-parser    | MIT        | No       | npm         | Server-only text DXF parsing                  |
| yjs                  | 13.6.32        | https://github.com/yjs/yjs                     | MIT        | No       | npm         | CRDT document and updates                     |
| y-indexeddb          | 9.0.12         | https://github.com/yjs/y-indexeddb             | MIT        | No       | npm         | Offline Yjs update persistence                |
| @hocuspocus/provider | 4.6.0          | https://github.com/ueberdosis/hocuspocus       | MIT        | No       | npm         | Browser collaboration provider and Awareness  |
| @hocuspocus/server   | 4.6.0          | https://github.com/ueberdosis/hocuspocus       | MIT        | No       | npm         | Node collaboration service runtime            |
| y-protocols          | 1.0.7          | https://github.com/yjs/y-protocols             | MIT        | No       | npm         | Awareness protocol types and helpers          |
| jose                 | 6.2.10         | https://github.com/panva/jose                  | MIT        | No       | npm         | Supabase asymmetric JWT verification          |
| tus-js-client        | 4.3.1          | https://github.com/tus/tus-js-client           | MIT        | No       | npm         | Resumable direct-to-Storage uploads           |

## P7 Drawing dependency closure

This is the complete direct and transitive closure inspected by the P7 release
gate. Package paths distinguish independently installed versions.

| Package path                                                  | Version        | License        |
| ------------------------------------------------------------- | -------------- | -------------- |
| node_modules/@electric-sql/pglite                             | 0.5.3          | Apache-2.0     |
| node_modules/@hocuspocus/common                               | 4.6.0          | MIT            |
| node_modules/@hocuspocus/provider                             | 4.6.0          | MIT            |
| node_modules/@hocuspocus/server                               | 4.6.0          | MIT            |
| node_modules/@lifeomic/attempt                                | 3.1.0          | MIT            |
| node_modules/@pdf-lib/standard-fonts                          | 1.0.0          | MIT            |
| node_modules/@pdf-lib/standard-fonts/node_modules/pako        | 1.0.11         | (MIT AND Zlib) |
| node_modules/@pdf-lib/upng                                    | 1.0.1          | MIT            |
| node_modules/@pdf-lib/upng/node_modules/pako                  | 1.0.11         | (MIT AND Zlib) |
| node_modules/@types/react-reconciler                          | 0.28.9         | MIT            |
| node_modules/async-mutex                                      | 0.5.0          | MIT            |
| node_modules/crossws                                          | 0.4.12         | MIT            |
| node_modules/dxf-parser                                       | 1.1.2          | MIT            |
| node_modules/fflate                                           | 0.8.3          | MIT            |
| node_modules/gltf-validator                                   | 2.0.0-dev.3.10 | Apache-2.0     |
| node_modules/isomorphic.js                                    | 0.2.5          | MIT            |
| node_modules/its-fine                                         | 2.0.0          | MIT            |
| node_modules/jose                                             | 6.2.10         | MIT            |
| node_modules/kleur                                            | 4.1.5          | MIT            |
| node_modules/konva                                            | 10.3.1         | MIT            |
| node_modules/lib0                                             | 0.2.117        | MIT            |
| node_modules/loglevel                                         | 1.9.2          | MIT            |
| node_modules/pdf-lib                                          | 1.17.1         | MIT            |
| node_modules/pdf-lib/node_modules/pako                        | 1.0.11         | (MIT AND Zlib) |
| node_modules/pdf-lib/node_modules/tslib                       | 1.14.1         | 0BSD           |
| node_modules/pdfjs-dist                                       | 6.2.108        | Apache-2.0     |
| node_modules/react-konva                                      | 19.2.5         | MIT            |
| node_modules/react-konva/node_modules/@types/react-reconciler | 0.33.0         | MIT            |
| node_modules/react-reconciler                                 | 0.33.0         | MIT            |
| node_modules/scheduler                                        | 0.27.0         | MIT            |
| node_modules/three                                            | 0.185.1        | MIT            |
| node_modules/tslib                                            | 2.8.1          | 0BSD           |
| node_modules/y-indexeddb                                      | 9.0.12         | MIT            |
| node_modules/y-protocols                                      | 1.0.7          | MIT            |
| node_modules/yjs                                              | 13.6.32        | MIT            |

The drawing dependency closure is permissive-only. IFC source parsing and
derivative generation run outside this browser package; the client verifies and
renders immutable, self-contained GLB plus its semantic manifest with Three.js.

## Redistributed IFC fixture provenance

This fixture redistribution record is separate from the permissive-only npm
dependency closure above. MPL-2.0 applies to the pinned upstream IFC source used
for semantic fixture data; it is not an npm runtime dependency.

| Fixture provenance field        | Value                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream repository             | https://github.com/ThatOpen/engine_web-ifc                                                                                                                                                                                            |
| Upstream commit                 | `3f6f3640b8317664194911fad63bcd407f7e32ca`                                                                                                                                                                                            |
| Pinned source URL               | https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc                                                                                                               |
| Upstream source license         | [MPL-2.0](https://github.com/ThatOpen/engine_web-ifc/blob/3f6f3640b8317664194911fad63bcd407f7e32ca/LICENSE.md)                                                                                                                        |
| Pinned source SHA-256           | `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d`                                                                                                                                                                    |
| Deployed GLB SHA-256            | `cb450586de90c234831a6a206c0cb83078d65eca1870ac642680df5b5056270f`                                                                                                                                                                    |
| Primary manifest SHA-256        | `65dc191d9089409f37d4757707e4a191bb7774ac4a64ac191384a67e3e85a17c`                                                                                                                                                                    |
| Copy manifest SHA-256           | `5c417a92f4e3feb6e61d19204e94eca0a131e89bc00c93c7aa5d1b5978147b82`                                                                                                                                                                    |
| Repository public fixture paths | `public/examples/synthetic-ifc-mapping.glb`, `public/examples/synthetic-ifc-mapping.manifest.json`, `public/examples/synthetic-ifc-mapping-copy.manifest.json`, `public/examples/IFC_FIXTURE_NOTICE.md`, `public/examples/index.html` |
| Deployed public fixture paths   | `/examples/synthetic-ifc-mapping.glb`, `/examples/synthetic-ifc-mapping.manifest.json`, `/examples/synthetic-ifc-mapping-copy.manifest.json`, `/examples/IFC_FIXTURE_NOTICE.md`, `/examples/index.html`                               |

The deployed GLB geometry is first-party synthetic test geometry and is not
source-faithful geometry from `example.ifc`. The two manifests carry semantic
fixture mapping from the pinned IFC example onto the synthetic GLB nodes.

## Redistributed DXF fixture provenance

This fixture redistribution record is separate from the `dxf-parser` npm
package row and the permissive-only dependency closure above. The pinned file
is redistributed under its upstream MIT license.

| Fixture provenance field | Value                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Upstream repository      | https://github.com/gdsestimating/dxf-parser                                                                                    |
| Upstream commit          | `0df7a37a4207a1f925b8d0bfffc270ff121446b4`                                                                                     |
| Pinned raw URL           | https://raw.githubusercontent.com/gdsestimating/dxf-parser/0df7a37a4207a1f925b8d0bfffc270ff121446b4/test/data/extendeddata.dxf |
| Upstream license URL     | https://github.com/gdsestimating/dxf-parser/blob/0df7a37a4207a1f925b8d0bfffc270ff121446b4/LICENSE                              |
| Raw SHA-256              | `9b39289e3435fb187eb0e671fb8a07b8728cdf69a0275836f67ca005732f781d`                                                             |
| Local SHA-256            | `9b39289e3435fb187eb0e671fb8a07b8728cdf69a0275836f67ca005732f781d`                                                             |
| Raw byte size            | `102001`                                                                                                                       |
| Local byte size          | `102001`                                                                                                                       |
| Local path               | `tests/fixtures/dxf-parser/extendeddata.dxf`                                                                                   |
| Local license path       | `tests/fixtures/dxf-parser/LICENSE`                                                                                            |
| Local copy status        | Exact, unmodified upstream bytes; original CRLF line endings preserved                                                         |

This is an OSS interoperability fixture. It is not customer data or customer acceptance.

## Resumable upload dependency closure

This is the exact direct and transitive closure of `tus-js-client@4.3.1` in the
reviewed lockfile. Package paths distinguish independently installed versions.

| Package path                                          | Version | License      |
| ----------------------------------------------------- | ------- | ------------ |
| node_modules/buffer-from                              | 1.1.2   | MIT          |
| node_modules/combine-errors                           | 3.0.3   | MIT          |
| node_modules/custom-error-instance                    | 2.1.1   | ISC          |
| node_modules/graceful-fs                              | 4.2.11  | ISC          |
| node_modules/is-stream                                | 2.0.1   | MIT          |
| node_modules/js-base64                                | 3.9.3   | BSD-3-Clause |
| node_modules/lodash.\_baseiteratee                    | 4.7.0   | MIT          |
| node_modules/lodash.\_basetostring                    | 4.12.0  | MIT          |
| node_modules/lodash.\_baseuniq                        | 4.6.0   | MIT          |
| node_modules/lodash.\_createset                       | 4.0.3   | MIT          |
| node_modules/lodash.\_root                            | 3.0.1   | MIT          |
| node_modules/lodash.\_stringtopath                    | 4.8.0   | MIT          |
| node_modules/lodash.throttle                          | 4.1.1   | MIT          |
| node_modules/lodash.uniqby                            | 4.5.0   | MIT          |
| node_modules/proper-lockfile                          | 4.1.2   | MIT          |
| node_modules/proper-lockfile/node_modules/signal-exit | 3.0.7   | ISC          |
| node_modules/querystringify                           | 2.2.0   | MIT          |
| node_modules/requires-port                            | 1.0.0   | MIT          |
| node_modules/retry                                    | 0.12.0  | MIT          |
| node_modules/tus-js-client                            | 4.3.1   | MIT          |
| node_modules/url-parse                                | 1.5.10  | MIT          |

`buffer-from` declares MIT in its installed package manifest. `combine-errors`
declares MIT in its bundled `Readme.md`; its registry and lock metadata omit the
license field. All licenses in this upload closure are permissive.
