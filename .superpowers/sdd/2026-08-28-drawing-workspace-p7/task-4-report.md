# P7 Task 4 — Whole-workspace 10k performance

## Status

- Local production-build Chromium warm-reopen gate: **MET**.
- Exact 10,000-object first usable: **2283.2 ms**, target `<= 2500 ms`.
- Warm input-to-next-frame p95: zoom **0.2 ms**, pan **0.2 ms**, selection **8.0 ms**, target `<= 16.7 ms` each.
- Fresh production context/cache-miss baseline: **2865.1 ms — NOT MET**.
- Hosted production runtime: **UNEXECUTED** because no trusted hosted browser/server/runtime authority was available.
- Final measured implementation commit: `fdf68a2a1bc772510587e04adc7dad4aeb34829f`.

The current gate does not trust a cached raster as PDF source-pixel authority. A cache hit may display provisionally, but readiness waits for PDF.js to render pixels from the original PDF source. The local `MET` is the live runner result. The persisted JSON files are mutually editable and have no external immutable or signed receipt, so the standalone validator deliberately refuses to grant execution authority from them.

This report supersedes both the invalid original `2366.3 ms / 9.2 ms` result and the later schema-v4 `2255.9 ms` result that treated a mutable derived-cache raster as verified source pixels.

## Exact readiness contract

The measured navigation is a **warm reopen**, not a cold navigation. One untimed production navigation primes immutable application, PDF, and IFC response bytes. The timed navigation must prove all of the following before the measured next animation frame:

- the exact 10,000 authoritative objects are present;
- the viewport projection and accessibility projection are nonempty and bounded;
- hydration is complete;
- the durable local edit bridge exists, its outbox is ready, and persistence has not failed;
- PDF.js has rendered and mounted pixels from the original PDF source;
- the visible IFC scene has completed a real frame for the current revision/source lifecycle;
- the next real animation frame has completed.

The provisional derived raster does not mark PDF readiness and does not finish the PDF stage. On a cache hit the product immediately performs the PDF.js source render; only that render can publish `PDFJS` authority and the lifecycle-scoped PDF first-paint mark.

## Authority model

The production runner performs the exact build, computes source/build provenance, launches the isolated Playwright process, promotes the complete raw capture only after all browser tests pass, derives thresholds, and returns nonzero for a complete `NOT MET` result without deleting that result.

The persisted raw capture and derived JSON remain useful for audit, shape validation, raw samples, deterministic hashes, source-tree binding, and served-build digest inspection. They are not a cryptographic execution receipt. Therefore:

- `node scripts/drawing-p7-performance-evidence.mjs inspect` validates shape, derivation, source tree, runner/config hashes, and served build digests;
- `node scripts/drawing-p7-performance-evidence.mjs validate` exits nonzero with `Standalone performance artifacts cannot establish execution authority without an external immutable or signed receipt`;
- paired edits to both raw capture and derived evidence cannot be promoted by the standalone validator;
- the live runner result is the only local execution decision;
- hosted authority stays `UNEXECUTED`.

No checksum of caller-editable data, environment variable, Cache API key, localStorage value, or other self-consistent local metadata is labeled as independent authority.

## Measured root cause and retained corrections

The first corrected whole-workspace run was over three seconds. Stage instrumentation showed that the dominant late source boundary was PDF module/document initialization rather than raster drawing. Earlier profiling measured roughly 507 ms for the PDF.js dynamic import, 740 ms for document opening, and only about 33 ms for rasterization. The rendering path also originally contained quadratic hosted-opening ordering and full 10,000-object Konva hit, snap, and accessibility scans.

Retained production corrections are limited to measured work:

- linear canonical host/opening ordering;
- viewport-windowed render, hit, snap, remote-selection, and accessibility projections while all 10,000 objects remain authoritative;
- conservative bounds for multiline/styled text, rotated geometry, wall/opening cuts, stroke and handle extents across pan/zoom boundaries;
- cached active-slice visibility and stable canvas inputs;
- code-only server-validated loader hydration that skips duplicate row parsing only after loader schema and graph validation, while every client recovery/collaboration/import boundary retains validation;
- collaboration/Yjs bootstrap deferred until required source first frames, without deferring the durable local command bridge;
- an immediate PDF.js source verification/render after a provisional cache mount.

The final source-bound run measured the PDF.js warm source render at **654.7 ms** and still completed the whole workspace in **2283.2 ms**.

Removed experiments included static PDF.js import, module/worker/source preloads that did not improve the gate, sequential PDF/IFC loading, inactive-panel splits within run variance, and timing diagnostics not needed by the production boundary. No new dependency, state manager, rendering framework, worker layer, queue, or second schema remains.

## Round 3 implementation

### Evidence and threshold handling

