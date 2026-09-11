# SDD ledger — plan: docs/superpowers/plans/2026-09-06-collaboration-canonical-initialization.md

Active goal remains R2/R4/R5. Previous freeze identity unit was progress, accepted by public evidence; not repeated. Current unit is atomic initial persistence plus durable first admission.

Working directory /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1; branch codex/universal-workspace-m1; HEAD 9f5f56d93db325ff935772252f9d4fb64d69f98c. Existing linked worktree and dirty state preserved. No index changes, commits or deploys authorized. Live preview 4173 build must not change.

## Preflight

| Tasks | Shared file/interface or self-consistency | Finding/ruling |
|---|---|---|
| 1 | SQL insertion and actual concurrent/ACL tests | Same error codes and signatures as binding spec; existing state return precedes candidate checks. |
| 2 | Storage, all three server loaders, durability and regression tests | Same winner-only contract; corrected test paths to actual service/review-freeze/native-collaboration files before dispatch. |
| 1 ↔ 2 | Private initialize_state/service_initialize_state full-row APIs | Exact parameters in spec; task 2 maps bytes, generation, SHA and base sequence. No shared production file. |

Ruling: User has repeatedly said to implement without further approvals. Execute current local scope; omit approval/commit menus. Cost if wrong: scope remains bounded to source and owned local test fixtures, no externally visible writes.

Ruling: Authorized Viewer initialization, including absent approved revision, is trusted canonical serialization and is permitted; ordinary editor store remains forbidden. Service absent bootstrap stays draft-only. Cost if wrong: readonly reads could be unnecessarily denied or ordinary authorization weakened; dedicated DB and server tests are required.

Ruling: Initial insertion can occur under an existing freeze lease because it only establishes active/null origin and never changes lease or existing state. Browser admission must reject transient unpersisted fence. Cost if wrong: divergent client CRDT origins; actual concurrency and admission tests required.

Ruling: No live-room transient projection or legacy divergent cache recovery claim in this unit. These remain R2 follow-ups; R4/R5 remain full active goal requirements.

Task 1: pending. Use astra/high for SQL lock/authorization/concurrency judgment; one implementation agent at a time. Root prepares Task 2 focused context while Task 1 executes. Reviewer astra/high for subtle concurrency. No duplicate full-suite runs during review.
Task 2: pending.

Task 1: complete. SQL and real-PG proof implemented; RED missing function42883, final UTF-8 full M1 fixture1/1 with no skips/failures. Independent astra/high reviewer approved, no Critical/Important/Minor. Exact2-file baseline delta and hash manifest recorded as task-1.diff/task-1-files.json. No commits. Initial runner SQL_ASCII caused unrelated Korean fixture failure; corrected owned runner to UTF-8, preserved all logs and stopped owned clusters. Existing long-identifier NOTICE noise retained, not new initializer diagnostics.

Task 2: dispatch astra/high for cross-loader CRDT/admission concurrency judgment. Task 1 contracts accepted. Root will independently prepare integration verification/evidence while implementation executes.

## Integration preflight extension

| Tasks | Shared file/interface or self-consistency | Finding/ruling |
|---|---|---|
| 3 | Actual SQL adapter + Hocuspocus socket; fixture-only JWT verification | Existing M1 targetUrl and createDocument permit reuse without another database harness. Assertions match canonical bytes/no-edit persistence. |
| 1 ↔ 3 | M1 real DB test | Task 3 adds only import/call; its baseline is Task 1 accepted state, preserving SQL proof. |
| 2 ↔ 3 | Production storage initializer/server admission interfaces | Task 3 consumes accepted Task 2 without production edits, independently checks actual Postgres RPC mapping and restart. |

Ruling: Add Task 3 as bounded integration acceptance so actual SQL/adapter/socket seam is exercised, not just separate SQL and fake-storage tests. No new feature scope or dependencies. Cost if omitted: an adapter signature/mapping error could pass unit tests. Task 2 agent notified; no concurrent implementation dispatch. Task 3 pending after Task 2 gate.

Verification preparation: root revalidated all17 accepted native DWG protocol file hashes unchanged and preview HTTP200. Supabase CLI2.114.0 supports `db advisors --db-url <owned-loopback-url> --type security --level warn --fail-on none`; help read. Run security advisors against Task 3 owned actual database before cleanup using owned-copy test instrumentation only (do not add CLI requirement to production test). Preserve output; classify pre-existing schema warnings separately from new private functions. No managed remote advisors call or project credentials.

Task 2: complete. Four-file exact baseline delta/manifest task-2.diff/task-2-files.json; new15focused+140existing=155/155, no skips/fails, tsc0. Root read final stable summary. Initial mislabeled green-initial log is explicitly intermediate6pass/2fixturefail, not acceptance; two fixes use correct leaseExpiresAtMs and signed operation revisionId. Independent astra/high task reviewer approved no findings. Existing freeze/native tests byte-identical. No commits/deploy/build. Task3 baseline M1 hash8e37790d48aee460bc6f2127d26fef06c3cd61333ef28a652f4a569e61827eda in baseline-task3.

Controller fresh verification after Task2 acceptance: eight-file collaboration155/155 exit0, existing Vite-alias legacy17/17 exit0, collaborationtsc0 with zero diagnostic bytes. Logs controller-collaboration.log, controller-legacy.log, controller-tsc.log. These172 distinct tests exclude Task3 actualPG integration, still running. Root sessions46954/90325 completed and closed. No current root test process left.

Independent R4 read-only next-contract map saved publicly at docs/superpowers/evidence/2026-09-06-native-dwg-resave-job-followup.md. This is unaccepted preparation, no R4 job implementation claim. Service-only exact source locator and actual cancellation signal are concrete next seams; do not widen current public source RPC or source-free export contract.

