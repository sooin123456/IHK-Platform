# 1HK Universal Workspace M1 release evidence

Release verdict: **UNEXECUTED**. The hardened Task 8 runner, estimator fixture, serial Playwright journey, measurable-primitive UI, BOQ focus, and real-PostgreSQL counterexamples are implemented and locally verified. This host has no Docker, Podman, Colima, OrbStack, or Finch runtime, so the disposable Supabase stack did not start and Playwright never entered the canonical M1 journey. M1 is not complete.

`PASS` means the named authority ran and met its assertions. `NOT MET` means it ran and missed a gate. `UNEXECUTED` means the required authority did not run. P0–P7 preview/local evidence and standalone PostgreSQL do not substitute for the canonical disposable-Supabase authority.

## Evidence identity and environment

- Checkout: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`
- Latest code/test commit: `967ef821725e578be4124c1231ac36503696c133` (`test: preserve partial ACK error priority`). It changes only the outbox regression test; production partial-ACK behavior remains `d24b3be90631f7d7a77c13a4d08715e5aa181df2`. Its post-commit record is separate from the preserved whole-branch, Editor-boundary, and security records below.
- This document is committed afterward in a documentation-only commit. That evidence commit is not claimed as the behavior SHA.
- Host inventory refreshed at 2026-09-01T13:08:36+0900: Darwin 25.5.0 arm64, Node `v26.5.0`, npm `11.17.0`, Playwright `1.62.1`, Supabase CLI `2.114.0`.
- Docker, Podman, Colima, OrbStack, and Finch: absent. Canonical disposable Supabase, M1 browser, production Hocuspocus, visual, and canonical 10k gates: `UNEXECUTED`.
- Homebrew `psql`, `postgres`, `pg_ctl`, and `initdb` were used only for a separately labeled UTF-8 `mktemp` PostgreSQL cluster on a free loopback port. It was not used as a Supabase or browser substitute.
- No dependency or lockfile changed. Repository `platform/supabase` was never started, stopped, copied over, or written by the runner.
- Production `platform/build/`, `platform/collaboration/dist/`, and React Router type output are intentional approved build outputs. Playwright scratch was removed. All tracked P4/P5/P6/P7 screenshots and generated evidence were restored after measurements.

## Latest Task 9 partial durable-ACK authority

The preceding whole-branch outbox fix reported acknowledgements only when the whole sequential flush fulfilled. If operation 1 had already been durably acknowledged and operation 2 then failed transport or returned a mismatched acknowledgement ID, `flushOnce()` rejected before its local acknowledged count reached the outer callback. Task 9 moves only that positive partial count to the rejection boundary and rethrows the exact original error.

Strict TDD against starting HEAD `cef7db53e6a52e7e2db7b2d208b26d784857594b` produced two real failures at 2026-09-01T18:37:03+0900: the focused outbox run exited 1 with 68 pass / 2 fail, and both new mixed-batch cases observed callback batches `[]` instead of `[1]`. The transport case still removed operation 1, retained operation 2 as pending with retry count 1 and a 1,000 ms retry, and preserved the original rejection. The mismatched-ID case retained operation 2 as rejected with no retry.

GREEN behavior SHA `d24b3be90631f7d7a77c13a4d08715e5aa181df2` reports the positive local durable count exactly once before either rejection. The transport test proves callback batches `[1, 1]` across the rejected initial flush and its later successful retry; the mismatch test proves `[1]` with no retry; all-success proves `[2]` once; all-failure proves no callback. Operation order, conflict, concurrency, disposal, retry schedule, rejected/pending residue, and exact error identity remain covered by the focused file.

### Post-commit command record for `d24b3be90631f7d7a77c13a4d08715e5aa181df2`

All rows ran after the exact clean behavior commit existed and before this documentation-only change.

| KST start–end                     | Command                                                  | Exit/result                                        | Artifact or classification                                         | Status    |
| --------------------------------- | -------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| 2026-09-01T18:39:39–18:39:42+0900 | focused outbox test                                      | exit 0; 70 passed, 0 failed                        | both partial-ACK regressions plus existing outbox matrix           | `PASS`    |
| 2026-09-01T18:39:39–18:39:42+0900 | final Task 8 10-file focused union                       | exit 0; 270 passed, 0 failed                       | shell/outbox/E2E/entry/library/route/properties/server/export      | `PASS`    |
| 2026-09-01T18:39:48–18:39:57+0900 | app and collaboration typechecks                         | both exit 0                                        | React Router typegen and both TypeScript graphs                    | `PASS`    |
| 2026-09-01T18:40:02–18:40:18+0900 | production app and collaboration builds                  | both exit 0                                        | approved `platform/build/` and `platform/collaboration/dist/`      | `PASS`    |
| 2026-09-01T18:40:24–18:41:07+0900 | `npm run test:drawing-workspace`                         | exit 1; 1,067 total / 1,058 pass / 7 skip / 2 fail | only committed P7 SHA checks; generated P6 evidence restored       | `NOT MET` |
| 2026-09-01T18:41:39–18:41:40+0900 | scoped Prettier, commit check, scratch and status checks | exit 0                                             | Playwright/Vite scratch removed; exact behavior worktree was clean | `PASS`    |

The two full-suite failures compare committed P7 artifact SHA `6bf871cc6d5985529fa82f8e673dc65749c33ae6` with Task 9 behavior SHA `d24b3be90631f7d7a77c13a4d08715e5aa181df2`; no legacy evidence was regenerated or hand-edited. Real PostgreSQL was not rerun because Task 9 changes no database or migration. Per the Task 9 brief, the known missing container runtime was not reconfirmed by rerunning the disposable-Supabase command, so no fifth recovery root was created. Canonical M1 remains `UNEXECUTED`.

### Review fix 1/5 — callback failure priority

The first Task 9 callbacks never threw, so they did not protect the claim that `finally` preserves the original transport or mismatched-ACK failure. Both real mixed-batch tests now append the durable partial count and throw a distinct callback Error. Transport asserts reference identity with the original Error plus pending residue/retry/later `[1, 1]`; mismatch asserts the exact acknowledgement message plus rejected residue, `[1]`, and no retry.

The intact implementation first passed the characterization 2/2. An unstaged mutation then removed the `try/finally` priority. At 2026-09-01T18:54:11+0900 the exact run failed 0/2 because both branches exposed the callback Error. The production file was immediately restored; at 2026-09-01T18:54:23+0900 the same tests passed 2/2 and the complete outbox file passed 70/70. Test-only SHA `967ef821725e578be4124c1231ac36503696c133` contains no production change.

| KST start–end                     | Post-commit command                      | Exit/result                                        | Classification                                                    | Status    |
| --------------------------------- | ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | --------- |
| 2026-09-01T18:54:58–18:54:59+0900 | focused outbox test                      | exit 0; 70 passed, 0 failed                        | throwing-callback branches and complete outbox matrix             | `PASS`    |
| 2026-09-01T18:55:06–18:55:09+0900 | final Task 8 10-file union               | exit 0; 270 passed, 0 failed                       | exact focused cross-feature regression set                        | `PASS`    |
| 2026-09-01T18:55:14–18:55:25+0900 | app and collaboration typechecks         | both exit 0                                        | both TypeScript graphs                                            | `PASS`    |
| 2026-09-01T18:55:30–18:55:46+0900 | production app and collaboration builds  | both exit 0                                        | approved build outputs                                            | `PASS`    |
| 2026-09-01T18:56:11–18:56:50+0900 | `npm run test:drawing-workspace`         | exit 1; 1,067 total / 1,058 pass / 7 skip / 2 fail | only committed P7 SHA checks                                      | `NOT MET` |
| 2026-09-01T18:57:30+0900          | restore/scratch/commit/clean-tree checks | exit 0                                             | P6 restored; Playwright/Vite scratch removed; exact SHA was clean | `PASS`    |

The full-suite mismatches are only committed P7 SHA `6bf871cc6d5985529fa82f8e673dc65749c33ae6` versus `967ef821725e578be4124c1231ac36503696c133`. Real PostgreSQL was not rerun because no database or migration changed. The canonical command was not rerun and no new recovery root was created; canonical M1 remains `UNEXECUTED`.

## Latest final whole-branch authority

The final review wave closed six product/React contracts and removed nine dead compatibility surfaces without changing dependencies, database authority, retention, client monetary calculation, or the canonical Docker verdict.

Strict TDD results against starting HEAD `00af54549cde643fb3689d4c9d0a23beac244726`:

- Viewer rail RED rendered `단가표 가져오기`; GREEN gates only that mutation entry by the existing server-derived `mayBind`, preserving read-only BOQ navigation/download.
- Outbox RED returned `undefined` instead of two durable acknowledgements, and scheduled retry failed to report `[1]`; that wave's GREEN reported fulfilled acknowledgement batches and later successful retries. It did not cover an earlier durable ACK followed by a later failure in the same batch; the Task 9 section above closes that gap.
- Estimator contract RED asserted `확정` before BOQ approval; GREEN asserts W/D `초안` and F `가정값` before approval, then revisits the canonical workspace after approval to prove `확정` lineage.
- Entry-flow REDs exposed `/workspaces/new` to read-only roles in drawing list, project root, dashboard, and organization library. GREEN reuses loader/server capability and sends non-editors to read-only project/drawing/file views.
- Loader RED had no independent-I/O parallel group and loaded binding options for non-binding actors. GREEN starts the six independent surfaces in one `Promise.all` after identity and conditionally omits options.
- Property RED retained effect-synchronized evidence/error state across selection. GREEN keys one inner field owner so value, evidence kind, dirty state, and validation error reset together.

Ponytail caller proof removed `DrawingWorkspacePreCreation`, string/null precreation compatibility, canonical null-document fallback, route-only `create_document`, nullable export fallbacks, `drawingEstimateBindingErrorResponse`, `drawingWorkspaceStartChoiceFocused`, dead entry builders, `drawingWorkspaceOperationPath`, and `legacyProjectWorkspacePath`. The legacy database `lukas_drawing_create_document` RPC remains deliberately covered. Production/E2E changed by 681 additions and 782 deletions, net -101. Final Ponytail finding: **Lean already. Ship.**

React review found no residual React fix after the GREEN implementation: the loader preserves identity dependencies while parallelizing independent work, acknowledgement revalidation has a stable ref and no feedback loop, property state is keyed without an effect, role gates remain loader-derived, and native accessible controls remain intact. Task 9 later corrected the outbox's rejected mixed-batch delivery boundary without changing that React callback.

### Post-commit command record for `729f07d96c33902a8f3f4f551863af75383af5b9`

All rows ran after the exact clean behavior commit existed and before this documentation-only change.

| KST start–end                     | Command                                                                              | Exit/result                                                                                | Artifact or residue                                                                                       | Status       |
| --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-09-01T13:02:08–13:02:15+0900 | focused shell/outbox/E2E/entry/library/route/properties/server/export union          | exit 0; 268 passed, 0 failed                                                               | ten exact test files                                                                                      | `PASS`       |
| 2026-09-01T13:03:35–13:03:44+0900 | app and collaboration typechecks                                                     | both exit 0                                                                                | React Router typegen and both TypeScript graphs                                                           | `PASS`       |
| 2026-09-01T13:03:48–13:04:04+0900 | production app and collaboration builds                                              | both exit 0                                                                                | approved `platform/build/` and `platform/collaboration/dist/`                                             | `PASS`       |
| 2026-09-01T13:04:30–13:04:31+0900 | required UTF-8 isolated real-PostgreSQL test                                         | exit 0; 1 passed; full migration, Editor operation boundary, attacks, and cascade executed | root `/private/tmp/1hk-m1-real-pg-729f07d.J072KQ`, port 63388; stopped, removed, root absent, port closed | `PASS`       |
| 2026-09-01T13:04:56–13:04:59+0900 | `npm run test:e2e:drawing-workspace-m1:local`                                        | exit 1 before build/fixture/browser; no Docker or Podman                                   | recovery root `.../1hk-m1-supabase-yXX21z` retained                                                       | `UNEXECUTED` |
| 2026-09-01T13:05:49–13:06:26+0900 | `npm run test:drawing-workspace`                                                     | exit 1; 1,065 total / 1,056 pass / 7 skip / 2 fail                                         | only committed P7 SHA checks; generated P6 evidence restored                                              | `NOT MET`    |
| 2026-09-01T13:08:10–13:08:11+0900 | package-scoped Prettier, `git diff --check`, generated-scratch cleanup, clean status | exit 0; all 28 behavior files formatted; clean                                             | Playwright report/results and `node_modules/.vite` removed                                                | `PASS`       |
| 2026-09-01T13:09:34+0900          | `git show --check 729f07d96c33902a8f3f4f551863af75383af5b9` plus clean status        | exit 0                                                                                     | exact tested behavior identity                                                                            | `PASS`       |

The two full-suite failures are exactly committed P7 evidence SHA `6bf871cc6d5985529fa82f8e673dc65749c33ae6` versus behavior SHA `729f07d96c33902a8f3f4f551863af75383af5b9`. No legacy evidence was regenerated or hand-edited. Earlier P0–P5/P7 browser results remain evidence for `819e88fd6d533e63a769d9f37d04b1268ab6543b`, not for this behavior commit.

The canonical run retained `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-yXX21z`, project `1hk-m1-fd97ecea`, API/DB ports 51074/51075, after start and stop could not use a container engine. `supabase status` independently returned `docker: command not found (podman also not found)`; exact cleanup-target validation passes and both ports are closed. The root is intentionally not deleted. Canonical browser acceptance 1–16, production Hocuspocus/outbox, 1440×900 and 1024×768 visuals/logs/screenshots, source before/after hashes, and canonical M1 10k raw performance remain `UNEXECUTED`.

## Latest Editor operation-boundary authority

The review premise that authenticated Editors retain direct page/object DML is not reproducible against the final migration graph. P2 contract hardening revokes authenticated structural-page writes and declares the authenticated page RPC to be the only structural mutation boundary. The issue-link migration later drops object mutation policies and revokes authenticated object `INSERT`, `UPDATE`, and `DELETE`, requiring revision-first operation events. Therefore direct Editor page/object DML correctly fails at table privilege evaluation rather than at the invoker guard's revision row lock.

Strict TDD record:

- RED: the first new real-PG assertion expected direct authenticated Editor object mutation to succeed and exited 1 with SQLSTATE `42501`, `permission denied for table lukas_drawing_objects`. That result disproved the review premise; it did not identify a production guard defect.
- Corrected contract: exact direct Editor page `UPDATE`/`DELETE` and object `UPDATE`/`DELETE` are denied, while canonical authenticated Editor `mutate_structure`, `add_objects`, `update_objects`, and `delete_objects` operations succeed with exact persisted versions, actor, names, status, and row counts. A test-only intermediate `null !== 3` mismatch was corrected because delete operation envelopes report `null` while the independently loaded soft-deleted row is version `3`.
- GREEN: pre-commit and clean post-commit UTF-8 real-PG runs each passed 1/1. No production SQL, grant, RLS policy, trigger mode, or purge rule changed; `lukas_drawing_draft_child_guard` remains `SECURITY INVOKER` and the forged-attack/legal-cascade matrix remains intact.

### Post-commit command record for `00d55985f236aa9d36acbe73c52a4e43531f8c5a`

| KST start–end                     | Command                                                                 | Exit/result                                                                                                     | Artifact or residue                                                                | Status    |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| 2026-09-01T11:54:09–11:54:10+0900 | focused database/retention/M1 database/release-harness/start union      | exit 0; 53 passed                                                                                               | includes static operation-only, invoker, lifecycle, guard, and starter contracts   | `PASS`    |
| 2026-09-01T11:54:28–11:54:30+0900 | UTF-8 `mktemp` PG plus `M1_REAL_POSTGRES_REQUIRED=1` real-database test | exit 0; 1 passed; full migration graph, Editor direct denials/RPC positives, attacks, cascade, cleanup executed | root `/private/tmp/1hk-m1-real-pg-00d5598.nNr60B`, port 59459; stopped and removed | `PASS`    |
| 2026-09-01T11:54:36–11:54:46+0900 | app and collaboration typechecks                                        | both exit 0                                                                                                     | no generated artifact retained as evidence                                         | `PASS`    |
| 2026-09-01T11:54:50–11:55:06+0900 | production app and collaboration builds                                 | both exit 0                                                                                                     | approved `platform/build/` and `platform/collaboration/dist/`                      | `PASS`    |
| 2026-09-01T11:55:13–11:55:53+0900 | `npm run test:drawing-workspace`                                        | exit 1; 1,065 total, 1,056 passed, 7 skipped, 2 failed                                                          | only stale P7 SHA checks; generated P6 evidence restored                           | `NOT MET` |
| 2026-09-01T11:58:36–11:58:37+0900 | exact focused union rerun from `platform/` cwd                          | exit 0; 50 passed, 1 real-PG environment skip                                                                   | `git show --check 00d55985...` also passed                                         | `PASS`    |

The full-suite failures are exactly the legacy P7 commit-bound evidence checks: committed artifact SHA `6bf871cc6d5985529fa82f8e673dc65749c33ae6` versus tested behavior SHA `00d55985f236aa9d36acbe73c52a4e43531f8c5a`. No P7 evidence was hand-edited. An additional focused invocation at 2026-09-01T11:58:26+0900 was launched from the repository root instead of the harness-required `platform/` cwd and exited 1 in two direct-Playwright child-output assertions; it is disclosed, corrected by the immediate cwd-accurate rerun, and is not counted as gate authority.

Independent cleanup checks reported `root_absent=true` and `port_closed=true` for the UTF-8 cluster. Runtime inventory at 2026-09-01T11:55:59+0900 again found Docker, Podman, Colima, OrbStack, and Finch absent. Canonical disposable Supabase, browser, production Hocuspocus, visual, source-integrity, and M1 10k gates remain `UNEXECUTED`.

## Source and migration identity

- M1 migration: `platform/supabase/migrations/20260831124950_universal_workspace_m1.sql`; SHA-256 `80fd2d9bca67d4e1fe99a9e65c6470fc3d252fb8fe31dd50f576a0d5828ecd33`.
- Additive purge child guard: `platform/supabase/migrations/20260901000000_drawing_retention_purge_child_guards.sql`; SHA-256 `e0d4e0e6f2b88541372548295c03f917d2788cd5ffc0ad4e8370fc8fb84ee9d6`.
- Draft/layer/binding purge bypasses each require the exact `DELETE` AND depth-greater-than-one AND transaction-local project-marker equality AND table-owning current user AND already-absent parent conjunction. The draft guard is `SECURITY INVOKER`, making the owner predicate caller-authoritative; execute remains revoked. Binding mutation tests lock every condition plus its `P1C01` append-only rejection. Executable owner-context direct and nested counterexamples are recorded below. Retention periods, holds, protected dependencies, public grants, and normal cleanup were not weakened.
- Company rate CSV SHA-256: `7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c`.
- Non-parseable RVT integrity sentinel bytes: `1HK-M1-RVT-IMMUTABILITY-SENTINEL-v1\n`; SHA-256 `c8b4cbb7e41bf48f3de429f8dd60a1c3dabed2db9566051c3b7dd76130b235a3`. It is integrity-only, never RVT import proof.

## Prior final-security automated command record

All commands in this table ran after clean code commit `f60998d5b430427817f8e8ec2ae8d2c1f787172d` existed and before this document changed.

| KST start–end                     | Command                                                                                           | Exit/result                                                                           | Artifact or residue                                                                | Status       |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------ |
| 2026-09-01T11:23:52–11:23:54+0900 | focused fixture/route/harness/retention/primitive/BOQ/P4-tools union                              | exit 0; 155 passed, 0 failed                                                          | named test files; includes real process trees and binding mutation lock            | `PASS`       |
| 2026-09-01T11:24:02–11:24:29+0900 | `npm run typecheck`; collaboration typecheck; `npm run build`; collaboration build                | all exit 0; production client/SSR and collaboration compiled                          | approved `platform/build/` and `platform/collaboration/dist/`                      | `PASS`       |
| 2026-09-01T11:24:42–11:24:43+0900 | UTF-8 `mktemp` PG plus `M1_REAL_POSTGRES_REQUIRED=1` real-database test                           | exit 0; 1 passed; catalog, direct/nested attacks, legal cascade, cleanup all executed | root `/private/tmp/1hk-m1-real-pg-f60998d.GOxeAa`, port 57822; stopped and removed | `PASS`       |
| 2026-09-01T11:25:01–11:25:04+0900 | `npm run test:e2e:drawing-workspace-m1:local`                                                     | exit 1 before build/fixture/browser; all supported container runtimes absent          | recovery root `.../1hk-m1-supabase-byEPd5` retained                                | `UNEXECUTED` |
| 2026-09-01T11:26:40–11:27:22+0900 | `npm run test:drawing-workspace`                                                                  | exit 1; 1,065 total, 1,056 passed, 7 skipped, 2 failed                                | generated P6 record restored; two known P7 commit-SHA checks failed                | `NOT MET`    |
| 2026-09-01T11:28:24+0900          | scoped Prettier check, `git diff --check`, clean-tree assertion, tool and migration-SHA inventory | exit 0; all format-managed final-round files matched; clean behavior SHA              | migration SHA `e0d4e0e6...`; no writes                                             | `PASS`       |
| 2026-09-01T11:28:34+0900          | exact PG residue/port check plus `assertDisposableCleanupTarget` and recovery API/DB port checks  | exit 0; PG root absent; ports 57822/52549/52550 closed; recovery marker/config valid  | retained recovery metadata only                                                    | `PASS`       |

An initial full-suite output collection at 2026-09-01T11:25:40+0900 yielded before its final summary and was not used for a gate claim. The exact clean SHA was restored, and the complete rerun above is the authoritative classification.

The full-suite failures are exactly the two known P7 commit-bound evidence checks. Committed legacy artifacts name `6bf871cc6d5985529fa82f8e673dc65749c33ae6`; the tested code is `f60998d5b430427817f8e8ec2ae8d2c1f787172d`. No P7 evidence SHA was hand-edited.

The real-PG executable retains its established compact style to avoid unrelated formatting churn. Every format-managed final-round file and `git diff --check` passed. Generated P6 evidence was restored and `playwright-report`, `test-results`, and `node_modules/.vite` scratch were removed.

Earlier accepted browser regression evidence remains tied to behavior SHA `819e88fd6d533e63a769d9f37d04b1268ab6543b`: P0–P2 4/4, P3 1/1, P4 14/14, P5 13/13, P7 release 3/3, and P7 performance 3/3. The final security-only change touched no product/browser surface; those earlier commands are not mislabeled as executions on `f60998d`.

## Disposable Supabase safety and blocker

The runner creates only a canonical OS-temp `mkdtemp` root, copies the reviewed migrations/config, assigns a generated project ID and free loopback ports, captures sensitive CLI output, and spawns without shell interpolation. POSIX long-running children use an immutable detached-child PGID. On group-leader close, the lifecycle probes the group and retains it if descendants remain; lifecycle cleanup then sends `SIGTERM`, escalates to `SIGKILL`, and observes group disappearance before owned cleanup. It resolves and refuses its own PGID before negative signaling. One real harness covers signaled parent/grandchild termination; another lets the leader exit normally while its `SIGTERM`-ignoring grandchild remains and proves that grandchild is gone before cleanup. A no-descendant command settles promptly. Windows retains direct-child termination.

Before fixture writes, Playwright config verifies `supabase status --workdir <exact-root> -o json` and matches API URL, DB URL, anon key, service key, and API/DB ports against the exact environment and generated config. A fabricated marker/config backed by another loopback stack fails. Cleanup validates canonical containment, marker, project ID, config, and every child `lstat`; any symlink fails closed.

The canonical command could not start or stop Supabase because no container engine exists. In accordance with recovery safety, it did not delete roots after start/stop failures. The latest retained root is `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-yXX21z` (`1hk-m1-fd97ecea`, 51074/51075). Earlier disclosed roots `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-byEPd5` (`1hk-m1-a9fe0b64`, 52549/52550), `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-VvWi6t` (`1hk-m1-9cb85afd`, 53965/53966), and `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-cqxuKX` (`1hk-m1-b19ec770`, 54543/54544) also remain. Exact cleanup-target validation passes for the latest root and its API/DB ports are closed; the earlier validations/closed-port checks remain recorded above. These roots contain no executed M1 fixture data. All four residues are disclosed for operator recovery and were not deleted.

## M1 acceptance conditions 1–16

The middle column records implemented assertions/static coverage, not a browser result. Every condition requires the canonical journey and therefore remains `UNEXECUTED`.

| #   | Condition                                                          | Implemented contract                                                                                                                                                     | M1 status    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | Start from a truly file/document-empty same-org project            | fixture checks exact zero counts; project root exposes accessible empty copy and canonical `새 작업실`                                                                   | `UNEXECUTED` |
| 2   | Create blank, starter, and PDF workspaces                          | serial spec drives all three exact accessible cards and canonical routes                                                                                                 | `UNEXECUTED` |
| 3   | Retry without duplicates                                           | exact request IDs, document/scaffold counts, and import-ledger singularity asserted                                                                                      | `UNEXECUTED` |
| 4   | Calibrate and prove line/area/count                                | exact labeled quantity rows/buttons; PDF line visibly asserts `5 m`; confirmed server evidence asserted                                                                  | `UNEXECUTED` |
| 5   | Classify floor, wall, ceiling, door, window, furniture, demolition | serial spec creates and persists all seven exact classes; no claim is made that the unrun browser did so                                                                 | `UNEXECUTED` |
| 6   | Import company CSV/XLSX rates                                      | exact UTF-8 CSV/digest and strict parsers pass; UI import was not reached                                                                                                | `UNEXECUTED` |
| 7   | Show exact quantities, units, rates, amounts, evidence, and review | row-scoped assertions specify W `0.3 m / 10,000 / 3,000`, F `0.02 m2 / 30,000 / 600`, D `1 EA / 150,000 / 150,000`, total `153,600`; manifest IDs/hashes are exact       | `UNEXECUTED` |
| 8   | Missing rate/evidence stays review, never silent zero/confirmed    | real same-version component-free `M1-C-001` asserts `0.15 m`, em-dash rate/amount, `검토 필요`/`근거 누락`, no `0원`/`확정`; exact object/line cleanup precedes approval | `UNEXECUTED` |
| 9   | Persist draft/binding through refresh and fresh login              | context closes, a fresh context authenticates, and exact IDs/results are reasserted                                                                                      | `UNEXECUTED` |
| 10  | Link an object issue                                               | exact object/revision scope and UI action are asserted                                                                                                                   | `UNEXECUTED` |
| 11  | Preserve draft versus confirmed evidence                           | pre-approval W/D `초안` and F `가정값` are asserted; only a post-approval canonical revisit asserts `확정`; no browser artifact exists                                   | `UNEXECUTED` |
| 12  | Deny Viewer UI/API/DB mutation                                     | Viewer has no rate-import/create entry; real line UPDATE uses representation return, zero rows, and admin-reloaded immutability; rate/drawing/binding remain denied      | `UNEXECUTED` |
| 13  | Distinct Editor/Reviewer/Approver actors                           | exact normalized roles and three distinct browser identities are asserted                                                                                                | `UNEXECUTED` |
| 14  | Map/review/approve/export/reverse navigate                         | exact W/F/D mappings, manifest, CSV/XLSX, approval envelope, and exact version/line return are asserted; imperative focus trusts only server-validated ownership         | `UNEXECUTED` |
| 15  | Preserve PDF/IFC/RVT/rate bytes                                    | static identities pinned and before/after Storage reads implemented; Storage reads did not run                                                                           | `UNEXECUTED` |
| 16  | Regress file/PDF/IFC/BOQ/Revit routes                              | earlier accepted P0–P5/P7 local regressions passed on `819e88f`; canonical M1 and hosted P6 authority did not run                                                        | `UNEXECUTED` |

## Source SHA-256 before/after

| Source                 | Static identity                                                                                | Browser before | Browser after | Status       |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------- | ------------- | ------------ |
| Company rate CSV       | `7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c`                             | not read       | not read      | `UNEXECUTED` |
| PDF source             | fixture verifies immutable metadata and downloaded bytes                                       | not read       | not read      | `UNEXECUTED` |
| IFC source             | pinned upstream fixture SHA `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d` | not read       | not read      | `UNEXECUTED` |
| RVT integrity sentinel | `c8b4cbb7e41bf48f3de429f8dd60a1c3dabed2db9566051c3b7dd76130b235a3`                             | not read       | not read      | `UNEXECUTED` |

No before/after equality is claimed.

## Real PostgreSQL authority matrix

The corrected UTF-8 isolated run replayed every migration into a random database and passed the Task 1 role/idempotency/starter/binding matrix. Static migration tests require the exact `DELETE` AND depth >1 AND exact GUC equality AND table-owner expression AND absent-parent conjunction for draft, layer, and binding guards. The binding test independently mutates every condition, the conjunction, and append-only rejection. Its executable purge extension proved:

- forged service-role JWT plus exact purge GUC cannot directly delete a binding at trigger depth 1;
- forged direct layer and page deletes fail at depth 1;
- the installed draft guard catalog row has `prosecdef=false`, proving `SECURITY INVOKER`;
- owner connection identity equals the page, layer, and binding table owners;
- test-only nested page, layer, and binding deletes at depth greater than one still fail while the parent project exists and the exact marker is forged;
- the attacked project, page, layer, and binding each remain exactly once after all attacks;
- the legitimate service-only parent purge cascade removes the project, page, and binding;
- cleanup drops the isolated database/temporary roles, stops loopback port 57822, removes exact root `/private/tmp/1hk-m1-real-pg-f60998d.GOxeAa`, and independently verifies the root absent and port closed.

This is `PASS` for PostgreSQL authority only. Viewer controls and live three-browser approval remain `UNEXECUTED`.

## Offline and canonical two-browser evidence

Status: `UNEXECUTED`.

The journey retains a starter draft and specifies two independently authenticated canonical contexts, Hocuspocus presence, production-UI geometry visibility in Browser B, offline IndexedDB enqueue, reconnect, exact one acknowledgement, reload, and one persisted object. The disposable database and production collaboration service never started, so no canonical WebSocket/outbox attachment exists. P3/P5 local results are regression evidence only.

## Performance targets

Canonical M1 target: authenticated canonical workspace navigation to first usable at or below 2,500 ms, real descendant Konva Stage zoom/pan/selection, p95 at or below 16.7 ms, and exact 10,000 persisted objects. The journey starts timing immediately before canonical `goto`, records production viewport x/y/zoom and exact selected ID/name before and after each intended interaction, captures 24 RAF samples around each real zoom/pan/selection sequence, attaches raw arrays before assertions, and fails on a miss. Status: `UNEXECUTED`; no M1 raw JSON exists.

Separate legacy P7 local result for commit `819e88fd6d533e63a769d9f37d04b1268ab6543b`:

- run ID `ac29beda-af96-4b58-8bf8-3b0604216fae`;
- 10,000 authoritative, 2,384 projected, 2,382 accessible objects;
- cold cache miss `2307.899999976158 ms` / target `2500 ms`, `MET`;
- warm first usable `1707.7000000476837 ms` / target `2500 ms`, `MET`;
- p95 zoom `0.10000002384185791 ms` (30), pan `0.20000004768371582 ms` (31), selection `7.600000023841858 ms` (30), all below `16.7 ms`;
- runner artifacts were inspected and then restored to the committed legacy baseline, so they are not retained as Task 8 changes.

P7 does not satisfy the canonical M1 performance gate.

## Visual inspection

Status: `UNEXECUTED`.

The M1 test registers context/page console, page-error, request-failure, and response listeners before first navigation; verifies Tab focus order across blank/starter/PDF cards; checks 1440×900 and 1024×768 production layouts; captures screenshots and console/network JSON; and contains PDF-render failure. No M1 screenshot or log attachment was generated. P7 release 3/3 is separately `PASS` and is not substituted.

## Audits and final ruling

The first Ponytail review removed duplicated recursive symlink traversal from runner validation. The second found an unused RAF-label round-trip even though the raw-evidence keys already label zoom/pan/selection; it was deleted and the focused contract/typecheck reran. Process-group state and explicit serial actor ordering remain required authority, not removable abstraction. No other verified-safe complexity could be removed.

React best-practices review found the BOQ focus effect depended on the whole result object; it now depends only on primitive focused-line/rendered booleans. The second-round canvas attribute derives directly from existing selected-object render state and introduces no hook, fetch, context, dependency, test mode, or duplicate state. Focused tests, typecheck, and production build passed; no client monetary authority was added.

The final security review found two remaining authority gaps: normal leader close could discard a still-live group, and the draft guard's owner predicate was vacuous under `SECURITY DEFINER`. The final behavior SHA retains and reaps independently surviving groups, refuses its own PGID, changes the draft trigger to `SECURITY INVOKER`, and adds exact binding mutations plus executable page/draft attacks. Focused 155/155, both typechecks/builds, and UTF-8 real PG 1/1 passed on that clean SHA. The two full-suite failures remain only the disclosed stale P7 SHA checks.

The latest whole-branch review then closed Viewer mutation visibility, fulfilled-batch acknowledgement revalidation, approval-lineage ordering, read-only creation traps, loader waterfalls, and selection-state leakage, while deleting Ponytail A–I. Exact behavior SHA `729f07d96c33902a8f3f4f551863af75383af5b9` passed focused 268/268, both typechecks/builds, and UTF-8 real PG 1/1. Task 9 behavior SHA `d24b3be90631f7d7a77c13a4d08715e5aa181df2` subsequently closed the rejected mixed-batch acknowledgement gap. Test SHA `967ef821725e578be4124c1231ac36503696c133` mutation-locks original-error priority when its callback throws and passed focused 70/70, the 10-file union 270/270, and both typechecks/builds. Its full-suite result still has only the same two disclosed P7 SHA checks. No canonical browser authority ran.

Required next action: install/start a supported container runtime and rerun `npm run test:e2e:drawing-workspace-m1:local` unchanged. Until acceptance 1–16, canonical collaboration/outbox, canonical 10k, both visual widths, and source before/after attachments actually run and pass, M1 remains incomplete.
