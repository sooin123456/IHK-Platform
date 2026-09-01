# 1HK Universal Workspace M1 release evidence

Release verdict: **UNEXECUTED**. The hardened Task 8 runner, estimator fixture, serial Playwright journey, measurable-primitive UI, BOQ focus, and real-PostgreSQL counterexamples are implemented and locally verified. This host has no Docker, Podman, Colima, OrbStack, or Finch runtime, so the disposable Supabase stack did not start and Playwright never entered the canonical M1 journey. M1 is not complete.

`PASS` means the named authority ran and met its assertions. `NOT MET` means it ran and missed a gate. `UNEXECUTED` means the required authority did not run. P0–P7 preview/local evidence and standalone PostgreSQL do not substitute for the canonical disposable-Supabase authority.

## Evidence identity and environment

- Checkout: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`
- Behavior/code/test commit verified by every post-commit command below: `819e88fd6d533e63a769d9f37d04b1268ab6543b` (`fix: close M1 authority proof gaps`).
- This document is committed afterward in a documentation-only commit. That evidence commit is not claimed as the behavior SHA.
- Host inventory at 2026-09-01T10:59:37+0900: Darwin 25.5.0 arm64, Node `v26.5.0`, npm `11.17.0`, Playwright `1.62.1`, Supabase CLI `2.114.0`.
- Docker, Podman, Colima, OrbStack, and Finch: absent. Canonical disposable Supabase, M1 browser, production Hocuspocus, visual, and canonical 10k gates: `UNEXECUTED`.
- Homebrew `psql`, `postgres`, `pg_ctl`, and `initdb` were used only for a separately labeled UTF-8 `mktemp` PostgreSQL cluster on a free loopback port. It was not used as a Supabase or browser substitute.
- No dependency or lockfile changed. Repository `platform/supabase` was never started, stopped, copied over, or written by the runner.
- Production `platform/build/`, `platform/collaboration/dist/`, and React Router type output are intentional approved build outputs. Playwright scratch was removed. All tracked P4/P5/P6/P7 screenshots and generated evidence were restored after measurements.

## Source and migration identity

- M1 migration: `platform/supabase/migrations/20260831124950_universal_workspace_m1.sql`; SHA-256 `80fd2d9bca67d4e1fe99a9e65c6470fc3d252fb8fe31dd50f576a0d5828ecd33`.
- Additive purge child guard: `platform/supabase/migrations/20260901000000_drawing_retention_purge_child_guards.sql`; SHA-256 `682119428886034dccbc29be45b360bcfa32a062771a4a6e3749070602aac748`.
- Draft/layer/binding purge bypasses each require `DELETE`, trigger depth greater than one, exact transaction-local project marker, the table-owning current user, and an already-absent parent project. Static tests lock every conjunct. Executable owner-context direct and nested counterexamples are recorded below. Retention periods, holds, protected dependencies, public grants, and normal cleanup were not weakened.
- Company rate CSV SHA-256: `7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c`.
- Non-parseable RVT integrity sentinel bytes: `1HK-M1-RVT-IMMUTABILITY-SENTINEL-v1\n`; SHA-256 `c8b4cbb7e41bf48f3de429f8dd60a1c3dabed2db9566051c3b7dd76130b235a3`. It is integrity-only, never RVT import proof.

## Automated command record

All commands in this table ran after clean code commit `819e88fd6d533e63a769d9f37d04b1268ab6543b` existed and before this document changed.

| KST start–end                     | Command                                                                                         | Exit/result                                                                        | Artifact or residue                                                                               | Status       |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------ |
| 2026-09-01T10:50:23–10:50:25+0900 | focused union: fixture, entry/route, harness, retention, primitives/tables, BOQ focus, P4 tools | exit 0; 151 passed, 0 failed                                                       | named test files                                                                                  | `PASS`       |
| 2026-09-01T10:50:28–10:50:36+0900 | `npm run typecheck`                                                                             | exit 0                                                                             | terminal result                                                                                   | `PASS`       |
| 2026-09-01T10:50:39–10:50:41+0900 | `npm run typecheck:collaboration`                                                               | exit 0                                                                             | terminal result                                                                                   | `PASS`       |
| 2026-09-01T10:50:44–10:50:59+0900 | `npm run build`                                                                                 | exit 0; production client and SSR built                                            | approved `platform/build/` output                                                                 | `PASS`       |
| 2026-09-01T10:51:02–10:51:04+0900 | `npm run build:collaboration`                                                                   | exit 0                                                                             | approved `platform/collaboration/dist/` output                                                    | `PASS`       |
| 2026-09-01T10:51:54–10:51:55+0900 | UTF-8 isolated PG + required M1 real-database test                                              | exit 0; 1 passed; all migrations and counterexamples executed                      | root `/private/tmp/1hk-m1-real-pg-819e88f.dkBUWf`, port 55610; stopped/removed/closed, no residue | `PASS`       |
| 2026-09-01T10:52:02–10:52:05+0900 | `npm run test:e2e:drawing-workspace-m1:local`                                                   | exit 1 before build/fixture/browser; start and stop lacked a container engine      | new recovery root `.../1hk-m1-supabase-VvWi6t` intentionally retained                             | `UNEXECUTED` |
| 2026-09-01T10:52:33–10:52:53+0900 | `npm run test:e2e:drawing-workspace-p0-p2:local`                                                | exit 0; 4 passed                                                                   | no retained pass artifact                                                                         | `PASS`       |
| 2026-09-01T10:53:04–10:53:10+0900 | `npm run test:e2e:drawing-workspace-p3:local`                                                   | exit 0; 1 passed                                                                   | local Hocuspocus preview regression only                                                          | `PASS`       |
| 2026-09-01T10:53:14–10:54:22+0900 | `npm run test:e2e:drawing-workspace-p4:local`                                                   | exit 0; 14 passed                                                                  | regenerated screenshots restored                                                                  | `PASS`       |
| 2026-09-01T10:54:26–10:54:51+0900 | `npm run test:e2e:drawing-workspace-p5:local`                                                   | exit 0; 13 passed; strict JSON HTTP 200 acknowledgements retained                  | regenerated evidence restored                                                                     | `PASS`       |
| 2026-09-01T10:54:55–10:55:15+0900 | `npm run test:e2e:drawing-workspace-p7:release`                                                 | exit 0; 3 passed                                                                   | regenerated screenshot restored                                                                   | `PASS`       |
| 2026-09-01T10:55:20–10:56:03+0900 | first post-commit `npm run test:e2e:drawing-workspace-p7:performance`                           | exit 0; 3 passed                                                                   | generated raw evidence/capture restored                                                           | `PASS`       |
| 2026-09-01T10:56:24–10:57:06+0900 | `npm run test:drawing-workspace`                                                                | exit 1; 1,061 total, 1,052 passed, 7 skipped, 2 failed                             | generated P6 record restored                                                                      | `NOT MET`    |
| 2026-09-01T10:57:37–10:57:38+0900 | Prettier check including the legacy compact real-PG executable                                  | exit 1; only `drawing-workspace-m1-real-database.test.mjs` is not whole-file clean | no writes                                                                                         | `NOT MET`    |
| 2026-09-01T10:57:51+0900          | scoped Prettier check for the format-managed changed files                                      | exit 0; all named files matched                                                    | no writes                                                                                         | `PASS`       |
| 2026-09-01T10:58:08–10:58:50+0900 | P7 performance raw-inspection rerun                                                             | exit 0; 3 passed                                                                   | run `ac29beda-af96-4b58-8bf8-3b0604216fae`; raw JSON inspected, then restored                     | `PASS`       |
| 2026-09-01T10:59:37+0900          | host/tool/runtime inventory and source SHA-256                                                  | exit 0; supported container runtimes absent                                        | terminal result                                                                                   | `PASS`       |

The full-suite failures are exactly the two known P7 commit-bound evidence checks. Committed legacy artifacts name `6bf871cc6d5985529fa82f8e673dc65749c33ae6`; the tested code is `819e88fd6d533e63a769d9f37d04b1268ab6543b`. No P7 evidence SHA was hand-edited.

The real-PG file intentionally retains its established compact style; formatting the whole legacy executable would create unrelated churn. The scoped format-managed set and `git diff --check` pass. The broader Prettier miss is recorded rather than hidden.

## Disposable Supabase safety and blocker

The runner creates only a canonical OS-temp `mkdtemp` root, copies the reviewed migrations/config, assigns a generated project ID and free loopback ports, captures sensitive CLI output, and spawns without shell interpolation. POSIX long-running children use isolated process groups; SIGINT/SIGTERM terminates and, if needed, escalates the whole group before owned cleanup. A real harness parent/grandchild test proves the `SIGTERM`-ignoring grandchild and parent are both gone before cleanup. Windows retains direct-child termination.

Before fixture writes, Playwright config verifies `supabase status --workdir <exact-root> -o json` and matches API URL, DB URL, anon key, service key, and API/DB ports against the exact environment and generated config. A fabricated marker/config backed by another loopback stack fails. Cleanup validates canonical containment, marker, project ID, config, and every child `lstat`; any symlink fails closed.

The canonical command could not start or stop Supabase because no container engine exists. In accordance with recovery safety, it did not delete the root after stop failure. The new retained root is `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-VvWi6t`; marker and config both name project `1hk-m1-9cb85afd`, API port 53965, DB port 53966, and recursive inspection found no symlink. It contains no executed M1 fixture data. The prior disclosed root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-cqxuKX` (`1hk-m1-b19ec770`, 54543/54544) also remains because its earlier stop failed. Both residues are disclosed for operator recovery and were not deleted.

