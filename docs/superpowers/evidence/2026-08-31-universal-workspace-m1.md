# 1HK Universal Workspace M1 release evidence

Release verdict: **UNEXECUTED**. The hardened Task 8 runner, estimator fixture, serial Playwright journey, measurable-primitive UI, BOQ focus, and real-PostgreSQL counterexamples are implemented and locally verified. This host has no Docker, Podman, Colima, OrbStack, or Finch runtime, so the disposable Supabase stack did not start and Playwright never entered the canonical M1 journey. M1 is not complete.

`PASS` means the named authority ran and met its assertions. `NOT MET` means it ran and missed a gate. `UNEXECUTED` means the required authority did not run. P0–P7 preview/local evidence and standalone PostgreSQL do not substitute for the canonical disposable-Supabase authority.

## Evidence identity and environment

- Checkout: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`
- Behavior/code/test commit verified by every post-commit command below: `21765f53a171992a9837bbcddbc0ac07244cb91d` (`fix: harden M1 acceptance authority`).
- This document is committed afterward in a documentation-only commit. That evidence commit is not claimed as the behavior SHA.
- Host inventory at 2026-09-01T10:11:55+0900: Darwin arm64, Node `v26.5.0`, npm `11.17.0`, Playwright `1.62.1`, Supabase CLI `2.114.0`.
- Docker, Podman, Colima, OrbStack, and Finch: absent. Canonical disposable Supabase, M1 browser, production Hocuspocus, visual, and canonical 10k gates: `UNEXECUTED`.
- Homebrew `psql`, `postgres`, `pg_ctl`, and `initdb` were used only for a separately labeled UTF-8 `mktemp` PostgreSQL cluster on a free loopback port. It was not used as a Supabase or browser substitute.
- No dependency or lockfile changed. Repository `platform/supabase` was never started, stopped, copied over, or written by the runner.
- Production `platform/build/`, `platform/collaboration/dist/`, and React Router type output are intentional approved build outputs. Playwright scratch was removed. All tracked P4/P5/P6/P7 screenshots and generated evidence were restored after measurements.

## Source and migration identity

- M1 migration: `platform/supabase/migrations/20260831124950_universal_workspace_m1.sql`; SHA-256 `80fd2d9bca67d4e1fe99a9e65c6470fc3d252fb8fe31dd50f576a0d5828ecd33`.
- Additive purge child guard: `platform/supabase/migrations/20260901000000_drawing_retention_purge_child_guards.sql`; SHA-256 `be4949fac5e3fe7cd04926cc66c7e556b0817fab3abab721057d75f71709187c`.
- Purge bypass is allowed only for `DELETE`, trigger depth greater than one, exact transaction-local project marker, table-owner execution, and an already-absent parent project. Forged marker at depth 1 and a test-only nested delete while the parent still exists both fail. Retention periods, holds, protected dependencies, public grants, and normal cleanup were not weakened.
- Company rate CSV SHA-256: `7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c`.
- Non-parseable RVT integrity sentinel bytes: `1HK-M1-RVT-IMMUTABILITY-SENTINEL-v1\n`; SHA-256 `c8b4cbb7e41bf48f3de429f8dd60a1c3dabed2db9566051c3b7dd76130b235a3`. It is integrity-only, never RVT import proof.

## Automated command record

All commands in this table ran after code commit `21765f53a171992a9837bbcddbc0ac07244cb91d` existed and before this document changed.

| KST start–end                     | Command                                                                                           | Exit/result                                                                          | Artifact or residue                                                                                                    | Status       |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-09-01T10:12:18–10:12:19+0900 | focused union: fixture, entry, route, harness, retention, primitives, tables, BOQ focus, P4 tools | exit 0; 163 passed, 0 failed                                                         | named test files                                                                                                       | `PASS`       |
| 2026-09-01T10:00:05–10:00:14+0900 | `npm run typecheck`                                                                               | exit 0                                                                               | terminal result                                                                                                        | `PASS`       |
| 2026-09-01T10:00:05–10:00:14+0900 | `npm run typecheck:collaboration`                                                                 | exit 0                                                                               | terminal result                                                                                                        | `PASS`       |
| 2026-09-01T10:00:22–10:00:38+0900 | `npm run build`                                                                                   | exit 0; production client and SSR built                                              | `platform/build/`                                                                                                      | `PASS`       |
| 2026-09-01T10:00:22–10:00:38+0900 | `npm run build:collaboration`                                                                     | exit 0                                                                               | `platform/collaboration/dist/`                                                                                         | `PASS`       |
| 2026-09-01T10:00:59–10:01:00+0900 | first standalone PG invocation, `initdb --no-locale`                                              | exit 1 before authority matrix; SQL_ASCII made the UTF-8 fixture fail its name check | exact root `/private/tmp/1hk-m1-real-pg-21765f5.NqxFsx` stopped and removed                                            | `NOT MET`    |
| 2026-09-01T10:03:25–10:03:26+0900 | UTF-8 isolated PG + required M1 real-database test                                                | exit 0; 1 passed; all migrations and counterexamples executed                        | root `/private/tmp/1hk-m1-real-pg-21765f5-utf8.bUIXQV` stopped and removed; no matching residue                        | `PASS`       |
| 2026-09-01T10:03:40–10:03:43+0900 | `npm run test:e2e:drawing-workspace-m1:local`                                                     | exit 1 before build/fixture/browser; start and stop lacked a container engine        | recovery root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-cqxuKX` intentionally retained | `UNEXECUTED` |
| 2026-09-01T10:04:50–10:05:10+0900 | `npm run test:e2e:drawing-workspace-p0-p2:local`                                                  | exit 0; 4 passed                                                                     | no retained pass artifact                                                                                              | `PASS`       |
| 2026-09-01T10:05:14–10:05:21+0900 | `npm run test:e2e:drawing-workspace-p3:local`                                                     | exit 0; 1 passed                                                                     | local Hocuspocus preview regression only                                                                               | `PASS`       |
| 2026-09-01T10:08:47–10:09:54+0900 | `npm run test:e2e:drawing-workspace-p4:local`                                                     | exit 0; 14 passed                                                                    | regenerated screenshots restored                                                                                       | `PASS`       |
| 2026-09-01T10:06:49–10:07:13+0900 | `npm run test:e2e:drawing-workspace-p5:local`                                                     | exit 0; 13 passed; strict JSON HTTP 200 acknowledgements retained                    | regenerated evidence restored                                                                                          | `PASS`       |
| 2026-09-01T10:07:18–10:07:40+0900 | `npm run test:e2e:drawing-workspace-p7:release`                                                   | exit 0; 3 passed                                                                     | screenshot restored                                                                                                    | `PASS`       |
| 2026-09-01T10:07:44–10:08:29+0900 | `npm run test:e2e:drawing-workspace-p7:performance`                                               | exit 0; 3 passed                                                                     | raw P7 evidence/capture inspected, then restored                                                                       | `PASS`       |
| 2026-09-01T10:10:17–10:10:58+0900 | `npm run test:drawing-workspace`                                                                  | exit 1; 1,059 total, 1,050 passed, 7 skipped, 2 failed                               | generated P6 record restored                                                                                           | `NOT MET`    |
| 2026-09-01T10:11:13–10:11:14+0900 | scoped Prettier check and `git diff --check`                                                      | exit 0; all checked files formatted, diff clean                                      | terminal result                                                                                                        | `PASS`       |

