# Imported DWG Resave Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist exact approved imported-DWG resave requests and control their leased execution, including real cancellation, without fabricating published output.

**Architecture:** Trusted server compilation creates deterministic attestation before service-only database admission. A separate imported-resave queue preserves replay/source identity, revalidates live authority and fences cancellation. The execution bridge reuses the existing source transport and isolated resaver; published artifacts/UI are the next integration unit.

**Tech Stack:** Existing TypeScript, Zod, Node crypto/AbortController, PostgreSQL/Supabase, Vite Node-test loader, existing ACadSharp sandbox.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-resave-control-design.md`

## Global Constraints

- Preserve existing dirty worktree changes; no commit, stage, merge, push or deployment.
- No new dependency, paid service, license contract or remote DB/Storage mutation.
- No changes to source-free native export or selected-edit compiler contracts.
- Original source bytes and approved revisions remain immutable.
- Native output remains experimental-unqualified; persistenceAuthority remains not-issued.
- Do not modify or restart the live port 4173 preview, or overwrite its platform/build assets.
- Use only owned disposable local fixtures; do not use customer data.

Each task uses saved exact pre-task copies, behavioral RED/GREEN, then independent spec and quality review. Do not commit despite the generic workflow's commit steps. The user's standing instruction selects continued execution without approval questions.

---

### Task 1: Exact server attestation

**Files:**
- Create `platform/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts`.
- Modify `platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts` only to export its existing strict payload schema under `NativeDrawingDwgResaveSourcePayloadSchema`; keep projector behavior unchanged.
- Create `platform/tests/drawing-native-dwg-resave-attestation.test.mjs`; extract the shared test-only fixture into `platform/tests/fixtures/drawing-native-dwg-resave-source.mjs` from `platform/tests/drawing-native-dwg-resave-source.test.mjs`, preserving its existing assertions.

**Interfaces:**
- Consumes existing `projectApprovedNativeDrawingDwgResaveSource(rawScope, rawPayload)`, `NativeDrawingDwgScopeSchema`, payload schema and compiler output.
- Produces `buildNativeDrawingDwgResaveAttestation(rawScope:unknown,rawPayload:unknown,rawImageId:unknown):Promise<NativeDrawingDwgResaveAttestation>` and `parseNativeDrawingDwgResaveAttestation(raw:unknown,rawScope:unknown):NativeDrawingDwgResaveAttestation`.
- Export the exact type and strict schema from the design, including nullable request; parser checks exact digests/byte bounds, canonical authority serialization and scope/request/image consistency. Error class exposes only `kind:"invalid"` and a generic message.

- [x] Write behavioral tests using the real approved-source fixture. The regression target is changed/truncated/wrong-scope bytes reaching native execution, not a particular source-code string. Assert the literal native edit request and independent SHA-256/UTF-8 size, plus a decoded exact authority envelope:

```js
const {scope,payload,canonical,report,rehash} = fixture();
const unchangedPayload = structuredClone(payload);
canonical.objects[0].geometry.start.x = 20;
rehash();
const attestation = await build(scope, payload, imageId);
assert.equal(attestation.request.text, JSON.stringify({
  schemaVersion: "1hk-dwg-edits/2", sourceSha256: report.source.sha256,
  coordinateSystem: "WCS_NATIVE_UNITS",
  edits: [{handle:"2A",type:"LINE",start:[2,2,0],end:[3,4,0]}],
}));
assert.equal(attestation.request.sha256,
  createHash("sha256").update(attestation.request.text,"utf8").digest("hex"));
assert.deepEqual(JSON.parse(attestation.authority.text).scope, scope);
assert.equal((await build({...scope,snapshotSha256:unchangedPayload.approved.snapshot.sha256}, unchangedPayload, imageId)).request, null);
```

The existing fixture is native centimeters: its original LINE(1,2)→(3,4) projects to millimeters(10,20)→(30,40); changing start.x to20mm produces the literal request above. Include changed five types using the existing all-five-entity fixture from the source tests, reordered input keys, original→superseded status, clone bindings, malformed source/report/snapshot/image, changed byte/hash/handle/scope and extra fields. A parser mutation which merely updates an outer hash must still be rejected for canonical envelope inconsistency. The parser validates structural identity, not native geometry semantics; actual worker recompilation and the existing native validator retain that responsibility.

- [x] Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-attestation.test.mjs` and retain actual missing-feature RED before production code.
- [x] Implement fixed-order serialization around the existing projector, cloning/validating input before the first asynchronous boundary. The core operation is:

