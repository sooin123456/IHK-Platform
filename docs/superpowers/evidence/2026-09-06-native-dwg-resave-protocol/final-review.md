# Final isolated native DWG resave unit review

## Assessment

**Ready for unit acceptance: Yes.** No Critical or Important issue was found in the exact 17-file unit. Its native producer, strict host consumer and closed Docker profile agree, and the retained final verification passes on the reviewed file hashes. This is acceptance of the experimental protocol unit only; no commit, staging, merge, deployment, persistence authority or full-goal completion is authorized or implied.

## Scope and plan alignment

Reviewed the complete spec `docs/superpowers/specs/2026-09-06-native-dwg-resave-protocol-design.md`, complete implementation plan `docs/superpowers/plans/2026-09-06-native-dwg-resave-protocol.md`, both task reports and both task reviews. The review base is the supplied dirty-baseline capture with unchanged HEAD `9f5f56d93db325ff935772252f9d4fb64d69f98c`, not a diff against HEAD.

Read all 3,838 lines of `final-unit-diff.md` once in bounded passes. One output was truncated; only the missing QualificationRunner/README portion was recovered. The supplied scope contains exactly ten Task 1 files and seven Task 2 files. The passive VIEWPORT amendment is intentional and implemented: ordinary paper-space viewports remain in generated fixtures and real execution. The existing geometry integration updates its obsolete gap status and viewport literal while retaining complete untouched-entity comparisons.

The implementation meets the unit's stated division of responsibility. Native code owns full v2 validation and supported-field semantic preservation. The host owns snapshot binding, strict output validation, confinement, resource receipts and lifecycle completion. Existing compiler/source-bridge authority remains upstream; no new route, job, storage or UI behavior is introduced. Task 2's plan checkboxes remain unchecked in the supplied plan despite completed report/evidence; reconcile that tracking state during controller handoff, without interpreting it as missing implementation.

## Strengths

- **Producer/consumer alignment:** `tools/dwg-engine-qualification/NativeDwgResaver.cs:16` and `platform/app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts:8` use the same input/output magic, unsigned big-endian request/source and report/DWG ordering, exact EOF, and 2 MiB/200 MiB/1 MiB/200 MiB budgets. Native length checks precede payload allocation. Host literal frame tests are independent of the production encoder.
- **Exact request and result identities:** the encoder synchronously copies source/request bytes, freezes parsed identities and ordered handles, checks hash/header/source binding, and forwards exact JSON bytes. Native duplicate-key and complete geometry validation are therefore retained rather than bypassed by reserialization. Decoding independently checks output hash/header/length, ordered request identity and every fixed qualification/status field. The public report is allowlisted and carries `experimental-unqualified`, `not-issued`, `supported-fields-only` and `not-performed` consistently.
- **Whole supported inventory preservation:** `NativeDwgResaver.cs:37` validates the source through the shared native reader, rejects explicit inventory gaps and unwritable retained objects, compares a no-edit readback, validates/applies the entire selected batch, then compares the output with the exact expected post-edit inventory. Both comparisons use `ExpectedEdits.None` at absolute tolerance `1e-9`; selected handles do not receive geometry exemptions. Output is reader-validated before any success bytes are written.
- **VIEWPORT preservation has concrete coverage:** `tools/dwg-engine-qualification/QualificationRunner.cs:407` adds passive stored geometry/view/plot fields and places plot names and relevant references in the exactly compared reference field. Undefined derived scale divisions are excluded while their stored inputs are covered. Literal default-paper inventory, actual retained viewport identity, and deliberate geometry/reference/ownership mutations are tested. The documented limits do not imply complete appearance or referenced-payload preservation.
- **Confinement remains one closed lifecycle:** reader and resaver use one private runner with fixed commands, separate ownership/protocol labels and immutable image IDs. The generalized memory fields at `platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts:299` are followed by exact profile-specific checks before execution and after exit. The reader remains at 1 GiB; the resaver requires 2 GiB memory and memory-swap. Stdin chunks use backpressure and output collection has an explicit profile budget.
- **Publication follows cleanup:** owned identity is checked independently of policy, so refused owned containers can be cleaned without removing foreign identities. Independent bounded cleanup covers uncertain creation, container removal and private CLI-config removal. Config device/inode/path checks and nonrecursive removal are retained at `drawing-native-dwg-sandbox.server.ts:584`. Final source/request mutation and caller-abort checks occur after both cleanup stages. All host failures collapse to the fixed resave error.
- **Regression evidence addresses shared-code risk:** the old reader test changes extract its finite transport and imports; its test bodies are preserved. The new fixture is shared instead of duplicating a daemon or production runner. Real integration passes through the existing reader, projector, drawing command and selected-edit compiler and checks all five literal geometries, units/header, source identity, untouched block children/INSERT and the ordinary viewport.

