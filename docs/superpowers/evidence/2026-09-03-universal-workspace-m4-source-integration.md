# Universal Drawing Workspace M4 source-integration evidence

Date: 2026-09-03 (Asia/Seoul)

Release verdict: **LOCAL PASS for the implemented M4 source-integration vertical**. The canonical signed-in workspace now proves source-optional PDF/IFC selection and reopen, PDF↔IFC object lineage, bounded verified DXF import, immutable source evidence, and the explicit native-DWG boundary without adding a second canvas, collaboration service, CRDT, or client state library.

This is disposable local production-shaped authority plus public production smoke. It is not a customer-fixture acceptance result and does not claim a credentialed hosted M4 collaboration replay.

## Implemented boundary

- A source-free authenticated workspace lists project PDF, IFC, and DXF candidates without fetching every candidate's signed bytes or derivative.
- An Editor can choose an IFC source, switch to the real IFC canvas, close the browser context, and restore the exact canonical deep link after re-authentication. The same workspace can then return to 2D and attach an immutable PDF background.
- One drawing object can retain a PDF page/region and IFC `GlobalId`; selection works in both directions, revision markers render, and Viewer mutation is denied by UI, action, and database authority.
- Verified DXF upload/import is server-only and bounded by byte, entity, point, block-depth, coordinate, report, and elapsed-work limits. Supported entities are normalized to millimetres and stored through the existing operation/outbox graph.
- DXF object-source rows retain source file/SHA, entity key/type, source layer, optional handle, declared/selected unit, and importer version. Deterministic IDs make response-loss retry idempotent.
- Native DWG remains an immutable original only. Import attempts receive bounded Korean guidance to provide a user-converted DXF; the product does not pretend to parse native DWG.
- `dxf-parser` is pinned to `1.1.2`, imported statically for server dependency tracing, and recorded under its MIT licence in `platform/THIRD_PARTY_NOTICES.md`.

## Fresh verification matrix

| Authority                         |                   Result | Covered surface                                                                                                                                                                                                                                          |
| --------------------------------- | -----------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused M4/source union           |         **207/207 PASS** | DXF client/server adapter and plan, route/upload contracts, source migrations/runtime, source attach, PDF/IFC P5 lineage, and canonical E2E contract                                                                                                     |
| Canonical disposable browser gate | **15/15 PASS (1.8 min)** | Real magic-link authentication, source-free IFC select → ready 3D → new context/re-authentication restore → verified 2D surface → PDF attach, immutable SHA evidence, PDF↔IFC lineage, verified DXF import, undo/redo, relogin, and Viewer denial       |
| Full local release runner         |                 **PASS** | Fresh isolated Supabase stack, application typecheck/build, collaboration build, real-database authorities, and one-worker Chromium canonical suite                                                                                                      |
| Standalone application typecheck  |                 **PASS** | `npm run typecheck` after the final browser-test change                                                                                                                                                                                                  |
| Scoped whitespace gate            |                 **PASS** | `git diff --check -- platform/e2e/drawing-workspace-m1-estimator.spec.ts`                                                                                                                                                                                |
| Independent focused review        |                 **PASS** | Initial review found 0 Critical and 2 Important proof gaps. After ready-viewer, 2D-state, request-failure, and evidence-label fixes, follow-up review returned 0 Critical, 0 Important, `Ready: Yes`; its minor 2D-surface note was also fixed and rerun |

The focused union was executed with `node --test` across the 17 M4 DXF/source/PDF/IFC contract files after the final review changes. The full browser authority was executed with `npm run test:e2e:drawing-workspace-m1:local`; its final post-review result was `15 passed (1.8m)`.

The expected collaboration-security counterexample logged `Clients cannot rewrite protected collaboration state.` and closed the offending client. The surrounding scenario passed; this is an exercised denial, not an application failure.

## Exact source-reopen proof

The added canonical scenario starts from `/projects/:projectId/workspaces/new`, creates a blank workspace, verifies `원본 없음 · 빈 캔버스`, selects the seeded immutable IFC source, and requires the `ifc` query identity, a visible IFC region with `data-viewer-phase="ready"`, a visible `canvas[aria-label="IFC 3D 모델"]`, and an enabled `전체 보기` control. It then:

1. saves the exact canonical pathname and query,
2. closes the original browser context,
3. creates a new context and re-authenticates into that URL,
4. verifies the IFC selector, `view=3d`, and IFC canvas again,
5. returns to 2D, verifies `view=2d`, the pressed 2D control, and the visible Konva drawing surface, then attaches the immutable PDF,
6. reloads and re-authenticates once more,
7. compares the persisted PDF document/canvas binding exactly, and
8. compares both PDF and IFC metadata plus downloaded Storage-byte SHA evidence before and after.

The assertion is therefore not a preview-route visual check: it crosses authentication contexts and verifies the persisted Postgres/Storage authority used by the canonical project route.

## Fixture and hosted status

- **Approved customer DXF fixture: UNEXECUTED.** No redistributable customer-approved CAD fixture is present. The executed DXF proof uses a small deterministic seeded fixture and must not be represented as customer acceptance.
- **Customer fixture redistribution status: NOT AVAILABLE / NOT GRANTED.** No customer bytes were copied into the repository or test artifacts.
- **Credentialed hosted P3/M4 replay: UNEXECUTED.** The promoted Vercel project stores the needed Supabase and collaboration credentials as non-exportable Secret values. `vercel env pull` and `vercel env run` intentionally returned masked/unavailable values, while this local shell has no Supabase access token. The fail-closed production fixture was not weakened and no secret was converted to exportable configuration.
- **Public production smoke: PASS on the already promoted runtime.** Vercel deployment `dpl_35DgDAVTE87CD9b6haTkbHWeP9bi` is the current production deployment at `https://lukas-qto-platform.vercel.app`; root/auth/public metadata routes and deployment-scoped error/fatal-log scans passed in the deployment evidence.