- Browser tests no longer assert warm/cold thresholds. They write a complete raw capture after functional readiness and raw-sample checks.
- The runner derives `MET` or `NOT MET` only after the entire Playwright command succeeds.
- Complete first-usable `2500.1 ms` and interaction `16.8 ms` captures persist honest `NOT MET` evidence and make the runner return `1`.
- Incomplete runs or later functional browser failures remove stale evidence, promoted capture, and temporary capture.
- A cold result is always structured and independently derived; it is not forced to `NOT MET` by a browser assertion and would be preserved honestly if it improved.
- Standalone validation refuses execution authority even when an attacker rewrites both raw capture and evidence to self-consistent one-millisecond timings.

### PDF cache boundary

- Cache key and response integrity checks remain useful corruption/fallback checks, but they are not proof that a PNG was derived from the source PDF.
- The cache reader labels every returned raster `UNVERIFIED_CACHE`.
- Canvas evidence labels a provisional mount `UNVERIFIED_DERIVED_CACHE` / `UNVERIFIED_HIT`.
- Provisional pixels cannot publish the PDF first-paint mark or finish the PDF performance stage.
- PDF.js source-rendered pixels replace the provisional surface before readiness and are recorded as `PDFJS`.
- Same-dimension alternate PNG bytes with a forged new request suffix and matching body/header digest may be displayed only provisionally; the final measured source-pixel surface must still be PDF.js.
- Decode, dimension, storage, and encoding failures continue to fall back safely.

### IFC lifecycle

- The mounted IFC viewer now owns a mutable current first-paint lifecycle key.
- A revision/PDF/IFC lifecycle-key transition rearms one real render and marks the new key without recreating or reparsing the unchanged IFC model.
- The property browser updates an existing viewer and also keeps the latest key in a ref for a transition that races initial viewer construction.
- A real component/browser regression proves the viewer instance stays the same while the second lifecycle gets its own first-frame mark.

### Existing interaction correction retained

Selection measurement starts at capture-phase `pointerdown`, before hit resolution, selected-ID construction, snapshots, state update, and parent notification. Each of 30 raw samples proves the expected selected object name was committed before the measured next frame. Block-instance selection inverse-transforms the pointer and narrow-phase tests topmost definition primitives, so rotated sparse empty corners fall through to the real object below.

## Strict TDD evidence

### Round 4 RED — fixed checked-in cold outcome

The checked-in cold evidence was mutated in the test to a valid `2499 ms / MET` result. The old result-specific assertions rejected it:

```sh
node --test --test-name-pattern='P7 records a raw cold' tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 1
pass 0
fail 1
AssertionError: assert.ok(coldCacheMiss.durationMs > 2_500)
```

### Round 4 focused GREEN

The regression now checks only that the raw duration is the readiness interval and that `status` is derived from `durationMs <= targetMs`. It has no fixed cold outcome:

```sh
node --test --test-name-pattern='P7 records a raw cold' tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 1
pass 1
fail 0
```

```sh
node --test tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 14
pass 14
fail 0
```

### Round 3 RED — paired evidence forgery, threshold retention, and mutable raster

```sh
node --test --test-name-pattern='paired one-millisecond|complete warm and interaction|same-dimension alternate' tests/drawing-workspace-p7-performance.test.mjs tests/drawing-pdf-raster-cache.test.mjs
```

```text
tests 3
pass 0
fail 3
paired raw capture plus derived one-millisecond evidence was accepted
complete first-usable threshold miss returned 0 instead of 1
forged alternate key/body/header returned a trusted raster payload
```

### Round 3 RED — fixed cold outcome

```sh
node --test --test-name-pattern='browser capture records cold' tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 1
pass 0
fail 1
browser source still asserted a fixed cold NOT MET outcome
```

### Round 3 RED — IFC component lifecycle transition

```sh
PORT=4177 npx playwright test e2e/drawing-workspace-p7-performance.spec.ts --config=playwright.p7-performance.config.ts --project=chromium --workers=1 --grep 'mounted IFC component rearms'
```

```text
1 failed
P7 IFC first-paint lifecycle element not found
```

### Round 3 focused GREEN

```sh
node --test tests/drawing-pdf-raster-cache.test.mjs tests/drawing-runtime.test.mjs tests/drawing-workspace-p7-performance.test.mjs
```

```text
tests 26
pass 26
fail 0
```

```sh
PORT=4177 npx playwright test e2e/drawing-workspace-p7-performance.spec.ts --config=playwright.p7-performance.config.ts --project=chromium --workers=1 --grep 'mounted IFC component rearms'
```

```text
1 passed (2.7s)
```

The focused coverage includes paired raw/evidence forgery rejection, durable complete `NOT MET` artifacts for both warm and interaction misses, later functional-failure cleanup, cold-status derivation without a fixed assertion, unverified forged raster behavior, PDF.js readiness authority, source/build inspection, and actual same-viewer IFC lifecycle rearming.

