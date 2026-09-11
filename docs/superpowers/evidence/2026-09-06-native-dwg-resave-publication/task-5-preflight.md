# Task5 acceptance preflight

Prepared while Task4 implements; not an acceptance claim or authorization to skip Task4 review.

## Owned execution boundary

- Authoritative source: /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1. App: platform. Original4173 preview/build must not be restarted/rebuilt. All actual full-stack runs use /Users/h/1hk-r2-restore-uvc74K/platform, whose node_modules/build/.react-router are physically owned and whose .env files are absent.
- Existing runner scripts/run-drawing-workspace-m1-e2e.mjs fully read by controller. It verifies project marker/config/status exact credentials, loopback API/DB, exclusive4000/12349/12350 ports, randomly named disposable Supabase project, tracked child process groups and bounded owned cleanup. It builds app and collaboration, runs mandatory M1/M2/M5 real DB gates, then the selected Playwright target. Do not bypass these guards or reuse occupied servers. No remote/linked Supabase commands.
- Add only dwg-resave profile to current m1/p3/dwg-source selection. Actual runner regression filename is tests/drawing-workspace-m1-release-harness.test.mjs (not an invented e2e-runner filename). New profile requires its exact target; existing profile targets and environment cleanup remain unchanged.
- The existing standalone PG at127.0.0.1:32780/container5acd32bf651a is a separate controller-owned runtime, not this runner's Auth/Storage stack. Do not substitute it for marked full-stack authority or stop it during runner cleanup.
- Installed node26.5, /opt/homebrew/bin/supabase2.114.0, /opt/homebrew/bin/docker with unix:///Users/h/.colima/default/docker.sock. Required ports4000/12349/12350 had no listeners at preflight. Recheck immediately before running.
- agent-browser is not available on PATH or enabled connector metadata. Use existing project Playwright browser/screenshot facilities as fallback, without installing another dependency. Visually verify the owned app when started; retain screenshot/page errors and exact UI evidence. No active-voice capture tool and no takeover of original user preview.

## Public native assets

- Immutable combined reader/resaver image sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae is cached. Controller verified both labels org.1hk.native-dwg-reader.protocol=1hk-dwg-import/1 and org.1hk.native-dwg-resaver.protocol=1hk-dwg-resave/1. Native sandbox owns credential-free/network-free containers and cleanup; no source/output bind mounts or private binaries.
- Exact source: docs/superpowers/evidence/2026-09-06-native-dwg-resave-protocol/controller/actual/source/synthetic-input.dwg;10987bytes,AC1024, SHA256bcc54d3c768444c9ade41a23e4ef2b9f5b5668d9972522ee4a4adbc98c670434, freshly rehashed. Preserve its exact relative path in owned copy. Different source-ingestion test fixture at native-dwg-export-jobs/native.dwg is13387bytes/SHA7d94793d…77201 and must not be substituted.
- Controller verified19 public .cs/.csproj/lock/notice files byte-identical in owned tool copy, then ran dotnet build --no-restore --no-incremental -c Release:0errors/0warnings; dotnet publish --no-build --no-restore -c Release to fresh /tmp/1hk-resave-acceptance-writer-YiAOMM:exit0. No new packages/lock changes or private DLL used. Exact outputs: controller-task-5-writer-build.log and controller-task-5-writer-publish.log.
- Source-free M1 regression writer directory must use canonical /private/tmp/1hk-resave-acceptance-writer-YiAOMM, not /tmp alias: accepted publishedFiles guard rejects any realpath mismatch. Controller first /tmp hash check failed at that guard; exact realpath check confirmed cause, canonical path then passed. Writer build SHA256d25ca5723523df1d793a00ae82f12589960e4a73dd3b691a26bf484b5690bd6e. Dotnet canonical host /opt/homebrew/Cellar/dotnet@8/8.0.130/bin/dotnet. This dependency is for source-free regression only; imported resave uses cached sandbox image.

## Concrete source/UI seams

