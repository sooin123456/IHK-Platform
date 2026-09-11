# Universal Drawing Workspace M5.1 material-lineage evidence

Updated: 2026-09-05 (Asia/Seoul)

Scope: close the first M5 vertical slice that connects one measurable drawing object to its exact quantity, BOQ, material, procurement, site, and carbon lineage. This document does not claim that the complete M5 productization roadmap is finished.

## Implemented boundary

- `DrawingObjectQuantityLineageRow.boqLinks[].hasMaterialLineage` is computed from an exact `(project_id, boq_version_id, boq_line_id)` match.
- Material lookups are grouped by BOQ version, line inputs remain in chunks of at most 100 IDs, and all groups share one fail-closed 10,000-row budget.
- The workspace inspector renders the six-stage chain `원본 → 객체 → 이슈 → 승인 → 물량·금액 → 자재 인계`; the selected object then exposes separate `발주`, `입고`, `시공·폐기`, and `탄소 근거` progress. Both surfaces link to the exact BOQ version/line and material version/line.
- Viewer can inspect the same lineage but cannot create or change quantities, BOQ, material plans, or site transactions.

## Verification matrix

| Evidence class                   | Result     | What was exercised                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic unit/contract fixtures | PASS       | 176/176 focused tests. The exact server suite separately passed 53/53, including dense multi-version cross-pairs above 10,000 rows, 100-ID line chunking, and one shared row budget.                                                                                                                                            |
| Real local PostgreSQL/RLS        | PASS       | A newly created disposable Supabase stack applied the complete schema and authority rules. The production-shaped run covered authenticated owner/editor/viewer paths, exact reverse lineage, immutable source bytes, and Viewer mutation denial. The storage authority preflight reported 3 passed and 1 environment-only skip. |
| Disposable browser authority     | PASS       | Chromium 15/15 in 1.6 minutes. The M5 scenario traversed drawing object → quantity → approved BOQ → material plan → purchase order → receipt → installation/waste → carbon and checked exact reverse links plus Viewer UI/API/RLS denial.                                                                                       |
| Hosted release and public smoke  | PASS       | Vercel deployment `dpl_C6beipfhNjnCdvpMYRafwbwudqRs` reached `Ready`, passed protected-candidate checks, and was promoted. The production alias resolved to that deployment and returned `/` 200, `/workspace` 302, `/auth/magic-link` 200, `robots.txt` 200, and `sitemap.xml` 200 with the expected product/login titles.     |
| Approved customer fixture        | UNEXECUTED | No customer-approved DXF/CAD fixture is available in this repository. Seeded verified DXF proof is present, but it is not represented as customer acceptance.                                                                                                                                                                   |
| Hosted authenticated M5 flow     | UNEXECUTED | The query-only release and public route smoke are complete, but the full signed-in M5 business chain has not been replayed against production data.                                                                                                                                                                             |

## Completion gates

- `node --import tsx --test` focused M5 union: 176/176 passed, 0 failed, 0 skipped.
- `npm run typecheck`: passed.
- `npm run typecheck:collaboration`: passed.
- `npm run build`: passed.
- `npm run build:collaboration`: passed.
- `npm run test:e2e:drawing-workspace-m1:local`: 15/15 passed.
- `git diff --check`: passed.

The application build still reports non-blocking large-chunk and React Router future-flag warnings. One intentional collaboration-security counterexample closes clients that attempt to rewrite protected state; the scenario passed as expected.

## Performance observation

The initial M5.1 dirty-tree, production-build browser run was runtime evidence rather than commit-bound P7 certification: 10,000 objects, first usable `1360.55 ms`, aggregate p95 frame time `10.00 ms`, calculated `119.23 fps`, and overall `PASS` against the `2500 ms`, `16.7 ms`, and `60 fps` targets.

## Ruling

M5.1's exact drawing-to-material lineage slice is deployed with local authority and public-route evidence. Customer-fixture acceptance, authenticated hosted M5 replay, broader organization/productization validation, and later AI recommendation work remain open roadmap items.

## 2026-09-03 exact deep-link hardening

- Root cause: the material route parsed the collection-level `version` filter and exact `boqLineId` filter independently, which allowed a handcrafted line-only URL even though canonical object-lineage links always identify both the BOQ version and line.
- Boundary: `version` alone remains valid for approved-BOQ collection/handoff selection; `boqLineId` without `version` now fails with HTTP 400 at the loader and is rejected by `listMaterialBoqLineage` before any database query.
- TDD: focused tests first produced 83 passed / 2 expected failures, then 85/85 after the two minimal guards.
- Independent controller verification: 85/85 focused tests, `npm run typecheck`, scoped Prettier check, and `git diff --check` all passed.
- Independent review: Critical 0, Important 0, Minor 0.
- This hardening does not close the customer fixture, hosted authenticated M5, managed backup/restore, or three-user production gates.
- Vercel deployment `dpl_7PpPofaToH8Vd8fCt54ZARmjGEkJ` reached READY, passed protected-candidate public/login-return smokes with no error/fatal logs, and was promoted. The production alias repeated the same smokes with empty error/fatal/`5xx` queries. The preceding verified deployment is `dpl_Ca9rQ4paG2qouw8KLTvL4e6GBR5A`.

