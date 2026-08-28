# P7 Task 4 — Whole-workspace 10k performance

## Status

- Corrected local production-build Chromium gate: **MET**.
- Exact 10,000-object warm-reopen first usable: **2273.800 ms**, target `<= 2500 ms`.
- First usable includes hydration, all 10,000 authoritative objects, a nonempty viewport projection, real PDF pixels, a ready visible IFC frame, the durable local edit command bridge, healthy persistence, and the next animation frame.
- Warm input-to-next-frame p95: zoom **0.200 ms**, pan **0.200 ms**, selection **7.500 ms**, target `<= 16.7 ms` each.
- Separately measured cold/cache-miss baseline: **3088.900 ms — NOT MET**. It is not relabeled or substituted by the warm-reopen result.
- Hosted production runtime: **UNEXECUTED**. No trusted hosted browser/server/runtime authority was available.
- Final measured implementation commit: `c412c1bb2b8756fd6e17db7df72e366d2c9f60b0`.
- Authority-hardening commit: `e0adaf929ea2a0bcaf56f6a2c36d43490912e65a`.

This report supersedes the invalid original `2366.3 ms / 9.2 ms` claim. That artifact warmed PDF/IFC before navigation, omitted them from timed readiness, began selection timing after pointer-down work, and accepted caller-authored evidence. It is not retained as passing evidence.

## Measurement conditions and authority

The passing gate is deliberately named a **warm reopen**, not cold navigation. One untimed production navigation primes immutable application/PDF/IFC HTTP responses and writes the source-SHA-bound `first-visible-v1` derived PDF raster. The timed exact navigation must prove:

- `schemaVersion: 3` runner-generated evidence;
- source commit, source-tree digest, runner digest, Playwright config digest, served server-build digest, served client-build digest, and whole-capture digest;
- exact 10,000 authoritative semantic objects and nonempty bounded projections;
- verified derived raster cache `HIT`, immutable key digest, real pixel mount timestamp, and at least `1.5` raster pixels per displayed CSS pixel;
- visible PDF and IFC completion;
- `outboxReady && commandBridgeReady && !persistenceFailed` exposed as `data-edit-ready="true"`;
- one animation frame after all readiness predicates.

The first navigation/cache-miss path remains honest `NOT MET` evidence at 3088.9 ms. The local warm-reopen gate does not establish hosted latency or a cold-start guarantee.

## Measured root cause

### Original Task 4 baseline

The original trusted local 10k production run found first usable above four seconds, 10,331 DOM nodes, 10,000 accessibility rows, and multiple 300–600 ms long tasks. Production-function profiling isolated quadratic hosted-opening order assembly plus full 10k Konva hit, snap, and accessibility projections. Those measured problems were corrected in `c07d0cb` by linear host ordering, viewport projection, bounded hit/snap/accessibility work, cached active-slice visibility, and stable canvas inputs while retaining all 10,000 authoritative objects.

### Review-corrected baseline

After fixing the warmed/incomplete readiness predicate, pointer-down selection boundary, evidence provenance, served-build binding, conservative bounds, boundary tests, deterministic complexity guard, and atomic evidence replacement, the real corrected production result was:

```text
first usable 3088.9 ms — NOT MET
hydration end 1398.1 ms
PDF 1782.3 → 3064.2 ms (1281.9 ms)
IFC 1782.3 → 2613.3 ms (831.0 ms)
readiness 3076.9 ms → usable frame 3088.9 ms
```

PDF substage measurement showed approximately **507 ms dynamic import**, **740 ms document opening**, and only **33 ms rasterization**. The raster draw itself was not the main miss.

Measured minimal experiments that did not meet the gate were removed:

| Experiment | Exact result | Disposition |
| --- | ---: | --- |
| Lazy four inactive panels | 3058.8 ms | removed; within run variance |
| Lazy inspector/command menu too | 3089.0 ms | removed |
| Static PDF.js import | 3071.1 ms | removed |
| Full derived raster, DPR 2 | 3105.5 ms | replaced |
| 1600 px derived raster, DPR 1 | 3045.9 ms | replaced |
| 1024 px derived raster alone | 3023.3 ms | retained only as part of measured combined correction |
| 1024 cache + server-validated hydration | 2670.9 ms | still NOT MET |

