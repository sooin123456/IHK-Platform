# Task2 independent review — controller record

Reviewer /root/resave_publication_database_review, gpt-6-astra/high, isolated read-only context. Returned review: Spec compliant, Task quality Approved. No Critical or Important finding. This file records the complete verdict/findings/checks with compact references; the original returned wording is in the agent response.

## Spec compliance and strengths

All nine package files have scoped changes. Five RPCs, durable upload fencing, immutable evidence, latest status and retention integration match the Task2 brief. Artifact adapters reuse existing RPC/authentication helpers. Fixture extraction and narrow local-advisors, transaction-time expiry and completed-negative-test corrections match the amended brief.

- Migration stage85 validates ordered bounded metadata, admitted request/authority identities, exact server paths and replay. Close142 releases only the exact historical attempt's fence. Publish173 validates both leases, all open attempts, live authority and final time before immutable commit.
- Guard49, claim245, fail284 and acknowledgement305 independently enforce open fencing while allowing cancellation intent.
- Artifact adapters34/66 verify strict scope/job/kind/path and actor before/after RPC. Boundary tests90 cover these contracts.
- Real publication fixture274/399/650 covers historical open attempts, replacement-attempt receipt identity, independent lock barriers, revoke/tamper, direct Storage denial and retention blockers isolated from earlier protected dependencies.

References above are source lines in platform/supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql; platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts; platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs; platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs. Latest adapter is drawing-native-dwg-resave-jobs.server.ts:198. Approved helper is tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs:43; advisors validation752. Source-free seed tests/fixtures/drawing-native-dwg-jobs-database.mjs:841. Negative status tests/drawing-native-dwg-resave-jobs.test.mjs:340.

## Findings

Critical: none. Important: none.

Minor (nonblocking; track for final unit review): Existing validation noise remains: large-bundle, React Router future-flag, mixed-import, and unsigned-theme-cookie warnings appear in the successful build; advisors report12warnings attributed to existing QTO policies. These are nonblocking for Task2 and should remain explicitly tracked rather than described as pristine validation. Evidence: controller-task-2-build.log:194,219,242 and task-2-advisors-summary.json:4.

## Cannot verify from this delta / controller resolution

- Task3 sequencing/settlement, actual native/Storage, HTTP/UI and full-stack acceptance: mapped to Tasks3–5, genuinely pending, not Task2 completion claims.
- Historical CLI generation/runtime ownership and all external preservation constraints: reviewer made no mutations. Controller inspected installed CLI/help before dispatch and implementer reported CLI-generated migration; accepted exact file is20260906130844. Owned container label/image/tmpfs and port32780 independently verified; exact application bytes built only in owned copy. Fresh post-review HEAD/index checks match original identities; original4173 still HTTP200. No source/native/operational deployment claim is inferred from this review.

## Reviewer checks

Read brief, report and all2306lines/114700characters of exact nine-file delta through EOF; no dirty-HEAD diff. No tests, builds, DB, Git, runtime or filesystem mutations.

Focused unchanged-contract checks for named risks:
- Inherited lock order/cancellation: control migration20260906110304:128,179; no project→job order regression.
- Privileged RPC service role+JWT: import migration20260905234036:107.
- Fresh receipt authority: control migration:40 plus source-authority migration20260906043637:4; current collaborator/exact approved-or-superseded source retained.
- Retention replacement preservation: previous latest migration20260905185231:980 onward; existing source-free/IFC/original/protected-dependency checks retained with new staged/open/prefix additions.
- New evidence cascade authority: previous migration20260905185231:497; retention context, nested trigger, table-owner and already-deleted project required.
- Saved controller evidence: tests23/23zero failures/skips, real full-chain1/1zero failures/skips, owned-copy build/typecheck exit0 with identical app hashes. No duplicate rerun.

Assessment: Task2 implements specified DB authority and authenticated adapters with meaningful regressions. No blocking correctness/scope/maintainability issue; later execution/integration is outside this approval.
