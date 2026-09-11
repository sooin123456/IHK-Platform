# Imported DWG Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Publish an approved imported-DWG edit as four immutable, verified files and expose authenticated request, status, cancel and download in the existing DWG dialog.

**Architecture:** Extend the accepted imported-DWG job/attempt lifecycle, not the source-free exporter. Share its bounded Storage transport with two fixed profiles; use durable upload fencing, exact-attempt publication and fresh download authorization. Preserve the accepted native runner and original source bytes.

**Tech Stack:** Existing TypeScript, Node crypto/fetch, Zod, Supabase PostgreSQL/Auth/Storage, React, Node test/Vite, Playwright, Docker resaver. No dependency installation.

**Spec:** docs/superpowers/specs/2026-09-06-native-dwg-resave-publication-design.md

## Global Constraints

- Preserve existing dirty worktree changes; no stage, commit, merge, push or deployment.
- No new dependency, paid service, license contract or remote DB/Storage mutation.
- Original source bytes and approved revisions remain immutable.
- Source-free native export eligibility, artifact kinds, limits and RPC behavior remain unchanged.
- Native output remains experimental-unqualified; persistenceAuthority remains not-issued.
- Do not modify or restart live port4173 or overwrite authoritative platform/build assets; build and run acceptance in an owned copy.
- Use only owned disposable local fixtures and public synthetic DWG; no customer data or private .superpowers/sdd artifacts.

## Execution and file map

Root: /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1. All commands run in platform unless noted. Use NODE_OPTIONS=--no-experimental-webstorage. Exact pre-task copies, not dirty HEAD diffs, form review baselines. Public ledger/brief/report/review artifacts live at docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/. The user's standing instruction waives further approval prompts and commits; retain evidence rather than deleting it.

Task1 owns artifact identity and the two-profile Storage transport. Task2 owns database evidence and RPC adapters. Task3 owns publication sequencing. Task4 owns resource/UI/CLI wiring. Task5 owns actual full-stack acceptance. Implementers run sequentially; read-only preflight/review can run alongside controller work.

Type flow: existing jobs → artifact core → artifact RPC adapters → publisher/resource/download. Existing jobs MUST NOT import artifact core; this avoids a claim-parser cycle. Existing native worker → publisher, not vice versa. HTTP/UI never get service keys, raw source locators, lease tokens or attestation texts.

## Task 2: Durable immutable publication and retention authority

**Files:**
- Create a new CLI-generated migration under platform/supabase/migrations; suffix drawing_native_dwg_resave_publication.sql. Do not edit accepted control/source migrations.
- Modify platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts (completed/failure enums, latest status only).
- Create platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts (receipt/descriptor and stage/close/publish adapters; imports Task1 core, never opposite).
- Create platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs and platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs.
- Modify platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs narrowly: extract its existing real clone→edit→approval setup as createApprovedNativeDwgResaveRevision({owner,ids,imported}) returning {unchangedScope,editedScope}; both old/new proofs consume it without losing prior assertions. Replace the obsolete advisors-only literal32779 port assertion with validated nonempty local loopback port and existing m1_ database identity check; actual container ownership is verified by controller before opt-in runs.
- Modify platform/tests/drawing-workspace-m1-real-database.test.mjs narrowly at existing actual imported-resave fixture integration; retain the separate finite drawing-workspace-m1-database.test.mjs tests.

**Interfaces:**
- Export getLatestNativeDrawingDwgResaveStatus(userClient,rawScope,signal?) → validated existing status|null; existing getStatus remains explicit-job.
- createApprovedNativeDwgResaveRevision is a test-only real operation/review fixture, not a production approval bypass. Existing role/JWT helpers stay test-only; no forged approved snapshot.
- Export getNativeDrawingDwgResaveReceipt(userClient,rawScope,jobId,signal?), getNativeDrawingDwgResaveDownloadDescriptor(userClient,rawScope,jobId,kind,signal?). Reverify authenticated user, strict scope/results, complete ordered receipt and exact descriptor path. Descriptor stays server-side.
- SQL signatures and return schemas are exactly the five numbered RPCs in spec. Task2 exports authenticated receipt/descriptor adapters; Task3 owns service stage/close/publish calls through its reused 5s worker helper and exact Task1 validators. Existing strict jobs RPC can be narrowly exported as callNativeDrawingDwgResaveJobRpc for authenticated Task2 reuse at its existing 30s deadline. Do not add a second general RPC framework.
- Failure codes add upload_failed and publication_failed. Completed outcome/status does not alter existing status shape. Receipt schemaVersion is 1hk-dwg-resave-receipt/1, published attempt only.

