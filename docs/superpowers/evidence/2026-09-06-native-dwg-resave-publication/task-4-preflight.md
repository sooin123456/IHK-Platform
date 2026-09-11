# Task4 product wiring preflight

Read-only map by /root/resave_product_wiring_map plus controller source/runtime checks. No implementation here. Task4 is pending behind Task3 review.

## Concrete existing seams

- app/routes.ts:112; screens/drawing-native-dwg-export.ts loader/action and drawing-native-dwg-download.ts loader-only.
- drawing-workspace-paths.ts:41/52: existing source-free paths/kind union; new imported helpers use a separate fixed union.
- components/drawing-workspace.tsx lazy wrapper315, launcher339, real callsite6066. currentUserId already supplied from screens/drawing-workspace.tsx:620/1268. Add pass-through only in launcher call, DrawingExportDialogProps35/destructuring422, new conditional DWG control706. It partitions local request IDs; never spread into HTTP JSON/query or treat as authority.
- drawing-native-dwg-export.tsx:392 existing source-free control. Keep its eligibility and direct tests unchanged; new imported control is selected only in dialog. Controller checked tests/drawing-native-dwg-export-ui.test.mjs:268: the imported rejection fixture is DXF and directly mounts the old control, so it remains a valid regression, not a test to replace.
- Dialog selection: any structure.sources value with sourceKind===dwg_entity gets new imported control, otherwise old control. Server projector remains authority for single page/canvas/no background/blocks and complete one-source-per-object graph.
- Existing source-free resource private bounded JSON reader is drawing-native-dwg-export.server.ts:59 (4096bytes, fatal UTF8); it is not an exported helper. Existing exported parseNativeDrawingDwgStatusScope can be assessed for narrow reuse with new normalized identities/strict intents. Do not invent an already-exported body helper.

## Tests/harnesses

- tests/drawing-native-dwg-jobs.test.mjs:39 resource exports,164 POST security/body/scope,234 GET strict query,324 verified download/second authorization.
- tests/drawing-native-dwg-export-ui.test.mjs:10 Vite SSR;268 old direct-control DXF rejection;340 paths;356–437 actual React createRoot/Playwright transport;439 replay/poll;491 double-click.
- tests/drawing-workspace-shell.test.mjs:205 launcher readiness; tests/drawing-export-approval-ui.test.mjs:11 dialog SSR starts PDF; tests/drawing-workspace-p2-contract.test.mjs:18 lazy-load source contract.
- Existing dialog SSR starts PDF and browser test mounts the old control directly: neither proves currentUserId traverses workspace→lazy dialog→new control. Add an explicit callsite assertion or meaningful mocked lazy-dialog test plus actual conditional dialog coverage.
- tests/drawing-native-dwg-import-worker.test.mjs:667 config,704 real spawned CLI/SIGTERM and loopback RPC. Reuse actual-process pattern, not Vite-only startup evidence.
- Relevant existing command: NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-jobs.test.mjs tests/drawing-native-dwg-export-ui.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-export-approval-ui.test.mjs tests/drawing-native-dwg-resave-jobs.test.mjs tests/drawing-native-dwg-resave-artifact-jobs.test.mjs tests/drawing-native-dwg-resave-worker.test.mjs

## Public DTO / runtime gaps

Resave acceptance is exactly {jobId,requestId,hasChanges}, not source-free accepted:true. Status has no actor/path/receipt and retains its exact admitted invariants. New resource envelope separately carries {job,receipt}; browser-safe extracted schemas must validate the complete strict ordered receipt and same exact scope/job. Descriptor is server-only.

No claim-resave adapter/CLI/package script currently exists. Use existing exported5s attempt RPC helper and parseNativeDrawingDwgResaveClaim, then Task3. Existing import.ts:45 shows config/session-disabled Supabase client/signal handling; import-supabase.ts:82 supplies redirect-blocked RPC fetch and164 exact source transport. Import helper's idle-only wait is not inherited for immediate resave failures: plan explicitly waits every turn.

Controller startup RED command in platform:

    NODE_OPTIONS=--no-experimental-webstorage node --experimental-strip-types --input-type=module -e 'await import("./app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts"); process.stdout.write("resave module import passed\\n");'

Exit1, Node.jsv26.5.0:

    SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
    drawing-native-dwg-resave-jobs.server.ts:85 readonly kind

Focused constructor search identifies the same inherited syntax in drawing-native-dwg-jobs.server.ts:132; sandbox and other resave errors already use erasable explicit fields. Node --experimental-transform-types is unavailable (bad option, exit9); help confirms strip-only switch. Task4 owns narrowly equivalent explicit readonly fields/assignments in those two classes and actual new-entry subprocess proof. Do not solve by adding a transpiler dependency or changing source-free behavior.

Main read React best-practices skill plus localStorage-schema and effect-dependencies rules: use minimal versioned actor/scope ID storage with exception handling, stable primitive effect dependencies and generation fencing; no new state library.