## M1 acceptance conditions 1–16

The middle column records implemented assertions/static coverage, not a browser result. Every condition requires the canonical journey and therefore remains `UNEXECUTED`.

| #   | Condition                                                          | Implemented contract                                                                                                                                                      | M1 status    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Start from a truly file/document-empty same-org project            | fixture checks exact zero counts; project root exposes accessible empty copy and canonical `새 작업실`                                                                    | `UNEXECUTED` |
| 2   | Create blank, starter, and PDF workspaces                          | serial spec drives all three exact accessible cards and canonical routes                                                                                                  | `UNEXECUTED` |
| 3   | Retry without duplicates                                           | exact request IDs, document/scaffold counts, and import-ledger singularity asserted                                                                                       | `UNEXECUTED` |
| 4   | Calibrate and prove line/area/count                                | exact labeled quantity rows/buttons; PDF line visibly asserts `5 m`; confirmed server evidence asserted                                                                   | `UNEXECUTED` |
| 5   | Classify floor, wall, ceiling, door, window, furniture, demolition | serial spec creates and persists all seven exact classes; no claim is made that the unrun browser did so                                                                  | `UNEXECUTED` |
| 6   | Import company CSV/XLSX rates                                      | exact UTF-8 CSV/digest and strict parsers pass; UI import was not reached                                                                                                 | `UNEXECUTED` |
| 7   | Show exact quantities, units, rates, amounts, evidence, and review | row-scoped assertions specify W `0.3 m / 10,000 / 3,000`, F `0.02 m2 / 30,000 / 600`, D `1 EA / 150,000 / 150,000`, total `153,600`; manifest IDs/hashes are exact        | `UNEXECUTED` |
| 8   | Missing rate/evidence stays review, never silent zero/confirmed    | real same-version component-free `M1-C-001` asserts `0.15 m`, em-dash rate/amount, `검토 필요`/`근거 누락`, no `0원`/`확정`; exact object/line cleanup precedes approval  | `UNEXECUTED` |
| 9   | Persist draft/binding through refresh and fresh login              | context closes, a fresh context authenticates, and exact IDs/results are reasserted                                                                                       | `UNEXECUTED` |
| 10  | Link an object issue                                               | exact object/revision scope and UI action are asserted                                                                                                                    | `UNEXECUTED` |
| 11  | Preserve draft versus confirmed evidence                           | exact per-kind confirmation and server lineage asserted; no browser artifact exists                                                                                       | `UNEXECUTED` |
| 12  | Deny Viewer UI/API/DB mutation                                     | real line UPDATE uses representation return, asserts HTTP 200 plus zero rows and admin-reloaded fields unchanged; real-ID rate insert, drawing, and binding remain denied | `UNEXECUTED` |
| 13  | Distinct Editor/Reviewer/Approver actors                           | exact normalized roles and three distinct browser identities are asserted                                                                                                 | `UNEXECUTED` |
| 14  | Map/review/approve/export/reverse navigate                         | exact W/F/D mappings, manifest, CSV/XLSX, approval envelope, and exact version/line return are asserted; imperative focus trusts only server-validated ownership          | `UNEXECUTED` |
| 15  | Preserve PDF/IFC/RVT/rate bytes                                    | static identities pinned and before/after Storage reads implemented; Storage reads did not run                                                                            | `UNEXECUTED` |
| 16  | Regress file/PDF/IFC/BOQ/Revit routes                              | runnable P0–P5/P7 local regressions passed, but canonical M1 and hosted P6 authority did not run                                                                          | `UNEXECUTED` |