- [ ] Build a real PostgreSQL regression fixture from existing canonical import→clone→literal LINE operation→review/approve flow. Production mutation expected to break tests: allowing terminal/reclaim/retention while an upload is open, accepting changed metadata, or returning another attempt's receipt. Independent concurrent clients and explicit lock barriers, not sleeps.

```js
const staged = await serviceRpc("lukas_drawing_stage_native_dwg_resave", {p_job_id: claim.jobId, p_attempt_number: 1, p_lease_token: claim.leaseToken, p_artifacts: metadata});
assert.equal(staged.uploadState, "open");
await expectSqlState("PNR13", () => serviceRpc("lukas_drawing_publish_native_dwg_resave", identityArgs));
await serviceRpc("lukas_drawing_close_native_dwg_resave_upload", identityArgs);
const receipt = await serviceRpc("lukas_drawing_publish_native_dwg_resave", identityArgs);
assert.equal(receipt.schemaVersion, "1hk-dwg-resave-receipt/1");
assert.deepEqual(await serviceRpc("lukas_drawing_publish_native_dwg_resave", identityArgs), receipt);
```

- [ ] Run before migration against owned disposable full-chain DB; record missing RPC/expected failure. CLI help first, explicit owned loopback only; no --linked. Generate migration through installed CLI.
- [ ] Add attempt upload state/timestamp consistency; forced-RLS, revoked direct grants, immutable artifact/export tables and exact composite FKs/indexes. Server owns managed paths. Stage validates four ordered unique bounded artifacts and request/authority hashes+lengths against admitted attestation. Close is historical exact-token cleanup, including expiry/revocation, and cannot publish/reopen. Publish atomically closes outcome/job after live source+attestation and final clock check; exact committed replay stable. Service role AND JWT, project→job→attempt locks.
- [ ] Update existing guard/claim/fail/ack paths to block ALL open attempts; cancel intent alone still allowed. Retry only closed/not-started under existing limits/backoff. Preserve stage conflictPNR12 and stalePNR13. Latest status authorizes before optional-ID lookup.
- [ ] Extend retention manifests/counts/purge/finalize with ALL staged artifacts, active/open blockers, stable job lock order and full managed-prefix leftovers. Revoke direct authenticated/anon Storage prefix access; preserve other prefixes. Read applicable latest function definitions, not first historical migration.
- [ ] Adapter tests use actual schemas/compiler and precise RPC-boundary doubles to catch malformed envelopes, normalized identity/strict extras, missing auth, wrong receipt/descriptors and null latest. DB tests cover replay/different metadata, cancel-first/publish-first, historical close, open expiry/reclaim/fail/ack/retention, requester revoke/source tamper/outsider, direct table/Storage denial and immutable approved/source data. Run existing real DB suite once in owned runtime, schema advisors (report existing warnings), focused TS tests and owned-copy typecheck. Write report and review exact delta; no commit.

## Controller scope clarifications during execution

- Narrowly export the existing bounded actor-verification helper alongside callNativeDrawingDwgResaveJobRpc for artifact adapter reuse. Preserve its existing30s auth/deadline behavior; no second auth implementation or browser authority exposure.
- Correct the source-free real retention fixture seed at tests/fixtures/drawing-native-dwg-jobs-database.mjs:841 from pg_catalog.clock_timestamp()-interval '1 second' to pg_catalog.now()-interval '1 second'. Both accepted and new production purge compare transaction now(), and a real run failed at the later intended protected_dependencies assertion with retention_not_expired. Preserve production semantics. Public baseline/task-2-drawing-native-dwg-jobs-database.mjs captures exact pre-fix bytes; include this sole test-only change and failed/passing evidence in review.
- Existing jobs negative-status tests must account for newly supported completed status; use an actually invalid completed shape (for example attemptCount0) instead of continuing to treat completed itself as unknown. Preserve original negative assertions and capture the pre-edit baseline.
- Advisors helper only: after validating explicit loopback/nonempty port/generated m1_ database, set sslmode=disable on its CLI URL because the owned disposable PG does not enable SSL. Preserve production/remote client behavior and record initial TLS refusal plus actual subsequent advisory results separately.