## Final exact production run

```sh
PORT=4177 npm run test:e2e:drawing-workspace-p7:performance
```

```text
prebuild/typecheck: PASS
production client/server build: PASS
Playwright: 3 passed (29.6s)
warm reopen first usable: 2283.2 ms — MET
cold/cache miss first usable: 2865.1 ms — NOT MET
warm p95: zoom 0.2 ms, pan 0.2 ms, selection 8.0 ms — MET
hosted authority: UNEXECUTED
```

The three browser tests cover the exact 10k measurement, mutable/decode/dimension cache corruption with mandatory PDF.js source readiness, and same-viewer IFC lifecycle rearming.

## Exact fixture and deterministic hashes

| Kind      |      Count |
| --------- | ---------: |
| Wall      |      2,000 |
| Opening   |      2,000 |
| Space     |      1,500 |
| Area      |      1,500 |
| Grid      |      1,500 |
| Arc       |      1,500 |
| **Total** | **10,000** |

Additional exact cardinalities: two source links, one selected IFC model, one active PDF page, 1,850 projected render items, and 1,848 accessible projected objects.

Every hash series contains exactly 100 identical runs:

| Boundary               | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| Fixture objects        | `eb7b316b82a4a3f7a64fbd529d14c5e8041911c54ac3c926bd0af7f299c66cb6` |
| Canonical render order | `9154c645ec9f00664b117471fba109c17e44ce8fac9adb0648f65ab0f93f2e5e` |
| Viewport projection    | `41a922cd1303904150c91afab6bacb6d4288a6e6e6b781a58b329380e7a75543` |

## Final stage evidence

Runtime: Chromium `151.0.7922.34`, Apple M3 Max, 14 logical CPUs, 38,654,705,664 bytes total memory, viewport 1440×900.

| Stage                | Interval / duration (ms) | Authority label                   |
| -------------------- | -----------------------: | --------------------------------- |
| Loader               |                  346.556 | `LOCAL_PRODUCTION_SERVER`         |
| SSR                  |                  173.310 | `LOCAL_PRODUCTION_SERVER`         |
| Hydration            |    600.0 → 809.1 / 209.1 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Style resolution     |    2179.1 → 2182.4 / 3.3 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Render adapter       |     839.4 → 874.8 / 35.4 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Konva mount          |     837.4 → 903.5 / 66.1 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| Snap/hit preparation |      921.1 → 924.6 / 3.5 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| PDF.js source render |   883.4 → 1538.1 / 654.7 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |
| IFC                  |   883.6 → 1111.2 / 227.6 | `LOCAL_PRODUCTION_BUILD_CHROMIUM` |

Warm readiness:

- hydration end: 809.1 ms;
- PDF.js pixels mounted: 1549.0 ms;
- provisional cache status: `UNVERIFIED_HIT`;
- provisional key digest: `d88d60be929ccb629703d75f2e63113e6fb2e323e3fe5b8ae42cfd39f6a29c3d`;
- final PDF/display pixel ratio: 3.0769;
- edit/state/projection/PDF/IFC predicates observed: 2242.8 ms;
- next usable frame: 2283.2 ms.

Cold readiness:

- cache status: `MISS`;
- hydration end: 1135.3 ms;
- all readiness predicates observed: 2816.6 ms;
- next usable frame: 2865.1 ms;
- independently derived status: `NOT MET`.

Raw interaction sample counts are 30 zoom, 31 pan, and 30 selection. Every selection sample committed the expected alternating object name before its recorded frame.

## Runner/build provenance

| Boundary                  | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| Source commit             | `fdf68a2a1bc772510587e04adc7dad4aeb34829f`                         |
| Source tree               | `82726593eb5ec607012d57bcb22296f0c85ffca0a8e468f81c05a9b3d9e89ff3` |
| Runner                    | `7e1703685cb53abb2834b9641d5847cc6bc896cd200d96c9ce8c136095c42fa6` |
| Playwright config         | `05b08b871eb320a47c28f9eccc9391c5dbf140f6d24c5604c2c7bf59185cf5f5` |
| Served server build       | `0b0815a7b63772ea4478a0d8cd6ccb5764fb3aa4e0173a0ff36d7b8ef63c24de` |
| Served client build       | `e3237dbf88b2e61adfce070f2f561c6813ccef1ec42c459fcc2c5bd6aea20e74` |
| Raw capture checksum      | `ee01f99022c1803547827bdd5b932a3393b2fa780eb30b59bb1d805bb8c757eb` |
| Derived evidence checksum | `bfa1b53e3a48605a55120ee6a773df75415db4370f49b71e377115657a8c534d` |
| Run ID                    | `f94c9722-3a01-4b06-ac84-02e790ef9b09`                             |

