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

- [ ] Write behavioral tests using the real approved-source fixture. The regression target is changed/truncated/wrong-scope bytes reaching native execution, not a particular source-code string. Assert the literal native edit request and independent SHA-256/UTF-8 size, plus a decoded exact authority envelope:

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

- [ ] Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-attestation.test.mjs` and retain actual missing-feature RED before production code.
- [ ] Implement fixed-order serialization around the existing projector, cloning/validating input before the first asynchronous boundary. The core operation is:

```ts
const text = JSON.stringify(projected.selectedEdits.request);
const request = projected.selectedEdits.request === null ? null : {
  text, sha256: createHash("sha256").update(text,"utf8").digest("hex"),
  byteSize: Buffer.byteLength(text,"utf8"),
  handles: projected.selectedEdits.request.edits.map(edit => edit.handle),
};
```

Build the nine-field authority envelope in the design's exact order. Parse strict nested objects before comparing canonical serialization; never accept reordered/noncanonical artifact bytes as a different valid encoding. No request ID or actor is consumed here; the queue binds them in Task2.
- [ ] Run the new test and existing `drawing-native-dwg-resave-source.test.mjs`, `drawing-native-dwg-selected-edits.test.mjs`, `drawing-native-dwg-resave-protocol.test.mjs`; run platform typecheck in an owned copy if generated build artifacts are needed. Save source hashes and request independent review of the exact task delta.