The final M4 delta in the 2026-09-03 closeout was test and documentation only. It did not alter the then-shipped application, migration, Edge Function, or collaboration-service runtime, so a second byte-equivalent production deployment was not created at that time. The 2026-09-05 supplement below is a later runtime change and has its own deployment gate. Credentialed hosted authority and customer-fixture acceptance remain explicit release follow-ups.

## Remaining gates

- Obtain an approved, redistributable customer DXF and run `upload → parse → persist → reload/relogin → exact geometry`, including deterministic totals, layer mapping, entity lineage, and source SHA before/after.
- Provide a safe credential authority for the fail-closed hosted browser fixture, then run hosted P3/M4 multi-user reflection, role denials, review/approval, and source integration without exporting secrets into logs or artifacts.
- Preserve a committed source revision and bind later deployment/evidence to that revision. This dirty shared worktree is runtime evidence, not a cryptographically reproducible release snapshot.

## Ruling

M4 Tasks 1–5 are implemented and freshly verified under disposable authenticated authority. Task 6 remains partially open because no approved customer fixture or credentialed hosted replay is available. The implementation may proceed to later roadmap work, but neither customer acceptance nor hosted authenticated M4 completion is claimed.

## 2026-09-05 OSS DXF interoperability supplement

This supplement proves one real open-source parser fixture without relabelling it as customer evidence. The repository now retains the exact `gdsestimating/dxf-parser` `extendeddata.dxf` bytes from commit `0df7a37a4207a1f925b8d0bfffc270ff121446b4` under its full MIT licence. The local fixture is 102001 bytes with SHA-256 `9b39289e3435fb187eb0e671fb8a07b8728cdf69a0275836f67ca005732f781d`; automated provenance checks bind the bytes, repository, commit, source URLs, licence text, and explicit non-customer disclaimer.

The prior adapter rejected the file because AutoCAD's unused exact `$EXTMIN=(1e20,1e20,1e20)` and `$EXTMAX=(-1e20,-1e20,-1e20)` header pair was interpreted as drawing geometry. The hardened adapter omits only that complete, exact, uppercase six-axis pair during parsed-header preflight. Partial, altered, case-folded, approximate, or non-finite variants remain subject to the original limit, as do every other header value plus raw, parsed, transformed, and converted entity coordinates. No coordinate limit, parser interface, dependency, schema, worker, client path, or state store changed.

The pinned fixture deterministically imports eight `LINE` objects on layer `0`, with handles `38`–`3F`, eight `STYLE_NORMALIZED` reports, one unsupported `VIEWPORT` skip at `raw:ENTITIES:2186`, zero blockers, and the existing `mutate_structure` plus `add_objects` operation pair. A repeat import is deeply equal. Counterexamples prove that an entity coordinate bomb, a partial or altered sentinel, a case-folded sentinel, and a non-finite unrelated header value still block.

Fresh controller verification before candidate deployment:

| Authority                                      |                                 Result |
| ---------------------------------------------- | -------------------------------------: |
| DXF adapter plus fixture-licence suites        |                         **57/57 PASS** |
| TypeScript                                     |                               **PASS** |
| Production application build                   |                               **PASS** |
| Disposable authenticated M1–M4 browser gate    |               **19/19 PASS (2.2 min)** |
| Scoped formatting and whitespace               |                               **PASS** |
| Independent licence/provenance review          | **0 Critical / 0 Important / 0 Minor** |
| Independent parser-security/determinism review | **0 Critical / 0 Important / 0 Minor** |

The browser gate includes verified DXF upload/import, canonical persistence, reload/relogin, immutable source lineage, Viewer denial, PDF/IFC regressions, collaboration/offline replay, review/approval, export, and responsive failure-containment scenarios. The observed `Clients cannot rewrite protected collaboration state.` server messages are exercised denial cases whose surrounding scenarios passed.

**Approved customer DXF fixture acceptance remains UNEXECUTED.** No customer bytes were copied into the repository, and this OSS fixture does not satisfy either customer-fixture checkbox. Credentialed hosted multi-user replay also remains `UNEXECUTED`; candidate and production route smokes do not replace that authority.

The exact verified web runtime was deployed as production-environment candidate `dpl_J7Ye8J27uZg5AigNeERs8q7nkMJx` at `https://lukas-qto-platform-h68d2up1b-lukas-projects-a540c097.vercel.app`. It reached `READY` with Lambda digest `a92bca0a45585d5d87966553402aea95823ac4cf03ae5684c136c48e83da28c3`. Before promotion, `/`, `/auth/magic-link`, `/robots.txt`, `/sitemap.xml`, `/examples/`, and `/examples/IFC_FIXTURE_NOTICE.md` returned 200; dashboard, canonical-new-workspace, and legacy-workspace deep links returned exact candidate-local 302 login returns. The public bodies contained no generic unexpected-error surface, and candidate-scoped error, fatal, and HTTP 500 queries were empty.

The exact candidate was promoted. `https://lukas-qto-platform.vercel.app` resolves to the same deployment in `READY` production state and repeated all six 200 responses, all three exact alias-local 302 login returns, body checks, and empty error/fatal/HTTP-500 queries. Immediate rollback target: `dpl_8UMz5iXFDNcio51yDLr69GbGk7ry`. This supplement changed only the Vercel web runtime; no Supabase schema, Edge Function, Storage policy, Railway collaboration service, or IFC derivative worker was redeployed.