The full-suite failures are exactly the two known P7 commit-bound evidence checks. Committed legacy artifacts name `6bf871cc6d5985529fa82f8e673dc65749c33ae6`; the tested code is `21765f53a171992a9837bbcddbc0ac07244cb91d`. No P7 evidence SHA was hand-edited.

The first standalone PG invocation is not authority: omission of `--encoding=UTF8` created SQL_ASCII and failed before the matrix. The corrected UTF-8 run is the authoritative real-PG result. Both servers were stopped and both exact roots were removed.

## Disposable Supabase safety and blocker

The runner creates only a canonical OS-temp `mkdtemp` root, copies the reviewed migrations/config, assigns a generated project ID and free loopback ports, captures sensitive CLI output, and spawns children without shell interpolation. It tracks children across SIGINT/SIGTERM, terminates them, and enters owned cleanup.

Before fixture writes, Playwright config verifies `supabase status --workdir <exact-root> -o json` and matches API URL, DB URL, anon key, service key, and API/DB ports against the exact environment and generated config. A fabricated marker/config backed by another loopback stack fails. Cleanup validates canonical containment, marker, project ID, config, and every child `lstat`; any symlink fails closed.

The canonical command could not start or stop Supabase because no container engine exists. In accordance with recovery safety, it did not delete the root after stop failure. The retained root has marker project `1hk-m1-b19ec770`, matching config project, API port 54543, DB port 54544, and no symlink. It contains no executed M1 fixture data. This residue is disclosed for operator recovery and was not deleted.

