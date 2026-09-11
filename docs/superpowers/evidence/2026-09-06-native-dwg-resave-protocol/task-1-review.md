### Spec Compliance

- ✅ Spec compliant for Task 1. All ten specified files have corresponding changes in the supplied dirty-baseline diff. The framing, unsigned big-endian lengths, preallocation bounds, exact EOF, v2-only entrypoint, generic failures, strict report fields and delayed publication follow the binding design (`NativeDwgResaver.cs:16`, `Program.cs:26`).
- ✅ The resaver reuses the existing selected-edit parser/application, native-reader validation, inventory/unknown-object gate and SemanticComparer; both roundtrips use `ExpectedEdits.None` and `1e-9` (`NativeDwgResaver.cs:33`, `NativeDwgResaver.cs:89`, `SelectedDwgEdits.cs:63`). The old path parser delegates to the new byte overload; old command dispatch remains present (`SelectedDwgEdits.cs:56`, `Program.cs:15`).
- ✅ The amended VIEWPORT scope is implemented passively, with default paper viewports retained, finite stored geometry inputs and exact plot/reference identities; the existing integration change only replaces its obsolete gap status and unsupported viewport literal (`QualificationRunner.cs:407`, `QualificationRunner.cs:428`, `QualificationRunner.cs:443`, `NativeDwgResaveSelfTests.cs:20`, `platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs:274`, `platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs:630`).
- ✅ Reader image behavior/pins are unchanged apart from the requested additional resaver label; README explains the protocol and supported-fields-only qualification limit (`Dockerfile.reader:13`, `README.md:70`).
- ⚠️ Cannot verify from this Task 1 diff: Task 2 host framing/strict report consumption, container confinement/cleanup, real current-image Docker acceptance, broader application regression checks and independent CAD qualification. These are explicitly downstream gates in `docs/superpowers/specs/2026-09-06-native-dwg-resave-protocol-design.md:92` and are not claimed completed by this review.
- ⚠️ The earliest absent-command RED is reproduced in `workspace/task-1-report.md` from the original tool transcript; this review did not independently inspect that historical transcript. Current retained build/self-test logs were inspected directly.

### Strengths

- Validation and both semantic comparisons complete before the first output write; partial transport failure is explicitly distinguished from native/request failure (`NativeDwgResaver.cs:37`, `NativeDwgResaver.cs:75`).
- Tests exercise the actual binary CLI and chunked nonseekable input, assert exact report keys/statuses/hashes/order, check literal geometry for all five types and retained untouched geometry, and require generic stderr with zero success bytes on rejection (`NativeDwgResaveSelfTests.cs:49`, `NativeDwgResaveSelfTests.cs:60`, `NativeDwgResaveSelfTests.cs:174`).
- Output memory is bounded before writes and backing-array growth, with focused boundary assertions; plot names and object references avoid numeric-tolerant geometry comparison (`NativeDwgResaver.cs:115`, `NativeDwgResaveSelfTests.cs:127`, `QualificationRunner.cs:428`).

### Issues

#### Critical (Must Fix)

- None found in the reviewed Task 1 change.

#### Important (Should Fix)

- None found in the reviewed Task 1 change.

#### Minor (Nice to Have)

- `workspace/self-test-green.log:19`: the successful full self-test run still emits legacy negative-test exception messages and temporary failure-report paths. This is pre-existing and disclosed, and the new resave rejection tests separately require the fixed public diagnostic, so it is not a resaver leakage/blocking finding. Capture and assert expected legacy failure diagnostics in their tests so a green suite has clean output.

### Checks and Review Boundaries

- Read the exact 1,266-line task diff in three bounded chunks; recovered only the README sentence truncated by output transport. No git commands, test reruns, subagents, dependency changes or application/build writes were performed. This review report is the only write.
- Named risk check — shared native-reader validation could be bypassed by the new helper: inspected the continuation of the cut-off `BuildReport` function (`NativeDwgReader.cs:109`). It still enforces layer/entity/aggregate-polyline budgets, object identities, entity owners/layer references and Xref rejection before returning the validation result. The new call is at `NativeDwgReader.cs:87`.
- Named risk check — new viewport references or selected handles might receive comparison exemptions: inspected unchanged `QualificationCore.cs:178`. Entity type/owner/layer/text/reference and document identities are compared exactly, geometry uses the supplied tolerance, and the new resaver passes `ExpectedEdits.None` for both comparisons (`NativeDwgResaver.cs:107`). No broader repository inspection was performed.
- Inspected retained `workspace/build-green.log:1` and the tail of `workspace/self-test-green.log`: build reports zero warnings/errors; all six added resave/viewport tests pass and the suite concludes `41 passed, 0 failed`. The report's additional lower-level three-flow integration and three framed-flow evidence were read as reported evidence, not rerun or independently revalidated here.

### Assessment

**Task quality: Approved.**

**Reasoning:** The implementation is narrowly scoped and reuses the established validation and comparison contracts. The tests cover the protocol's meaningful success/rejection behavior and viewport amendment; no concrete correctness or maintainability blocker was found, with downstream confinement and qualification remaining explicit.