PDF.js runtime/document preload, PDF worker/module preload, client canvas chunk preload, sequential PDF/IFC loading, and inactive-panel splits did not produce a genuine threshold improvement. Their diagnostic/preload code was removed.

CPU profiling of the remaining path found about 300 ms of duplicate client Zod row parsing after the server had already validated every loader row. After that duplicate parse was removed at one code-only server boundary, the remaining Zod work was the Yjs collaboration adapter's canonical graph validation. That validation is required for durable editing and was not skipped.

The collaboration adapter was therefore initialized after the real PDF/IFC first-paint boundary in an idle callback, with an error fallback and the existing connecting UI. The first apparent result, **1512.6 ms**, was rejected because preview `outboxReady` did not prove that the command bridge existed. Adding exact durable edit readiness moved the valid result to 2292.3 ms; repeated final source-bound runs were 2303.5, 2295.9, and finally **2273.8 ms**.

## Implementation

### Existing 10k rendering corrections retained

- Linear canonical host/opening ordering replaces the measured quadratic full-scan/splice loop.
- Visually conservative bounds cover multiline/styled text, rotated geometry, hosted opening cuts, wall thickness, stroke, handles, pan/zoom boundaries, and screen-space overscan.
- All 10,000 authoritative objects remain in the canonical document and render adapter.
- Only expensive Konva render, hit, snap, remote-selection, and accessibility projections are viewport-windowed.
- The deterministic complexity guard uses operation/growth evidence instead of a machine stopwatch.

### Corrected evidence and interaction authority

- First usable includes PDF, IFC, hydration, authoritative object count, projection, edit readiness, and the next real frame.
- Selection capture starts at the earliest capture-phase `pointerdown`, before hit resolution, selected-ID construction, snapshotting, state updates, and parent notification. All 30 raw samples prove the expected selected name is committed before the measured frame.
- Schema-v3 validation accepts only the Playwright runner environment, exact served build digests, complete raw timing samples, exact shapes, and a whole-capture SHA-256.
- The runner deletes stale evidence first, builds the exact source it serves, and atomically writes only validated output. A failed run cannot leave an older `MET` artifact.
- Hosted authority stays `UNEXECUTED`; no local or P6 pure-function evidence substitutes for it.

### Server-validated hydration

- `DRAWING_SERVER_VALIDATED_HYDRATION` is a code-only `Symbol`, not serialized payload authority.
- Only `drawingStateFromRevision`, whose DB/fixture producer already parsed every row schema and graph invariant, can use it.
- Bootstrap, IndexedDB, Yjs, outbox, checkpoint, import, operation, and collaboration hydration retain their existing schema parsing.
- Even the trusted path still rejects duplicate IDs and structural graph corruption and still constructs the canonical document state.

### Source-SHA-bound derived PDF raster

- Cache key inputs are render profile, current/previous slot, validated source file ID, immutable source SHA-256, page, 1024 px host width, zoom, and DPR. Signed URLs are never keys.
- Cache response metadata includes schema, render profile, slot, source file ID/SHA, page, host width, zoom, DPR, content SHA-256, canvas pixel/CSS dimensions, PDF viewport dimensions, and rotation.
- Blob digest, every header, PNG decoding, and decoded dimensions are verified. Any mismatch deletes the entry and falls back to PDF.js.
- Cache API absence, cache read/write failure, PNG encoding failure, decode failure, and dimension corruption preserve the PDF.js path.
- A verified 1024 px DPR-1 first-visible raster is mounted for readiness only when it supplies at least 1.5 pixels per displayed CSS pixel. The full 1600 px PDF.js raster refines after readiness.
- Current and previous PDF slots remain separate. IFC URLs cannot inherit a PDF file identity.

### Collaboration and edit readiness

- PDF and IFC production renderers mark their real first frames.
- Initial collaboration/Yjs construction waits for required source frames, then runs through the existing idle boundary; source failure has a bounded fallback.
- The Yjs canonical graph validation, local outbox, reconciliation, command schema validation, persistence, connection, retry, and recovery authorities remain unchanged.
- The UI remains honestly busy/connecting until `outboxReady`, a real command bridge, and healthy persistence are all present.