## 2026-09-03 exact material-to-BOQ reverse navigation

- Root cause: each material-lineage row already carried both BOQ identities, but `승인 BOQ 근거 열기` emitted only `version`. Users returned to the BOQ version without the originating row identity.
- TDD: the SSR rendering contract first failed because the link lacked `line`; the minimum component change now emits the exact version-plus-line tuple.
- Browser contract: the canonical authenticated scenario now asserts the exact URL and focused `#boq-line-{id}` immediately after material-to-BOQ navigation, then continues through the existing BOQ-to-Drawing-to-BOQ lineage.
- Focused M5 route/server/browser-contract union: 94/94 passed. `npm run typecheck`, scoped Prettier, and `git diff --check` passed.
- The first disposable full-suite attempt stopped on one pre-existing IFC-view `.data` request canceled with `net::ERR_ABORTED`; the changed M5 scenario had not failed. An immediate fresh disposable-stack rerun did not reproduce it and passed all 17/17 Chromium scenarios in 1.9 minutes, including the changed material lineage gate. No request-failure exception was added and no unrelated production code was changed.
- Hosted authenticated replay and customer-fixture acceptance remain unexecuted. The existing hosted P2/P3/P6/P7 fixtures were not run because their current cleanup contracts can leave retained projects, immutable files, derivative jobs, audit rows, organizations, and test identities on the production data plane.
- On 2026-09-04, production-environment candidate `dpl_9sZVTYqzjVcZPgSkqwKiLtjwa6UG` reached `READY` at `https://lukas-qto-platform-lbrnu486m-lukas-projects-a540c097.vercel.app`. Candidate checks returned `/`, `/auth/magic-link`, `/robots.txt`, `/sitemap.xml`, `/examples/`, and `/examples/IFC_FIXTURE_NOTICE.md` as HTTP 200; `/workspace?entry=dashboard` returned HTTP 302 to `/login?next=%2Fworkspace%3Fentry%3Ddashboard`. Candidate-scoped `error`, `fatal`, and HTTP 500 log queries returned no records.
- After promotion, `https://lukas-qto-platform.vercel.app` resolved to that exact READY deployment and repeated the same route contract with empty post-promotion error/fatal/500 scans. The immediate rollback target is `dpl_7PpPofaToH8Vd8fCt54ZARmjGEkJ`. No Supabase schema, Edge Function, Storage authority, or Railway collaboration service changed in this increment.

## 2026-09-04 exact carbon-factor origin

- One exact project-scoped carbon factor can now start material lineage. The server unions plans that reference the factor through `material_plans.baseline_factor_id` or `material_transactions.carbon_factor_id`; it does not choose an arbitrary first plan.
- A valid unused factor returns an empty page. Malformed, missing, foreign-project, duplicate, and explicit plan/transaction conflict scopes fail closed. Material-link reads use the shared 100-ID chunk bound and a 2,000-plan ceiling; direct factor transactions retain the existing 10,000-row ceiling.
- Cross-chunk pagination is merged and deduplicated by exact UTC-microsecond descending `(created_at, id)` order before the 200-row cut. The regression fixture proves 205 plans over three chunks, a 200/5 split, and a second page with no duplicate or skipped identity.
- The UI exposes `이 탄소계수 계보만 보기`, preserves the exact factor across pagination, and the authenticated browser contract proceeds directly from factor → approved BOQ row → canonical Drawing object.
- Fresh controller verification passed 98/98 focused server/route tests, `npm run typecheck`, scoped Prettier, and `git diff --check`. A newly created disposable Supabase authority rebuilt the application, applied the complete schema, exercised real authentication/RLS/storage, and passed all 18 Chromium scenarios in 2.2 minutes.
- Independent review initially found the fractional-timestamp ordering and insufficient cursor/conflict/browser proofs. After the TDD fix loop, independent re-review reported Critical 0, Important 0, Minor 0, Ready YES.
- This increment adds no migration, RPC, dependency, alternate state store, or write authority. Approved customer-fixture acceptance and credentialed hosted M5 business-flow replay remain `UNEXECUTED`; public production deployment evidence is recorded only after exact-candidate promotion.
- Production-environment candidate `dpl_3v94Tum1CoicA3oUctZPnEEncWrM` reached `READY` at `https://lukas-qto-platform-dzlxcjijg-lukas-projects-a540c097.vercel.app`. Before promotion, `/`, `/auth/magic-link`, `/robots.txt`, `/sitemap.xml`, `/examples/`, and `/examples/IFC_FIXTURE_NOTICE.md` returned HTTP 200; dashboard, canonical split Drawing, and exact carbon-factor material paths returned HTTP 302 with their encoded internal login return preserved; malformed sharing returned bounded HTTP 404 with `private, no-store`, `no-referrer`, `noindex, nofollow`, `DENY`, and `nosniff`.
- Candidate fatal and HTTP 500 scans were empty; error entries were limited to the deliberately requested malformed-share 404. The exact candidate was promoted, and `https://lukas-qto-platform.vercel.app` resolved to the same `READY` deployment. Post-promotion route, security-header, title, and unexpected-error checks repeated successfully; fatal/500 scans remained empty and error entries remained limited to the intentional 404 probes.
- Immediate web rollback reference: `dpl_65jPHVYEqmkYHs2XWBUmgBMQ23rK`. Because this increment has no database contract change, that preceding artifact remains schema-compatible.

