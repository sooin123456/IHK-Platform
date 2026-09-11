# 1HK Universal Drawing Workspace M2 structure, source, and standards evidence

Current-tree release verdict: **LOCAL RELEASE GATE READY; DEPLOYED**. Fresh focused authority, production builds, and the disposable real-database/browser runner are green. The approved-snapshot database correction and exact web artifact are deployed, while authenticated hosted/customer and P7 performance authorities remain explicitly separate.

## Partial tree identifiers for the dirty worktree

- HEAD: `9f5f56d93db325ff935772252f9d4fb64d69f98c`.
- Pre-refresh evidence blob: `9abbf8f92f330de6d5570b2301d0196c2a229545`.
- Dirty-tree hosted P7 production test: `e2e/drawing-workspace-p7-production.spec.ts` = Git blob `2cb6d6631036870e9c651efdec91f4fb0d735ea8`, SHA-256 `b929ece0ca7cad66aa8179e8942d44270e75f0c190ac42eca8c6d4f6084e74a0`.
- Current Vite configuration blob: `e3cec04368f4c06f4b1f3d7937a0b7b61e6ac290`; functional authority blob: `db78c29cccb9e1308e93cfd9f27cce67ec338931`; authority-test blob: `922df54f9adeb34b1e45b126d983ba06b829cc1c`.
- Canonical export refresh: route SHA-256 `c1f5fb3797eec659e9bf9c236aa02917b7052998478ee805ef4f85514193d041`; browser authority SHA-256 `89ffa012213684ab4e663b50c4b9a977fba514a6d426e14ed5b8246a0ad36241`; forward migration SHA-256 `965b212960dbb86964bd5567fe8d53b1608cde0a221ecc802a9f267669afa346`.

HEAD and these selected blobs identify only named state; they do not identify the complete dirty snapshot.

## Implemented scope

- Style and schedule-table editing use the existing versioned structure authority, preserving dirty local input through remote-version conflicts and requiring explicit conflict resolution.
- A source-free canonical workspace can attach an eligible immutable PDF through the idempotent database authority, binding source identity, canvas background, operation ledger, retry result, and loader invalidation without a second collaboration transport.
- Company-template publication/import retains immutable payload/SHA evidence and exact clone relationships; authorization, deprecation, and request-idempotency remain server-bound.
- PDF/PNG/SVG export receipts bind artifact bytes, SHA-256, byte size, workspace, revision/version, canonical operation checkpoint/SHA, and matching approved snapshot SHA. The existing five-argument export RPC remains available for rolling deployment compatibility.
- Price-book reuse stays read-only evidence rather than a new registry or storage model.

## Fresh verification — 2026-09-04 Asia/Seoul

| Authority                                    | Exact outcome                                                                                                                                                                             | Status       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Combined focused M2 app/route/PGlite union   | 73 total; 72 passed; 0 failed; 1 skipped (environment-gated real PostgreSQL)                                                                                                              | `PASS`       |
| `npm run typecheck`                          | exit 0                                                                                                                                                                                    | `PASS`       |
| `npm run typecheck:collaboration`            | exit 0                                                                                                                                                                                    | `PASS`       |
| Production client and SSR build              | exit 0 with the fixed loopback-only local verification environment; client, SSR, and prerender output completed                                                                           | `PASS`       |
| Standalone M2 Chromium suite                 | exit 0; all 5 configured tests began and passed in 14.4 seconds. The functional server used a dedicated Vite cache and complete cold optimizer list with no 504 or failed dynamic import. | `PASS — 5/5` |
| Disposable M1 real PostgreSQL/browser runner | exit 0. M1 and M2 PDF-attach real-database authorities each passed 1/1; M5 storage had 3 passed/1 skipped; authenticated Chromium regression passed 18/18.                                | `PASS`       |
| Diff check                                   | `git diff --check` exit 0                                                                                                                                                                 | `PASS`       |

## Canonical three-format refresh and production release — 2026-09-04