No new dependency, state manager, rendering framework, worker, queue, product schema, or second object authority was added.

## Strict TDD and review-fix evidence

### Original RED boundaries

The original implementation began with failing tests for stage instrumentation, 10k viewport projection, quadratic ordering, missing production browser projection evidence, and the absent evidence validator. The initial production browser run also preserved real `NOT MET` artifacts at 3253.5 ms first usable and 41.2 ms selection p95 before optimization.

### Review RED — missing first-paint collaboration boundary

```sh
node --test tests/drawing-runtime.test.mjs
```

```text
tests 6
pass 5
fail 1
TypeError: drawingWorkspaceFirstPaintReady is not a function
```

### Review RED — durable edit readiness and schema-v3 evidence

```sh
node --test tests/drawing-runtime.test.mjs tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 13
pass 8
fail 5
drawingLocalEditReady is not a function
expected schemaVersion 3, received 2
workspace source did not expose data-edit-ready
```

### Authority RED — source changed after evidence capture

After the cache-failure fallback and formatting edits, the focused run intentionally failed closed instead of accepting stale evidence:

```sh
node --test tests/drawing-workspace-blocks.test.mjs tests/drawing-runtime.test.mjs tests/drawing-pdf-raster-cache.test.mjs tests/drawing-document-store.test.mjs tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 56
pass 52
fail 4
all four failures: sourceTreeSha256 mismatch against the prior capture
```

### Regression RED — SSR shell attribute order

```sh
npm run test:drawing-workspace
```

```text
tests 769
pass 764
fail 1
skipped 4
workspace SSR shell keeps an empty inspector collapsed for a canvas-first desktop
```

The new readiness attribute had been inserted between the existing `aria-label` and `class` serialization contract. Moving it after `class` was the minimal GREEN change; no behavior or predicate was weakened.

### Focused GREEN

```sh
node --test tests/drawing-workspace-blocks.test.mjs tests/drawing-runtime.test.mjs tests/drawing-pdf-raster-cache.test.mjs tests/drawing-document-store.test.mjs tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 56
pass 56
fail 0
```

Focused coverage includes server authority fail-closed behavior, graph invariants, cache identity and integrity, IFC identity rejection, edit readiness, first-paint scheduling, conservative viewport edges, deterministic sub-quadratic growth, evidence mutation rejection, atomic stale removal, and runner-only provenance.

### Final production-build GREEN

```sh
PORT=4177 npm run test:e2e:drawing-workspace-p7:performance -- --reporter=line
```

```text
2 passed (25.6s)
first usable 2273.8 ms — MET
warm p95 { zoom: 0.2, pan: 0.2, selection: 7.5 } ms — MET
```

The second browser test corrupts a real cached PNG in two ways: valid digest with wrong decoded dimensions, and valid digest metadata with undecodable PNG bytes. Both are deleted and fall back to visible PDF.js pixels.

```sh
node scripts/drawing-p7-performance-evidence.mjs validate
```

```text
/Users/h/Documents/GoAgent/.worktrees/drawing-workspace-p0-p1/.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json
```

## Exact fixture and deterministic hashes

| Kind | Count |
| --- | ---: |
| Wall | 2,000 |
| Opening | 2,000 |
| Space | 1,500 |
| Area | 1,500 |
| Grid | 1,500 |
| Arc | 1,500 |
| **Total** | **10,000** |

The fixture also contains exactly two source links, one selected IFC model, and one active PDF page. At 1440×900 it retains 10,000 authoritative objects while projecting 1,850 render items and 1,848 accessibility rows.

Every series below contains exactly 100 identical runs:

| Boundary | SHA-256 |
| --- | --- |
| Fixture objects | `eb7b316b82a4a3f7a64fbd529d14c5e8041911c54ac3c926bd0af7f299c66cb6` |
| Canonical render order | `9154c645ec9f00664b117471fba109c17e44ce8fac9adb0648f65ab0f93f2e5e` |
| Viewport projection | `41a922cd1303904150c91afab6bacb6d4288a6e6e6b781a58b329380e7a75543` |

