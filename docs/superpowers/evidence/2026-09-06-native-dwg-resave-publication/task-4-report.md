# Task 4 — authenticated imported-DWG product wiring

Implementation source frozen for controller owned-copy build. Final combined rerun is GREEN; controller build result is recorded separately below.

## Scope and implementation

Implemented the two authenticated resource routes, strict request/cancel body and GET query parsing, trusted server image admission, completed-only exact receipt lookup, private verified four-file downloads, a browser-safe public Zod DTO module, one conditional imported control in the existing lazy export dialog, actor pass-through, and a direct strip-only Node resave worker entry/package script.

The download performs descriptor → Storage stream and independent SHA256/size → fresh descriptor equality → attachment. Every received chunk is copied before another await. A bounded race surrounds the entire GET operation, including abort-ignoring client creation, Storage headers/body and cancellation. Cancellation is requested without awaiting an indefinitely pending cleanup promise. This does not apply to POST or publication settlement.

The control uses versioned localStorage containing only a request UUID, partitioned by normalized actor and exact six-field scope. It reads latest on opening/remount/relogin and never POSTs on opening. Explicit retry preserves an uncertain ID. Only explicit new request after failed/cancelled mints a replacement. Own cancel requires the local actor/scope request UUID to match the displayed job. Actor, scope, readiness and open lifecycle transitions allocate fresh generations, including A→B→A. Four links require the shared strict completed receipt, exact scope and matching job.

The CLI uses the accepted `callNativeDrawingDwgResaveAttemptRpc` (its existing 5s deadline), strict claim parser and `runNativeDrawingDwgResaveToStorage`. It composes the existing RPC fetch/source transport and Task1 Storage transport. A claim received during shutdown enters Task3 for fenced settlement. Every outcome receives an abortable poll wait. Logs contain fixed events and outcome strings only. Two error classes now use explicit readonly fields instead of non-erasable parameter properties, preserving names, kinds and messages.

## Exact changes

All eight existing-file baseline hashes in task-4-baselines.md were rechecked against the original files before editing and matched. New files use `/dev/null` as review baseline. Exactly these 18 implementation/test files changed; the report is the sole extra evidence file. Paths below are relative to `platform/`.

| File | SHA256 |
| --- | --- |
| app/routes.ts | 4c99a2fdf4eae975228ef3ae38712afeaff085c9fecdca135d792e638ceea045 |
| app/lukas/lib/drawing-workspace-paths.ts | d040e7448611f49af42d4e754d016e5a2d7a116837fc46ea0aa672ea4cdf9f0a |
| app/lukas/components/drawing-export-dialog.tsx | 153f6fa0c45c0b9eeceba5a2e2fed9fc12e4bbac3613a2224f8d413b60c36824 |
| app/lukas/components/drawing-workspace.tsx | 40f43f2a38c707d61f8bce7e64a3a666f9b6cf958e524e0ff4a8d5fc13b1be4c |
| app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts | 786d3d047fbc5178159f160124dcf4f0b61551c2b9420f933afef8a12c8366e0 |
| app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts | 0396f4abfd4cd5c6b55f6d91bd9fd50d657155601c6ce84f9913c0c572c114f8 |
| app/lukas/lib/drawing-native-dwg-jobs.server.ts | 4caf9b30b29a9a84e17a3cb73ae85d989701e25b08be3c52f016b6f19a5c5eb7 |
| package.json | b3316cbb30ce5c955f596693b5dd9085fea0403b26c5802b5a1112dbad38ce49 |
| app/lukas/lib/drawing-native-dwg-resave-resource.server.ts | fc07c04b31ca9269b7937fc72281c11aedf034d0843b5dd1fc8fcd86e032a681 |
| app/lukas/lib/drawing-native-dwg-resave-download.server.ts | 8aae313e8ddcc72c85a8fa82912f0f2ae2849a8a25bd2314dcc1bf5a32d5a5fa |
| app/lukas/screens/drawing-native-dwg-resave.ts | d93f70bda8f300117527c7fcdb601c9ce1a8e82839af445163cf6542937e16f5 |
| app/lukas/screens/drawing-native-dwg-resave-download.ts | 17cfe12a8deb8b1f632a2f670901fd8e8c7ffa09f0422dd24402b1a0540f45ec |
| app/lukas/components/drawing-native-dwg-resave-control.tsx | bb3426178f999c5dbe1aa7ff887190bf8b10b8fc6db9e770c269fc14c9efaa51 |
| app/lukas/lib/drawing-native-dwg-resave-contract.ts | ca26c5db8910f92f346da86a6972359aa8e22582e37385723a25989f08b718b7 |
| native-dwg-worker/src/resave.ts | ee907f82e4605056dffcff15e7677b9d1710835304fefdac811b4c0dfe7641a2 |
| tests/drawing-native-dwg-resave-resource.test.mjs | 0f003ee3ec46feb48f658f352210174302b5c14f695f1687ca1d25fa72a20f1c |
| tests/drawing-native-dwg-resave-control.test.mjs | c41bb7f08c96864a2d147bf66b6d02b26a462e067e150f432175e172ec0d0944 |
| tests/drawing-native-dwg-resave-entry.test.mjs | c01ba555ace79ef63080c06281d2f1c5aadd40490827e28f537ebe14007e70e8 |

