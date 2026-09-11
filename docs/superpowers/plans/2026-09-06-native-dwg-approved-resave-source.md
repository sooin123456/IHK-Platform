# Approved imported-DWG resave source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile native DWG selected edits from a verified approved canonical snapshot, including clone-remapped objects.

**Architecture:** Add a separate read-only authority RPC and strict server adapter. Reuse canonical hydration, immutable import receipts, native projection and the existing selected-edits compiler. Prove the bridge with actual canonical import/approval/clone transactions.

**Tech Stack:** Existing PostgreSQL/Supabase, TypeScript/Zod, Node tests and pinned ACadSharp 3.7.1 only.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-approved-resave-source-design.md`

## Global Constraints

- Preserve existing dirty worktree changes; no commit, stage, merge, push or deployment.
- No new dependency, paid service, license contract or remote DB/Storage mutation.
- No changes to source-free native export or selected-edit compiler contracts.
- Original source bytes and approved revisions remain immutable.
- Native output remains experimental-unqualified; persistenceAuthority remains not-issued.
- Do not modify or restart the live port 4173 preview, or overwrite its platform/build assets.
- Use only owned disposable local fixtures; do not use customer data.

---

### Task 1: Approved source resolution and clone-aware edit compilation

**Files:**
- Modify: `platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql` (CLI-created empty migration).
- Create: `platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts`.
- Create: `platform/tests/drawing-native-dwg-resave-source.test.mjs`.
- Modify: `platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs` for a narrow exported/invoked approved-resave proof, or create a sibling fixture if clearer and invoke it from this existing fixture.
- Modify only if needed to connect the fixture: `platform/tests/drawing-workspace-m1-real-database.test.mjs`.
- Create test-only helpers within the new test/fixture when required; no production test hooks.

**Interfaces:**
- Consumes `NativeDrawingDwgScopeSchema`, `NativeDrawingDwgImportScopeSchema`, `NativeDrawingDwgImportResultSchema`, `hydrateDrawingAuthoritySnapshot`, `buildNativeDrawingDwgImportPlan`, `projectNativeDrawingDwgImport`, `buildNativeDrawingDwgSelectedEdits`.
- Produces exactly the two server functions and RPCs defined in the spec. Result `{scope, approved: {revisionId, revisionVersion, snapshotSha256, operationSequence}, analysisReceipt, bindings: [{objectId, handle}], selectedEdits}`. Bindings sort by numeric native handle. RPC payload `{approved, analysis: {scope, result}}`; reuse existing receipt schemas, no private storage descriptor.

- [x] **Step 1: Write failing behavior tests.** Assert the real adapter exists and accepts a literal valid approved fixture; map manually checked moved LINE end to native units, then reject rehashed malicious anchors instead of silently remapping them. Extend canonical DB fixture after its real approval and clone operations to call the new RPC. Example acceptance assertions:

```js
assert.equal(result.selectedEdits.request.schemaVersion, '1hk-dwg-edits/2');
assert.equal(result.selectedEdits.persistenceAuthority, 'not-issued');
assert.equal(noop.selectedEdits.request, null);
assert.deepEqual(result.bindings.map(x => x.objectId).sort(), approvedObjectIds.sort());
await assert.rejects(projectApprovedNativeDrawingDwgResaveSource(scope, forged),
  error => error.code === 'NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE');
```

Each expected native coordinate must be literal/hand-derived, not the output of the compiler. DB proof must exercise draft denial, approved acceptance, clone approval acceptance, denied actor/scope/source evidence and original source-free rejection. Watch the test fail because the RPC/function is absent before implementation. Use a fresh owned local PostgreSQL cluster if needed; record exact commands and cleanup.

- [x] **Step 2: Implement the separate SQL authority contract.** Use `security definer set search_path=''`, fully-qualified names and exact revoke/grants. Reuse current actor/capability and immutable source checks without changing old helpers. Validate the frozen approved snapshot and homogeneous anchors before joining the historical analysis result/verified upload. Return strict existing public receipt/result DTOs, not arbitrary raw table rows. Public wrapper maps unavailable/inaccessible/malformed evidence to one bounded `PNR01` message. Private helper grants no app-role execution. SQL shape:

```sql
create function public.lukas_qto_drawing_native_dwg_resave_source(p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or private.lukas_qto_verified_session() is not true
  then raise exception using errcode='PNR01', message='Approved DWG resave source is unavailable'; end if;
  result := private.lukas_drawing_native_dwg_resave_source_for_actor((select auth.uid()),p_scope);
  if result is null then raise exception using errcode='PNR01', message='Approved DWG resave source is unavailable'; end if;
  return result;
exception when others then
  raise exception using errcode='PNR01', message='Approved DWG resave source is unavailable';
end;
$$;
```

Private resolver supplies all joins/gates in the spec; no runtime SQL string patching of the old source-free resolver. Use primary/foreign-key constrained joins, inspect EXPLAIN on a seeded accepted scope and avoid adding an unproven index.

- [x] **Step 3: Implement strict server projection.** Validate request, payload scopes and byte hashes; hydrate the real canonical snapshot. Rebuild native baseline with frozen report units. Match current sources to report entities using all persisted source fields; verify object/layer cardinality and semantics. Normalize only verified clone IDs for the existing compiler. Keep edited geometry and style unchanged. Forward RPC via reflective existing pattern, reject RPC errors and mismatches with the generic typed error.

```ts
const selectedEdits = buildNativeDrawingDwgSelectedEdits({
  importInput,
  objects: boundCanonicalObjects,
});
return { scope, approved, analysisReceipt, bindings, selectedEdits };
```

The existing `DrawingObjectSchema` and compiler reject new/deleted objects, unknown geometry, non-permitted name/style/layer changes, bad sizes/text and partial native entity sets. Add adapter tests for clone mapping and default empty layer explicitly rather than weakening these checks.

- [x] **Step 4: Run GREEN and integration verification.** Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-source.test.mjs tests/drawing-native-dwg-source.test.mjs tests/drawing-native-dwg-selected-edits.test.mjs` from platform; run the updated real PostgreSQL test against an owned disposable loopback cluster with `M1_REAL_POSTGRES_REQUIRED=1`. Run `npm run typecheck` (not build in this live-preview checkout). If using CLI proof, use the current Debug DLL and synthetic original only, fresh temp output, exact source SHA before/after; never pass approved customer files to a host CLI.

- [x] **Step 5: Self-review and report.** Review only the changed files against the spec. Record RED/GREEN commands, counts, source/HEAD/index preservation and unresolved runtime/qualification gates in the task report. Leave changes uncommitted. Controller runs independent task and final reviews using dirty-baseline diffs.

## Independent validation track

Validate existing R2/R5 authenticated stories against a disposable copy including the current dirty source state, with separate build outputs and freshly published native DLL. This is evidence gathering, not a second implementation task. It may run alongside Task 1 and must not change the live checkout, remote services or user preview. Preserve failures as failures and report prerequisite gaps without claiming completion.
