# Task 1 report: five-type app edit compiler

## Status

PASS. The existing selected-edit builder now emits the exact `1hk-dwg-edits/2` LINE, LWPOLYLINE, CIRCLE, ARC, and TEXT records while preserving its exported builder name, result flags, no-op behavior, and lack of persistence authority.

## RED

Command:

```sh
cd platform
node --test tests/drawing-native-dwg-selected-edits.test.mjs
```

Expected output observed before production edits:

```text
tests 37
pass 31
fail 6
duration_ms 170.487083
exit_code=1
```

The six new behavioral tests failed for the intended missing behavior: CIRCLE, LWPOLYLINE, and both ARC cases raised `Native DWG projected shape geometry change is unsupported`; TEXT origin/height raised immutable-style rejection; the inch CIRCLE case was likewise unsupported. This also demonstrated that the compiler had not yet moved to the v2 shape contract before old schema expectations were updated.

## GREEN

Focused command:

```sh
cd platform
node --test tests/drawing-native-dwg-selected-edits.test.mjs
```

Output:

```text
tests 40
pass 40
fail 0
duration_ms 305.735167
exit_code=0
```

Final requested verification command:

```sh
cd platform
npx prettier --check app/lukas/lib/drawing-native-dwg-selected-edits.server.ts tests/drawing-native-dwg-selected-edits.test.mjs && node --test tests/drawing-native-dwg-selected-edits.test.mjs tests/drawing-native-dwg-import.test.mjs tests/drawing-native-dwg-import-plan-server.test.mjs && npm run typecheck
```

Output:

```text
All matched files use Prettier code style!
tests 61
pass 61
fail 0
duration_ms 872.375333
> react-router typegen && tsc
exit_code=0
```

## Changed files

- `platform/app/lukas/lib/drawing-native-dwg-selected-edits.server.ts`
- `platform/tests/drawing-native-dwg-selected-edits.test.mjs`
- `.superpowers/sdd/2026-09-06-native-dwg-geometry-resave/task-1-report.md`

No dependency, .NET, endpoint, authorization, persistence, deployment, remote, staged, committed, or pushed changes were made.

## Self-review

- Wire records contain only the exact v2 root/type fields; edits retain numeric-handle ordering and non-null requests contain at least one edit.
- Changed millimeter points/sizes use the frozen projector unit scale; unchanged LINE points, indexed polyline vertices, centers, radii, ARC angle pairs, TEXT inserts, and TEXT heights reuse raw native binding values.
- Edited ARC angles use the current start plus a strictly positive sweep without modulo normalization; raw wrapped/full-turn pairs remain untouched when angles do not change.
- The complete object set, identities, versions, names, layers, style references, kinds, and strict object schema remain enforced. Only TEXT `style.fontSize` may differ; TEXT width and every other style field remain immutable.
- Tests cover literal cm/in conversions, precision retention, all five types, TEXT movement/height/content, raw wrap/full-turn behavior, null/order/identity guards, negative sweep, width/style rejection, invalid text, projected bounds, two-polyline aggregate vertex limits, and compact UTF-8 request bytes.
- Mutation check: changing v2 back to v1, rebuilding unchanged raw fields, normalizing ARC end angles, accepting negative sweep, allowing TEXT width/non-font style, omitting bounds/vertex/byte checks, or changing numeric handle ordering each fails a named behavioral assertion.

## Limits retained

- Requests remain `experimental-unqualified` with `persistenceAuthority: "not-issued"`; this task adds no approved resave integration or browser authorization.
- Maximums remain 10,000 edited objects/handles, 100,000 aggregate vertices across edited polylines, 2 MiB compact UTF-8 JSON, ±9e9 mm projected extent, and ±999,999,999,999 finite native numbers; sizes must be positive.
- TEXT remains plain, nonempty, at most 10,000 UTF-16 units, and rejects controls, U+2028/U+2029, `%%`, and `%<` expressions.
- Unsupported/rotated/formatted text, Xrefs, unknown/proxy preservation, actual DWG mutation/readback, sandboxing, recipient qualification, and authenticated artifact delivery remain outside Task 1 and are not claimed.

## Scoped review fix round 1: native LWPOLYLINE collapse

The compiler now revalidates distinctness after projected points are converted to the final `NativePoint[]`. This prevents separately-authored millimeter values such as `0` and `Number.MIN_VALUE` from both underflowing to native zero and producing a wire-invalid LWPOLYLINE.

### RED

Command:

```sh
cd platform
node --test tests/drawing-native-dwg-selected-edits.test.mjs
```

Output:

```text
tests 41
pass 40
fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
exit_code=1
```

The failing regression was `rejects distinct projected LWPOLYLINE points that collapse to one native point`, demonstrating that the compiler emitted the collapsed native points.

### GREEN

Focused command:

```sh
cd platform
node --test tests/drawing-native-dwg-selected-edits.test.mjs
```

Output:

```text
tests 41
pass 41
fail 0
duration_ms 306.319084
exit_code=0
```

Final compiler/import verification:

```sh
cd platform
npx prettier --check app/lukas/lib/drawing-native-dwg-selected-edits.server.ts tests/drawing-native-dwg-selected-edits.test.mjs && node --test tests/drawing-native-dwg-selected-edits.test.mjs tests/drawing-native-dwg-import.test.mjs && npm run typecheck
```

Output:

```text
All matched files use Prettier code style!
tests 57
pass 57
fail 0
duration_ms 310.3075
> react-router typegen && tsc
exit_code=0
```

Changed code remains limited to the original compiler and its test; this section is the required report-only append. No limitation changed: the result remains experimental/unqualified with no persistence authority.