Task 2: reopened fix round1. Root named-risk trace found Hocuspocus serializes error.reason only, dropping new error.message/code/retryable into generic permission-denied. Same task reviewer confirmed ImportantP2 at actual wire boundary. Binding explicit retry requirement therefore needs reason='drawing-reconciling' plus real WS refused-empty/clear-lease/explicit-token-retry proof. Pre-fix exact server/newtest snapshots baseline-task2-fix1. This is not an automatic UI retry feature. Task3 happy-path1/1 still valid; after fix rerun focused regression/tsc and realPG gate against final code.

Ruling: Expand narrow Task2 acceptance to wire serialization; local retryable property alone was insufficient. Cost if left: transient review state misreported as permission failure. No authorization loosening or transport framework replacement.

Task2 fix1 additional load-bearing finding: actual wire RED revealed failed Hocuspocus load never registers payload document, so upstream unloadDocument skips destroy and leaves its Awareness interval. Root confirmed upstream unloaded-map guard. Ruling: production onLoad failure must destroy its never-admitted payload in catch; add cleanup assertion, don't merely clean it in test and hide leak. Same server.ts ownership/initial-admission resource boundary; no dependency patch. Cost if ignored: each legitimate transient refusal retains timers/documents.

Task3 initial independent review: needs fixes for provider cleanup on authentication failure. connect() rejects without returning locally scoped provider; caller cannot destroy it, managed WS/interval can leak. Other actualPG/WS/authority/restart evidence accepted. Task3 fix1 queued after Task2 implementation completes (one implementation agent at a time).

Task2: complete after fix1 re-review PASS, no remainingfindings/newbreakage. Fix exacttwofiledelta task-2-fix1.diff; boundedRED2failed, focused2/2 andfull157/157tsc0. Actual explicit retry needs sendToken PLUS startSync, not sendToken alone; this distinction is logged, automatic UI retry remains R2. Task3 implementer nowfixing onlyfixture unsuccessfulprovider cleanup andrerunningactualPG againstfinalproductioncode; no advisor rerun(SQLunchanged).

Final controller production verification after Task2fix1: 157/157 +legacy17/17 =174 distinct tests, tsc0, allzero failures/skips. Expected negative-load diagnostics are exactly reconciliation retry and unavailable canonical initializer; not unexpected production errors. Logs controller-final-*.log. Sessions4893/53539 completedclosed. Task3fix1 actualPG final1/1 ran currentproductioncode; SHA c0c100899c9c3885453780fa50b2b4befb8c38e9598c2fcb05d38c368788c500,gen1,366bytes,seq0,ops0,exactreload. ProviderfailureRED0vs1 nowcleanupcount1/shouldConnectfalse. Task3scopedre-reviewrunning.

Task3: complete afterfix1 re-review APPROVED no remainingfindings/newbreakage. No pending task gate. Final7-file exactdirtydelta126062bytes+manifest packaged final.diff/final-files.json. Final integration reviewer astra/high dispatched over this unit only, not unrelated dirty branch. Total final distincttests175 (157+17+realPG1), no failures/skips. No goalcompleteclaim; R2whole/R4/R5 remainactive.

Final integration: accepted, no Critical/Important/Minor. Reviewer checked all7currenthashes, retainedfinaltests/advisors and named active-correction service-store/freeze seam. Root reverified7current+17nativehashes allmatch, previewPID80284/4173 andHTTP200, HEAD/indexunchanged. Publish this unit's evidence; do notredispatch completedTasks1–3. NextR2 automatic UI retry+legacycache/live-transition and actuallogout/offline gates; R4jobprep publiclysaved; fullgoal remainsactive. No commit/merge/push/deploy or worktree cleanup.

Public evidence published at docs/superpowers/evidence/2026-09-06-collaboration-canonical-initialization.md and same-name artifact directory (60 artifacts, raw failed/diagnostic/final logs retained). Manifest verification0mismatches. Continuation map updated, completedunits notredispatched. This goal turn is progress, not whole-goal completion or blockage. All spawned agents completed; owned test resources stopped, live userpreview preserved.

Baseline: root ran 7 focused collaboration files, 140/140 passing, 0 skips/failures. HEAD and index SHA unchanged. Saved focused Task 2 context rather than re-auditing accepted units. Task 1 implementer running; parallel read-only admission contract analysis is independent, not a code review gate.

Ruling: Read-only analyst proposed replacing existing service first-boot test as divergent origin. Root checked actual client initializer: it creates empty collections only, does not write protected metadata. Keep existing pending-operation first-boot coverage and add separate canonical restart test. Cost if ignored: lost regression coverage and false diagnosis. Other focused findings (detached preparation, P3S04 rebuild, validation/receipt finally cleanup) accepted into Task 2 context.

Task 2: implemented; controller review pending. Exact four-file owned delta: storage.ts, server.ts, service test fixture updates, new initialization test. Existing review-freeze/native tests unchanged from task baseline. Initial RED8/8 failures, final full regression155/155 passes with zero skipped/failures, collaboration tsc exit0, preview4173 HTTP200. Actual untouched-room WS restart/cached replay uses production Hocuspocus+storage facade with real-byte/hash/CAS double. Root's separately authorized Task3 adds actual PostgreSQL adapter/socket integration. See task-2-report.md and stable task-2-full-green.log/task-2-tsc.log; task-2-green-initial.log is explicitly an intermediate failure log despite its historical filename. No commits/deployment/build. R2/R4/R5 overall remains active.