These checksums detect mutation but do not make the files an independent execution receipt.

## Files changed in round 3

- `platform/app/lukas/components/drawing-canvas.client.tsx`
- `platform/app/lukas/components/ifc-model-viewer.client.ts`
- `platform/app/lukas/components/ifc-property-browser.client.tsx`
- `platform/app/lukas/lib/drawing-pdf-raster-cache.client.ts`
- `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- `platform/e2e/drawing-workspace-p7-performance.spec.ts`
- `platform/scripts/drawing-p7-performance-evidence.d.mts`
- `platform/scripts/drawing-p7-performance-evidence.mjs`
- `platform/scripts/run-drawing-p7-performance.mjs`
- `platform/tests/drawing-pdf-raster-cache.test.mjs`
- `platform/tests/drawing-workspace-p7-performance.test.mjs`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-playwright-capture.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-report.md`

Implementation commits: `95cbf3b35740fd4bbcae203695c469f3c9f6ca44` and ponytail cleanup `672eb0439052a0eee1b5e7e4b4baf8e15482ed35`.

## Round 4 files changed

- `platform/tests/drawing-workspace-p7-performance.test.mjs`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-playwright-capture.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-report.md`

Round 4 implementation commit: `fdf68a2a1bc772510587e04adc7dad4aeb34829f`.

## Final verification

### Full Drawing Workspace suite

```sh
npm run test:drawing-workspace
```

```text
tests 777
pass 773
fail 0
skipped 4
duration_ms 38600.34575
```

The skips are existing unavailable disposable/real PostgreSQL authorities.

### Desktop/tablet shell

```sh
PORT=4177 P7_RELEASE_PRODUCTION_BUILD=1 npx playwright test e2e/drawing-workspace-shell.spec.ts --config=playwright.p7-performance.config.ts --project=chromium --workers=1 --grep 'current desktop preview|tablet keeps one drawer' --reporter=line
```

```text
2 passed (5.3s)
```

This preserves the persistent tablet canvas, mutually exclusive drawers, desktop dock behavior, keyboard recovery, and canvas focus restoration from Task 3.

### Typecheck/build

The final exact runner executed `npm run build`, whose prebuild executed `npm run typecheck`; both passed before the measured production server started. Only existing large-chunk, dynamic-import, unsigned theme-cookie, localStorage experimental, and React Router future-flag warnings remained.

### Evidence inspection and deliberate standalone rejection

```sh
node scripts/drawing-p7-performance-evidence.mjs inspect
```

```text
task-4-performance-evidence.json (structure/build binding only; standalone execution authority unavailable)
```

```sh
node scripts/drawing-p7-performance-evidence.mjs validate
```

```text
exit 1
Standalone performance artifacts cannot establish execution authority without an external immutable or signed receipt
```

### Formatting, diff, and frozen invariants

Changed platform files were formatted with Prettier. `git diff --check` was empty. The following frozen-source query was empty:

```sh
git diff --name-only 9213807 -- platform/supabase platform/tests/fixtures platform/THIRD_PARTY_NOTICES.md
```

The full suite also passed the pinned P5 source hashes, P6 byte-for-byte P0–P5 preservation, deterministic P6 workload, and P4 durable-source byte checks.

The user-owned P4 progress/images and `.superpowers/audits/` remained unstaged and were not edited by this task.

## Self-review

- The warm predicate includes real PDF.js source pixels, IFC, exact 10k authority, bounded projection, durable local editing, and the next frame.
- Cached pixels are explicitly provisional and cannot satisfy PDF readiness, even when cache key, body, headers, dimensions, and digests are mutually self-consistent.
- Paired public raw/evidence forgery cannot obtain standalone execution authority.
- Complete threshold misses remain durable `NOT MET`; only incomplete or later functional failures clean artifacts.
- Cold status is derived rather than asserted.
- IFC lifecycle changes rearm a real frame without reparsing an unchanged model and handle an initial-mount race.
- All 10,000 objects remain authoritative; only derived expensive projections are bounded.
- No speculative preload, inactive split, local trust anchor, second schema, new dependency, worker, or queue remains.

## Concerns

- The warm-reopen margin is **216.8 ms** on this machine. CPU load, browser version, thermal state, or hosted latency can reduce it.
- The cold/cache-miss path remains **2865.1 ms — NOT MET**.
- Hosted production runtime remains **UNEXECUTED**.
- The provisional cache can improve what the user sees before verification, but it is intentionally not a source-pixel authority; readiness always pays the PDF.js source-render cost.
- Without an external immutable or signed runner receipt, persisted local timing artifacts remain inspectable records rather than independently verifiable execution authority.
