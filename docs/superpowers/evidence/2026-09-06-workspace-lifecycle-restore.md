# Workspace lifecycle and authenticated restore — bounded unit

The Universal Workspace goal remains active. This unit fixes stale connection presentation and strengthens existing R2 acceptance; it does not complete R2, imported-DWG resave/delivery (R4), or the exact-revision delivery package (R5).

## Implemented

- Connection presentation is owned by a lifecycle generation, not just the actor/project/revision identity. An A → B → A return cannot revive A's previous `connected` phase or accept its delayed callback. Conditional current-component state adjustment resets before children commit; functional phase updates reject obsolete generations without restarting persistence on ordinary phase changes.
- Persistence, source-readiness and token-refresh effects capture the current generation. No outbox/IndexedDB clearing, new package, storage format, database migration or authorization change.
- The loopback-only preview fixture exposes actual completed-provider count and independently releasable pending providers. The real browser test waits for first admission, holds B and returning A, releases obsolete B without turning A connected, and finally admits A. Existing local edit/revalidation/actor reset/read-only behavior remains checked.
- Existing estimator acceptance now performs visible logout, proves protected `/workspace` redirects to login, authenticates the same editor through the existing confirmation helper, selects the correct organization in the hub, and opens Recent Drawings. Fixed W/F/D geometry/properties plus exact saved canvas/calibration/source-null state, revision, binding and BOQ identity are compared. All three restored estimate rows and the total are asserted, then checked again in a fresh browser context.
- Existing offline acceptance derives ArrowRight's expected +1 X translation and object version **before** going offline. Owner's offline display, both synchronized browsers, authoritative geometry/version, exact base/forward/result operation, one acknowledgement and one post-reload operation must agree with that independent expectation. Editor request failures are asserted separately for the reconnect and online-reload phases.

The existing React, local persistence, authentication, Yjs and PostgreSQL paths were reused; no parallel editor or storage abstraction was introduced.

## Verification

Final copied M1 runner attempt 5 completed with **exit 0: 23/23 authenticated Chromium scenarios passed in 3.5 minutes**. This includes the new logout/full-snapshot and independently expected offline-move assertions, and the existing source-free native writer/receipt/download story. Its temporary Supabase stack cleaned up; ports 4000, 5198, 12349 and 12350 are no longer listening. No other stack or preview was stopped.

| Check | Observed result |
| --- | --- |
| Initial stale-phase browser check | Fails on the exact pre-task behavior |
| A → B → A delayed admission check | Fails on identity-only fix; passes on final generation fix |
| Final focused actor + existing local-persistence browser checks | 2/2 passed |
| Node runtime/shell/realtime/structure/collaboration checks | 159/159 passed, no skips |
| Application/collaboration production builds in owned M1 copy | Typegen/typechecks/builds passed |
| Real PostgreSQL M1 / PDF attach / material storage | 1 + 1 + 3 passed; two configuration sentinels skipped |
| Final authenticated run, attempt 5 | 23/23 passed; no skipped browser scenarios |
| Copied pinned native writer publication | .NET 8 Release publish passed with locked ACadSharp 3.7.1 dependency |

Attempts are not hidden: attempt 1 omitted two existing public DWG fixture files from the owned source copy; attempt 2 used a heading locator for the login CardTitle, which is a div; attempt 3 looked for an organization drawing in the newly selected default personal space; attempt 4 omitted native writer environment paths. The corrected test uses the real login text and actual organization selector. The same four final application/test source files were used for attempt 5, which adds only a fresh native publication and its explicit local environment paths. No successful-case mock, weakened assertion or production guard bypass was added.

The [artifact directory](2026-09-06-workspace-lifecycle-restore/) contains exact pre-task diffs, source/copy hashes, red/green and failed-suite evidence. The old full preview shell suite is **not green**: baseline 8/16 and changed 8/17 pass. The extra compact-test HTTP 500 is independently reproduced before and after this change on the missing `/__p5-current.pdf` fixture. [The follow-up diagnosis](2026-09-06-workspace-shell-followup.md) separates stale mode/permission/menu tests, fixture routing/lazy-dialog startup, and actual 243-vs-239-pixel overflow. None are silently waived as a launch gate.

The final native writer build identity recorded by the real worker is `d25ca5723523df1d793a00ae82f12589960e4a73dd3b691a26bf484b5690bd6e`; it remains `experimental-unqualified` with independent CAD `not-performed`. The final server log contains no `Clients cannot rewrite protected collaboration state` diagnostic, unlike the earlier historical run. It retains one revoked-share 404 and one `P3A01` awareness reauthorization failure during the native scenario that explicitly revokes Viewer membership. The latter lacks exact actor correlation in the server log and is not a general clean-log qualification. No blanket error allowlist was introduced.

## Review, scope and preservation

`r2_connection_review` independently reviewed exact dirty-baseline deltas. It caught the initial identity-reuse counterexample, premature fixture readiness and stale source-ready effect closure; all were corrected and the final production/fixture unit was accepted. It separately accepted the estimator/offline test delta with no blocking findings. `r2_restore_acceptance` implemented that test-only delta and traced its exact command/schema contracts. The main agent ran all browser, database and build checks.

The authentication helper proves real Auth/confirmation but not email delivery. The estimator checks canonical geometry/properties and rendered estimate rows, not every object's rendered post-login coordinates. The offline scenario proves its exact queued edit and online reload, not arbitrary disconnected shell navigation. Phase-scoped Editor assertions do not certify the absence of every background error in the full suite. Native source-free writer evidence does not qualify imported DWG resave, independent CAD compatibility or recipient delivery.

Authoritative checkout remains `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`, branch `codex/universal-workspace-m1`, HEAD `9f5f56d93db325ff935772252f9d4fb64d69f98c`. The index remains SHA-256 `ab8778babeb2aa04f070a609cbd1240760b3158cb5aa1e6ced3da34bb9a9f84c`. Owned runtime: `/Users/h/1hk-r2-restore-uvc74K`. It excludes `.env` files, uses only marked disposable loopback Supabase projects, and does not run builds against the original preview checkout. Original port 4173/PID 80284 remains HTTP 200 and the existing build; these source changes are not deployed there.

No staging, commit, merge, push, production deployment, paid resource, remote customer mutation, or modification of original customer files. Remaining live freeze/divergent-cache recovery, shell corrections and R4/R5 work are tracked in the [continuation map](2026-09-06-universal-workspace-continuation-map.md).
