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

### Task 3: Cancellation-aware native execution

**Files:**
- Create `platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts` and `platform/tests/drawing-native-dwg-resave-worker.test.mjs`.
- Create `platform/tests/drawing-native-dwg-resave-worker-sandbox.test.mjs` for explicit-opt-in actual execution-bridge cancellation, reusing the public synthetic DWG fixture and cached immutable image.
- Reuse `platform/native-dwg-worker/src/import-supabase.ts` unchanged. Modify `drawing-native-dwg-sandbox.server.ts` and `tests/drawing-native-dwg-resave-sandbox.test.mjs` only for the design's narrow resaver cleanup-confirmation error metadata and its tests; preserve reader behavior and the existing process lifecycle.

**Interfaces:**
- Consumes validated claim, service control/failure/cancel RPCs, source transport `downloadSource({source,signal})` and actual resaver `runIsolatedNativeDrawingDwgResaver` inputs plus its new bounded cleanup-confirmation error metadata.
- Export `runNativeDrawingDwgResaveAttempt(options)` with claim, service RPC client, download/resave dependencies, trusted image and optional worker-shutdown signal. Return discriminated outcomes prepared/cancelled/retry_scheduled/failed/stale/control_uncertain/settlement_uncertain. Prepared carries claim and exact native result, not a receipt.

- [ ] Write signal-observing tests before implementation. A pending source or native operation must observe abort when the independently polled control changes. Preserve actual compiler/attestation validation rather than replacing it with a mock. The external-process seam may use a deterministic deferred operation; its test resolves only after its abort listener records cleanup.

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

- [ ] First add behavioral RED for the existing sandbox's indistinguishable cleanup failure versus ordinary abort; implement only the design's `NativeDrawingDwgResaveSandboxError.cleanupConfirmed` metadata. Prove uncertain create/removal/directory cleanup never reports confirmed, ordinary abort after actual cleanup reports confirmed, and reader error contract is unchanged. The bridge must not acknowledge cancellation or failure after unknown/unconfirmed native cleanup; assert uncertainty outcomes and zero settlement calls.
- [ ] Implement a1000ms independent poll with5000ms RPC deadlines and a separate execution controller. Run control before download and immediately after native return. Abort on any refusal/uncertainty, wait for execution cleanup, stop timers, and only then acknowledge cancellation. Use existing native timeout120s/cleanup10s and import source limit200MiB. Ordinary failure goes through the fenced failure RPC; uncertainty never returns prepared or silently retries admission.
- [ ] Exercise actual sandbox cancellation with the already available immutable resaver image in an owned local probe; do not rebuild or replace the user's running preview. Run full focused attestation/source/compiler/protocol/job/worker tests and platform/worker typechecks. Obtain independent spec/quality review.
- [ ] Record final implemented scope, exact source/runtime identity and any unexecuted actual-process/database checks. Update the continuation map to artifact publication/download/Auth/browser handoff; never mark the overall goal complete or wire scheduled/UI execution before the next unit can publish verified immutable results.

