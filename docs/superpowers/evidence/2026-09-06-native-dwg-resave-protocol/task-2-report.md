# Task 2 implementation report

Status: DONE. No commits created. This completes Task 2 only; it does not complete the full Universal Workspace goal.

## Implemented

- Added the pure host resave protocol module with strict public report schema, synchronously copied source/request inputs, frozen identities and handles, exact 16-byte big-endian framing, strict UTF-8/BOM and byte budgets, v2 metadata/source binding, canonical unique handles and supported edit types, exact output EOF, independent DWG SHA/header/length checks, ordered request identity checks and fixed unqualified verification statuses.
- Request geometry and duplicate-key validation remain in the accepted native v2 engine. The host preserves the exact original JSON bytes, including duplicate keys, so native validation cannot be bypassed by host reserialization.
- Shared the existing private Docker lifecycle between a closed reader/resaver catalog. New public APIs are only nativeDwgResaveSandboxCreateArguments and runIsolatedNativeDrawingDwgResaver. No public arbitrary-command, environment, mount or runner API was added.
- Resaver fixes the separate ownership/name/image protocol, resave-native-stdio command and 2147483648-byte memory/swap receipt. Reader retains 1073741824 bytes, its existing command/argv and exact public error. Shared stdin streaming uses chunks/backpressure and an explicit stdout budget: metadata 64KiB, reader 32MiB, resaver 16 + 1MiB + 200MiB.
- Both profiles inspect actual daemon/image/container policy, use the existing isolated CLI config, outer/inner bounded execution, independent 10000ms cleanup, owned-identity reconciliation after uncertain create, and final caller mutation/cancellation checks after container and config cleanup. All resaver failures redact to "Isolated native DWG resave failed."
- Extracted the existing finite transport into one fixture shared by old reader and new resaver tests. Existing reader test bodies from the first test() through EOF are byte-identical. There is no duplicate fake daemon or security lifecycle.
- Added real Docker integration covering generated source → isolated reader → projector → drawing command → selected-edit compiler → isolated resaver → isolated reader. Retained actual geometry, hashes, receipts, cgroup probe and full passive inventory evidence.

## TDD and test results

All commands below were run in /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform unless otherwise noted.

### RED before production implementation

1. node --test tests/drawing-native-dwg-resave-protocol.test.mjs

   6 tests, 0 pass, 6 fail. Each failed the explicit absent-API assertion: "Required protocol API absent: NativeDrawingDwgResaveReportSchema". Captured in workspace/task-2-protocol-red.log before creating the production protocol module.

2. node --test tests/drawing-native-dwg-resave-sandbox.test.mjs

   18 tests, 0 pass, 18 fail. Explicit assertion: "Required isolated resaver API absent" (undefined instead of function). Captured in workspace/task-2-sandbox-red.log before implementing the closed resaver lifecycle.

3. First protocol implementation run: 5/6 passed; the remaining failure identified an independently hand-written fixture length error (AC1024original is 14 bytes, not 13). Corrected that literal to 14; no production relaxation.

4. node --test tests/drawing-native-dwg-resave-sandbox-integration.test.mjs without required environment

   3 fail, 0 skip, explicit "Required actual resave prerequisite unavailable: NATIVE_DWG_DOCKER_PATH". workspace/task-2-integration-prerequisite-red.log demonstrates missing actual prerequisites fail instead of silently skipping; this is prerequisite evidence, not a substitute for the production TDD RED runs.

### GREEN

Focused protocol + new resaver + existing reader finite tests:
```sh
node --test tests/drawing-native-dwg-resave-protocol.test.mjs tests/drawing-native-dwg-resave-sandbox.test.mjs tests/drawing-native-dwg-sandbox.test.mjs
```

42/42 pass (6 protocol, 18 new resaver, 18 existing reader). No skips.

