# Task 2 — durable imported-DWG publication authority

Implemented and verified on 2026-09-06. Ready for controller review; Task3 service sequencing remains separate.

## Changed behavior

The CLI-generated migration `20260906130844_drawing_native_dwg_resave_publication.sql` adds durable attempt upload state, immutable artifact/export records, exact composite foreign keys and indexes, forced RLS, revoked direct grants, and the five specified RPCs. Stage validates four ordered unique bounded records, matches edit-request/authority hashes and lengths to the admitted compiler attestation, assigns exact managed paths, and opens the upload session atomically. Exact replay is stable; changed valid metadata conflicts with PNR12. Closed stage replay never reopens the session.

Close accepts an exact historical staged attempt/token even after expiry, cancellation or requester revocation, changes only open→closed, and replays without touching job/outcome. Publish checks current job and attempt leases, all upload blockers, live source and approved attestation, then rechecks the clock and atomically records the completed attempt/export/job. Exact committed-attempt replay returns the same receipt after expiry; another attempt/token is refused. Fresh authenticated receipt/descriptor RPCs resolve the published attempt only and disclose no lease/actor/attestation text. Cancellation and publication serialize under project→job→attempt locks.

Claim skips any job with any open attempt before all expiry/cancellation/authority/exhaustion handling. Fail, cancel acknowledgement, and row guards independently fence all open attempts. Failure codes add upload_failed/publication_failed under existing three-attempt and 30×attempt backoff rules. Latest status authorizes first, returns null for an idle exact scope, and keeps explicit unknown IDs unavailable. The jobs module imports no artifact core.

Retention extends the latest prior definitions from `20260905185231_drawing_native_dwg_export_jobs.sql`: all staged attempt artifacts enter manifests/counts; imported jobs lock in stable ID order; active jobs and open attempts block purge and finalization; finalization also rejects any unexpected object under the entire imported prefix. Existing IFC, source-free, original-file and protected-dependency behavior remains. A restrictive Storage policy denies authenticated/anon access to the imported prefix while preserving other prefixes.

Authenticated application exports:

- `getLatestNativeDrawingDwgResaveStatus(client: UserClient, rawScope: unknown, signal?: AbortSignal)`
- `getNativeDrawingDwgResaveReceipt(client: UserClient, rawScope: unknown, rawJobId: unknown, signal?: AbortSignal)`
- `getNativeDrawingDwgResaveDownloadDescriptor(client: UserClient, rawScope: unknown, rawJobId: unknown, rawKind: unknown, signal?: AbortSignal)`
- Existing `rpc(client: RpcClient, name: string, args: Record<string,unknown>, signal?: AbortSignal)` is exported as `callNativeDrawingDwgResaveJobRpc`.
- Existing `actor(client: UserClient, signal?: AbortSignal)` is exported as `verifyNativeDrawingDwgResaveActor`.

These reuse the existing bounded 30-second RPC/auth implementation. Receipt and descriptor adapters verify the authenticated actor before and after the RPC, reject malformed envelopes/results, normalize UUIDs, require exact scope/job/kind, and compare the complete managed descriptor path against the authorized project/job/attempt/hash/filename. The descriptor stays server-side. No second RPC/auth framework or Task3 service adapter was added.

## Tests and evidence

TDD RED: before the new migration, the full owned real PostgreSQL chain passed the existing resave control proof and failed the new actual clone→literal LINE edit→review→approval→compiler fixture at the missing stage RPC:

```
SQLSTATE 42883
function public.lukas_drawing_stage_native_dwg_resave(uuid, unknown, uuid, jsonb) does not exist
tests 1; pass 0; fail 1; duration_ms 8412.801583
```

The three authenticated adapter tests independently failed on missing receipt/descriptor/latest functions before their implementation. Their subsequent validation assertions use real schemas and the production compiler/core with precise RPC-boundary responses.

