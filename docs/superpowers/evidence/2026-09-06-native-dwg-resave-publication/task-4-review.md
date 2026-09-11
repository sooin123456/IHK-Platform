# Task4 independent review

Reviewer /root/r2_restore_acceptance, reused solely because the harness reached its four-agent thread limit. This is a new independent Task4 review, not a continuation of its completed R2 keyboard review. Source frozen at the18hashes in task-4-report.md; exact task-4-review-package.md is the reviewed delta.

## Verdicts

- Spec compliant: all18planned files represented,8bounded existing-file changes/10new files.
- Task quality Approved; no Critical or Important findings. No implementation fix round required.
- Strict resource authentication/scope/body/query and admin-lazy behavior checked at resave-resource.server.ts:15–270; bounded copied verified download/fresh descriptor at resave-download.server.ts:43–227; public DTO preservation at resave-contract.ts:1–131.
- Actor/six-field scope/open/readiness generation, GET-only recovery, uncertain ID reuse, own cancel and strict receipt links checked at resave-control.tsx:15–307; one conditional export control and readiness at drawing-export-dialog.tsx:697–749.
- CLI strict config/claim/Task3/shutdown/poll/logging checked at native-dwg-worker/src/resave.ts:15–176; equivalent constructor syntax at resave-jobs.server.ts:35–47 and source-free jobs.server.ts:127–146.
- Tests meaningfully exercise actual React lifecycle and actual strip-only child processes; HTTP/Storage/native outcome doubles are identified, not presented as real publication.

## Named outside-diff checks

- Strict query reuse: parseNativeDrawingDwgStatusScope at drawing-native-dwg-export.server.ts:113–143 rejects extra/duplicate query fields and binds route/revision identity.
- Receipt/descriptor trust: resave-artifact-jobs.server.ts:34–105 rechecks actor, exact scope/job/kind/path.
- Lazy actor propagation: DrawingExportLauncher at drawing-workspace.tsx:339–379 forwards dialog props.
- Controller owned build log confirms typegen/tsc/build success. Existing chunk/futureflag/cookie/mixed-import warnings predateTask4; new empty server-only route chunks follow the existing pattern.

## Full actionable finding and metadata correction

Initial sole Minor: `platform/package.json:1 — the diff changes the file mode from100644 to100755 in addition to adding the requested script. This executable bit is unrelated metadata noise; restore mode0644.`

Controller checked exact metadata before making any change: git ls-files --stage and git ls-tree HEAD both report100755 for platform/package.json with identical trackedblob eb22d6cbcc79608d216a0dc09f5706ad7a2473d3; core.filemode=true, git diff --summary for package is empty. Original/owned package both755. The public apply_patch baseline was a newly created644copy; its bytes, not its reconstructed metadata, were the snapshot authority. HEAD/index hashes remain unchanged since pretask. No package chmod was performed.

Reviewer disposition follow-up: **Minor finding withdrawn.** Package was already100755 in HEAD/index; the displayed mode difference is a baseline-copy artifact, not a Task4change. No implementation fix is needed.

## Cannot-verify items and controller resolution

- Live Auth/PostgREST, Storage policy enforcement, actual native conversion/publication and full end-to-end original/source/approved-byte preservation are explicitly Task5requirements, not missing Task4code. They remain pending and will not be represented as completed. All37fresh controller resource/control/entry+shared-contract tests pass; no live claim is inferred from them.
- Cached immutable resaver runtime availability separately verified read-only by controller: imagec921c67d…66ae exists and carries both required reader/resaver labels. Task5 must verify/run it in its marked owned stack.
- 200MiB production memory/performance and independent recipient CAD qualification are separate explicitly open release boundaries; the local50MiB synthetic gate does not claim them.
- Reported221/221 focused suite not rerun by reviewer per review instruction. Controller independently verified18frozen bytes in owned build, ran fresh37/37/0skip5366ms/exit0 and typegen/tsc/build0; exact controller-task-4-tests.log/build.log. Existing source-free suites are included in implementer's fresh221run; previous accepted Tasks1–3 retain their own evidence.

Task4 accepted. Whole-unit review remains afterTask5 and must triage the earlier Task2warning and Task3coverage Minors. No Task4Minor remains open.