```ts
const text = JSON.stringify(projected.selectedEdits.request);
const request = projected.selectedEdits.request === null ? null : {
  text, sha256: createHash("sha256").update(text,"utf8").digest("hex"),
  byteSize: Buffer.byteLength(text,"utf8"),
  handles: projected.selectedEdits.request.edits.map(edit => edit.handle),
};
```

Build the nine-field authority envelope in the design's exact order. Parse strict nested objects before comparing canonical serialization; never accept reordered/noncanonical artifact bytes as a different valid encoding. No request ID or actor is consumed here; the queue binds them in Task2.
- [x] Run the new test and existing `drawing-native-dwg-resave-source.test.mjs`, `drawing-native-dwg-selected-edits.test.mjs`, `drawing-native-dwg-resave-protocol.test.mjs`; run platform typecheck in an owned copy if generated build artifacts are needed. Save source hashes and request independent review of the exact task delta.

### Task 2: Durable admission, status, lease and cancellation

**Files:**
- Create one migration via `supabase migration new drawing_native_dwg_resave_control` after inspecting CLI help; record its actual generated path in the task evidence.
- Create `platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts` and `platform/tests/drawing-native-dwg-resave-jobs.test.mjs`.
- Create `platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs`.
- Modify `platform/tests/drawing-workspace-m1-real-database.test.mjs` to pass its existing canonical-import result to the new fixture, and verify zero remaining resave rows after owned retention cleanup.

**Interfaces:**
- Consumes Task1 attestation, existing six-field scope, public approved-source RPC and verified user identity.
- Produces the seven RPCs and private context/lock/guard helpers named in the spec. Server adapters: `requestNativeDrawingDwgResave(userClient,serviceClient,rawRequest,rawImageId,signal?)`, `getNativeDrawingDwgResaveStatus(client,rawScope,rawJobId,signal?)`, `cancelNativeDrawingDwgResave(client,rawScope,rawJobId,signal?)` and `parseNativeDrawingDwgResaveClaim(raw,expectedImageId)`.
- Status shape: `{jobId,requestId,status,attemptCount,failureCode,hasChanges}`. Admission: `{jobId,requestId,hasChanges}`. Claim/control shapes and error codes are fixed in the design. RPC client uses existing mandatory abortSignal transport shape; every RPC is bounded and every response validates exact requested identity.

- [x] Add fixture export `proveNativeDwgResaveJobAuthority({owner,workerA,workerB,ids,imported})`. Reuse the canonical imported project's unmodified approved revision for no-op. Create an additional trusted template clone, read its canonical current object, and apply a supported nonzero LINE change using the existing operation RPC before review/approval. Do not seed invented approved snapshots or compiled edits. The service admission receives Task1's actual compiler output.
- [x] Start with absent RPC/schema RED through the existing real PostgreSQL wrapper (not a PGlite substitute). Add independently awaited session barriers and tests for:

```js
const first = await admit(editor, editedScope, requestId, attestation);
assert.deepEqual(await admit(editor, editedScope, requestId, attestation), first);
await denied(admit(editor, unchangedScope, requestId, noOpAttestation), "PNR12");
const [a,b] = await Promise.all([claim(workerA), claim(workerB)]);
assert.equal([a,b].filter(Boolean).length, 1);
await cancel(editor, editedScope, first.jobId);
assert.equal((await control(a ?? b)).action, "cancel");
await denied(fail(a ?? b, "worker_interrupted", true), "PNR13");
await acknowledgeCancel(a ?? b);
assert.equal((await status(editor,editedScope,first.jobId)).status, "cancelled");
assert.equal(await claim(workerA), null);
```