Final focused command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-artifact-jobs.test.mjs tests/drawing-native-dwg-resave-jobs.test.mjs tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-workspace-m1-database.test.mjs
```

Result: **23/23 passed**, 0 skipped, duration 1640.886083 ms.

Final real database command, with the controller-provided loopback URL on port32780:

```sh
M1_RESAVE_ADVISORS=1 M1_REAL_POSTGRES_DATABASE_URL=<owned-loopback-32780-postgres-url> M1_REAL_POSTGRES_REQUIRED=1 NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-workspace-m1-real-database.test.mjs
```

Result: **1/1 full-chain gate passed**, 0 skipped, duration 12171.450458 ms; generated database `m1_62538_575a06d3bd89` was created/dropped by the existing harness. Existing native export/import, collaboration, editor, approval and control assertions remain.

New real authority assertions cover strict stage metadata/caps/admitted identities; stage conflict/replay; publication while open denied; completed and expired replay; historical close and no reopen; ALL-attempt fencing including deliberately corrupted historical state; fail/ack/reclaim/expired-cancel denial while open; retry to attempt2 and exact published-attempt receipt/descriptor; independent-client cancel-first/publish-first races with explicit pg_blocking_pids project-lock barriers, without sleeps; requester revoke, outsider, exact scope, source/snapshot tamper; role+JWT/grants/forced-RLS/immutability; direct Storage select/insert/update/delete denial and ordinary-prefix behavior; complete staged retention manifests; independent active/open purge/finalization blockers; whole-prefix leftover denial; and successful guarded cascade removal.

The original clone/edit/approval sequence was extracted as `createApprovedNativeDwgResaveRevision({owner,ids,imported}) → {unchangedScope,editedScope}`, preserving all old assertions. New tests never forge an approved snapshot. Retention-only corruption probes temporarily remove earlier protected dependencies and emulate historical state inside an explicitly rolled-back synthetic transaction so the particular upload/active predicate must deny deletion. Exact original import-source and approved-snapshot rows compare equal afterward. Role/JWT helper changes exist only in tests; successful nested savepoints explicitly restore their prior role/claims.

Controller reports owned-copy full `npm run build`/typecheck passed exit0 for the final application hashes below. Evidence: [controller-task-2-build.log](controller-task-2-build.log). Existing large-chunk, React Router future-flag, mixed BOQ import and unsigned theme-cookie warnings were reported. Authoritative build/typegen and original4173 were untouched.

## Advisors and narrow fixture corrections

CLI help was inspected before migration generation and advisors. The first advisors attempt failed to connect because CLI2.114.0 requested TLS against the owned plain PostgreSQL runtime. The controller authorized `sslmode=disable` only after the helper validates loopback host, nonempty numeric port and generated `m1_` database name. The CLI says “Connecting to remote database...” for explicit --db-url even here; the actual destination was always 127.0.0.1:32780.

Final advisors: **278 findings, 0 ERROR, 12 WARN, 266 INFO**. Counts: 135 unindexed foreign keys, 109 unused indexes, 22 RLS-enabled/no-policy notices, 11 auth-RLS-initplan warnings, 1 multiple-permissive-policy warning. Warnings concern existing QTO tables/policies; no resave warning or unindexed FK finding. The two new tables' no-policy notices reflect intentional RPC-only access with direct grants revoked; no policies were added to suppress them. New indexes are not removed based on a disposable fixture's usage statistics. Machine-readable counts, relevant resave findings and all warnings are in [task-2-advisors-summary.json](task-2-advisors-summary.json).

An existing source-free fixture once failed before the new proof: `tests/fixtures/drawing-native-dwg-jobs-database.mjs:855` expected protected_dependencies but received retention_not_expired. Line841 seeded `purge_after=clock_timestamp()-1 second`, while production intentionally compares transaction `now()`. No numeric transaction age was logged. The controller preserved the exact baseline and authorized only clock_timestamp→now for that test seed; production retention time semantics are unchanged. The final real gate covers this correction.

The existing jobs test's old negative “completed” case was updated to invalid completed+attemptCount0 because completed is now supported; its test name was adjusted accordingly. Controller recovered and verified its exact baseline from the owned pre-task copy. No old authority assertion was dropped.

## Exact review scope and hashes

Existing-file comparisons use the public `baseline/task-2-*` copies, not dirty HEAD:

| Existing file | Baseline SHA256 |
| --- | --- |
| drawing-native-dwg-resave-jobs.server.ts | 7f20ed2c958ac7789a3a4ba673c2cfd3fc038f2b39bb2828ab8fedb2c96cd4d5 |
| drawing-native-dwg-resave-jobs-database.mjs | 8522d138f571326ca9469cea852b12ab184aeb92afd601565b3fdfd040664e20 |
| drawing-workspace-m1-real-database.test.mjs | dd1ab084d1b8703919cdf0942fd05f2137adeab15415a5fbc3bc31784f80117a |
| drawing-native-dwg-jobs-database.mjs | 0f5a71b9619ca8d851eefecd1a85736fddfd280ac3c9d57492fab20289d690d2 |
| drawing-native-dwg-resave-jobs.test.mjs | a323adea06176d96ca3f9028b3fedff951650b329e601c075c468f3c30c3fe5c |

Final key SHA256:

| File | SHA256 |
| --- | --- |
| app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts | 1c11d4cd8ef6e4e2eb8e5ae0c80ad41b0d844512618a70b971e60310ffc4fdc8 |
| app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts | cdf5df3bcdad088b989c406353282aaf498e38c697e260d3df0d0586fed2cea9 |
| supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql | ba1fade7c669dd4ce6022750d6787796cc8b93e37f6bcba03c9d5ea0ca2a61e6 |
| tests/fixtures/drawing-native-dwg-resave-publication-database.mjs | cec50d2e3c032c24d0ec59e6b5daf90fa6d280f61f9ad9d78af4e02c239e6e24 |

Accepted Task1 core remains 1cbe7ec842dfbf9404e11e12bdbfd7808d12ec968308396b55373724ff21410d; accepted control migration remains bc1f7c7f129788bf32dd3025dc990475061df9f98e2403f136304be6831f2cdd. `git diff --check` passed.

## Limits and handoff

These are database-authority and adapter-contract proofs. The fixture's DWG/report metadata uses declared literal bytes; it does not prove native execution, Storage upload/readback or browser E2E. Task3 must invoke stage/close/publish through its existing bounded 5-second helper and the accepted core validators, preserving settlement uncertainty; Task4/5 own HTTP/UI/worker wiring and actual Auth/Storage/native acceptance. An open session never closes by timeout and may require operational reconciliation after an unknown POST settlement. Qualification remains experimental-unqualified and persistenceAuthority remains not-issued.

Supabase/Postgres guidance informed explicit grants, RLS, composite FK indexes and lock order; TDD/writing-good-tests drove the missing-RPC RED and actual authority fixtures; Ponytail guided reuse of existing RPC/auth/compiler/retention behavior. Official Storage access-control documentation and current changelog were checked. No dependencies, commits, staging, remote DB/Storage mutation, deployment, native license/service, private artifact, owned runtime deletion or authoritative build changes were performed.
