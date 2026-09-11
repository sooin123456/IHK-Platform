# 1HK Universal Drawing Workspace M2 precision and touch evidence

Current-tree release verdict: **LOCAL RELEASE GATE READY; DEPLOYED**. The browser authority now supplies fixed loopback-only Supabase server configuration, strips any inherited client-prefixed service role, and isolates Vite's dependency cache. The standalone production build, five-scenario M2 Chromium gate, and disposable M1 real-database/browser authority all pass. The exact web artifact was deployed, candidate-smoked, and promoted; authenticated hosted M2 mutation and customer-data execution remain unexecuted.

## Partial tree identifiers for the dirty worktree

- HEAD: `9f5f56d93db325ff935772252f9d4fb64d69f98c`.
- Pre-refresh evidence blob: `09eccb8c771611e20b8768a7f771c2841cb5a45a`.
- Dirty-tree hosted P7 production test: `e2e/drawing-workspace-p7-production.spec.ts` hashes to `b4bd190b8c6babde9e2c20d9bd4f5069003be818`.
- Current Vite configuration blob: `e3cec04368f4c06f4b1f3d7937a0b7b61e6ac290`; functional authority blob: `db78c29cccb9e1308e93cfd9f27cce67ec338931`; authority-test blob: `922df54f9adeb34b1e45b126d983ba06b829cc1c`.

HEAD and these selected blobs identify only named state; they do not identify the complete dirty snapshot.

## Fresh verification — 2026-09-04 Asia/Seoul

| Authority                                                                                                    | Exact outcome                                                                                                                                                                                                                    | Status       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Focused union: touch, style, tables, source attach, export audit, retention, price-book reuse, library route | Node test: 73 total; 72 passed; 0 failed; 1 skipped (environment-gated real PostgreSQL)                                                                                                                                          | `PASS`       |
| `npm run typecheck`                                                                                          | exit 0                                                                                                                                                                                                                           | `PASS`       |
| `npm run typecheck:collaboration`                                                                            | exit 0                                                                                                                                                                                                                           | `PASS`       |
| `npm run build` with the fixed loopback-only local verification environment                                  | exit 0; React Router client, SSR, and prerender output completed                                                                                                                                                                 | `PASS`       |
| `npm run test:e2e:drawing-workspace-m2:local -- --reporter=line`                                             | exit 0; all 5 configured Chromium tests began and passed in 14.4 seconds. Precision geometry, table builder, and three touch scenarios passed. No Vite outdated-dependency, HTTP 504, or failed dynamic-import warning occurred. | `PASS — 5/5` |
| `npm run test:e2e:drawing-workspace-m1:local`                                                                | exit 0; disposable isolated Supabase authority. Real-database sub-authorities ran (M1 and M2 PDF attach: 1/1 each; M5 storage: 3 passed, 1 skipped); authenticated Chromium regression: 18/18 passed.                            | `PASS`       |
| `git diff --check`                                                                                           | exit 0                                                                                                                                                                                                                           | `PASS`       |

## Scope and distinctions

- The focused union covers exact geometry/touch authority together with the current M2 style, table, source-attach, export-audit, retention, price-book, and library-route contracts. The one skip is the intentionally environment-gated standalone real-PostgreSQL test; it is not a passing hosted claim.
- The disposable M1 runner is a local, temporary Supabase/PostgreSQL and authenticated browser authority. Its final run passed all 18/18 browser scenarios and cleaned up with exit 0.
- Vercel deployment `dpl_2voVeyaAZRKu92TzYTE3JP99zsUo` is `READY` and promoted at `https://lukas-qto-platform.vercel.app`. The deployment proves build and anonymous route behavior, not authenticated hosted geometry mutations or customer data.
- No hosted P7 three-identity browser authority was exercised or claimed. The P7 source is complete/ready for serial PDF, PNG, and SVG downloads with real-byte SHA/size, workspace/revision/version, operation checkpoint/SHA, approved snapshot SHA, 45-second waits, and three distinct request IDs; its hosted execution remains **UNEXECUTED** because no `P7_E2E_*` authority variables are present.
- Performance was not measured in this refresh and remains **UNEXECUTED**.

## Final ruling

The named local M2 release gate is green and its exact web artifact is deployed. This does not convert local/disposable evidence into a hosted authenticated M2, customer-fixture, three-user, P7 three-format, or performance claim; those authorities remain separately unexecuted.
