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

- [ ] Add fixture export `proveNativeDwgResaveJobAuthority({owner,workerA,workerB,ids,imported})`. Reuse the canonical imported project's unmodified approved revision for no-op. Create an additional trusted template clone, read its canonical current object, and apply a supported nonzero LINE change using the existing operation RPC before review/approval. Do not seed invented approved snapshots or compiled edits. The service admission receives Task1's actual compiler output.
- [ ] Start with absent RPC/schema RED through the existing real PostgreSQL wrapper (not a PGlite substitute). Add independently awaited session barriers and tests for:

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
- [ ] Implement private context via the existing private actor resolver and already verified import-job source. Reuse the established project→job lock order, fixed-role JWT guard and retention deletion helper. Admit stores exact attestation and source immutably; no_changes rows participate in request-ID replay. Claim/fail/control/ack never grant drawing write authority. Every public/application grant is explicit; direct table privileges remain revoked with forced RLS.
- [ ] Implement user adapter verified identity and scope-only input. Malformed, aborted, followed-login/wrong response or mismatched job/request identity must fail generically; service errors map PNR12/13/15 without exposing raw messages. Unit tests exercise actual adapter calls with complete transport responses.
- [ ] Run adapter tests, actual PostgreSQL cases, migration replay and local advisors. Keep logs and exact source hashes. Independent review must accept replay, source confidentiality, cancellation races and retention before Task3 integration.