Fixture-local `admit/claim/control/fail/cancel/status/acknowledgeCancel` call the exact RPCs in role+JWT transactions; no production methods exist for fixture-only cleanup. Also cover viewer request/status, owner/admin cancellation, wrong scope/other-user cancellation, private locator confidentiality, service grant/JWT mismatch, strict identity corruption, terminal update/delete guards, capacity replay, blocked project/job locks, expired/replaced tokens, three attempts and live revoked/changed source evidence. Use `pg_blocking_pids` barriers for ordered races, not sleeps.
- [x] Implement private context via the existing private actor resolver and already verified import-job source. Reuse the established project→job lock order, fixed-role JWT guard and retention deletion helper. Admit stores exact attestation and source immutably; no_changes rows participate in request-ID replay. Claim/fail/control/ack never grant drawing write authority. Every public/application grant is explicit; direct table privileges remain revoked with forced RLS.
- [x] Implement user adapter verified identity and scope-only input. Malformed, aborted, followed-login/wrong response or mismatched job/request identity must fail generically; service errors map PNR12/13/15 without exposing raw messages. Unit tests exercise actual adapter calls with complete transport responses.
- [x] Run adapter tests, actual PostgreSQL cases, migration replay and local advisors. Keep logs and exact source hashes. Independent review must accept replay, source confidentiality, cancellation races and retention before Task3 integration.

### Task 3: Cancellation-aware native execution

**Files:**
- Create `platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts` and `platform/tests/drawing-native-dwg-resave-worker.test.mjs`.
- Create `platform/tests/drawing-native-dwg-resave-worker-sandbox.test.mjs` for explicit-opt-in actual execution-bridge cancellation, reusing the public synthetic DWG fixture and cached immutable image.
- Reuse `platform/native-dwg-worker/src/import-supabase.ts` unchanged. Modify `drawing-native-dwg-sandbox.server.ts` and `tests/drawing-native-dwg-resave-sandbox.test.mjs` only for the design's narrow resaver cleanup-confirmation error metadata and its tests; preserve reader behavior and the existing process lifecycle.

**Interfaces:**
- Consumes validated claim, service control/failure/cancel RPCs, source transport `downloadSource({source,signal})` and actual resaver `runIsolatedNativeDrawingDwgResaver` inputs plus its new bounded cleanup-confirmation error metadata.
- Export `runNativeDrawingDwgResaveAttempt(options)` with claim, service RPC client, download/resave dependencies, trusted image and optional worker-shutdown signal. Return discriminated outcomes prepared/cancelled/retry_scheduled/failed/stale/control_uncertain/settlement_uncertain. Prepared carries claim and exact native result, not a receipt.

- [x] Write signal-observing tests before implementation. A pending source or native operation must observe abort when the independently polled control changes. Preserve actual compiler/attestation validation rather than replacing it with a mock. The external-process seam may use a deterministic deferred operation; its test resolves only after its abort listener records cleanup.

```js
const execution = runNativeDrawingDwgResaveAttempt(options);
await nativeStarted.promise;
controlAction = {action:"cancel",reason:"cancel_requested"};
await nativeAborted.promise;
assert.equal(controlSignal.aborted, false);
nativeCleanup.resolve();
assert.equal((await execution).outcome, "cancelled");
assert.equal(publicationCalls, 0);
```

Also test cancellation immediately after native return, ignored abort result, revoked authority, expired lease, failed control poll, uncertain cancellation/failure acknowledgement, malformed source bytes and image/attestation/output mismatch. A successful prepared result must include the exact native report/output identities and no persistence authority.

- [x] First add behavioral RED for the existing sandbox's indistinguishable cleanup failure versus ordinary abort; implement only the design's `NativeDrawingDwgResaveSandboxError.cleanupConfirmed` metadata. Prove uncertain create/removal/directory cleanup never reports confirmed, ordinary abort after actual cleanup reports confirmed, and reader error contract is unchanged. The bridge must not acknowledge cancellation or failure after unknown/unconfirmed native cleanup; assert uncertainty outcomes and zero settlement calls.
- [x] Implement a1000ms independent poll with5000ms RPC deadlines and a separate execution controller. Run control before download and immediately after native return. Abort on any refusal/uncertainty, wait for execution cleanup, stop timers, and only then acknowledge cancellation. Use existing native timeout120s/cleanup10s and import source limit200MiB. Ordinary failure goes through the fenced failure RPC; uncertainty never returns prepared or silently retries admission.
- [x] Exercise actual sandbox cancellation with the already available immutable resaver image in an owned local probe; do not rebuild or replace the user's running preview. Run full focused attestation/source/compiler/protocol/job/worker tests and platform/worker typechecks. Obtain independent spec/quality review.
- [x] Record final implemented scope, exact source/runtime identity and any unexecuted actual-process/database checks. Update the continuation map to artifact publication/download/Auth/browser handoff; never mark the overall goal complete or wire scheduled/UI execution before the next unit can publish verified immutable results.