## 2026-09-05 transaction-origin exact BOQ tuple correction

- Root cause: a material-lineage row already contained its authoritative `boqVersionId` and `boqLineId`, but `이 BOQ 행 계보만 보기` supplied only the line and inherited a version only when the page happened to have a collection-level `version` filter. A valid transaction-, carbon-factor-, or material-plan-origin page without that filter therefore emitted an orphan line URL that the loader correctly rejected with HTTP 400.
- Boundary: the row self-link now always emits its own exact BOQ version-plus-line tuple. The existing loader/server rejection of a handcrafted orphan line remains unchanged, and no schema, RPC, RLS policy, server query, dependency, state store, or collaboration boundary changed.
- TDD: the new real-component SSR regression first failed on the orphan `?boqLineId=...` href and passed after the minimum link-builder correction. The focused M5 server/component/shell/table/BOQ union then passed `224/224`; application typecheck, collaboration typecheck/build, scoped formatting, and `git diff --check` passed.
- Disposable production-shaped authority rebuilt the application, started a fresh isolated Supabase/PostgreSQL/Auth/Storage/Realtime stack, and passed all `19/19` authenticated Chromium scenarios in 2.3 minutes. The M5 scenario now explicitly starts from a materials URL with no `version`, clicks the exact goods-receipt transaction, verifies the sole `transactionId`, clicks the BOQ-row self-filter, verifies the exact `version + boqLineId` tuple, focuses the approved BOQ row, and returns to the exact Drawing object. The runner removed its temporary project and service state afterward.
- The current-source P7 production-build runner passed `3/3` with run ID `114b8dac-2d03-43d4-a2e1-027074b352cf` and source-tree SHA-256 `e9ccfb7be47e248027c43197ab29c4a58c0f79664dc088d3801569b64f4dc65b`. It recorded cold first usable `2228.9000000953674 ms`, warm first usable `1615.3999998569489 ms`, and warm p95 `0.10000014305114746 ms` zoom, `0.20000004768371582 ms` pan, and `9.700000047683716 ms` selection. Local thresholds are `MET`; hosted production-runtime performance remains `UNEXECUTED`.
- Production-environment candidate `dpl_DXrtemKPhhYktJdethjnmL458ZVd` reached `READY` at `https://lukas-qto-platform-pxqxtzadh-lukas-projects-a540c097.vercel.app` with Lambda digest `6d3b225d17391ffd32620e9ad699c3620a1e1b2bc29bd85a39c4618099c1ee84`. It passed six public HTTP 200 routes, exact HTTP 302 login returns for dashboard, new workspace, canonical split workspace, and unversioned transaction-origin material paths, plus the bounded malformed-share HTTP 404 and five security-header checks. Checked bodies had no generic unexpected-error surface; fatal and HTTP 500 scans were empty, and error entries were only the deliberate 404 probes.
- The exact candidate was promoted without rebuilding. `https://lukas-qto-platform.vercel.app` resolves to the same `READY` deployment and repeated the candidate route, body, header, and log contracts. Immediate schema-compatible web rollback target: `dpl_J3VEdL9G5nnX9bhK5sMfthqvWRTH`. No Supabase, Storage, Edge, Railway collaboration, or IFC derivative boundary changed in this release.
- This local disposable proof does not become hosted authenticated authority. Customer-approved fixture acceptance, credentialed hosted M5 replay, Site-role field validation, and managed backup/restore remain `UNEXECUTED`.