## M1 acceptance conditions 1–16

The middle column records implemented assertions/static coverage, not a browser result. Every condition requires the canonical journey and therefore remains `UNEXECUTED`.

| #   | Condition                                                          | Implemented contract                                                                                                                                               | M1 status    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | Start from a truly file/document-empty same-org project            | fixture checks exact zero counts; project root exposes accessible empty copy and canonical `새 작업실`                                                             | `UNEXECUTED` |
| 2   | Create blank, starter, and PDF workspaces                          | serial spec drives all three exact accessible cards and canonical routes                                                                                           | `UNEXECUTED` |
| 3   | Retry without duplicates                                           | exact request IDs, document/scaffold counts, and import-ledger singularity asserted                                                                                | `UNEXECUTED` |
| 4   | Calibrate and prove line/area/count                                | exact labeled quantity rows/buttons; PDF line visibly asserts `5 m`; confirmed server evidence asserted                                                            | `UNEXECUTED` |
| 5   | Classify floor, wall, ceiling, door, window, furniture, demolition | serial spec creates and persists all seven exact classes; no claim is made that the unrun browser did so                                                           | `UNEXECUTED` |
| 6   | Import company CSV/XLSX rates                                      | exact UTF-8 CSV/digest and strict parsers pass; UI import was not reached                                                                                          | `UNEXECUTED` |
| 7   | Show exact quantities, units, rates, amounts, evidence, and review | row-scoped assertions specify W `0.3 m / 10,000 / 3,000`, F `0.02 m2 / 30,000 / 600`, D `1 EA / 150,000 / 150,000`, total `153,600`; manifest IDs/hashes are exact | `UNEXECUTED` |
| 8   | Missing rate/evidence stays review, never silent zero/confirmed    | a real temporary negative row asserts em-dash rate/amount and `검토 필요`/`근거 누락`, then is deleted before approval; this path was not run                      | `UNEXECUTED` |
| 9   | Persist draft/binding through refresh and fresh login              | context closes, a fresh context authenticates, and exact IDs/results are reasserted                                                                                | `UNEXECUTED` |
| 10  | Link an object issue                                               | exact object/revision scope and UI action are asserted                                                                                                             | `UNEXECUTED` |
| 11  | Preserve draft versus confirmed evidence                           | exact per-kind confirmation and server lineage asserted; no browser artifact exists                                                                                | `UNEXECUTED` |
| 12  | Deny Viewer UI/API/DB mutation                                     | spec uses real same-project version, line, section, and price-book IDs for BOQ, rate, drawing, and binding denials; real-PG role matrix is separately PASS         | `UNEXECUTED` |
| 13  | Distinct Editor/Reviewer/Approver actors                           | exact normalized roles and three distinct browser identities are asserted                                                                                          | `UNEXECUTED` |
| 14  | Map/review/approve/export/reverse navigate                         | exact W/F/D mappings, manifest, CSV/XLSX, approval envelope, and exact version/line return are asserted; imperative focus trusts only server-validated ownership   | `UNEXECUTED` |
| 15  | Preserve PDF/IFC/RVT/rate bytes                                    | static identities pinned and before/after Storage reads implemented; Storage reads did not run                                                                     | `UNEXECUTED` |
| 16  | Regress file/PDF/IFC/BOQ/Revit routes                              | runnable P0–P5/P7 local regressions passed, but canonical M1 and hosted P6 authority did not run                                                                   | `UNEXECUTED` |