## Issues

### Critical — must fix

None found.

### Important — should fix

None found.

### Minor — nonblocking

1. **Legacy negative self-tests still print private diagnostic paths.** `workspace/self-test-green.log:19` contains an expected legacy qualification failure-report path, alongside expected exception messages. This predates the new public protocol and was disclosed by Task 1; every new resave rejection separately asserts generic stderr and no success bytes. The consequence is noisy green-suite output and poorer signal when a new diagnostic leak occurs, not a demonstrated leak from the resaver API. In a later test-hygiene change, capture/assert those expected legacy diagnostics instead of printing them. This does not block unit acceptance.

The Docker legacy-builder warning is an environment/tooling disclosure, not a code finding. It does not invalidate the recorded successful offline build from pinned cached inputs.

## Checks and evidence

No suites were rerun. This review inspected retained evidence and performed read-only hash/receipt checks:

- `controller-final-regressions.log`: 186 tests, 186 passed, zero failures/cancellations/skips.
- `controller-final-typecheck.log` and recorded result: `react-router typegen && tsc`, exit 0.
- `controller-final-actual-resave.log`: 3/3 passed, zero skips, including actual 2 GiB confinement/deadline, compiler-to-native geometry/preservation, malformed input, cancellation and owned cleanup with foreign sentinel preservation.
- `controller-final-actual-reader.log`: 5/5 passed, zero skips, on the same current image, including parallel reads, actual 1 GiB enforcement, inner deadline and cleanup.
- `workspace/build-green.log`: zero warnings/errors; `workspace/self-test-green.log` concludes 41 passed, zero failed, including actual framed CLI and nonseekable input. The Task 1 report additionally records three lower-level geometry flows and three framed flows; these additional artifacts were not independently replayed here. Historical initial RED evidence is taken from the retained task reports/reviews, not independently reconstructed.
- Independently hashed all 17 current reviewed files against `controller-verification.json`; all match. Independently hashed all four final controller logs against their recorded digests; all match and each recorded process exit is zero. The inspected private verifier checks reviewed hashes before the sequence and after each completed step.
- Independently hashed the retained controller source DWG, exact request JSON, exact report JSON and resaved DWG; all match `controller-actual/summary.json`. Inspected actual native-run before/after receipts: same ID/name/image/nonce, exact `resave-native-stdio` command, created then exited successfully without OOM, readonly root, user 65532, network none, no mounts, and memory/memory-swap both 2147483648.
- The inspected retained cgroup probe records `memory.max=2147483648`, `memory.swap.max=0`, CPU 100000/100000, pids64, UID65532, seccomp2, no-new-privileges and zero capabilities, with rejected root write and successful constrained tmpfs write. This is a separate test-local probe using the profile; the native execution receipts establish the fixed command used for the real resave.

Verified image: `sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae`. Build provenance and cache/offline procedure are recorded in the Task 2 report; this reviewer did not rebuild the image or query live Docker state.

The earlier controller regression run's 34 `listen EINVAL` setup failures came from its long private TMPDIR reaching finite Unix sockets. The corrected private verifier scopes that override only to the actual reader integration, and the fresh final 186/186 run passes on unchanged reviewed hashes. No production/test expectation relaxation is evident in this resolution.

Outside the full supplied diff, checks were restricted to named risks: omitted receipt/config-cleanup hunk context; shared native-reader budgets/ownership/Xref validation; existing selected-edit duplicate-key/handle validation and atomic candidate application; complete inventory document fields; imported source schema; and SemanticComparer's exact identity/reference/document comparisons and numeric geometry behavior. No whole-repository crawl, git/index/HEAD action, build, service, database or Storage mutation occurred. This requested review file is the only write.

## Recommendations and remaining gates

Accept this unit and carry its exact hashes, image identity and retained final evidence into continuation. Keep the one minor legacy logging item as optional follow-up and reconcile the completed Task 2 checklist.

The actual tests establish generated-source same-engine behavior and the observed local Docker/kernel profile. Finite transport cases establish host validation and lifecycle behavior, not independent CAD or kernel proof. Maximum-size customer drawings, full appearance/attributes/layout/XData preservation, referenced visual-style/scale payloads and engine upgrades remain unqualified; the report accurately advertises supported-fields-only coverage.

The wider goal still requires imported-resave job orchestration and cancellation API; immutable attested Storage artifacts and receipt-only downloads; full Auth/Storage/browser acceptance; independent CAD and licensed corpus/recipient qualification; and the R5 package from the same approved revision. These are explicit follow-on gates, not missing current-unit features. Unit acceptance does not issue delivery or persistence authority.