Accepted Task3 files independently rehashed unchanged: publication `0983a6c68fe1f9f8d3f9f4ddea376f81a7f323cff7fc745aafaa708c0c4612e3`; worker `cdcbc6eb52332e12f754e5212921bd212bf1828d4cc90f5fc6f7c4496cde606b`.

## RED and GREEN evidence

Working directory for all commands is `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform`. Node is v26.5.0. Every Node command uses `NODE_OPTIONS=--no-experimental-webstorage`.

1. Before resource/download production files: `node --test tests/drawing-native-dwg-resave-resource.test.mjs` → exit1, tests5/pass0/fail5. Primary assertions reported expected `function`, actual `undefined` for absent resource/download exports; dependent calls failed because the handlers were absent. After implementation: tests5/pass5/fail0; expanded delegate/auth test suite now6 tests.
2. Before CLI production entry: `node --test tests/drawing-native-dwg-resave-entry.test.mjs` → exit1, tests3/pass0/fail3: absent config/worker exports and actual child exit1 instead of0. After adding entry but before constructor conversion: `node --experimental-strip-types --input-type=module -e 'await import("./native-dwg-worker/src/resave.ts")'` → exit1 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, resave jobs constructor `readonly kind`, Node26.5.0. After narrow two-constructor conversion: original3 tests GREEN; expanded exact error and actual source/refusal subprocess checks make5/5 GREEN.
3. Before contract/control/dialog wiring: `node --test tests/drawing-native-dwg-resave-control.test.mjs` → exit1, tests4/pass0/fail4: missing schema export, absent component could not load the browser fixture, missing workspace actor callsite. After implementation and correcting a test selector from nonexistent format `<select>` to the actual DWG radio:4/4 GREEN. Expanded remount/own-cancel/retry and scope/open/storage-denial checks make6/6 GREEN.
4. After DTO extraction: `node --test tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-jobs.test.mjs tests/drawing-native-dwg-resave-artifact-jobs.test.mjs` → exit0, tests20/pass20/fail0. All accepted shape/refinement, compiler, exact receipt and descriptor behavior remains gated by the original suites.

Harness corrections are not production fixes or independent RED claims: the mutable stream fixture now uses `highWaterMark:0` so it mutates only on the next consumer read; the child SIGTERM harness sends its signal once instead of again on the stopped log; the dialog test clicks the real radio; the extra loopback CLI test uses the actual `lukas_drawing_native_dwg_resave_control` name. Supplemental regression tests were added after the initial RED/GREEN cycle and are not represented as separate preimplementation RED evidence.

