# Task 3 — real app-command to native geometry resave

## Scope and files

- Created `platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs`.
- No production, C#, fixture-helper, dependency, stage, commit, deployment, or remote changes were made by Task 3.
- Task 3 did not run `dotnet build`; GREEN used the stable Debug DLL supplied by Task 2.

## TDD evidence

RED used the captured, real pre-change engine rather than a fake writer:

```sh
cd /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform
NODE_OPTIONS=--no-experimental-webstorage \
NATIVE_DWG_GEOMETRY_TEST_ENGINE_DLL=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-geometry-resave/baseline-engine/DwgEngineQualification.dll \
node --test tests/drawing-native-dwg-geometry-resave-integration.test.mjs
```

Result: exit `1`, `0/1` passed. The v2 compiler reached the actual old CLI; `qualify` returned exit `2` with `InvalidDataException: DWG edit schema or coordinate policy is unsupported.` This is the expected missing-consumer RED.

GREEN after Task 1 was quiescent and Task 2 declared the Debug build stable:

```sh
cd /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform
NODE_OPTIONS=--no-experimental-webstorage \
node --test tests/drawing-native-dwg-geometry-resave-integration.test.mjs
```

Final accepted-code result: exit `0`, `1/1` passed, `0` failed, `0` skipped; Node-reported duration `2807.329958 ms`. The exact final Debug DLL SHA-256 was independently checked as `80c80237c05bb5e9fc48fb79846b5d29215d1de46556d839c5ed14dc1d0b312f` immediately before this run.

## Real pipeline proved

The test invokes `/opt/homebrew/bin/dotnet` and the built `tools/dwg-engine-qualification/bin/Debug/net8.0/DwgEngineQualification.dll` by default. It performs two fresh actual CLI flows:

1. `create-generated-fixture` → `read-native` → `projectNativeDrawingDwgImport` → `createDrawingDocumentState`/`applyDrawingCommand` updates for LINE, LWPOLYLINE, CIRCLE, ARC, and TEXT → `buildNativeDrawingDwgSelectedEdits` v2 → `qualify --edits` → `read-native` on `edited-roundtrip.dwg`. The edited ARC crosses the 360-degree boundary with literal `300°` start and `390°` raw end.
2. A separate actual `qualify --edits` and `read-native` flow verifies literal `0 → 2π` full-turn ARC readback.

Assertions include the original normal ARC; literal edited geometry with absolute tolerance `1e-9`; selected handle/owner/layer identity; exact untouched VIEWPORT, ordinary-block LINE/CIRCLE, INSERT and block membership inventory; exact source and working-copy SHA-256 preservation; exact retained request bytes and request digest; output-DWG/read-report SHA binding; and experimental/unqualified/not-independently-verified flags.

## Runtime, output, and evidence controls

- `NATIVE_DWG_DOTNET_PATH`: optional absolute executable override.
- `NATIVE_DWG_GEOMETRY_TEST_ENGINE_DLL`: optional absolute DLL override.
- `NATIVE_DWG_RESAVE_EVIDENCE_DIRECTORY`: optional absolute, fresh, non-existing directory. If present, the test refuses overwrite and retains generated input, source report, both exact requests, both qualification outputs, both readbacks, and `integration-summary.json`.
- Without the evidence override, the test uses a unique private `mkdtemp` root and registers cleanup for only that owned root, including on failure.
- Every child process has a 120-second timeout, a shared 64-KiB stdout/stderr ceiling, a fixed credential-free environment, and no shell. Missing prerequisites fail the test; nothing is skipped.

## Boundary

This is same-engine local synthetic roundtrip evidence only. It does not exercise or qualify authentication, database/storage authority, worker/browser delivery, customer files, an OS sandbox, independent CAD acceptance, or production DWG delivery.