## Final stage evidence

Authority: local production build, Chromium `151.0.7922.34`, Apple M3 Max, 14 logical CPUs, 38,654,705,664 bytes total memory, 1440×900 viewport.

| Stage | Duration (ms) | Authority |
| --- | ---: | --- |
| Loader | 395.495 | `LOCAL_PRODUCTION_SERVER` |
| SSR | 168.725 | `LOCAL_PRODUCTION_SERVER` |
| Hydration | 218.800 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Style resolution | 2.700 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Render adapter | 44.500 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Konva mount | 77.600 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Snap/hit preparation | 5.000 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| PDF | 178.400 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| IFC | 220.500 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |

Readiness details:

- hydration end: 858.8 ms;
- verified raster HIT mount: 1123.8 ms;
- raster key digest: `02668746cb3475a67fb6684b0c0b9ee5d0bc823c1d736b242932841a48c6dc1b`;
- raster/display ratio: 1.96923;
- durable edit-ready observed: 2233.5 ms;
- next usable frame: 2273.8 ms.

Raw interaction samples: 30 zoom, 31 pan, and 30 selection samples. All selection samples committed the expected alternating object name before their recorded frame.

## Runner/build provenance

| Boundary | SHA-256 / commit |
| --- | --- |
| Source commit | `c412c1bb2b8756fd6e17db7df72e366d2c9f60b0` |
| Source tree | `7832252ab64151efba3e7e2b8de5fc59691271be9065314162b40cb620b83bc5` |
| Runner | `905a99db804f55d911db73f72300ab0accbbb03d288cf6f1ae3a51fe6fb027d1` |
| Playwright config | `05b08b871eb320a47c28f9eccc9391c5dbf140f6d24c5604c2c7bf59185cf5f5` |
| Served server build | `94fce813bb8e0f0d64bc9b2e59844a9ca0499140762b0e7a09b854f583cb2771` |
| Served client build | `53ab1fcefdfc3e630e2233a150e1163725b157844fecb29957746d8f269c4abe` |
| Capture | `63d283ae2ec29e6be7d923354fd4b2d9e5e8e70f2384ffaf3375995c4214af76` |

## Files changed

Authority hardening in `e0adaf9` corrected the selection boundary, readiness, build binding, evidence writer/validator, conservative projection bounds/tests, complexity guard, and stale artifact handling across:

- `platform/app/lukas/components/drawing-canvas.client.tsx`
- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/components/ifc-property-browser.client.tsx`
- `platform/app/lukas/lib/drawing-blocks.ts`
- `platform/e2e/drawing-workspace-p7-performance.spec.ts`
- `platform/package.json`
- `platform/scripts/drawing-p7-performance-evidence.d.mts`
- `platform/scripts/drawing-p7-performance-evidence.mjs`
- `platform/scripts/run-drawing-p7-performance.mjs`
- `platform/tests/drawing-workspace-blocks.test.mjs`
- `platform/tests/drawing-workspace-p4-tools.test.mjs`
- `platform/tests/drawing-workspace-p7-performance.test.mjs`

Measured budget completion in `c412c1b` changed:

- `platform/app/lukas/components/drawing-canvas.client.tsx`
- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/lib/drawing-document-store.ts`
- `platform/app/lukas/lib/drawing-pdf-raster-cache.client.ts`
- `platform/app/lukas/lib/drawing-pdf-raster-identity.ts`
- `platform/app/lukas/lib/drawing-runtime.ts`
- `platform/e2e/drawing-workspace-p7-performance.spec.ts`
- `platform/scripts/drawing-p7-performance-evidence.mjs`
- `platform/tests/drawing-document-store.test.mjs`
- `platform/tests/drawing-pdf-raster-cache.test.mjs`
- `platform/tests/drawing-runtime.test.mjs`
- `platform/tests/drawing-workspace-p7-performance.test.mjs`

Evidence/report artifacts:

- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-report.md`

## Verification

### Full Drawing Workspace suite

```sh
npm run test:drawing-workspace
```

```text
tests 769
pass 765
fail 0
skipped 4
duration_ms 38717.066667
```

The four skipped/UNEXECUTED cases require unavailable disposable or real PostgreSQL authorities. The suite includes frozen source/hash, migration, P0–P6 authority, collaboration/outbox/recovery, viewport, and exact 100-run production-function coverage.

### Desktop/tablet shell

```sh
PORT=4177 P7_RELEASE_PRODUCTION_BUILD=1 npx playwright test e2e/drawing-workspace-shell.spec.ts --config=playwright.p7-performance.config.ts --project=chromium --workers=1 --grep "current desktop preview|tablet keeps one drawer" --reporter=line
```

```text
2 passed (5.2s)
```

This preserves the Task 3 persistent canvas, mutually exclusive tablet drawers, inspector behavior, keyboard recovery, and focus restoration.

### Typecheck and production build

The final exact runner executes `npm run build`, whose `prebuild` executes `npm run typecheck`, before starting the production server. Both passed. The build retained only existing large-chunk, dynamic-import, unsigned theme-cookie, localStorage experimental, and React Router future-flag warnings.

### Formatting, diff, and frozen invariants

```sh
npx prettier --write app/lukas/components/drawing-canvas.client.tsx app/lukas/components/drawing-workspace.tsx app/lukas/lib/drawing-document-store.ts app/lukas/lib/drawing-runtime.ts app/lukas/lib/drawing-pdf-raster-cache.client.ts app/lukas/lib/drawing-pdf-raster-identity.ts e2e/drawing-workspace-p7-performance.spec.ts scripts/drawing-p7-performance-evidence.mjs tests/drawing-document-store.test.mjs tests/drawing-runtime.test.mjs tests/drawing-pdf-raster-cache.test.mjs tests/drawing-workspace-p7-performance.test.mjs
git diff --check
git diff --name-only 9213807 -- platform/supabase platform/tests/fixtures platform/THIRD_PARTY_NOTICES.md
```

Formatting completed, `git diff --check` was empty, and the frozen migration/fixture/notice query was empty. The full suite independently passed the pinned P5 source byte hashes, P6 byte-for-byte P0–P5 authority preservation, P6 deterministic 100-run workload, and P4 durable-source byte check.

The pre-existing user-owned P4 progress/images and `.superpowers/audits/` remained unstaged and were not edited by this task.

## Self-review

- The passing predicate is stricter than the rejected artifact: it includes real PDF, IFC, exact 10k authority, viewport projection, durable local editing, and the next frame.
- The condition is called warm reopen and the 3088.9 ms miss remains visible as `NOT MET`.
- Cache authority is derived solely from validated source ID/SHA and verified real PNG pixels; URL capability values never become identity.
- Cache corruption, unavailable storage, and failed writes fall back to existing PDF.js without removing fresh pixels.
- Server parse skipping is available only through a code-only symbol at one loader-revision callsite; all external/client recovery boundaries retain schema validation and graph invariants.
- Yjs validation is deferred, not removed. Edit readiness prevents the performance gate from passing before the durable bridge exists.
- Authoritative state remains 10,000 objects; viewport projections remain derived and bounded.
- No experimental preload, panel split, static import, sequence change, diagnostic timing, second schema, worker, queue, or dependency remains.
- Evidence rejects extra/missing shapes, caller-written acceptance, wrong raw samples, uncommitted selection, wrong hashes, wrong served build, missing cache HIT, insufficient pixel ratio, stale source, and threshold/status mismatch.

## Concerns

- The corrected warm-reopen margin is **226.2 ms** on this machine. CPU load, browser version, thermal state, and hosted latency can reduce it.
- The cold/cache-miss baseline remains **3088.9 ms — NOT MET**; this task establishes the specified warm immutable/derived-cache reopen path, not a cold-start pass.
- Hosted production runtime is **UNEXECUTED** and must be run when trusted target authority is available.
- The 1024 px derived raster is a verified first-visible surface and is refined by full PDF.js pixels after readiness; cache misses and any integrity/quality failure retain the slower full PDF.js path.