Final requested regression suite:
```sh
node --test tests/drawing-native-dwg-resave-protocol.test.mjs tests/drawing-native-dwg-resave-sandbox.test.mjs tests/drawing-native-dwg-sandbox.test.mjs tests/drawing-native-dwg-reader.test.mjs tests/drawing-native-dwg-selected-edits.test.mjs tests/drawing-native-dwg-source.test.mjs tests/drawing-native-dwg-resave-source.test.mjs
```

186 tests, 186 pass, 0 fail, 0 cancelled, 0 skip; duration 39011.943ms; exit 0. Completion excerpt retained in workspace/task-2-regressions-green.log. Counts include subtests. This includes an actual .NET reader test as well as host/adapter/double cases; it is not represented as 186 CAD/kernel proofs.

```sh
npm run typecheck
# > react-router typegen && tsc
# exit 0
git diff --check
# no output, exit 0 (repository root)
```

Typecheck evidence: workspace/task-2-typecheck-green.log. No app build was run. Since these Task2 files are untracked on the pre-existing dirty branch, git diff --check alone does not inspect them: all seven current file hashes were checked against workspace/task-2-files.json, each file was separately checked for trailing whitespace/final newline, and targeted Prettier formatting was run. 7/7 hashes match, no trailing whitespace, all final newlines present.

No semantic production changes followed the successful real Docker runs. Only formatting was applied to the production files; the old reader test subsequently had now-unused extracted imports removed. Existing reader test case bodies remain byte-identical.

Accepted Task1 self-test evidence (not rerun or reimplemented here): workspace/self-test-green.log ends "41 passed, 0 failed". All 10 Task1 files still match task-1-files.json, and the supplied Debug DLL SHA remains exactly the accepted value below.

## Actual Docker build and provenance

Executed at repository root:
```sh
/opt/homebrew/bin/docker --host unix:///Users/h/.colima/default/docker.sock build --pull=false --network=none -f tools/dwg-engine-qualification/Dockerfile.reader -t 1hk-task2-resave-20260906-7ac831 --iidfile .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/task-2-image.id tools/dwg-engine-qualification
```

Build succeeded from current native source with the cached pinned SDK/runtime inputs and cached locked-mode restore layer 3487ed3a97d0. No network, pull, dependency installation or upgrade. The first invocation included --progress=plain; this Docker installation uses the legacy builder and rejected that flag before building. Retried with supported flags; no buildx installation. The legacy-builder warning is recorded, not hidden.

- Image: sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae
- Owned tag: 1hk-task2-resave-20260906-7ac831:latest
- Created: 2026-09-06T15:05:32.801373869+09:00
- Pinned SDK: sha256:bb32ba3ba3ea36e38572d9d8db76fa15f7cbf722f3f886e06bca6d528bd4fba8
- Pinned runtime: sha256:9d94ecf60a21c6e7a784cf0761fbd4a8391646617a0ff2f39621443d580cc2c3
- Native source input build SHA: 0d9e421cf1765fadc84c4f290839fdca13a72a3e40f4814fd91f05bf911fe168
- Actual image /app published build SHA: 777c549785783ad0d2c4c8f01752cf1975d407410005dc373470501df1e4c52a
- Actual image Release DwgEngineQualification.dll SHA: 535b03b674d7bec7422df0c8f96c02d24b11cbe98a322c3f0ddc4cb059a9b17f
- Accepted local synthetic-generation Debug DLL SHA: 51b2f0f6bda21b5dd1dfcb93cb7a06ad3b6b382cfdb4bfa9a7051734f383132a

Source build SHA hashes the sorted input filenames, NUL, ASCII byte length, NUL, exact contents, NUL; the input list and individual hashes are in workspace/task-2-files.json. It covers *.cs, csproj, packages.lock.json, notices, Dockerfile.reader and .dockerignore. Published build SHA is the existing calculateNativeDwgWriterBuildSha256 result on an actual docker cp of /app to workspace/task-2-image-app. Copy used an owned, inspected, never-started container and removed it after exact ownership checks. Copy-container ID/name and full provenance are retained in workspace/task-2-image-provenance.json. Different Release/Debug assembly hashes are expected; source inputs remain the accepted current code.