## Focused combined regression command

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-resource.test.mjs tests/drawing-native-dwg-resave-control.test.mjs tests/drawing-native-dwg-resave-entry.test.mjs tests/drawing-native-dwg-jobs.test.mjs tests/drawing-native-dwg-export-ui.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-export-approval-ui.test.mjs tests/drawing-workspace-p2-contract.test.mjs tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-jobs.test.mjs tests/drawing-native-dwg-resave-artifact-jobs.test.mjs tests/drawing-native-dwg-resave-worker.test.mjs tests/drawing-native-dwg-resave-publication.test.mjs tests/drawing-native-dwg-import-worker.test.mjs
```

Initial combined run:221 tests,220 pass,1 test-only wrong RPC-name failure noted above. Final frozen-source rerun: exit0,221 tests,221 pass,0 fail,0 cancelled,0 skipped, duration22649.843375ms. Output includes all17 new resource/UI/entry tests, original source-free UI/direct DXF rejection/download tests, accepted20 artifact/jobs/adapter tests, Task3 publication/worker tests and the original actual import CLI subprocess test.

Formatting verification: `NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/prettier --check` on the new control, edited dialog/path helpers, both resources, public contract, three affected jobs/artifact modules, new screen delegates, CLI and three new test files → exit0, `All matched files use Prettier code style!`.

## Type checking and owned build

`NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/tsc --noEmit --incremental false --pretty false` currently reports exactly2 missing generated `./+types/drawing-native-dwg-resave` and `./+types/drawing-native-dwg-resave-download` modules. No implementation TypeScript error remains. The authority worktree's `.react-router` and `build` were not regenerated. The controller owns full typegen/build from the frozen source in `/Users/h/1hk-r2-restore-uvc74K/platform`.

## Self-review / React / Supabase

- The eight pre-task deltas and all new files are the review scope. Source-free resource/download/control code is untouched. The source-free jobs file changes only the erasable error constructor; its exact behavior has a covering test. Existing source-free DXF rejection, lifecycle, UI, path, HTTP and download tests remain included.
- Self-review inspected actual `diff -u` for all eight baseline pairs: only two new routes, two helpers, one dialog branch plus optional actor prop, one workspace actor line, the DTO extractions, two error constructors and one package script. No unrelated baseline delta was introduced. The accepted Task3 hashes were rechecked again after the final221-test run and remain unchanged. No unresolved implementation finding was identified; full-stack/live service boundaries below remain explicit.
- Public DTO shapes and refinements were extracted from accepted code. Descriptor, claim, compiler, crypto, source locators and native code remain server-only. The browser control's runtime imports are React, Zod, Button, the public contract and path helpers; actual Vite/Chromium loading succeeds.
- Existing Button and dialog styling and native anchor downloads are reused. No new state library or dependency. The lazy dialog boundary is preserved, with only `currentUserId` added at the workspace callsite.
- Effects use stable actor/scope/open/readiness identity and a stable lifecycle token, explicit abort and timer cleanup. Generation fencing protects actor/scope/open A→B→A, and request flight refs synchronously suppress overlapping admission clicks. Storage reads/writes are exception-safe, versioned and minimal.
- Buttons are `type="button"`, disable unavailable/busy actions, status and alert copy uses live roles, and downloads have descriptive labels. The experimental warning explicitly disclaims independent CAD qualification and issued persistence authority.
- Service credentials never cross the browser boundary. Admin loading follows authenticated admission or a validated user descriptor; idle/latest/cancel require neither admin credentials nor image config. No user_metadata-based authority, no client actor/image/path admission, no SQL or remote state changes. Supabase changelog/docs were checked; recent relevant SDK initialization and existing Storage streaming APIs are reused. No schema/API redesign was introduced. The generated DB types predate the accepted RPCs, so only route binding casts through `unknown` to the already validated adapter contracts.
- No stage, commit, merge, push, deploy, lockfile/dependency changes, source/original/approved-byte mutation, original4173 restart/rebuild, Task3 publisher/native-worker/SQL edit, or private `.superpowers/sdd` artifact/script use.

## Evidence boundaries

Controller supplement: all18implementation/test files were copied to the physically owned build directory and independently SHA-checked against the frozen table. NODE_OPTIONS=--no-experimental-webstorage npm run build there includes route typegen+tsc and exited0; exact controller-task-4-build.log. Existing large chunks/ReactRouter future flags/mixed BOQ import/unsigned-theme-cookie warnings remain. Controller fresh six-file new-resource/control/entry+artifact/jobs/adapter covering run37/37/0skip5366ms/exit0; exact controller-task-4-tests.log. No original4173 assets/typegen or app runtime changed. Independent task review remains separate from these checks.

- Resource tests use real request/response streaming, actual production compiler/attestation/protocol fixtures and RPC/Auth/Storage doubles with exact names/arguments. They prove the adapter contracts, not live Supabase authentication/authorization.
- Download tests exercise actual loopback HTTP stalled bodies and real Web Streams, plus abort-ignoring header/body/cancel doubles. Hashes are independently computed on returned bytes and literal finite artifacts. They do not measure the200MiB boundary's production memory/performance or use live Storage policy enforcement.
- UI tests run real React `createRoot`, controls/dialog, user events and localStorage in Chromium on ephemeral owned loopback servers. The Radix dialog shell alone is replaced for test mounting; transport responses are finite doubles. The workspace actor callsite has explicit source coverage; the full live workspace/auth chain belongs to Task5.
- Entry tests spawn actual `node --experimental-strip-types native-dwg-worker/src/resave.ts`. They prove production dependency construction, exact HTTP claim/source authorization, safe native-launch refusal, per-turn poll spacing and SIGTERM shutdown. The successful artifact fixture is a finite protocol fixture, not a real native DWG conversion. No production worker or native publication was started here.
- Actual Auth/PostgREST/Storage/native/browser publication, full original-byte preservation story and independent recipient CAD qualification remain Task5/recipient acceptance. This report does not claim them.