## Source SHA-256 before/after

| Source                 | Static identity                                                                                | Browser before | Browser after | Status       |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------- | ------------- | ------------ |
| Company rate CSV       | `7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c`                             | not read       | not read      | `UNEXECUTED` |
| PDF source             | fixture verifies immutable metadata and downloaded bytes                                       | not read       | not read      | `UNEXECUTED` |
| IFC source             | pinned upstream fixture SHA `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d` | not read       | not read      | `UNEXECUTED` |
| RVT integrity sentinel | `c8b4cbb7e41bf48f3de429f8dd60a1c3dabed2db9566051c3b7dd76130b235a3`                             | not read       | not read      | `UNEXECUTED` |

No before/after equality is claimed.

## Real PostgreSQL authority matrix

The corrected UTF-8 isolated run replayed every migration into a random database and passed the Task 1 role/idempotency/starter/binding matrix. Static migration tests require the exact `DELETE` + depth >1 + exact GUC + table owner + absent parent conjunction for draft, layer, and binding guards. Its executable purge extension proved:

- forged service-role JWT plus exact purge GUC cannot directly delete a binding at trigger depth 1;
- a forged direct layer delete fails;
- owner connection identity equals the layer and binding table owners;
- test-only nested layer and nested binding deletes at depth greater than one still fail while the parent project exists and the exact marker is forged;
- the attacked project, layer, and binding each remain exactly once after all attacks;
- the legitimate service-only parent purge cascade removes the project and binding;
- cleanup drops the isolated database/temporary roles, stops loopback port 55610, removes exact root `/private/tmp/1hk-m1-real-pg-819e88f.dkBUWf`, and independently verifies the root absent and port closed.

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

Required next action: install/start a supported container runtime and rerun `npm run test:e2e:drawing-workspace-m1:local` unchanged. Until acceptance 1–16, canonical collaboration/outbox, canonical 10k, both visual widths, and source before/after attachments actually run and pass, M1 remains incomplete.
