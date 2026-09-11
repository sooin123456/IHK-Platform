# Consolidated final-review fix wave

Both Important findings in `final-review.md` are addressed within the three owned files. No further implementation wave or independent review was performed by this author. Work is frozen for one independent scoped rereview.

## Changes and precision policy

- ARC compilation still preserves the exact original raw pair when both displayed angles are unchanged. For changed angles it first computes the original start-plus-positive-sweep representation. Only when floating-point addition makes the represented difference exceed the strict 2π boundary, it lowers the end by exactly one representable IEEE-754 double using DataView. The end is never reduced modulo a turn. A final producer guard requires a positive represented sweep no larger than 2π and absolute sweep error no larger than the existing same-engine 1e-9 numeric tolerance; unrepresentable edits fail explicitly. No loader, source reader, projector, schema, or C# bounds were loosened.
- For the reproduced 300°/360° edit, start remains `5.235987755982989`; end changes from `11.519173063162576` to its immediate predecessor `11.519173063162574`. The corrected raw difference is `6.283185307179585`, less than 2π by about 8.88e-16, and remains a full turn at the declared 1e-9 tolerance. Actual CLI qualification, DWG readback, and the actual app projector all accept it; the projector returns exactly start 300° and sweep 360°. Thus the turn does not collapse and existing raw source pairs remain untouched.
- After request limits pass, the compiler constructs a private prospective report from the validated source report plus final native edits and calls the existing strict projector with the original import input and frozen unit selection. This uses the actual TEXT height rounding, Unicode scalar width estimate, geometry bounds, and native geometry rules. The preview result is discarded and never returned as source evidence or authority. Direct display-width edits remain prohibited. No second TEXT-width formula was added.
- Added millimeter content-growth and height-growth boundary rejections, declared centimeter content growth, selected centimeter height growth, an earlier valid LINE edit in each rejected batch, and exact input/object preservation checks. Existing normal/wrapped/raw-angle, zero-start full-turn, TEXT width/style, plain-text, raw precision, unit conversion, and request-limit coverage remains.
- The real native integration adds a separate 300°/360° app-command→compiler→unchanged native loader→DWG writer→native reader→actual projector scenario, preserving original/working-copy hashes, handle/owner/layer, non-target inventory, request bytes/digest, and qualification boundaries. Its optional summary includes the new scenario's artifact hashes. Default runs clean only their own mkdtemp directory; old retained `native-artifacts-final` was not touched.

## RED, before production edits

Working directory for all Node commands: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform`.

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-selected-edits.test.mjs
```

Exit 1, 47 tests, 41 passed, 6 failed (321.472375 ms). The ARC strict-bound assertion failed; all four TEXT cases failed with `Missing expected exception`; their parent test also failed. Existing tests passed.

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-geometry-resave-integration.test.mjs
```

Exit 1, 1 test, 0 passed, 1 failed (2891.602125 ms). Actual native CLI returned exit 2 at `nonzero-full-turn selected-edit qualification`: `InvalidDataException: DWG edited ARC angle difference must be nonzero and at most 2π.` The prior wrapped and zero-start full-turn scenarios reached successful readback before this failure. This is actual native consumer rejection of the compiler output, not a mocked loader or serialization-only assertion.

## GREEN

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-selected-edits.test.mjs tests/drawing-native-dwg-import.test.mjs tests/drawing-native-dwg-import-plan-server.test.mjs tests/drawing-native-dwg-geometry-resave-integration.test.mjs
```

Exit 0, 69 tests, 69 passed, 0 failed/skipped/cancelled (3774.2965 ms). Actual integration completed in 3671.172791 ms against the existing DLL. No native build was run.

```sh
./node_modules/.bin/prettier --write app/lukas/lib/drawing-native-dwg-selected-edits.server.ts tests/drawing-native-dwg-selected-edits.test.mjs tests/drawing-native-dwg-geometry-resave-integration.test.mjs
./node_modules/.bin/prettier --check app/lukas/lib/drawing-native-dwg-selected-edits.server.ts tests/drawing-native-dwg-selected-edits.test.mjs tests/drawing-native-dwg-geometry-resave-integration.test.mjs
NODE_OPTIONS=--no-experimental-webstorage npm run typecheck
```

Each exit 0. Prettier check: all matched files use Prettier code style. App typecheck executes `react-router typegen && tsc` and produced no diagnostics. Formatting changed test layout only; the production file was already formatted.

## Frozen code hashes and scope

SHA-256:

| File | SHA-256 |
| --- | --- |
| `platform/app/lukas/lib/drawing-native-dwg-selected-edits.server.ts` | `7c9d08e9bade1ba5133edb1ab6d3a1feed9db71ad0a96c9a555150b8f7ddc449` |
| `platform/tests/drawing-native-dwg-selected-edits.test.mjs` | `4674241325503f69f607969aa8e776733c0c8d7855c3020b1a558ac0d11fc3bd` |
| `platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs` | `f35697481acceba1db50ea46d37772c39e02e0a4ebc4ec18e3af298771dce7d2` |
| Existing `tools/dwg-engine-qualification/bin/Debug/net8.0/DwgEngineQualification.dll` | `a3c454ef94abc16d112cca4645ad1ef1974ec97e920a17bd3bc9bdb2c003b999` |

Compared all ten live whole-unit source files with `whole-unit-files.json`: only the three owned files differ; all seven native-source/README hashes remain identical. The only additional authored file is this private report. No importer/schema/other app source, C#, dependencies, native binary, retained native artifacts, commits, staging, deployment, remote service, customer file, or credential changes were made. App type generation is the normal ignored output of the authorized typecheck.

## Boundaries

This closes two local compiler correctness findings only. Same-engine synthetic proof remains experimental/unqualified with persistence authority not issued. Auth, approved jobs, source/snapshot authority, isolated workers, downloadable receipts, browser persistence/approval, recipient/corpus qualification, unknown-object strategy, production delivery, and the wider R2/R4/R5 goal remain pending. No full-goal completion or delivery qualification is claimed.