## Actual integration commands and results

Real resaver:
```sh
NATIVE_DWG_DOCKER_PATH=/opt/homebrew/bin/docker \
NATIVE_DWG_DOCKER_HOST=unix:///Users/h/.colima/default/docker.sock \
NATIVE_DWG_RESAVER_IMAGE_ID=sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae \
NATIVE_DWG_RESAVE_SANDBOX_EVIDENCE_DIRECTORY=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/task-2-actual-first \
NATIVE_DWG_RESAVE_TEST_ENGINE_DLL=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/bin/Debug/net8.0/DwgEngineQualification.dll \
NATIVE_DWG_DOTNET_PATH=/opt/homebrew/bin/dotnet \
node --test tests/drawing-native-dwg-resave-sandbox-integration.test.mjs
```

3/3 pass, 0 skips, exit 0. workspace/task-2-actual-green.log contains complete output. Retained artifacts in workspace/task-2-actual-first:

- source SHA: 8d9ae187d7a046735149ce1dd2e362720bb0fb3c80b060c9d8ea31f0e697fcc1, 10987 bytes, AC1024, units 4.
- Exact request SHA: b5bdbcdfba6754fa7ebdfd41cf2e829c220a6059cc4cac104278c44da48caeab.
- Exact report byte SHA: 7140063642e650bba2f7bd12197b31cb5aa480af3b9f99dfeba3494c14659643.
- Output SHA: 0b4efe038e95b3fe8ee9e96f3d2f332e75bd7ae4265c4caa4ad340983cbf5616.
- Literal edits: LINE [10,11,0]→[120,21,0]; CIRCLE center [12,14,0], radius 7; ARC center [45,30,0], radius 9, 300°→390° within 1e-9; LWPOLYLINE [[1,12,0],[16,20,0],[31,12,0],[1,12,0]], closed false; TEXT insert [8,42,0], height 3.25, "수정된 실명".
- Exact ordered handles 4A,4B,4C,4D,4E and original entity ownership/layer identities retained. Source bytes and original on-disk SHA unchanged. Source/output units/header, layers, coverage and unsupported inventory agree.
- Nine inventoried entities; untouched default paper-space VIEWPORT 47, block LINE 52, block CIRCLE 53, INSERT 54 and passive document inventories agree exactly. Local current native qualify commands independently captured before/after passive inventories for these assertions; those are same-engine verification, not independent CAD.
- success-before.json/success-after.json are real daemon receipts for the actual native run: created/exited, fixed resave command and 2147483648 memory/swap. cgroup-probe.txt/cgroup-receipt.json prove actual memory.max=2147483648, memory.swap.max=0, CPU 100000/100000, pids64, UID65532, seccomp2, no-new-privileges, zero capabilities, loopback-only networking, no host mounts, failed readonly-root write and writable constrained tmpfs.
- Real malformed stream produces no stdout and fixed native stderr; zero-length LINE geometry fails through the actual native resaver; source mismatch fails before spawn. A real started container was observed before caller abort and before outer deadline. Owned containers disappear and a separately owned foreign sentinel survives each attempted operation until the test explicitly cleans its own sentinel.
- The cgroup/inner-deadline test uses a test-local command replacement on the generated profile for /proc probes and a finite sleeper. The production API remains fixed to resave-native-stdio. Success/rejection tests invoke the actual fixed native command. The forwarding shim only records/forwards actual Docker operations and coordinates cancellation; it does not fabricate receipts or native output.

