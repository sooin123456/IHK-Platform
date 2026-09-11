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

## Task 1: Verified artifacts and shared imported Storage transport

**Files:**
- Create platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
- Modify platform/native-dwg-worker/src/supabase.ts (existing private Storage primitives only; preserve its other adapters)
- Create platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs
- Create platform/tests/drawing-native-dwg-resave-artifacts.test.mjs
- Create platform/tests/drawing-native-dwg-resave-storage.test.mjs
- Read existing resave jobs, attestation, protocol, source fixture and source-free Storage tests.

**Interfaces:**
- Consumes parseNativeDrawingDwgResaveClaim(raw,imageId), buildNativeDrawingDwgResaveAttestation(scope,payload,imageId), decodeNativeDrawingDwgResaveOutput(bytes,expected); read exact existing signatures before calling.
- Produces NATIVE_DWG_RESAVE_ARTIFACT_LIMITS = {dwg:209715200,edit_request:2097152,authority:67108864,report:1048576}; DWG min6 and other artifacts min1, all safe integers.
- Produces strict NativeDrawingDwgResaveArtifactKindSchema, NativeDrawingDwgResaveReceiptSchema, NativeDrawingDwgResaveDescriptorSchema.
- buildNativeDrawingDwgResaveArtifacts(rawClaim,rawResult,imageId): Promise<{claim,bytesByKind:Record<Kind,Buffer>,metadata:Array<{kind,sha256,byteSize}>}>.
- nativeDrawingDwgResaveArtifactPath(scope,jobId,attemptNumber,metadata): string.
- validateNativeDrawingDwgResaveStagedArtifacts(raw,claim,metadata): parsed {jobId,attemptNumber,leaseToken,uploadState:"open"|"closed",artifacts:Array<{kind,sha256,byteSize,path}>}.
- validateNativeDrawingDwgResaveReceipt(raw,claim,metadata): parsed exact public receipt (spec schema, no token/path).
- createNativeDwgResaveStorageTransport(rawConfig,runtime?) uses {supabaseUrl,serviceRoleKey} and optional fetch/lowered artifactLimits; returns the same upload/read call shapes as createNativeDwgStorageTransport but new kinds. New NativeDwgConfirmedUploadError distinguishes definite no-write from existing NativeDwgUncertainUploadError.
- Fixture resaveArtifactFixture(buildAttestation) returns {claim,result,imageId,sourceBytes}; uses actual production attestation with finite literal native output, explicitly not actual native evidence.

- [ ] Write failing behavior tests. Use Vite SSR as existing tests do, real production compiler, independently hashed finite bytes. Example:

```js
const f = await resaveArtifactFixture(buildAttestation);
const artifacts = await buildNativeDrawingDwgResaveArtifacts(f.claim, f.result, f.imageId);
assert.deepEqual(artifacts.metadata.map(x => x.kind), ["dwg", "edit_request", "authority", "report"]);
assert.equal(artifacts.bytesByKind.edit_request.toString("utf8"), f.claim.attestation.request.text);
assert.equal(artifacts.bytesByKind.authority.toString("utf8"), f.claim.attestation.authority.text);
assert.equal(artifacts.metadata[0].sha256, createHash("sha256").update(f.result.dwgBytes).digest("hex"));
```

  Also reject wrong pinned image, rebuilt-attestation mismatch, report object/bytes disagreement, no-op, output/source/request mismatch, invalid size/header, extra fields, swapped/duplicate/missing kinds, other scope/job/attempt/hash/filename, and injected receipt authority. Start build then mutate caller claim/result buffers to prove snapshots precede awaits. Validate exact staged replay and closed response.
- [ ] Run new tests before production edits: `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-storage.test.mjs`. Record expected feature-missing assertion, not syntax/setup error.
- [ ] Implement core by snapshotting raw claim/result synchronously, parsing claim with pinned image, rebuilding and deep-comparing attestation, encoding copied report/DWG into existing protocol frame and decoding it with independent claim-derived expected identity. Copy exact attestation UTF8 text. Derive ordered metadata with Node SHA256; validate immutable receipt/path schemas. Keep server path derivation shared inside this module.
- [ ] Factor one private Storage transport using two explicit profiles; preserve source-free API/error behavior. Imported validation checks exact project/job/attempt/hash/filename path and bounded sizes, immutable copied POST, x-upsert:false. Only explicit Duplicate/ResourceAlreadyExists is exists; read full bounded bodies. Unknown POST fetch/body failure uses uncertain class; definite before-send or fully consumed HTTP refusal uses confirmed class only for new profile. Caller must still verify full readback before publication.
- Task1 review clarification: synchronous throws after invoking request are uncertain, like rejected promises. Confirmed non-duplicate HTTP initially means only fully consumed401 + InvalidJWT; unknown/malformed/status-mismatched4xx and all5xx remain uncertain. Tests must start a real owned loopback POST before a synchronous injected throw and cover explicit401 rejection versus503/unknown4xx.
- [ ] Real loopback HTTP tests exercise no-upsert/copied body, success/duplicate/definite HTTP refusal, after-start disconnect/body failure uncertainty, bounded upload-response/read streams, lowered caps and cross-profile kind/path rejection. No paid/remote request; server fixture teardown is test-only. Source-free regression command: `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-worker.test.mjs`.
- [ ] Run focused/new plus existing resave worker/protocol and source-free Storage tests once, self-review and write exact commands/results/RED/GREEN and any limits to task-1-report.md. Controller independently reviews exact delta; no commit.