- The disposable real-login approval scenario serially downloaded PDF, PNG, and SVG, hashed each actual download, and matched artifact bytes/size, workspace, approved revision/version, operation checkpoint/SHA, and non-null approved snapshot SHA. All three request IDs were distinct and immutable source evidence matched before/after.
- Exact request parsing rejects missing, empty, duplicate, whitespace, leading-zero, exponent, extra, or malformed authority fields before the audit RPC. Korean filenames return an ASCII fallback plus RFC 5987 UTF-8 `filename*` instead of throwing at the response-header boundary.
- Focused export/retention authority passed `30/31` with zero failures and one environment-gated real-PostgreSQL skip. Application and collaboration typechecks/builds passed; scoped formatting and full diff checks passed. The final post-format disposable production-shaped suite passed Chromium `18/18` in 1.9 minutes.
- Production Supabase applied `20260904102443 drawing_export_approved_snapshot_required`. Hosted inspection confirmed the approved-snapshot fail-closed guard, preserved exact retry lookup, `SECURITY DEFINER`, empty `search_path`, expected ACL, and zero historical drawing receipts missing an approved snapshot.
- Vercel deployment `dpl_AECPU3AieRdmoZhQLgphYBBgPBVf` is `READY` and promoted at `https://lukas-qto-platform.vercel.app`. Candidate and production checks returned six HTTP 200 routes, two exact HTTP 302 login-return routes, malformed-share HTTP 404, and empty deployment-scoped error/fatal/500 logs. Immediate web rollback target: `dpl_2voVeyaAZRKu92TzYTE3JP99zsUo`.
- Independent review closed two Important findings and returned Critical 0, Important 0, Minor 1, Ready YES. The Minor asks the isolated local proof to select its receipt by the observed POST request ID in addition to its existing unique artifact/actor/project/workspace/revision/version constraints.

## Unexecuted boundaries

- **Hosted P7 three-identity release gate: UNEXECUTED.** Equivalent approved-revision PDF/PNG/SVG receipt authority now executes in the disposable canonical suite, but the separate credentialed hosted P7 journey was not run because no `P7_E2E_*` authority variables are set. Do not describe local/disposable evidence as a hosted authenticated replay.
- **Authenticated customer/hosted M2 execution: UNEXECUTED.** Vercel deployment `dpl_AECPU3AieRdmoZhQLgphYBBgPBVf` is promoted and anonymously smoke-tested, but no customer object or authenticated hosted edit was manufactured.
- **Performance: UNEXECUTED.** No performance gate or measured threshold was run in this refresh.
- The focused real-PostgreSQL skip remains environment-gated. It is distinct from the disposable runner's real PostgreSQL checks, which did execute.

## Canonical hosted-P7 receipt authority refresh — 2026-09-04

- The hosted production harness now mounts each ordered real identity directly on `/projects/:projectId/workspaces/:workspaceId`, requires the observed final pathname to equal that route with an empty query string, and records all three observed paths. The retired file-scoped compatibility route remains unchanged and is no longer accepted as direct mounted-route evidence.
- Raw evidence is now `schemaVersion: 2` / `P7_MOUNTED_PRODUCTION_PLAYWRIGHT_V2`; V1 fails closed. The receipt contains the database-observed approval subject version/SHA and approved-snapshot checkpoint/SHA, and every ordered PDF/PNG/SVG audit row must match that authority, the approver, configured workspace/revision, actual artifact bytes, and a semantically distinct request UUID. The PDF compatibility summary must equal the PDF row exactly.
- Final file identities: runner Git blob `16a5af4505ec65e05f7322a77646503353938977`, SHA-256 `70106fba144d605d48ba792610699c8ff990d1c227d27fda4fa23385dbfd8e1c`; focused contract Git blob `73fb9b5a6fa3e197747d93786e57a4a3abad4794`, SHA-256 `ca551e4038f0e00f277ad16241beaad5ccd144bf90c0d50ba2054d9ac20a6ccf`.
- Fresh controller verification passed P7 contracts `29/29`, canonical/legacy route contracts `2/2`, application typecheck, scoped Prettier, and `git diff --check`. The full disposable production-shaped authority rebuilt the application, replayed real local Supabase/PostgreSQL/Storage/Realtime/Edge boundaries, and passed Chromium `18/18` in 2.2 minutes. Independent final review reported Critical `0`, Important `0`, Minor `0`, Ready `YES`.
- **Hosted P7 three-identity replay remains UNEXECUTED.** No complete real `P7_E2E_*` authority exists in this environment, so no identity or customer data was manufactured. This correction touches only tests/scripts; production runtime remains the previously promoted `dpl_3v94Tum1CoicA3oUctZPnEEncWrM`, and no redundant Vercel, Supabase, or Railway deployment was created.

## Design restraint and rollout posture

- No parallel drawing model, new client state store, or second collaboration transport is required by this scope.
- Export lineage extends the existing append-only authority and preserves the legacy RPC during rolling deployment; it does not add a second export engine or receipt store.
- Redis/pub-sub remains deferred until a measured single-instance collaboration threshold fails.

## Final ruling

The named local M2 gate and approved-snapshot database correction are complete, and the exact web artifact is deployed. Hosted P7 credentials, customer fixtures, authenticated three-user execution, and performance authority must still be supplied and run before making those broader claims.