## Source SHA-256 before/after

| Source                 | Static identity                                                                                | Browser before | Browser after | Status       |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------- | ------------- | ------------ |
| Company rate CSV       | `7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c`                             | not read       | not read      | `UNEXECUTED` |
| PDF source             | fixture verifies immutable metadata and downloaded bytes                                       | not read       | not read      | `UNEXECUTED` |
| IFC source             | pinned upstream fixture SHA `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d` | not read       | not read      | `UNEXECUTED` |
| RVT integrity sentinel | `c8b4cbb7e41bf48f3de429f8dd60a1c3dabed2db9566051c3b7dd76130b235a3`                             | not read       | not read      | `UNEXECUTED` |

No before/after equality is claimed.

## Real PostgreSQL authority matrix

The corrected UTF-8 isolated run replayed every migration into a random database and passed the Task 1 role/idempotency/starter/binding matrix. Its purge attack extension proved:

- forged service-role JWT plus exact purge GUC cannot directly delete a binding at trigger depth 1;
- a forged direct layer delete fails;
- a test-only nested delete at depth greater than one still fails while the parent project exists;
- all attacked project, layer, and binding rows remain;
- the legitimate service-only parent purge cascade removes the project and binding;
- cleanup drops the isolated database/temporary roles, stops the server, and removes the exact cluster root.

This is `PASS` for PostgreSQL authority only. Viewer controls and live three-browser approval remain `UNEXECUTED`.

## Offline and canonical two-browser evidence

Status: `UNEXECUTED`.

The journey retains a starter draft and specifies two independently authenticated canonical contexts, Hocuspocus presence, production-UI geometry visibility in Browser B, offline IndexedDB enqueue, reconnect, exact one acknowledgement, reload, and one persisted object. The disposable database and production collaboration service never started, so no canonical WebSocket/outbox attachment exists. P3/P5 local results are regression evidence only.

## Performance targets

Canonical M1 target: authenticated canonical workspace navigation to first usable at or below 2,500 ms, real descendant Konva Stage zoom/pan/selection, p95 at or below 16.7 ms, and exact 10,000 persisted objects. The journey starts timing immediately before canonical `goto`, attaches raw RAF samples before assertions, and fails on a miss. Status: `UNEXECUTED`; no M1 raw JSON exists.

Separate legacy P7 local result for commit `21765f53a171992a9837bbcddbc0ac07244cb91d`:

- run ID `fd2fae69-7089-4d46-9170-e4ddc12ded0d`;
- 10,000 authoritative, 2,384 projected, 2,382 accessible objects;
- cold cache miss `2346.5 ms` / target `2500 ms`, `MET`;
- warm first usable `1759.3999999761581 ms` / target `2500 ms`, `MET`;
- p95 zoom `0.20000004768371582 ms` (30), pan `0.2999999523162842 ms` (31), selection `7.700000047683716 ms` (30), all below `16.7 ms`;
- runner artifacts were inspected and then restored to the committed legacy baseline, so they are not retained as Task 8 changes.

P7 does not satisfy the canonical M1 performance gate.

## Visual inspection

Status: `UNEXECUTED`.

The M1 test registers context/page console, page-error, request-failure, and response listeners before first navigation; verifies Tab focus order across blank/starter/PDF cards; checks 1440×900 and 1024×768 production layouts; captures screenshots and console/network JSON; and contains PDF-render failure. No M1 screenshot or log attachment was generated. P7 release 3/3 is separately `PASS` and is not substituted.

## Audits and final ruling

Ponytail review found duplicated recursive symlink traversal in runner validation. It was replaced with one exact helper and the harness was rerun. No other verified-safe complexity could be removed. React best-practices review found the BOQ focus effect depended on the whole result object; it now depends only on primitive focused-line/rendered booleans, and its focused test, typecheck, and build passed. No bundle dependency, client money authority, effect fetch, or derived-state duplication was added.

Required next action: install/start a supported container runtime and rerun `npm run test:e2e:drawing-workspace-m1:local` unchanged. Until acceptance 1–16, canonical collaboration/outbox, canonical 10k, both visual widths, and source before/after attachments actually run and pass, M1 remains incomplete.