- e2e/drawing-dwg-source-ingestion.spec.ts:96 uploadFromBrowser pattern exercises real TUS upload, verification edge function, then files/finalize-upload. Reuse the pattern against the exact10987byte source; do not count fixture seeding alone as browser upload proof.
- e2e/utils/drawing-estimator-fixture.ts:435 creates normalized owned owner/editor/reviewer/approver/viewer/outsider and blank workspace. e2e/utils/drawing-collaboration-fixture.ts:1548 authenticateContext;1575 authenticateApiClient;1601 destroyDrawingFixture. Existing cleanup uses retention protocol, not blind row deletion. Public pinned IFC fetch by this fixture is unrelated source regression data, not customer data.
- components/drawing-native-dwg-import.tsx has accessible region DWG 편집 가져오기; selectors DWG 원본, DWG 단위, buttons DWG 분석 시작 and 편집 객체로 가져오기. Workspace source tools render it near6490; its actual production form action is operations route with revision query, intents request_native_dwg_import/native_dwg_import_status/prepare_native_dwg_import. Canonical prepare/apply comes from server and uses existing collaboration persistence; never forge a plan, approval or snapshot.
- native-dwg-worker/src/import.ts exports parseNativeDrawingDwgImportWorkerConfig; import-supabase.ts exports createNativeDrawingDwgImportRpcFetch and createSupabaseNativeDrawingDwgImportDependencies; import-worker.server.ts exports runNativeDrawingDwgImportWorkerOnce. Actual analysis must use these against marked Auth/Storage and the pinned image.
- Tests/drawing-native-dwg-resave-worker-sandbox.test.mjs shows existing runIsolatedNativeDrawingDwgReader input and literal output LINE4A end[120,21,0]. Its finite control fixture is not full-stack acceptance and must not replace real Task5 job authority.
- Existing source-free e2e/utils/drawing-native-dwg-export-evidence.ts demonstrates actual receipt/download/hash/header/role checks, but owns source-free request and writer contracts. Reuse patterns, not its whole helper or source-free manifest kind for imported resave.

## Authority traps

Viewer has accepted read authority to approved imported source/status/receipt/download (Task2 fixture defaults receipt/descriptor reads to viewer). Test viewer geometry/approval mutation denial and direct managed Storage denial; do not invent a new blanket Viewer download prohibition. Outsider/revoked actor must lose all scoped access. Server request identity is authenticated actor; never send browser actor/image/paths/leases.

Task5 success story needs actual UI request/completion/relogin/download. Use real production edit and review/approve paths; any explicit transport barrier in cancellation/retry tests is finite fault injection, labelled separately from actual native and browser success. Preserve originalSHA and compare untouched supported entities/layers plus bounded unsupported identity/coverage; same-engine checks do not prove independent recipient CAD or complete unsupported payload fidelity.

## Focused native seam follow-up

Read-only /root/resave_publication_handoff_fix_review map (a new task after its completed Task3 review), independently source-checked by controller:

- Current production reader is drawing-native-dwg-sandbox.server.ts:377, signature runIsolatedNativeDrawingDwgReader({dockerPath,dockerHost,imageId,sourceBytes,expectedSource,signal?,timeoutMilliseconds?}). It returns strict NativeDrawingDwgImportReport after owned cleanup. Read downloaded bytes only after hash/size agrees with independently authenticated publication receipt/report output, not with a descriptor invented from those bytes.
- Public source-inventory/qualification-report.json:38 proves actual baselineLINE4A start[0,0,0],end[100,0,0],layerQA_GEOMETRY,modelSpace40. Task5 changes only endpoint to[120,21,0], retaining start[0,0,0]. Earlier finite worker-sandbox test deliberately changed start too; do not mistake its expected[10,11,0] for the original baseline or use its output as a golden artifact.
- drawing-native-dwg-import.server.ts:430 projects X/Y times millimetersPerUnit; declaredunit4→factor1. selected-edits.server.ts:114 divides X/Y by that factor, no Y-axis inversion. Resolve actual LINE object via dwg_entity source handle4A, not the first line or a hardcoded generated UUID.
- applyDrawingCommand(state,command,environment?) in drawing-commands.ts:2053 produces a version-aware update_objects operation. If using authenticated endpoint for literal geometry, parse through DrawingOperationInputSchema to retain only seven wire keys before intent=apply_operation,operation_json form to /projects/:projectId/workspaces/:workspaceId/operation. Label this API seam honestly. Do not submit extra client-only command fields.
- Real collaboration review requires workspace UI/action freeze handshake. Direct lukas_drawing_request_review is the non-collaboration DB proof, not a substitute in this story. Then distinct reviewer/approver use snapshot-bound decisions.
- Readback oracle: LINE4A start[0,0,0]/end[120,21,0]; other supported4B–4E deep-equal; layers/coverage deep-equal; unsupportedINSERT/unsupported_type/count1/sampleHandles54 retained. This bounded native reader oracle plus resaver supported-field inventory is not full payload or independent CAD fidelity.

## Exact pending Task5 baselines

| File | SHA256 |
| --- | --- |
| platform/scripts/run-drawing-workspace-m1-e2e.mjs | 97fff5bcd793698449d4ff148b70b4c6f12e273ea97fb7fb711f3639b37fad8d |
| platform/tests/drawing-workspace-m1-release-harness.test.mjs | 13b04fd32fd0050c1276e9771fcfb52a7545c09f4ab1095ab9175b98358d7f83 |
| platform/DEPLOYMENT.md | 26d87c31ccc041d0191a5e1f764063eb9bf5268413e3023ede66d2a8f6eba180 |

Exact public copies baseline/task-5-[basename] were written and all3hashes independently reverified. Recheck authoritative files before editing; capture any additional baseline before broadening file scope. Task4 in-flight files are not Task5 baselines.