Old reader actual regression on the same current image:
```sh
NATIVE_DWG_DOCKER_PATH=/opt/homebrew/bin/docker \
NATIVE_DWG_DOCKER_HOST=unix:///Users/h/.colima/default/docker.sock \
NATIVE_DWG_READER_IMAGE_ID=sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae \
NATIVE_DWG_PUBLISHED_DIRECTORY=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/bin/Debug/net8.0 \
NATIVE_DWG_DOTNET_PATH=/opt/homebrew/bin/dotnet \
TMPDIR=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace \
node --test tests/drawing-native-dwg-sandbox-integration.test.mjs
```

5/5 pass, 0 skips, exit 0. workspace/task-2-reader-actual-green.log contains complete output, including memoryMax=1073741824, seccomp2, zero capabilities, UID65532, no inherited synthetic secret, exact parallel source geometry, timeout and cancellation cleanup. Old reader integration source file was not edited.

## Files changed and final hashes

Full path prefix: /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/

| File | SHA-256 |
| --- | --- |
| platform/app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts | 54c8e3b032464dbeaf5718f6f849c8f4b4d1d6152d680d89d178ce4fe9e1bc08 |
| platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts | 87e62b6ddea49c0af38cc37a0681d6a587812106f3ecdef4b646bf503153f54c |
| platform/tests/drawing-native-dwg-resave-protocol.test.mjs | ec23975ccbb52fa5e8bd358a9e5a4d77722fa855a442e9b6b4c5c6adbf0e53eb |
| platform/tests/drawing-native-dwg-resave-sandbox.test.mjs | 3a49aa4dfe29eabca946b3ceb806f2e7ed08da1dcd6ded2743b4c0cf10e53f87 |
| platform/tests/drawing-native-dwg-resave-sandbox-integration.test.mjs | f353fffb15c8f181d3a55482b3643f44afbbd154301be0d400feea7a1eff7497 |
| platform/tests/drawing-native-dwg-sandbox.test.mjs | 3499141bf9197e04157872241440eae890b9940b4708d4b977abf1885271f043 |
| platform/tests/fixtures/drawing-native-dwg-sandbox-transport.mjs | d0311521371cde4bf1c098b692b961571c629a8a8a3f445d2671ed97615a1e38 |

Task2 working evidence/report artifacts are confined to this plan's private workspace/report path. No accepted Task1 file changed. Shared sandbox grew from 518 to 612 lines; it continues using one lifecycle. The 665-line real integration test includes the real CLI helpers, receipt capture, geometry/inventory assertions and confinement/cancellation probes in the required single test file; no extra public runner or service was created.

## Cleanup, self-review and limits

- Final successful query: docker container ls --all --no-trunc --filter ancestor=sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae returned empty output. Test and image-copy containers are removed; the builder reported removal of its intermediates. No test services remain.
- The owned new image and generated evidence are intentionally retained for parent review/reproduction. No image prune, old-image mutation or unrelated-container removal occurred.
- Finite transport doubles prove host validation, bounds, environment/config isolation, uncertain creation ownership, source AND request mutation, abort at start/removal/config cleanup, wrong receipts and cleanup-failure redaction. They are not CAD/kernel evidence.
- Real tests supply the separate current-native/Docker/kernel proof above. Results remain experimental-unqualified, persistenceAuthority not-issued, inventoryCoverage supported-fields-only and independentCad not-performed.
- Self-review confirmed exact old-reader test bodies, accepted Task1 hashes, current file hashes, snapshot timing, byte order, ownership cleanup, strict report bindings and absence of new public configurable execution surfaces. No unresolved Task2 correctness issue identified.
- No commit, stage, merge, push, deployment, dependency installation, paid service, remote database/Storage write, customer file, root native bin/obj write, live platform/build write or preview restart.
- Remaining full-goal gates are unchanged: imported-resave job orchestration and cancellation API; immutable attested Storage artifacts and receipt-only downloads; full Auth/Storage/browser acceptance; independent CAD/corpus qualification; R5 package from the same approved revision. No persistence/delivery authority is issued by this work.
